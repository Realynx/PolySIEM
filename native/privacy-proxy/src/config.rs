//! The proxy configuration file: grammar, parser and validation.
//!
//! # Grammar
//!
//! **Space-delimited**, one record per line. `#` starts a comment; blank lines
//! are ignored. **An unset optional field is the literal token `-`, never an
//! empty field** - an empty field between two separators is indistinguishable
//! from a typo, and the rest of this codebase already settled on `-`.
//!
//! ```text
//! VPNPROXY 1
//! LISTEN <port> <tls|http>
//! EXIT <key> <ifname>
//! DEFAULT <direct|exit:KEY|block>
//! RULE <seq> <action> <src> <dst> <proto> <dports> <hostname> <rateKbps>
//! LIMITS <maxFlows> <idleSeconds> <pipeBytes> <workers>
//! ```
//!
//! ## Why spaces and not tabs
//!
//! Every other tab-delimited format in this feature is tab-delimited, and this
//! one deliberately is not. The agent ships this file to the router inside its
//! APPLY payload as one `PROXYCONF<TAB><line>` record per line, and
//! `normalizePrivacyProxyConfig` in `agent.ts` **rejects a config containing a tab**
//! precisely because a tab inside a line would break that framing. Spaces are
//! unambiguous here because no field can contain one: exit keys, interface
//! names, actions, CIDRs, port specs, hostnames and integers are all drawn from
//! character sets that exclude whitespace. A field that somehow did contain a
//! space would fail its own validator before it ever reached this parser.
//!
//! Fields are split on a single space after trimming the line, rather than on
//! runs of whitespace, so that a renderer which emitted a doubled separator or
//! an empty field fails loudly instead of being silently tolerated.
//!
//! * `VPNPROXY 1` must be the first non-comment line. A version bump makes an
//!   old binary fail the parse instead of half-understanding a new format - and
//!   because a failed parse keeps the *previous* config running, that failure is
//!   safe.
//! * `LISTEN` may appear more than once; each port gets its own listener and its
//!   own prelude parser. Ports must be >= 1024 so the proxy needs no
//!   `CAP_NET_BIND_SERVICE`.
//! * `RULE` lines are evaluated in the order they appear. `seq` must be dense
//!   from 1, which is a cheap way to catch a renderer that dropped a row.
//! * `LIMITS` is optional; see [`Config::default_limits`].
//!
//! `renderPrivacyProxyConfig` in `src/lib/integrations/privacy-router/proxy-config.ts` is
//! the only writer of this format, and `tests/config_golden.rs` pins the exact
//! text both sides agree on.
//!
//! # Why parse errors are values, not exits
//!
//! `SIGHUP` must never be able to kill the proxy. A config that fails to parse is
//! returned here as a [`ConfigError`] with a line number; the server logs it,
//! raises `DEGRADED`, and keeps serving the configuration it already had. The one
//! exception is the very first load at startup, where there is no previous
//! configuration to fall back to.

#![forbid(unsafe_code)]
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::arithmetic_side_effects,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented
)]

use core::fmt;

use crate::hostname::HostPattern;
use crate::parser::PeekMode;
use crate::rules::{Action, ActionLabel, Cidr4, PortSpec, Proto, Rule, MAX_EXIT_KEY};

/// Format version this binary understands.
pub const CONFIG_VERSION: &str = "1";
/// First field of the header line.
pub const CONFIG_MAGIC: &str = "VPNPROXY";

/// Ceiling on exits, mirroring `PRIVACY_ROUTER_MAX_EXITS`.
pub const MAX_EXITS: usize = 16;
/// Ceiling on rules, mirroring `PRIVACY_ROUTER_MAX_RULES`.
pub const MAX_RULES: usize = 200;
/// Ceiling on config lines, mirroring `PRIVACY_ROUTER_MAX_PROXY_CONFIG_LINES`.
pub const MAX_LINES: usize = 1024;
/// `IFNAMSIZ - 1`. A longer name cannot be handed to `SO_BINDTODEVICE`.
pub const MAX_IFNAME: usize = 15;
/// Lowest port the proxy will bind, so it needs no bind capability.
pub const MIN_LISTEN_PORT: u16 = 1024;

/// A parse or validation failure, with the 1-based line it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    /// 1-based line number, or 0 for a whole-file problem.
    pub line: usize,
    /// Human-readable cause. Safe to log: it never echoes untrusted bytes.
    pub message: String,
}

impl ConfigError {
    fn at(line: usize, message: impl Into<String>) -> Self {
        Self {
            line,
            message: message.into(),
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.line == 0 {
            f.write_str(&self.message)
        } else {
            write!(f, "line {}: {}", self.line, self.message)
        }
    }
}

impl std::error::Error for ConfigError {}

/// One listening socket.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Listener {
    /// TCP port, >= [`MIN_LISTEN_PORT`].
    pub port: u16,
    /// Which prelude to expect from clients arriving here.
    pub mode: PeekMode,
}

/// One WireGuard tunnel the proxy may pin an upstream socket to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Exit {
    /// Stable key, `[A-Za-z0-9_-]{1,32}`. Appears in stats as `exit:<key>`.
    pub key: String,
    /// Kernel interface name passed to `SO_BINDTODEVICE`.
    pub ifname: String,
}

/// A parsed, validated configuration.
#[derive(Clone, Debug)]
pub struct Config {
    /// Listening sockets, at least one.
    pub listeners: Vec<Listener>,
    /// Exits, indexed by [`Action::Exit`].
    pub exits: Vec<Exit>,
    /// The ordered rule list, in evaluation order.
    pub rules: Vec<Rule>,
    /// Applied when no rule matches.
    pub default_action: Action,
    /// Precomputed stats label for [`Config::default_action`].
    pub default_label: ActionLabel,
    /// Hard ceiling on concurrent flows across all workers.
    pub max_flows: usize,
    /// Seconds of inactivity after which a flow is reaped.
    pub idle_secs: u64,
    /// Requested pipe capacity. The kernel is allowed to give us less.
    pub pipe_bytes: usize,
    /// Worker threads, or 0 for `min(nproc, 4)`.
    pub workers: usize,
}

impl Config {
    /// Limit defaults, sized for the 512 MB / 2 vCPU box in design doc §4.
    #[must_use]
    pub const fn default_limits() -> (usize, u64, usize, usize) {
        (512, 120, 1 << 20, 0)
    }

    /// Parse and validate the whole file.
    ///
    /// # Errors
    /// Returns the first [`ConfigError`] found, with its line number.
    pub fn parse(text: &str) -> Result<Self, ConfigError> {
        let mut builder = Builder::new();
        let mut seen_header = false;

        for (offset, raw) in text.lines().enumerate() {
            let number = offset.saturating_add(1);
            if number > MAX_LINES {
                return Err(ConfigError::at(
                    number,
                    format!("config exceeds {MAX_LINES} lines"),
                ));
            }
            // `trim` rather than just stripping `\r`: a trailing space would
            // otherwise produce a spurious empty final field.
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if !seen_header {
                parse_header(line, number)?;
                seen_header = true;
                continue;
            }
            builder.record(line, number)?;
        }

        if !seen_header {
            return Err(ConfigError::at(
                0,
                format!("missing {CONFIG_MAGIC} header line"),
            ));
        }
        builder.finish()
    }
}

fn parse_header(line: &str, number: usize) -> Result<(), ConfigError> {
    let mut fields = line.split(' ');
    let magic = fields.next().unwrap_or_default();
    let version = fields.next().unwrap_or_default();
    if magic != CONFIG_MAGIC {
        return Err(ConfigError::at(
            number,
            format!("expected a {CONFIG_MAGIC} header"),
        ));
    }
    if version != CONFIG_VERSION {
        return Err(ConfigError::at(
            number,
            format!("unsupported config version (this binary speaks {CONFIG_VERSION})"),
        ));
    }
    if fields.next().is_some() {
        return Err(ConfigError::at(
            number,
            "trailing fields on the header line",
        ));
    }
    Ok(())
}

/// Accumulates records, then resolves and validates them in [`Builder::finish`].
///
/// Two passes so that `EXIT` and `RULE` lines may appear in any order: a rule
/// naming an exit declared further down the file still resolves.
struct Builder {
    listeners: Vec<Listener>,
    exits: Vec<Exit>,
    pending: Vec<(PendingRule, usize)>,
    default_action: Option<(String, usize)>,
    limits: Option<(usize, u64, usize, usize)>,
}

struct PendingRule {
    seq: u16,
    action: String,
    src: Option<Cidr4>,
    dst: Option<Cidr4>,
    proto: Option<Proto>,
    dports: Option<PortSpec>,
    host: Option<HostPattern>,
    rate_kbps: Option<u32>,
}

impl Builder {
    fn new() -> Self {
        Self {
            listeners: Vec::new(),
            exits: Vec::new(),
            pending: Vec::new(),
            default_action: None,
            limits: None,
        }
    }

    fn record(&mut self, line: &str, number: usize) -> Result<(), ConfigError> {
        let mut fields = line.split(' ');
        match fields.next().unwrap_or_default() {
            "LISTEN" => self.listen(&mut fields, number),
            "EXIT" => self.exit(&mut fields, number),
            "DEFAULT" => self.default(&mut fields, number),
            "RULE" => self.rule(&mut fields, number),
            "LIMITS" => self.limits(&mut fields, number),
            other => Err(ConfigError::at(
                number,
                format!("unknown record type {:?}", sanitise_token(other)),
            )),
        }
    }

    fn listen(&mut self, fields: &mut Fields<'_>, number: usize) -> Result<(), ConfigError> {
        let port = required(fields, number, "LISTEN port")?
            .parse::<u16>()
            .map_err(|_| ConfigError::at(number, "LISTEN port is not a number"))?;
        if port < MIN_LISTEN_PORT {
            return Err(ConfigError::at(
                number,
                format!("LISTEN port must be >= {MIN_LISTEN_PORT} so no bind capability is needed"),
            ));
        }
        let mode = match required(fields, number, "LISTEN mode")? {
            "tls" => PeekMode::Tls,
            "http" => PeekMode::Http,
            _ => return Err(ConfigError::at(number, "LISTEN mode must be tls or http")),
        };
        if self.listeners.iter().any(|existing| existing.port == port) {
            return Err(ConfigError::at(number, "duplicate LISTEN port"));
        }
        self.listeners.push(Listener { port, mode });
        Ok(())
    }

    fn exit(&mut self, fields: &mut Fields<'_>, number: usize) -> Result<(), ConfigError> {
        let key = required(fields, number, "EXIT key")?;
        if !is_exit_key(key) {
            return Err(ConfigError::at(
                number,
                format!("EXIT key must match [A-Za-z0-9_-]{{1,{MAX_EXIT_KEY}}}"),
            ));
        }
        let ifname = required(fields, number, "EXIT interface")?;
        if !is_ifname(ifname) {
            return Err(ConfigError::at(
                number,
                format!("EXIT interface must be 1..={MAX_IFNAME} bytes of [A-Za-z0-9_.-]"),
            ));
        }
        if self.exits.iter().any(|existing| existing.key == key) {
            return Err(ConfigError::at(number, "duplicate EXIT key"));
        }
        if self.exits.len() >= MAX_EXITS {
            return Err(ConfigError::at(
                number,
                format!("more than {MAX_EXITS} exits"),
            ));
        }
        self.exits.push(Exit {
            key: key.to_owned(),
            ifname: ifname.to_owned(),
        });
        Ok(())
    }

    fn default(&mut self, fields: &mut Fields<'_>, number: usize) -> Result<(), ConfigError> {
        if self.default_action.is_some() {
            return Err(ConfigError::at(number, "DEFAULT given more than once"));
        }
        let action = required(fields, number, "DEFAULT action")?;
        self.default_action = Some((action.to_owned(), number));
        Ok(())
    }

    fn limits(&mut self, fields: &mut Fields<'_>, number: usize) -> Result<(), ConfigError> {
        let (d_flows, d_idle, d_pipe, d_workers) = Config::default_limits();
        let max_flows = optional_number(fields, number, "maxFlows", d_flows)?;
        let idle = optional_number(fields, number, "idleSeconds", d_idle)?;
        let pipe = optional_number(fields, number, "pipeBytes", d_pipe)?;
        let workers = optional_number(fields, number, "workers", d_workers)?;
        if max_flows == 0 {
            return Err(ConfigError::at(number, "maxFlows must be at least 1"));
        }
        self.limits = Some((max_flows, idle, pipe, workers));
        Ok(())
    }

    fn rule(&mut self, fields: &mut Fields<'_>, number: usize) -> Result<(), ConfigError> {
        let seq = required(fields, number, "RULE seq")?
            .parse::<u16>()
            .map_err(|_| ConfigError::at(number, "RULE seq is not a number"))?;
        let action = required(fields, number, "RULE action")?.to_owned();
        let src = optional_with(fields, number, "RULE src", Cidr4::parse)?;
        let dst = optional_with(fields, number, "RULE dst", Cidr4::parse)?;
        let proto = optional_with(fields, number, "RULE proto", |text| match text {
            "tcp" => Some(Proto::Tcp),
            "udp" => Some(Proto::Udp),
            _ => None,
        })?;
        let dports = optional_with(fields, number, "RULE dports", PortSpec::parse)?;
        let host = optional_with(fields, number, "RULE hostname", |text| {
            HostPattern::parse(text.as_bytes())
        })?;
        let rate_kbps = optional_with(fields, number, "RULE rateKbps", |text| {
            text.parse::<u32>().ok().filter(|rate| *rate > 0)
        })?;
        if fields.next().is_some() {
            return Err(ConfigError::at(number, "trailing fields on a RULE line"));
        }
        if self.pending.len() >= MAX_RULES {
            return Err(ConfigError::at(
                number,
                format!("more than {MAX_RULES} rules"),
            ));
        }
        self.pending.push((
            PendingRule {
                seq,
                action,
                src,
                dst,
                proto,
                dports,
                host,
                rate_kbps,
            },
            number,
        ));
        Ok(())
    }

    fn finish(self) -> Result<Config, ConfigError> {
        if self.listeners.is_empty() {
            return Err(ConfigError::at(0, "no LISTEN lines"));
        }
        let Some((default_text, default_line)) = self.default_action else {
            return Err(ConfigError::at(0, "no DEFAULT line"));
        };
        let default_action = resolve_action(&default_text, &self.exits, default_line)?;
        let default_label = action_label(default_action, &self.exits, default_line)?;

        let mut rules = Vec::with_capacity(self.pending.len());
        for (index, (pending, line)) in self.pending.into_iter().enumerate() {
            let expected = u16::try_from(index.saturating_add(1))
                .map_err(|_| ConfigError::at(line, "too many rules"))?;
            if pending.seq != expected {
                return Err(ConfigError::at(
                    line,
                    format!("RULE seq must be dense from 1 (expected {expected})"),
                ));
            }
            let action = resolve_action(&pending.action, &self.exits, line)?;
            rules.push(Rule {
                seq: pending.seq,
                action,
                label: action_label(action, &self.exits, line)?,
                src: pending.src,
                dst: pending.dst,
                proto: pending.proto,
                dports: pending.dports,
                host: pending.host,
                rate_kbps: pending.rate_kbps,
            });
        }

        let (max_flows, idle_secs, pipe_bytes, workers) =
            self.limits.unwrap_or_else(Config::default_limits);

        Ok(Config {
            listeners: self.listeners,
            exits: self.exits,
            rules,
            default_action,
            default_label,
            max_flows,
            idle_secs,
            pipe_bytes,
            workers,
        })
    }
}

type Fields<'a> = core::str::Split<'a, char>;

fn required<'a>(
    fields: &mut Fields<'a>,
    number: usize,
    what: &str,
) -> Result<&'a str, ConfigError> {
    fields
        .next()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ConfigError::at(number, format!("missing {what}")))
}

fn optional_with<T>(
    fields: &mut Fields<'_>,
    number: usize,
    what: &str,
    parse: impl Fn(&str) -> Option<T>,
) -> Result<Option<T>, ConfigError> {
    let value = required(fields, number, what)?;
    if value == "-" {
        return Ok(None);
    }
    parse(value).map(Some).ok_or_else(|| {
        ConfigError::at(
            number,
            format!("{what} is not valid: {:?}", sanitise_token(value)),
        )
    })
}

fn optional_number<T: core::str::FromStr>(
    fields: &mut Fields<'_>,
    number: usize,
    what: &str,
    fallback: T,
) -> Result<T, ConfigError> {
    match fields.next() {
        None | Some("-") => Ok(fallback),
        Some(value) => value
            .parse::<T>()
            .map_err(|_| ConfigError::at(number, format!("{what} is not a number"))),
    }
}

fn resolve_action(text: &str, exits: &[Exit], line: usize) -> Result<Action, ConfigError> {
    match text {
        "direct" => Ok(Action::Direct),
        "block" => Ok(Action::Block),
        _ => {
            let Some(key) = text.strip_prefix("exit:") else {
                return Err(ConfigError::at(
                    line,
                    format!(
                        "action must be direct, block or exit:<key>, got {:?}",
                        sanitise_token(text)
                    ),
                ));
            };
            let index = exits
                .iter()
                .position(|exit| exit.key == key)
                .ok_or_else(|| {
                    ConfigError::at(
                        line,
                        format!("action names undeclared exit {:?}", sanitise_token(key)),
                    )
                })?;
            Ok(Action::Exit(index))
        }
    }
}

fn action_label(action: Action, exits: &[Exit], line: usize) -> Result<ActionLabel, ConfigError> {
    match action {
        Action::Direct | Action::Block => Ok(ActionLabel::simple(action)),
        Action::Exit(index) => {
            let exit = exits
                .get(index)
                .ok_or_else(|| ConfigError::at(line, "internal: exit index out of range"))?;
            ActionLabel::exit(&exit.key)
                .ok_or_else(|| ConfigError::at(line, "exit key is too long for a stats label"))
        }
    }
}

fn is_exit_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_EXIT_KEY
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// Interface names accepted by `SO_BINDTODEVICE`.
///
/// Character set matches `INTERFACE_NAME_PATTERN` in `agent.ts`, including `:`
/// for alias interfaces such as `eth0:1`. Notably it excludes whitespace, which
/// is what lets the config file be space-delimited.
fn is_ifname(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_IFNAME
        && name.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || byte == b'_'
                || byte == b'-'
                || byte == b'.'
                || byte == b':'
        })
}

/// Trim and strip non-printable bytes from a token before it reaches a log.
///
/// The config file is written by PolySIEM rather than by a remote peer, so this
/// is defence in depth - but the error strings it builds end up in journald and
/// in the UI, and a config that arrived over a compromised channel should not be
/// able to inject escape sequences there.
fn sanitise_token(text: &str) -> String {
    text.chars()
        .take(64)
        .map(|ch| if ch.is_ascii_graphic() { ch } else { '?' })
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::indexing_slicing,
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::arithmetic_side_effects
    )]

    use super::*;

    const SAMPLE: &str = concat!(
        "VPNPROXY 1\n",
        "# a comment\n",
        "\n",
        "LISTEN 8080 http\n",
        "LISTEN 8443 tls\n",
        "EXIT us-nyc psvpn0\n",
        "EXIT se-sto psvpn1\n",
        "DEFAULT direct\n",
        "RULE 1 exit:us-nyc - - - - *.netflix.com -\n",
        "RULE 2 block 10.0.3.50/32 - tcp 443 - -\n",
        "RULE 3 exit:se-sto - - - 80,443 bbc.co.uk 2048\n",
        "LIMITS 256 90 262144 2\n",
    );

    #[test]
    fn parses_the_reference_config() {
        let config = Config::parse(SAMPLE).expect("sample parses");
        assert_eq!(config.listeners.len(), 2);
        assert_eq!(config.listeners[0].mode, PeekMode::Http);
        assert_eq!(config.listeners[1].mode, PeekMode::Tls);
        assert_eq!(config.exits.len(), 2);
        assert_eq!(config.rules.len(), 3);
        assert_eq!(config.default_action, Action::Direct);
        assert_eq!(config.rules[0].action, Action::Exit(0));
        assert_eq!(config.rules[0].label.as_bytes(), b"exit:us-nyc");
        assert_eq!(config.rules[2].rate_kbps, Some(2048));
        assert_eq!(config.max_flows, 256);
        assert_eq!(config.idle_secs, 90);
        assert_eq!(config.pipe_bytes, 262_144);
        assert_eq!(config.workers, 2);
    }

    #[test]
    fn limits_are_optional() {
        let text = SAMPLE.replace("LIMITS 256 90 262144 2\n", "");
        let config = Config::parse(&text).unwrap();
        let (flows, idle, pipe, workers) = Config::default_limits();
        assert_eq!(
            (
                config.max_flows,
                config.idle_secs,
                config.pipe_bytes,
                config.workers
            ),
            (flows, idle, pipe, workers)
        );
    }

    #[test]
    fn an_exit_may_be_declared_after_the_rule_that_names_it() {
        let text = concat!(
            "VPNPROXY 1\n",
            "LISTEN 8443 tls\n",
            "DEFAULT direct\n",
            "RULE 1 exit:later - - - - - -\n",
            "EXIT later psvpn9\n",
        );
        assert_eq!(
            Config::parse(text).unwrap().rules[0].action,
            Action::Exit(0)
        );
    }

    #[test]
    fn rejects_the_ways_a_renderer_can_go_wrong() {
        let cases: &[(&str, &str)] = &[
            ("VPNPROXY 2\nLISTEN 8443 tls\nDEFAULT direct\n", "version"),
            ("LISTEN 8443 tls\n", "VPNPROXY"),
            ("VPNPROXY 1\nDEFAULT direct\n", "no LISTEN"),
            ("VPNPROXY 1\nLISTEN 8443 tls\n", "no DEFAULT"),
            (
                "VPNPROXY 1\nLISTEN 443 tls\nDEFAULT direct\n",
                "bind capability",
            ),
            (
                "VPNPROXY 1\nLISTEN 8443 tls\nDEFAULT exit:ghost\n",
                "undeclared exit",
            ),
            (
                "VPNPROXY 1\nLISTEN 8443 tls\nDEFAULT direct\nRULE 2 direct - - - - - -\n",
                "dense from 1",
            ),
            (
                "VPNPROXY 1\nLISTEN 8443 tls\nLISTEN 8443 http\nDEFAULT direct\n",
                "duplicate LISTEN",
            ),
            (
                "VPNPROXY 1\nLISTEN 8443 tls\nDEFAULT direct\nWAT x\n",
                "unknown record type",
            ),
        ];
        for (text, expected) in cases {
            let error = Config::parse(text).expect_err(&format!("{text:?} should fail"));
            assert!(
                error.message.contains(expected),
                "expected {expected:?} in {error}"
            );
        }
    }

    #[test]
    fn an_empty_field_is_not_the_same_as_an_unset_one() {
        // `-` means unset; a genuinely empty field is a renderer bug.
        let text = "VPNPROXY 1\nLISTEN 8443 tls\nDEFAULT direct\nRULE 1 direct  - - - - -\n";
        assert!(Config::parse(text).is_err());
    }

    #[test]
    fn error_messages_never_echo_raw_control_bytes() {
        let text = "VPNPROXY 1\nLISTEN 8443 tls\nDEFAULT direct\nRULE 1 dir\x07ect - - - - - -\n";
        let error = Config::parse(text).unwrap_err();
        assert!(!error.message.contains('\x07'));
        assert!(error.message.contains('?'));
    }
}
