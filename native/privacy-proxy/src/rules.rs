//! The ordered, first-match-wins rule list, and the types it is built from.
//!
//! The proxy evaluates the **full** list, including the rules nftables could have
//! decided on its own. That is deliberate (design doc §2.2): the proxy is the only
//! evaluator that knows source address, destination address, destination port
//! *and* hostname at once, so having it re-evaluate everything in the original
//! order is what makes the two tiers agree. Splitting the list would create two
//! evaluators with two orders and one of them would be wrong.

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
use core::str::FromStr as _;
// `std::net`, not `core::net`: the latter only stabilised in 1.77 and the crate
// declares `rust-version = "1.74"` so it still builds on an older image.
use std::net::Ipv4Addr;

use crate::hostname::{HostPattern, Hostname};

/// Longest exit key accepted, matching the agent's `exit:[A-Za-z0-9_-]{1,32}`.
pub const MAX_EXIT_KEY: usize = 32;
/// `exit:` + the longest key.
const MAX_ACTION_LABEL: usize = 5 + MAX_EXIT_KEY;
/// Ceiling on the comma-separated parts of one port spec.
const MAX_PORT_RANGES: usize = 32;

/// What a rule does with a flow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// Egress over the normal WAN.
    Direct,
    /// Egress over the exit at this index in [`crate::config::Config::exits`].
    Exit(usize),
    /// Refuse the flow.
    Block,
}

/// TCP or UDP. The proxy only ever sees TCP, so a `Udp` condition never matches.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Proto {
    /// TCP.
    Tcp,
    /// UDP - inert on this tier by construction.
    Udp,
}

/// An action rendered as the token the stats file carries: `direct`, `block` or
/// `exit:<key>`.
///
/// Precomputed when the config is parsed so that recording a flow copies a fixed
/// array instead of formatting a string - the stats path runs per flow and must
/// not allocate.
#[derive(Clone, Copy)]
pub struct ActionLabel {
    bytes: [u8; MAX_ACTION_LABEL],
    len: u8,
}

impl ActionLabel {
    /// `direct` or `block`.
    #[must_use]
    pub fn simple(action: Action) -> Self {
        let text: &[u8] = match action {
            Action::Direct => b"direct",
            Action::Block => b"block",
            // An `Exit` label needs its key; callers use `exit` instead. Falling
            // back to `direct` here would misreport an exit flow, so use a token
            // that is obviously wrong rather than one that is plausibly right.
            Action::Exit(_) => b"exit",
        };
        Self::from_bytes(text)
    }

    /// `exit:<key>`. Returns `None` if the key is longer than [`MAX_EXIT_KEY`].
    #[must_use]
    pub fn exit(key: &str) -> Option<Self> {
        if key.is_empty() || key.len() > MAX_EXIT_KEY {
            return None;
        }
        let mut bytes = [0u8; MAX_ACTION_LABEL];
        let mut len = 0usize;
        for (slot, byte) in bytes.iter_mut().zip(b"exit:".iter().chain(key.as_bytes())) {
            *slot = *byte;
            len = len.checked_add(1)?;
        }
        Some(Self {
            bytes,
            len: u8::try_from(len).ok()?,
        })
    }

    fn from_bytes(text: &[u8]) -> Self {
        let mut bytes = [0u8; MAX_ACTION_LABEL];
        let mut len = 0u8;
        for (slot, byte) in bytes.iter_mut().zip(text.iter()) {
            *slot = *byte;
            len = len.saturating_add(1);
        }
        Self { bytes, len }
    }

    /// The label bytes. Always matches `direct|block|exit:[A-Za-z0-9_-]{1,32}`.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        self.bytes.get(..usize::from(self.len)).unwrap_or(&[])
    }
}

impl fmt::Display for ActionLabel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(core::str::from_utf8(self.as_bytes()).unwrap_or("?"))
    }
}

impl fmt::Debug for ActionLabel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ActionLabel({self})")
    }
}

impl PartialEq for ActionLabel {
    fn eq(&self, other: &Self) -> bool {
        self.as_bytes() == other.as_bytes()
    }
}

impl Eq for ActionLabel {}

/// An IPv4 network. IPv6 is out of scope for v1 and the box fails closed on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cidr4 {
    network: u32,
    mask: u32,
}

impl Cidr4 {
    /// Parse `a.b.c.d/len`, or a bare address as a /32.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let (addr_text, prefix) = match text.split_once('/') {
            Some((addr, len)) => (addr, len.parse::<u32>().ok()?),
            None => (text, 32u32),
        };
        if prefix > 32 {
            return None;
        }
        let addr = Ipv4Addr::from_str(addr_text).ok()?;
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX.checked_shl(32u32.checked_sub(prefix)?)?
        };
        Some(Self {
            network: u32::from(addr) & mask,
            mask,
        })
    }

    /// Is `addr` inside this network?
    #[must_use]
    pub fn contains(&self, addr: Ipv4Addr) -> bool {
        u32::from(addr) & self.mask == self.network
    }
}

/// A destination-port condition: `443`, `80,443`, `8000-8100`, or a mix.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PortSpec {
    ranges: Vec<(u16, u16)>,
}

impl PortSpec {
    /// Parse a comma-separated list of ports and inclusive ranges.
    ///
    /// Allocates, but only while the config is being loaded - never per flow.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let mut ranges = Vec::new();
        for part in text.split(',') {
            if ranges.len() >= MAX_PORT_RANGES {
                return None;
            }
            let part = part.trim();
            let range = match part.split_once('-') {
                Some((low, high)) => {
                    let low = low.trim().parse::<u16>().ok()?;
                    let high = high.trim().parse::<u16>().ok()?;
                    if low > high {
                        return None;
                    }
                    (low, high)
                }
                None => {
                    let port = part.parse::<u16>().ok()?;
                    (port, port)
                }
            };
            ranges.push(range);
        }
        if ranges.is_empty() {
            return None;
        }
        Some(Self { ranges })
    }

    /// Does `port` fall in any of the ranges?
    #[must_use]
    pub fn contains(&self, port: u16) -> bool {
        self.ranges
            .iter()
            .any(|(low, high)| *low <= port && port <= *high)
    }
}

/// One row of the ordered list.
#[derive(Clone, Debug)]
pub struct Rule {
    /// 1-based position, dense, as written by PolySIEM.
    pub seq: u16,
    /// What to do when every condition below matches.
    pub action: Action,
    /// Precomputed stats label for [`Rule::action`].
    pub label: ActionLabel,
    /// Source address condition.
    pub src: Option<Cidr4>,
    /// Destination address condition, tested against `SO_ORIGINAL_DST`.
    pub dst: Option<Cidr4>,
    /// Protocol condition. `Some(Proto::Udp)` makes the rule inert here.
    pub proto: Option<Proto>,
    /// Destination-port condition, tested against `SO_ORIGINAL_DST`.
    pub dports: Option<PortSpec>,
    /// Hostname condition. Never matches a flow whose hostname is unknown.
    pub host: Option<HostPattern>,
    /// Throttle in kilobits per second, shared by every flow matching this rule.
    pub rate_kbps: Option<u32>,
}

/// Everything known about a flow at the moment the rule list is evaluated.
#[derive(Clone, Copy, Debug)]
pub struct FlowKey {
    /// The client.
    pub src: Ipv4Addr,
    /// The destination the client originally asked for.
    pub dst: Ipv4Addr,
    /// The destination port the client originally asked for (80 or 443).
    pub dport: u16,
    /// The hostname, if the prelude yielded one.
    pub host: Option<Hostname>,
}

impl Rule {
    /// Does this rule match `key`? Every present condition must hold.
    #[must_use]
    pub fn matches(&self, key: &FlowKey) -> bool {
        if let Some(src) = self.src {
            if !src.contains(key.src) {
                return false;
            }
        }
        if let Some(dst) = self.dst {
            if !dst.contains(key.dst) {
                return false;
            }
        }
        // Everything reaching the proxy is TCP, so a UDP condition can never be
        // satisfied here. The UI states this consequence rather than letting an
        // operator discover it.
        if self.proto == Some(Proto::Udp) {
            return false;
        }
        if let Some(dports) = &self.dports {
            if !dports.contains(key.dport) {
                return false;
            }
        }
        if let Some(pattern) = &self.host {
            // A hostname rule cannot match a flow whose name we never learned;
            // the flow falls through to the IP/port rules below it.
            let Some(observed) = key.host.as_ref() else {
                return false;
            };
            if !pattern.matches(observed) {
                return false;
            }
        }
        true
    }
}

/// First rule that matches, with its index, or `None` for "use the default".
#[must_use]
pub fn match_rule<'a>(rules: &'a [Rule], key: &FlowKey) -> Option<(usize, &'a Rule)> {
    rules.iter().enumerate().find(|(_, rule)| rule.matches(key))
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

    fn rule(seq: u16) -> Rule {
        Rule {
            seq,
            action: Action::Direct,
            label: ActionLabel::simple(Action::Direct),
            src: None,
            dst: None,
            proto: None,
            dports: None,
            host: None,
            rate_kbps: None,
        }
    }

    fn key(src: &str, dst: &str, dport: u16, host: Option<&str>) -> FlowKey {
        FlowKey {
            src: Ipv4Addr::from_str(src).unwrap(),
            dst: Ipv4Addr::from_str(dst).unwrap(),
            dport,
            host: host.and_then(|h| Hostname::parse(h.as_bytes())),
        }
    }

    #[test]
    fn cidr_matching_handles_the_edges() {
        let any = Cidr4::parse("0.0.0.0/0").unwrap();
        assert!(any.contains(Ipv4Addr::from_str("8.8.8.8").unwrap()));

        let host = Cidr4::parse("10.0.3.70").unwrap();
        assert!(host.contains(Ipv4Addr::from_str("10.0.3.70").unwrap()));
        assert!(!host.contains(Ipv4Addr::from_str("10.0.3.71").unwrap()));

        let lan = Cidr4::parse("10.0.3.0/24").unwrap();
        assert!(lan.contains(Ipv4Addr::from_str("10.0.3.255").unwrap()));
        assert!(!lan.contains(Ipv4Addr::from_str("10.0.4.0").unwrap()));

        assert!(Cidr4::parse("10.0.3.0/33").is_none());
        assert!(Cidr4::parse("not-an-address").is_none());
    }

    #[test]
    fn port_specs_accept_lists_and_ranges() {
        let spec = PortSpec::parse("80,443,8000-8100").unwrap();
        assert!(spec.contains(80));
        assert!(spec.contains(443));
        assert!(spec.contains(8000));
        assert!(spec.contains(8100));
        assert!(!spec.contains(8101));
        assert!(PortSpec::parse("100-1").is_none());
        assert!(PortSpec::parse("").is_none());
    }

    #[test]
    fn first_match_wins_in_written_order() {
        let mut first = rule(1);
        first.host = HostPattern::parse(b"*.example.com");
        first.action = Action::Block;
        let second = rule(2);

        let rules = [first, second];
        let (index, matched) = match_rule(
            &rules,
            &key("10.0.3.5", "1.1.1.1", 443, Some("a.example.com")),
        )
        .unwrap();
        assert_eq!(index, 0);
        assert_eq!(matched.action, Action::Block);
    }

    #[test]
    fn a_hostname_rule_never_matches_a_flow_with_no_hostname() {
        let mut hostname_rule = rule(1);
        hostname_rule.host = HostPattern::parse(b"example.com");
        let rules = [hostname_rule];
        assert!(match_rule(&rules, &key("10.0.3.5", "1.1.1.1", 443, None)).is_none());
    }

    #[test]
    fn a_udp_rule_is_inert_on_the_inspected_tier() {
        let mut udp_rule = rule(1);
        udp_rule.proto = Some(Proto::Udp);
        let rules = [udp_rule];
        assert!(match_rule(&rules, &key("10.0.3.5", "1.1.1.1", 443, None)).is_none());
    }

    #[test]
    fn action_labels_render_the_wire_tokens() {
        assert_eq!(ActionLabel::simple(Action::Direct).as_bytes(), b"direct");
        assert_eq!(ActionLabel::simple(Action::Block).as_bytes(), b"block");
        assert_eq!(
            ActionLabel::exit("us-nyc").unwrap().as_bytes(),
            b"exit:us-nyc"
        );
        assert!(ActionLabel::exit(&"a".repeat(33)).is_none());
        assert!(ActionLabel::exit("").is_none());
    }
}
