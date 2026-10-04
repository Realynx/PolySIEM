//! TLS ClientHello and HTTP `Host:` parsing.
//!
//! **This is the module the language choice was made for.** Every byte it reads
//! was written by a remote peer on the open internet, on a box that sits in the
//! middle of a household's traffic. The C version of this file would have been a
//! nest of pointer arithmetic against attacker-controlled length fields; here the
//! same job is done with slices and `Option`, and the compiler plus a short lint
//! list make the dangerous shapes unwritable.
//!
//! # The three guarantees, and how each is enforced
//!
//! 1. **Never reads out of bounds.** `#![forbid(unsafe_code)]` plus
//!    `deny(clippy::indexing_slicing)` mean there is no `buf[i]` and no raw
//!    pointer anywhere in this file. Every read goes through [`Reader`], which is
//!    built on `slice::get` and returns `Option`. Out-of-bounds is not a bug that
//!    is avoided here; it is a program that does not compile.
//! 2. **Never panics.** `deny(clippy::unwrap_used, expect_used, panic,
//!    arithmetic_side_effects)` removes the remaining panic sources: no unwraps,
//!    and no `+`/`-`/`*` on integers - length arithmetic is `checked_add` and
//!    `saturating_sub`, so a hostile length field yields `None` instead of an
//!    overflow. A panic reachable from a connection handler is a remote DoS.
//! 3. **Never loops unboundedly.** Every loop both advances a cursor by a
//!    positive minimum *and* burns a unit of [`FUEL`]. The cursor argument alone
//!    would be enough, but the fuel counter makes termination a local, checkable
//!    property rather than one that has to be re-derived from the record grammar
//!    every time this file is edited.
//!
//! `tests/parser_proptest.rs` asserts all three against arbitrary byte strings.
//!
//! # Failure is not an error
//!
//! Anything that is not a well-formed ClientHello returns [`Peek::NoHostname`],
//! never an error and never a log line. Non-TLS traffic on 443 is completely
//! normal - health checks, port scans, protocols that borrowed the port - and
//! must fall through to the IP/port rules rather than being dropped or reported
//! as an attack. The only three outcomes are "here is a hostname", "there will
//! never be a hostname", and "ask me again when you have more bytes".

#![forbid(unsafe_code)]
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::arithmetic_side_effects,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    clippy::string_slice
)]

use crate::hostname::{ascii_lower, Hostname};
use crate::MAX_PEEK;

/// TLS `ContentType.handshake`.
const TLS_HANDSHAKE: u8 = 0x16;
/// TLS `HandshakeType.client_hello`.
const TLS_CLIENT_HELLO: u8 = 0x01;
/// RFC 6066 `server_name` extension.
const EXT_SERVER_NAME: u16 = 0x0000;
/// RFC 6066 `NameType.host_name`.
const SNI_HOST_NAME: u8 = 0x00;
/// RFC 8446 caps a plaintext record at 2^14 bytes.
const MAX_TLS_RECORD: usize = 16_384;

/// Iteration budget shared by every loop in this module.
///
/// Nothing legitimate comes close: a real ClientHello has a handful of records,
/// a few dozen extensions and one server name. See guarantee 3 in the module
/// docs for why this exists even though each loop already advances a cursor.
const FUEL: u32 = 1024;

/// Maximum number of header lines examined in an HTTP request.
const MAX_HEADER_LINES: u32 = 128;
/// Maximum length of a single HTTP header line.
const MAX_HEADER_LINE: usize = 1024;
/// Maximum length of an HTTP method token.
const MAX_METHOD: usize = 16;

/// What a peek at the head of a client connection concluded.
///
/// The `Hostname` variant makes this enum ~256 bytes while the other two are
/// empty, which `clippy::large_enum_variant` flags. Boxing the hostname would
/// even them out at the cost of a heap allocation per connection on the
/// datapath, which is exactly what the "no allocation in the steady-state path"
/// requirement forbids. A 256-byte value returned once per connection and
/// immediately consumed is the cheaper side of that trade.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Peek {
    /// The prelude is incomplete but still plausible. Read more and re-run.
    ///
    /// The caller must stop re-running once it has [`MAX_PEEK`] bytes; the
    /// parser enforces that itself, but the caller also has an idle timeout.
    NeedMore,
    /// A hostname was found.
    Hostname(Hostname),
    /// There is no hostname and there never will be on this connection.
    ///
    /// Fall through to the IP/port rules. Not an error, not loggable.
    NoHostname,
}

/// Which prelude to expect on a listener.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PeekMode {
    /// TCP/443 - a TLS ClientHello.
    Tls,
    /// TCP/80 - an HTTP request head.
    Http,
}

/// Parse the head of a client connection according to `mode`.
#[must_use]
pub fn peek(mode: PeekMode, stream: &[u8]) -> Peek {
    match mode {
        PeekMode::Tls => peek_tls(stream),
        PeekMode::Http => peek_http_host(stream),
    }
}

/// "Out of bytes" - is that because the peer has not sent them yet, or because
/// we have already looked at as much as we are ever going to?
#[inline]
fn incomplete(stream: &[u8]) -> Peek {
    if stream.len() >= MAX_PEEK {
        Peek::NoHostname
    } else {
        Peek::NeedMore
    }
}

// ---------------------------------------------------------------------------
// A bounds-checked cursor. The only way this module touches a byte.
// ---------------------------------------------------------------------------

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    #[inline]
    const fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    #[inline]
    fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }

    /// Everything not yet consumed, for looking ahead without committing.
    #[inline]
    fn rest(&self) -> &'a [u8] {
        self.buf.get(self.pos..).unwrap_or(&[])
    }

    /// Consume exactly `n` bytes, or `None` if fewer remain.
    #[inline]
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let slice = self.buf.get(self.pos..end)?;
        self.pos = end;
        Some(slice)
    }

    #[inline]
    fn u8(&mut self) -> Option<u8> {
        self.take(1)?.first().copied()
    }

    #[inline]
    fn u16(&mut self) -> Option<u16> {
        let bytes = self.take(2)?;
        Some(u16::from_be_bytes([*bytes.first()?, *bytes.get(1)?]))
    }

    /// TLS's 24-bit handshake length.
    #[inline]
    fn u24(&mut self) -> Option<u32> {
        let bytes = self.take(3)?;
        Some(u32::from_be_bytes([
            0,
            *bytes.first()?,
            *bytes.get(1)?,
            *bytes.get(2)?,
        ]))
    }
}

// ---------------------------------------------------------------------------
// TLS
// ---------------------------------------------------------------------------

/// Extract the SNI host name from a TLS ClientHello.
///
/// `stream` is the raw bytes seen so far, which may hold a partial record, a
/// whole one, or a ClientHello fragmented across several records - all three are
/// legal and all three occur in the wild (notably from clients that pad the hello
/// to defeat fingerprinting).
#[must_use]
pub fn peek_tls(stream: &[u8]) -> Peek {
    // Records are reassembled into one contiguous handshake message. This costs
    // one 8 KiB stack memset per call, which is ~200ns against the ~5 syscalls
    // already on the connection-setup path, and it buys a parser that never has
    // to reason about a structure straddling a record boundary. It is a stack
    // array, not an allocation: the steady-state no-allocation rule holds.
    let mut acc = [0u8; MAX_PEEK];
    let mut acc_len = 0usize;
    let mut records = Reader::new(stream);
    let mut fuel = FUEL;
    // `Some(n)` once the handshake header has been reassembled: 4 header bytes
    // plus the declared body length.
    let mut handshake_total: Option<usize> = None;

    loop {
        if let Some(total) = handshake_total {
            if acc_len >= total {
                break;
            }
        }
        let Some(next_fuel) = fuel.checked_sub(1) else {
            return Peek::NoHostname;
        };
        fuel = next_fuel;

        // Judge the record header from whatever bytes have arrived rather than
        // waiting for all five. A connection whose very first byte is not
        // `handshake` is not TLS and never will be, and saying so now lets it
        // fall through to the IP/port rules immediately instead of sitting here
        // until the peer happens to send four more bytes - or until the idle
        // timeout, for a peer that sends nothing else at all.
        let ahead = records.rest();
        // ContentType must be handshake. Anything else on this port is simply
        // not TLS, which is a normal thing for it to be.
        if matches!(ahead.first(), Some(&kind) if kind != TLS_HANDSHAKE) {
            return Peek::NoHostname;
        }
        // ProtocolVersion major is 3 for every TLS version including 1.3, whose
        // records still claim 3,1 or 3,3 on the wire for middlebox compatibility.
        if matches!(ahead.get(1), Some(&major) if major != 0x03) {
            return Peek::NoHostname;
        }

        let Some(header) = records.take(5) else {
            return incomplete(stream);
        };
        let (Some(hi), Some(lo)) = (header.get(3).copied(), header.get(4).copied()) else {
            return Peek::NoHostname;
        };
        let length = usize::from(u16::from_be_bytes([hi, lo]));
        if length == 0 || length > MAX_TLS_RECORD {
            return Peek::NoHostname;
        }
        let Some(payload) = records.take(length) else {
            return incomplete(stream);
        };

        // Append. `MAX_PEEK` is the hard ceiling from the contract: a hello that
        // needs more than 8 KiB is treated as having no hostname.
        let Some(end) = acc_len.checked_add(payload.len()) else {
            return Peek::NoHostname;
        };
        if end > MAX_PEEK {
            return Peek::NoHostname;
        }
        let Some(dst) = acc.get_mut(acc_len..end) else {
            return Peek::NoHostname;
        };
        dst.copy_from_slice(payload);
        acc_len = end;

        if handshake_total.is_none() {
            match handshake_len(acc.get(..acc_len).unwrap_or(&[])) {
                HandshakeLen::Known(total) => handshake_total = Some(total),
                HandshakeLen::NotClientHello => return Peek::NoHostname,
                HandshakeLen::NeedMore => {}
            }
        }
    }

    let Some(total) = handshake_total else {
        return incomplete(stream);
    };
    // Everything from here on is inside a length the peer declared and we have
    // fully received, so a short read is malformed input rather than truncation.
    let Some(body) = acc.get(4..total) else {
        return Peek::NoHostname;
    };
    parse_client_hello_body(body)
}

enum HandshakeLen {
    Known(usize),
    NeedMore,
    NotClientHello,
}

/// Read the 4-byte handshake header once enough of it has been reassembled.
fn handshake_len(acc: &[u8]) -> HandshakeLen {
    let mut reader = Reader::new(acc);
    let Some(msg_type) = reader.u8() else {
        return HandshakeLen::NeedMore;
    };
    // The first handshake message a client sends is always a ClientHello.
    if msg_type != TLS_CLIENT_HELLO {
        return HandshakeLen::NotClientHello;
    }
    let Some(body_len) = reader.u24() else {
        return HandshakeLen::NeedMore;
    };
    let Ok(body_len) = usize::try_from(body_len) else {
        return HandshakeLen::NotClientHello;
    };
    let Some(total) = body_len.checked_add(4) else {
        return HandshakeLen::NotClientHello;
    };
    if total > MAX_PEEK {
        // Larger than we will ever buffer. Give up now instead of reading 8 KiB
        // and then giving up.
        return HandshakeLen::NotClientHello;
    }
    HandshakeLen::Known(total)
}

/// Parse a complete ClientHello body (everything after the 4-byte handshake
/// header) and return its SNI host name.
fn parse_client_hello_body(body: &[u8]) -> Peek {
    let mut reader = Reader::new(body);

    // legacy_version + random
    if reader.take(2).is_none() || reader.take(32).is_none() {
        return Peek::NoHostname;
    }
    // legacy_session_id
    let Some(session_id_len) = reader.u8() else {
        return Peek::NoHostname;
    };
    if usize::from(session_id_len) > 32 || reader.take(usize::from(session_id_len)).is_none() {
        return Peek::NoHostname;
    }
    // cipher_suites: a non-empty even number of bytes
    let Some(cipher_len) = reader.u16() else {
        return Peek::NoHostname;
    };
    let cipher_len = usize::from(cipher_len);
    if cipher_len == 0 || cipher_len & 1 == 1 || reader.take(cipher_len).is_none() {
        return Peek::NoHostname;
    }
    // legacy_compression_methods: at least the null method
    let Some(compression_len) = reader.u8() else {
        return Peek::NoHostname;
    };
    if compression_len == 0 || reader.take(usize::from(compression_len)).is_none() {
        return Peek::NoHostname;
    }
    // extensions. Absent entirely on an SSLv3-era hello, which therefore has no
    // SNI - a legitimate "no hostname", not a parse failure.
    if reader.remaining() == 0 {
        return Peek::NoHostname;
    }
    let Some(extensions_len) = reader.u16() else {
        return Peek::NoHostname;
    };
    let Some(extensions) = reader.take(usize::from(extensions_len)) else {
        return Peek::NoHostname;
    };
    find_server_name(extensions)
}

/// Walk the extension list looking for `server_name`.
///
/// Unknown extensions are skipped by their declared length, which is how an
/// `encrypted_client_hello` (0xfe0d) extension is handled: it is simply not the
/// one we want. When a client uses ECH the *outer* SNI is still present and is
/// what we match on - the real inner name is encrypted and unavailable to any
/// middlebox, which the design doc states as a known limitation rather than a bug
/// to fix here.
fn find_server_name(extensions: &[u8]) -> Peek {
    let mut reader = Reader::new(extensions);
    let mut fuel = FUEL;
    while reader.remaining() > 0 {
        let Some(next_fuel) = fuel.checked_sub(1) else {
            return Peek::NoHostname;
        };
        fuel = next_fuel;

        let Some(ext_type) = reader.u16() else {
            return Peek::NoHostname;
        };
        let Some(ext_len) = reader.u16() else {
            return Peek::NoHostname;
        };
        let Some(ext_data) = reader.take(usize::from(ext_len)) else {
            return Peek::NoHostname;
        };
        if ext_type == EXT_SERVER_NAME {
            return parse_server_name_list(ext_data);
        }
    }
    Peek::NoHostname
}

/// `ServerNameList` -> `ServerName` -> `HostName`, each length checked against
/// the bytes its parent actually declared.
fn parse_server_name_list(data: &[u8]) -> Peek {
    let mut reader = Reader::new(data);
    let Some(list_len) = reader.u16() else {
        return Peek::NoHostname;
    };
    let Some(list) = reader.take(usize::from(list_len)) else {
        return Peek::NoHostname;
    };

    let mut entries = Reader::new(list);
    let mut fuel = FUEL;
    while entries.remaining() > 0 {
        let Some(next_fuel) = fuel.checked_sub(1) else {
            return Peek::NoHostname;
        };
        fuel = next_fuel;

        let Some(name_type) = entries.u8() else {
            return Peek::NoHostname;
        };
        let Some(name_len) = entries.u16() else {
            return Peek::NoHostname;
        };
        let Some(name) = entries.take(usize::from(name_len)) else {
            return Peek::NoHostname;
        };
        if name_type == SNI_HOST_NAME {
            // First host_name wins. RFC 6066 permits at most one per type, and a
            // hello carrying two is either broken or trying to confuse a
            // middlebox into disagreeing with the server about the name.
            return match Hostname::parse(name) {
                Some(host) => Peek::Hostname(host),
                None => Peek::NoHostname,
            };
        }
    }
    Peek::NoHostname
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/// Line splitter over an HTTP request head.
///
/// Yields complete lines only. When it returns `None` the remainder is an
/// unterminated final line, which is exactly the "need more bytes" signal.
struct Lines<'a> {
    rest: &'a [u8],
}

impl<'a> Iterator for Lines<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        let newline = self.rest.iter().position(|byte| *byte == b'\n')?;
        let line = self.rest.get(..newline)?;
        let next_start = newline.checked_add(1)?;
        self.rest = self.rest.get(next_start..)?;
        // Tolerate bare LF as well as CRLF; a stray trailing CR is not
        // interesting enough to reject a request over.
        Some(match line.split_last() {
            Some((&b'\r', head)) => head,
            _ => line,
        })
    }
}

/// Extract the host from an HTTP request's `Host:` header.
///
/// Held to the same standard as the TLS path, and to two extra rules that exist
/// because HTTP is a text protocol sitting in front of a routing decision:
///
/// * **An obs-fold continuation line rejects the request.** A header folded
///   across lines is parsed differently by different implementations, and this
///   parser's answer decides which exit the flow takes.
/// * **Zero or several `Host:` headers reject the request.** Duplicate `Host`
///   headers are the classic request-smuggling primitive; if we cannot say
///   unambiguously which host was asked for, we decline to name one and the flow
///   falls through to the IP/port rules.
///
/// "Reject" here means [`Peek::NoHostname`] - the flow is still routed, just not
/// by name. Nothing is dropped on the basis of a parse.
#[must_use]
pub fn peek_http_host(stream: &[u8]) -> Peek {
    // Same early exit as the TLS path: binary junk on port 80 should be
    // classified as "not HTTP" on the bytes already in hand, not after waiting
    // for a line terminator that is never coming.
    if !plausible_method_prefix(stream) {
        return Peek::NoHostname;
    }

    let mut lines = Lines { rest: stream };

    let Some(request_line) = lines.next() else {
        return incomplete(stream);
    };
    if !is_request_line(request_line) {
        return Peek::NoHostname;
    }

    let mut host: Option<Hostname> = None;
    let mut host_headers = 0u32;
    let mut fuel = MAX_HEADER_LINES;

    loop {
        let Some(next_fuel) = fuel.checked_sub(1) else {
            return Peek::NoHostname;
        };
        fuel = next_fuel;

        let Some(line) = lines.next() else {
            return incomplete(stream);
        };
        if line.is_empty() {
            break; // end of the header block
        }
        if line.len() > MAX_HEADER_LINE {
            return Peek::NoHostname;
        }
        // Leading whitespace means an obs-fold continuation.
        if matches!(line.first(), Some(&b' ') | Some(&b'\t')) {
            return Peek::NoHostname;
        }
        if let Some(value) = header_value(line, b"host") {
            host_headers = host_headers.saturating_add(1);
            host = Hostname::parse(strip_port(trim_ows(value)));
        }
    }

    if host_headers != 1 {
        return Peek::NoHostname;
    }
    match host {
        Some(found) => Peek::Hostname(found),
        None => Peek::NoHostname,
    }
}

/// Could the bytes so far still be the start of a method token?
///
/// Only looks at what has arrived, so it works on a one-byte stream. Every HTTP
/// method is ASCII uppercase, so a single lowercase or non-printable byte before
/// the first space settles it.
fn plausible_method_prefix(stream: &[u8]) -> bool {
    for (offset, byte) in stream.iter().enumerate().take(MAX_METHOD.saturating_add(1)) {
        if *byte == b' ' {
            return offset > 0;
        }
        if !byte.is_ascii_uppercase() {
            return false;
        }
    }
    // Ran out of bytes before finding a space: still plausible, unless the
    // "method" has already run past the longest one we will accept.
    stream.len() <= MAX_METHOD
}

/// Does this look like an HTTP/1.x request line at all?
///
/// Cheap guard so that arbitrary binary traffic on port 80 is classified as "not
/// HTTP" immediately rather than being walked line by line.
fn is_request_line(line: &[u8]) -> bool {
    let Some(space) = line.iter().position(|byte| *byte == b' ') else {
        return false;
    };
    let Some(method) = line.get(..space) else {
        return false;
    };
    if method.is_empty() || method.len() > MAX_METHOD {
        return false;
    }
    if !method.iter().all(u8::is_ascii_uppercase) {
        return false;
    }
    // HTTP/0.9 has no version token and no Host header, so requiring one costs
    // nothing and rejects a lot of noise.
    let Some(version) = line.len().checked_sub(8).and_then(|at| line.get(at..)) else {
        return false;
    };
    version.get(..7) == Some(b"HTTP/1.")
        && version.get(7).copied().is_some_and(|d| d.is_ascii_digit())
}

/// If `line` is the named header, return its raw value.
fn header_value<'a>(line: &'a [u8], name: &[u8]) -> Option<&'a [u8]> {
    let head = line.get(..name.len())?;
    if !head
        .iter()
        .zip(name.iter())
        .all(|(seen, want)| ascii_lower(*seen) == *want)
    {
        return None;
    }
    let rest = line.get(name.len()..)?;
    let (colon, value) = rest.split_first()?;
    if *colon != b':' {
        return None;
    }
    Some(value)
}

/// Strip optional leading and trailing whitespace, per RFC 9110's OWS.
fn trim_ows(mut value: &[u8]) -> &[u8] {
    while let Some((&first, rest)) = value.split_first() {
        if first == b' ' || first == b'\t' {
            value = rest;
        } else {
            break;
        }
    }
    while let Some((&last, rest)) = value.split_last() {
        if last == b' ' || last == b'\t' {
            value = rest;
        } else {
            break;
        }
    }
    value
}

/// Drop a trailing `:port` from a `Host` value.
///
/// Only a plausible port is stripped, so a name containing a colon for any other
/// reason is left intact and then rejected by `Hostname::parse` - which is the
/// right outcome, since we would not know what it meant.
fn strip_port(value: &[u8]) -> &[u8] {
    let Some(colon) = value.iter().rposition(|byte| *byte == b':') else {
        return value;
    };
    let Some(port) = colon.checked_add(1).and_then(|at| value.get(at..)) else {
        return value;
    };
    if port.is_empty() || port.len() > 5 || !port.iter().all(u8::is_ascii_digit) {
        return value;
    }
    value.get(..colon).unwrap_or(value)
}
