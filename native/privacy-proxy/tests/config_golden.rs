//! The golden configuration file: one set of bytes, two implementations.
//!
//! `tests/fixtures/reference.conf` is the single artefact that keeps the Rust
//! parser and the TypeScript renderer honest about each other. It is asserted
//! from both sides:
//!
//! * here, that this parser reads it and produces the expected model;
//! * in `src/lib/integrations/privacy-router/proxy-config.test.ts`, that
//!   `renderPrivacyProxyConfig` produces these exact bytes.
//!
//! Neither side can drift without the other's test going red, which is the only
//! reliable way to keep a wire format agreed across two languages. Changing the
//! format means changing the fixture, and then both tests, deliberately.

#![allow(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic
)]

use polysiem_privacy_proxy::config::Config;
use polysiem_privacy_proxy::hostname::Hostname;
use polysiem_privacy_proxy::parser::PeekMode;
use polysiem_privacy_proxy::rules::{match_rule, Action, FlowKey};
use std::net::Ipv4Addr;
use std::str::FromStr as _;

/// The bytes both implementations agree on.
const REFERENCE: &str = include_str!("fixtures/reference.conf");

fn reference() -> Config {
    // Tolerate a CRLF checkout on Windows; the parser strips `\r` itself, this
    // is only so the byte-count assertion below is about content, not line
    // endings.
    Config::parse(&REFERENCE.replace("\r\n", "\n")).expect("the reference config must parse")
}

#[test]
fn the_reference_config_parses_into_the_expected_model() {
    let config = reference();

    assert_eq!(config.listeners.len(), 2);
    assert_eq!(config.listeners[0].port, 8080);
    assert_eq!(config.listeners[0].mode, PeekMode::Http);
    assert_eq!(config.listeners[1].port, 8443);
    assert_eq!(config.listeners[1].mode, PeekMode::Tls);

    // Exits are emitted in key order, so the rendered file is deterministic.
    assert_eq!(config.exits[0].key, "se-sto");
    assert_eq!(config.exits[0].ifname, "psvpn1");
    assert_eq!(config.exits[1].key, "us-nyc");
    assert_eq!(config.exits[1].ifname, "psvpn0");

    assert_eq!(config.default_action, Action::Direct);
    assert_eq!(config.rules.len(), 3);
    assert_eq!(config.rules[0].action, Action::Exit(1)); // us-nyc
    assert_eq!(config.rules[1].action, Action::Block);
    assert_eq!(config.rules[2].action, Action::Exit(0)); // se-sto
    assert_eq!(config.rules[2].rate_kbps, Some(2048));

    let (flows, idle, pipe, workers) = Config::default_limits();
    assert_eq!(config.max_flows, flows);
    assert_eq!(config.idle_secs, idle);
    assert_eq!(config.pipe_bytes, pipe);
    assert_eq!(config.workers, workers);
}

#[test]
fn the_reference_config_routes_the_flows_it_describes() {
    let config = reference();
    let evaluate = |source: &str, destination: &str, port: u16, host: Option<&str>| {
        let key = FlowKey {
            src: Ipv4Addr::from_str(source).unwrap(),
            dst: Ipv4Addr::from_str(destination).unwrap(),
            dport: port,
            host: host.and_then(|text| Hostname::parse(text.as_bytes())),
        };
        match_rule(&config.rules, &key).map_or(config.default_action, |(_, rule)| rule.action)
    };

    // Rule 1: any Netflix subdomain, and the apex, go out us-nyc.
    assert_eq!(
        evaluate("10.0.3.5", "1.2.3.4", 443, Some("www.netflix.com")),
        Action::Exit(1)
    );
    assert_eq!(
        evaluate("10.0.3.5", "1.2.3.4", 443, Some("netflix.com")),
        Action::Exit(1)
    );
    // ...but a lookalike does not.
    assert_eq!(
        evaluate("10.0.3.5", "1.2.3.4", 443, Some("notnetflix.com")),
        Action::Direct
    );

    // Rule 2: one host on the LAN is blocked on 443 regardless of name.
    assert_eq!(
        evaluate("10.0.3.50", "1.2.3.4", 443, Some("example.com")),
        Action::Block
    );
    // Rule 2 is scoped to 443, so port 80 falls through to the default.
    assert_eq!(
        evaluate("10.0.3.50", "1.2.3.4", 80, Some("example.com")),
        Action::Direct
    );

    // Rule 3: bbc.co.uk exactly, on 80 or 443, out se-sto.
    assert_eq!(
        evaluate("10.0.3.5", "1.2.3.4", 80, Some("bbc.co.uk")),
        Action::Exit(0)
    );
    // Exact pattern, so a subdomain is NOT covered.
    assert_eq!(
        evaluate("10.0.3.5", "1.2.3.4", 443, Some("www.bbc.co.uk")),
        Action::Direct
    );

    // A flow whose hostname was never learned skips every hostname rule.
    assert_eq!(evaluate("10.0.3.5", "1.2.3.4", 443, None), Action::Direct);
}

#[test]
fn the_reference_config_carries_no_tab_because_the_agent_rejects_one() {
    // `normalizePrivacyProxyConfig` in agent.ts refuses a config containing a tab:
    // the file crosses the wire as one `PROXYCONF<TAB><line>` record per line,
    // so a tab inside a line would break that framing. This assertion is the
    // Rust-side guard on that constraint.
    assert!(
        !REFERENCE.contains('\t'),
        "the proxy config must be space-delimited, never tab-delimited"
    );
}

#[test]
fn the_reference_config_is_space_delimited_with_no_empty_fields() {
    for (offset, raw) in REFERENCE.lines().enumerate() {
        let line = raw.trim_end_matches('\r');
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        assert!(
            line.contains(' '),
            "line {} has no separator: {line:?}",
            offset + 1
        );
        assert!(
            !line.split(' ').any(str::is_empty),
            "line {} has an empty field; unset must be the literal `-`: {line:?}",
            offset + 1
        );
        assert_eq!(
            line,
            line.trim(),
            "line {} has leading or trailing whitespace",
            offset + 1
        );
    }
}
