//! **The property test that justifies choosing Rust over C.**
//!
//! The vector table next door proves the parser handles the malformed inputs
//! somebody thought of. This file proves something strictly stronger and much
//! harder to get from a table: that for *arbitrary* bytes - every byte string
//! proptest can construct, plus targeted mutations of real ClientHellos - the
//! parser
//!
//! 1. **never panics**, so a remote peer cannot take a connection handler down.
//!    A panic in the datapath is a denial of service, and unwinding out of a
//!    worker takes the whole proxy with it (see `server::WorkerGuard`).
//! 2. **never loops unboundedly**, so a remote peer cannot pin a worker thread.
//!    Enforced structurally by the `FUEL` counter in every loop; observed here by
//!    the simple fact that these tests terminate.
//! 3. **never reads out of bounds.** This one is not tested at all, because it
//!    cannot be: `parser.rs` and `hostname.rs` carry `#![forbid(unsafe_code)]`
//!    and `deny(clippy::indexing_slicing)`, so an out-of-bounds read is not a bug
//!    that testing might miss - it is a program that does not compile. The
//!    property below covers what the compiler cannot: that the bounds checks
//!    resolve to an *answer* rather than to a panic.
//!
//! Point 3 is the whole argument. A C implementation would need this file plus a
//! fuzzer plus ASan plus a code review to reach a weaker conclusion.

#![allow(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::arithmetic_side_effects
)]

use proptest::prelude::*;

use polysiem_privacy_proxy::hostname::{HostPattern, Hostname};
use polysiem_privacy_proxy::parser::{peek_http_host, peek_tls, Peek};
use polysiem_privacy_proxy::MAX_PEEK;

/// A minimal, valid, single-record ClientHello carrying `host`.
fn valid_hello(host: &[u8]) -> Vec<u8> {
    let mut list = vec![0u8];
    list.extend_from_slice(&u16::try_from(host.len()).unwrap().to_be_bytes());
    list.extend_from_slice(host);

    let mut extension_data = Vec::new();
    extension_data.extend_from_slice(&u16::try_from(list.len()).unwrap().to_be_bytes());
    extension_data.extend_from_slice(&list);

    let mut extensions = Vec::new();
    extensions.extend_from_slice(&0x0000u16.to_be_bytes());
    extensions.extend_from_slice(&u16::try_from(extension_data.len()).unwrap().to_be_bytes());
    extensions.extend_from_slice(&extension_data);

    let mut body = Vec::new();
    body.extend_from_slice(&[0x03, 0x03]);
    body.extend_from_slice(&[0x11; 32]);
    body.push(0);
    body.extend_from_slice(&[0x00, 0x02, 0x13, 0x01]);
    body.extend_from_slice(&[0x01, 0x00]);
    body.extend_from_slice(&u16::try_from(extensions.len()).unwrap().to_be_bytes());
    body.extend_from_slice(&extensions);

    let mut handshake = vec![0x01];
    let length = u32::try_from(body.len()).unwrap().to_be_bytes();
    handshake.extend_from_slice(&length[1..4]);
    handshake.extend_from_slice(&body);

    let mut record = vec![0x16, 0x03, 0x01];
    record.extend_from_slice(&u16::try_from(handshake.len()).unwrap().to_be_bytes());
    record.extend_from_slice(&handshake);
    record
}

/// Arbitrary bytes, across the whole size range the caller can present.
fn any_bytes() -> impl Strategy<Value = Vec<u8>> {
    prop::collection::vec(any::<u8>(), 0..=(MAX_PEEK + 64))
}

/// Bytes that already look like a TLS record header, so the generator spends its
/// budget *inside* the record grammar instead of being rejected at byte one.
fn tls_shaped_bytes() -> impl Strategy<Value = Vec<u8>> {
    (any::<u16>(), prop::collection::vec(any::<u8>(), 0..2048)).prop_map(|(declared, payload)| {
        let mut out = vec![0x16, 0x03, 0x01];
        out.extend_from_slice(&declared.to_be_bytes());
        out.extend_from_slice(&payload);
        out
    })
}

/// A valid ClientHello with a handful of bytes corrupted - the shape most likely
/// to walk deep into the parser and then find something inconsistent.
fn mutated_hello() -> impl Strategy<Value = Vec<u8>> {
    (
        prop::collection::vec(prop::num::u8::ANY, 1..24),
        prop::collection::vec((any::<prop::sample::Index>(), any::<u8>()), 0..12),
    )
        .prop_map(|(host, edits)| {
            let mut bytes = valid_hello(&host);
            for (index, value) in edits {
                let at = index.index(bytes.len());
                bytes[at] = value;
            }
            bytes
        })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 3072, ..ProptestConfig::default() })]

    /// The headline property. Arbitrary bytes in, an answer out.
    #[test]
    fn tls_parser_answers_for_arbitrary_bytes(bytes in any_bytes()) {
        let verdict = peek_tls(&bytes);
        // Reaching here at all is the assertion: no panic, and it terminated.
        prop_assert!(matches!(
            verdict,
            Peek::NeedMore | Peek::NoHostname | Peek::Hostname(_)
        ));
    }

    #[test]
    fn http_parser_answers_for_arbitrary_bytes(bytes in any_bytes()) {
        let verdict = peek_http_host(&bytes);
        prop_assert!(matches!(
            verdict,
            Peek::NeedMore | Peek::NoHostname | Peek::Hostname(_)
        ));
    }

    #[test]
    fn tls_parser_answers_for_record_shaped_bytes(bytes in tls_shaped_bytes()) {
        let _ = peek_tls(&bytes);
    }

    #[test]
    fn tls_parser_answers_for_mutated_hellos(bytes in mutated_hello()) {
        let _ = peek_tls(&bytes);
    }

    /// Never ask for more once the caller has hit the cap.
    ///
    /// The relay stops peeking at `MAX_PEEK` and falls through to the IP/port
    /// rules. If the parser could still answer `NeedMore` at that point the
    /// caller would be waiting on a decision that is never coming, which is a
    /// slowloris with extra steps.
    #[test]
    fn a_full_buffer_is_never_answered_with_need_more(
        bytes in prop::collection::vec(any::<u8>(), MAX_PEEK..=(MAX_PEEK + 512))
    ) {
        prop_assert_ne!(peek_tls(&bytes), Peek::NeedMore);
        prop_assert_ne!(peek_http_host(&bytes), Peek::NeedMore);
    }

    /// Parsing is a pure function of the bytes.
    ///
    /// Nothing carries state between calls, so re-peeking the same buffer after
    /// another read must not change the verdict.
    #[test]
    fn parsing_is_deterministic(bytes in any_bytes()) {
        prop_assert_eq!(peek_tls(&bytes), peek_tls(&bytes));
        prop_assert_eq!(peek_http_host(&bytes), peek_http_host(&bytes));
    }

    /// A truncated stream never yields a hostname.
    ///
    /// This is the property that keeps a rule from matching half a name: if the
    /// bytes for `evil.example.com` have only reached `evil.exa`, the parser must
    /// not hand back `evil.exa` and let it match `*.exa`.
    #[test]
    fn no_proper_prefix_of_a_hello_yields_a_different_hostname(
        host in "[a-z][a-z0-9]{0,20}\\.[a-z]{2,6}",
        cut in any::<prop::sample::Index>(),
    ) {
        let whole = valid_hello(host.as_bytes());
        let at = cut.index(whole.len());
        match peek_tls(&whole[..at]) {
            Peek::Hostname(found) => {
                prop_assert_eq!(found.as_bytes(), host.as_bytes());
            }
            Peek::NeedMore | Peek::NoHostname => {}
        }
    }

    /// Whatever comes out of the parser is a usable, already-normalised hostname.
    #[test]
    fn any_extracted_hostname_satisfies_its_invariants(bytes in mutated_hello()) {
        if let Peek::Hostname(found) = peek_tls(&bytes) {
            let text = found.as_bytes();
            prop_assert!(!text.is_empty());
            prop_assert!(text.len() <= 253);
            prop_assert!(text.iter().all(|b|
                b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-' || *b == b'.'
            ));
            prop_assert!(text.split(|b| *b == b'.').all(|label|
                !label.is_empty() && label.len() <= 63
            ));
            // And it is stable under re-parsing, which is what makes byte
            // equality a safe substitute for case-insensitive comparison.
            let reparsed = Hostname::parse(text).unwrap();
            prop_assert_eq!(reparsed.as_bytes(), text);
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 2048, ..ProptestConfig::default() })]

    /// Hostname validation never panics on arbitrary bytes either - it is on the
    /// same hostile path, just one call deeper.
    #[test]
    fn hostname_parsing_answers_for_arbitrary_bytes(
        bytes in prop::collection::vec(any::<u8>(), 0..300)
    ) {
        let _ = Hostname::parse(&bytes);
        let _ = HostPattern::parse(&bytes);
    }

    /// A suffix pattern only ever matches on a label boundary.
    ///
    /// The bug this pins is the classic one: `*.example.com` matching
    /// `notexample.com` because the code checked `ends_with` and forgot the dot.
    #[test]
    fn a_suffix_pattern_never_matches_across_a_label_boundary(
        base in "[a-z]{3,10}\\.[a-z]{2,4}",
        prefix in "[a-z0-9-]{1,10}",
    ) {
        let Some(pattern) = HostPattern::parse(format!("*.{base}").as_bytes()) else {
            return Ok(());
        };
        // Glued directly on, with no dot: must not match.
        let glued = format!("{prefix}{base}");
        if !prefix.ends_with('-') {
            if let Some(host) = Hostname::parse(glued.as_bytes()) {
                prop_assert!(!pattern.matches(&host), "{glued} matched *.{base}");
            }
        }
        // Separated by a dot: must match.
        let separated = format!("{prefix}.{base}");
        if let Some(host) = Hostname::parse(separated.as_bytes()) {
            prop_assert!(pattern.matches(&host), "{separated} did not match *.{base}");
        }
    }
}
