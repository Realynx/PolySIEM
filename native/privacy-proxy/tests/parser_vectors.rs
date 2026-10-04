//! The hostile-input vector table.
//!
//! Every case here is a shape a real client, a broken client, or an attacker can
//! put on the wire. The assertion is almost always the same and almost always
//! boring: **the parser returns an answer**. That is the point. In the C version
//! of this file half of these vectors would be candidate CVEs; here they are
//! table rows.

#![allow(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::arithmetic_side_effects
)]

use polysiem_privacy_proxy::parser::{peek_http_host, peek_tls, Peek};
use polysiem_privacy_proxy::MAX_PEEK;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/// One entry of a `ServerNameList`.
struct ServerName {
    name_type: u8,
    name: Vec<u8>,
}

/// Build a `server_name` extension body from a list of entries.
fn sni_extension(entries: &[ServerName]) -> Vec<u8> {
    let mut list = Vec::new();
    for entry in entries {
        list.push(entry.name_type);
        list.extend_from_slice(&u16::try_from(entry.name.len()).unwrap().to_be_bytes());
        list.extend_from_slice(&entry.name);
    }
    let mut data = Vec::new();
    data.extend_from_slice(&u16::try_from(list.len()).unwrap().to_be_bytes());
    data.extend_from_slice(&list);
    data
}

/// Build a complete ClientHello handshake message.
fn client_hello(extensions: &[(u16, Vec<u8>)]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&[0x03, 0x03]); // legacy_version TLS 1.2
    body.extend_from_slice(&[0xAB; 32]); // random
    body.push(32); // session id length
    body.extend_from_slice(&[0xCD; 32]);
    body.extend_from_slice(&[0x00, 0x02]); // cipher suites length
    body.extend_from_slice(&[0x13, 0x01]); // TLS_AES_128_GCM_SHA256
    body.push(1); // compression methods length
    body.push(0); // null compression

    let mut blob = Vec::new();
    for (kind, data) in extensions {
        blob.extend_from_slice(&kind.to_be_bytes());
        blob.extend_from_slice(&u16::try_from(data.len()).unwrap().to_be_bytes());
        blob.extend_from_slice(data);
    }
    body.extend_from_slice(&u16::try_from(blob.len()).unwrap().to_be_bytes());
    body.extend_from_slice(&blob);

    let mut handshake = vec![0x01]; // ClientHello
    let length = u32::try_from(body.len()).unwrap().to_be_bytes();
    handshake.extend_from_slice(&length[1..4]); // 24-bit length
    handshake.extend_from_slice(&body);
    handshake
}

/// Wrap a handshake message into TLS records of at most `chunk` bytes each.
fn records(handshake: &[u8], chunk: usize) -> Vec<u8> {
    let mut out = Vec::new();
    for piece in handshake.chunks(chunk) {
        out.push(0x16); // handshake
        out.extend_from_slice(&[0x03, 0x01]); // legacy record version
        out.extend_from_slice(&u16::try_from(piece.len()).unwrap().to_be_bytes());
        out.extend_from_slice(piece);
    }
    out
}

/// A single-record ClientHello carrying one `host_name`.
fn hello_with_sni(host: &str) -> Vec<u8> {
    let extension = sni_extension(&[ServerName {
        name_type: 0,
        name: host.as_bytes().to_vec(),
    }]);
    records(&client_hello(&[(0x0000, extension)]), usize::MAX)
}

fn found(bytes: &[u8]) -> Option<String> {
    match peek_tls(bytes) {
        Peek::Hostname(host) => Some(host.to_string()),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// The happy path, so the negative cases mean something
// ---------------------------------------------------------------------------

#[test]
fn extracts_a_plain_sni() {
    assert_eq!(
        found(&hello_with_sni("example.com")).as_deref(),
        Some("example.com")
    );
}

#[test]
fn lowercases_the_extracted_name() {
    assert_eq!(
        found(&hello_with_sni("EXAMPLE.CoM")).as_deref(),
        Some("example.com")
    );
}

// ---------------------------------------------------------------------------
// Contract vector table
// ---------------------------------------------------------------------------

#[test]
fn truncated_records_ask_for_more_until_the_cap() {
    let whole = hello_with_sni("example.com");
    // Every proper prefix is either "need more" or "no hostname" - never a
    // hostname, because a partial name must not be matched against a rule.
    for cut in 0..whole.len() {
        let verdict = peek_tls(&whole[..cut]);
        assert!(
            matches!(verdict, Peek::NeedMore | Peek::NoHostname),
            "prefix of {cut} bytes produced {verdict:?}"
        );
    }
    assert_eq!(found(&whole).as_deref(), Some("example.com"));
}

#[test]
fn a_length_field_larger_than_the_record_is_not_a_hostname() {
    // ServerNameList claims far more bytes than the extension carries.
    let mut extension = sni_extension(&[ServerName {
        name_type: 0,
        name: b"example.com".to_vec(),
    }]);
    extension[0] = 0xFF;
    extension[1] = 0xFF;
    let bytes = records(&client_hello(&[(0x0000, extension)]), usize::MAX);
    assert_eq!(peek_tls(&bytes), Peek::NoHostname);
}

#[test]
fn a_name_length_beyond_the_list_is_not_a_hostname() {
    let mut extension = sni_extension(&[ServerName {
        name_type: 0,
        name: b"example.com".to_vec(),
    }]);
    // Bytes 3..5 are the ServerName's own length field.
    extension[3] = 0x7F;
    extension[4] = 0xFF;
    let bytes = records(&client_hello(&[(0x0000, extension)]), usize::MAX);
    assert_eq!(peek_tls(&bytes), Peek::NoHostname);
}

#[test]
fn a_handshake_length_larger_than_the_records_asks_for_more() {
    let mut handshake = client_hello(&[(
        0x0000,
        sni_extension(&[ServerName {
            name_type: 0,
            name: b"example.com".to_vec(),
        }]),
    )]);
    // Inflate the 24-bit handshake length, but stay under the 8 KiB cap.
    handshake[1] = 0x00;
    handshake[2] = 0x10;
    handshake[3] = 0x00;
    let bytes = records(&handshake, usize::MAX);
    assert_eq!(peek_tls(&bytes), Peek::NeedMore);
}

#[test]
fn a_handshake_length_beyond_the_peek_cap_is_abandoned_immediately() {
    let mut handshake = client_hello(&[(0x0000, sni_extension(&[]))]);
    handshake[1] = 0xFF; // ~16 MiB
    handshake[2] = 0xFF;
    handshake[3] = 0xFF;
    let bytes = records(&handshake, 64);
    assert_eq!(peek_tls(&bytes), Peek::NoHostname);
}

#[test]
fn zero_length_sni_is_no_hostname() {
    let extension = sni_extension(&[ServerName {
        name_type: 0,
        name: Vec::new(),
    }]);
    let bytes = records(&client_hello(&[(0x0000, extension)]), usize::MAX);
    assert_eq!(peek_tls(&bytes), Peek::NoHostname);
}

#[test]
fn an_empty_server_name_list_is_no_hostname() {
    let bytes = records(&client_hello(&[(0x0000, sni_extension(&[]))]), usize::MAX);
    assert_eq!(peek_tls(&bytes), Peek::NoHostname);
}

#[test]
fn multiple_sni_entries_take_the_first_host_name() {
    let extension = sni_extension(&[
        ServerName {
            name_type: 0,
            name: b"first.example".to_vec(),
        },
        ServerName {
            name_type: 0,
            name: b"second.example".to_vec(),
        },
    ]);
    let bytes = records(&client_hello(&[(0x0000, extension)]), usize::MAX);
    assert_eq!(found(&bytes).as_deref(), Some("first.example"));
}

#[test]
fn a_non_host_name_entry_is_skipped_and_the_host_name_after_it_is_used() {
    let extension = sni_extension(&[
        ServerName {
            name_type: 9, // some future NameType
            name: b"ignored-blob".to_vec(),
        },
        ServerName {
            name_type: 0,
            name: b"real.example".to_vec(),
        },
    ]);
    let bytes = records(&client_hello(&[(0x0000, extension)]), usize::MAX);
    assert_eq!(found(&bytes).as_deref(), Some("real.example"));
}

#[test]
fn only_non_host_name_entries_yield_no_hostname() {
    let extension = sni_extension(&[ServerName {
        name_type: 3,
        name: b"whatever".to_vec(),
    }]);
    let bytes = records(&client_hello(&[(0x0000, extension)]), usize::MAX);
    assert_eq!(peek_tls(&bytes), Peek::NoHostname);
}

#[test]
fn a_hello_split_across_three_records_is_reassembled() {
    let handshake = client_hello(&[(
        0x0000,
        sni_extension(&[ServerName {
            name_type: 0,
            name: b"split.example.com".to_vec(),
        }]),
    )]);
    let chunk = handshake.len().div_ceil(3);
    let bytes = records(&handshake, chunk);
    // Genuinely three records, or the test is not testing what it claims.
    assert!(bytes.iter().filter(|b| **b == 0x16).count() >= 3);
    assert_eq!(found(&bytes).as_deref(), Some("split.example.com"));
}

#[test]
fn a_hello_arriving_one_byte_at_a_time_is_reassembled() {
    let handshake = client_hello(&[(
        0x0000,
        sni_extension(&[ServerName {
            name_type: 0,
            name: b"dribble.example".to_vec(),
        }]),
    )]);
    let bytes = records(&handshake, 1);
    assert_eq!(found(&bytes).as_deref(), Some("dribble.example"));
}

#[test]
fn eight_kilobytes_of_garbage_is_not_a_hostname() {
    let garbage: Vec<u8> = (0..MAX_PEEK)
        .map(|i| u8::try_from(i % 251).unwrap())
        .collect();
    assert_eq!(peek_tls(&garbage), Peek::NoHostname);
}

#[test]
fn an_all_ff_buffer_is_not_a_hostname() {
    for size in [1, 5, 6, 1024, MAX_PEEK, MAX_PEEK * 2] {
        assert_eq!(peek_tls(&vec![0xFF; size]), Peek::NoHostname, "size {size}");
    }
}

#[test]
fn an_all_zero_buffer_is_not_a_hostname() {
    for size in [1, 5, 1024, MAX_PEEK] {
        assert_eq!(peek_tls(&vec![0x00; size]), Peek::NoHostname, "size {size}");
    }
}

#[test]
fn a_hello_carrying_an_ech_extension_still_yields_the_outer_sni() {
    // 0xfe0d is `encrypted_client_hello`. We do not understand it and must not
    // need to: it is skipped by its declared length like any other extension,
    // and the OUTER server_name is what a middlebox can see and match on.
    let extension = sni_extension(&[ServerName {
        name_type: 0,
        name: b"cloudflare-ech.com".to_vec(),
    }]);
    let bytes = records(
        &client_hello(&[
            (0xfe0d, vec![0x00; 200]),
            (0x0000, extension),
            (0x002b, vec![0x03, 0x04]), // supported_versions
        ]),
        usize::MAX,
    );
    assert_eq!(found(&bytes).as_deref(), Some("cloudflare-ech.com"));
}

#[test]
fn a_hello_with_no_extensions_at_all_is_no_hostname() {
    let bytes = records(&client_hello(&[]), usize::MAX);
    assert_eq!(peek_tls(&bytes), Peek::NoHostname);
}

#[test]
fn non_tls_traffic_on_the_tls_port_is_no_hostname_not_an_error() {
    // Normal things that turn up on 443 and must simply fall through to the
    // IP/port rules rather than being dropped or logged as an attack.
    for probe in [
        &b"GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"[..],
        b"SSH-2.0-OpenSSH_9.2\r\n",
        b"\x00\x00\x00\x00",
        b"HELO",
    ] {
        assert_eq!(peek_tls(probe), Peek::NoHostname, "{probe:?}");
    }
}

#[test]
fn a_server_hello_is_not_a_client_hello() {
    let mut handshake = client_hello(&[(0x0000, sni_extension(&[]))]);
    handshake[0] = 0x02; // ServerHello
    assert_eq!(peek_tls(&records(&handshake, usize::MAX)), Peek::NoHostname);
}

#[test]
fn an_oversized_record_length_is_rejected_before_anything_is_read() {
    // 0x4001 exceeds the 2^14 plaintext record limit.
    let bytes = vec![0x16, 0x03, 0x01, 0x40, 0x01];
    assert_eq!(peek_tls(&bytes), Peek::NoHostname);
}

#[test]
fn a_zero_length_record_is_rejected() {
    let bytes = vec![0x16, 0x03, 0x01, 0x00, 0x00];
    assert_eq!(peek_tls(&bytes), Peek::NoHostname);
}

#[test]
fn a_name_that_is_not_a_hostname_is_no_hostname() {
    for bad in [
        "exa mple.com",
        "example..com",
        "-example.com",
        "exa_mple.com",
        "[2001:db8::1]",
        "example.com\u{7f}",
    ] {
        assert_eq!(peek_tls(&hello_with_sni(bad)), Peek::NoHostname, "{bad}");
    }
}

#[test]
fn a_name_longer_than_253_bytes_is_no_hostname() {
    let long = format!("{}.example.com", "a".repeat(250));
    assert_eq!(peek_tls(&hello_with_sni(&long)), Peek::NoHostname);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

#[test]
fn extracts_a_host_header() {
    let request = b"GET /index.html HTTP/1.1\r\nHost: example.com\r\nAccept: */*\r\n\r\n";
    assert_eq!(peek_http_host(request), Peek::Hostname(host("example.com")),);
}

#[test]
fn host_header_matching_is_case_insensitive_on_both_name_and_value() {
    let request = b"GET / HTTP/1.1\r\nHOST:   EXAMPLE.CoM  \r\n\r\n";
    assert_eq!(peek_http_host(request), Peek::Hostname(host("example.com")));
}

#[test]
fn a_port_suffix_is_stripped_from_the_host_header() {
    let request = b"GET / HTTP/1.1\r\nHost: example.com:8443\r\n\r\n";
    assert_eq!(peek_http_host(request), Peek::Hostname(host("example.com")));
}

#[test]
fn bare_lf_line_endings_are_tolerated() {
    let request = b"GET / HTTP/1.1\nHost: example.com\n\n";
    assert_eq!(peek_http_host(request), Peek::Hostname(host("example.com")));
}

#[test]
fn duplicate_host_headers_are_refused_because_they_are_a_smuggling_primitive() {
    let request = b"GET / HTTP/1.1\r\nHost: a.example\r\nHost: b.example\r\n\r\n";
    assert_eq!(peek_http_host(request), Peek::NoHostname);
}

#[test]
fn an_obs_fold_continuation_is_refused() {
    let request = b"GET / HTTP/1.1\r\nHost: a.example\r\n b.example\r\n\r\n";
    assert_eq!(peek_http_host(request), Peek::NoHostname);
}

#[test]
fn a_request_with_no_host_header_is_no_hostname() {
    assert_eq!(peek_http_host(b"GET / HTTP/1.1\r\n\r\n"), Peek::NoHostname);
}

#[test]
fn an_incomplete_header_block_asks_for_more() {
    assert_eq!(
        peek_http_host(b"GET / HTTP/1.1\r\nHost: exa"),
        Peek::NeedMore
    );
    assert_eq!(peek_http_host(b""), Peek::NeedMore);
}

#[test]
fn a_header_block_that_never_ends_is_abandoned_at_the_cap() {
    let mut request = b"GET / HTTP/1.1\r\nHost: example.com\r\n".to_vec();
    while request.len() < MAX_PEEK {
        request.extend_from_slice(b"X-Filler: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\n");
    }
    // Far more than MAX_HEADER_LINES, so it is refused on the line budget.
    assert_eq!(peek_http_host(&request), Peek::NoHostname);
}

#[test]
fn binary_junk_on_port_80_is_no_hostname() {
    for probe in [&b"\x16\x03\x01\x00\x05"[..], b"\xff\xff\xff\xff", b"\x00"] {
        assert_eq!(peek_http_host(probe), Peek::NoHostname, "{probe:?}");
    }
}

#[test]
fn a_line_longer_than_the_header_cap_is_refused() {
    let mut request = b"GET / HTTP/1.1\r\nHost: example.com\r\nX-Big: ".to_vec();
    request.extend_from_slice(&vec![b'a'; 2048]);
    request.extend_from_slice(b"\r\n\r\n");
    assert_eq!(peek_http_host(&request), Peek::NoHostname);
}

fn host(text: &str) -> polysiem_privacy_proxy::hostname::Hostname {
    polysiem_privacy_proxy::hostname::Hostname::parse(text.as_bytes()).unwrap()
}
