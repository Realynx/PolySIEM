//! Fixed-size, validated hostname storage.
//!
//! Every hostname in this crate comes from the open internet - a TLS SNI
//! extension or an HTTP `Host:` header written by whoever is on the other end of
//! the socket. Nothing downstream of [`Hostname::parse`] may assume anything the
//! parse did not prove, so the type is deliberately opaque: the only way to build
//! one is to survive validation.
//!
//! # Invariants a `Hostname` carries
//!
//! * 1..=253 bytes, and every dot-separated label is 1..=63 bytes;
//! * every byte is LDH (ASCII letter, ASCII digit or `-`);
//! * no label starts or ends with `-`, and no label is empty;
//! * ASCII-lowercased, so byte equality *is* case-insensitive comparison;
//! * therefore valid UTF-8, printable, and safe to log verbatim.
//!
//! The storage is a fixed `[u8; 253]` so a hostname can live inside a
//! preallocated connection slot or stats slot without allocating - see the "no
//! allocation in the steady-state path" requirement.

#![forbid(unsafe_code)]
// A panic in a connection handler is a remote denial of service, so the lint set
// that makes panics reachable is denied rather than merely warned about. Tests
// relax these locally; production code in this module does not.
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

use core::fmt::{self, Write as _};

/// Maximum total length of a hostname, per RFC 1035 presentation form.
pub const MAX_HOSTNAME: usize = 253;
/// Maximum length of one dot-separated label.
pub const MAX_LABEL: usize = 63;

/// ASCII-only, locale-independent case fold.
///
/// Deliberately *not* `libc::tolower`, `str::to_lowercase` or anything else that
/// could consult a locale or the Unicode tables: hostname matching has to be
/// byte-stable across every machine this ever runs on. `is_ascii_uppercase` is
/// defined as the range `b'A'..=b'Z'` and nothing more, and `| 0x20` is the ASCII
/// case bit.
#[inline]
#[must_use]
pub const fn ascii_lower(byte: u8) -> u8 {
    if byte.is_ascii_uppercase() {
        byte | 0x20
    } else {
        byte
    }
}

/// True when `byte` is LDH: an ASCII letter, an ASCII digit, or `-`.
#[inline]
#[must_use]
pub const fn is_ldh(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'-'
}

/// A validated, lowercased hostname in fixed storage.
#[derive(Clone, Copy)]
pub struct Hostname {
    bytes: [u8; MAX_HOSTNAME],
    /// Always <= `MAX_HOSTNAME` (253), so `u8` cannot truncate it.
    len: u8,
}

impl Hostname {
    /// Validate and store `raw`, or return `None` if it is not a hostname.
    ///
    /// `None` is not an error condition. Non-TLS traffic on 443 and clients that
    /// send an IP literal or an IDN A-label we do not accept are all normal; the
    /// caller treats `None` as "no hostname" and falls through to the IP/port
    /// rules rather than dropping the flow.
    ///
    /// One trailing dot is stripped before validation. `example.com.` and
    /// `example.com` are the same name, and letting the dotted form through as a
    /// distinct string would be a trivial way to evade a hostname rule.
    #[must_use]
    pub fn parse(raw: &[u8]) -> Option<Self> {
        let raw = match raw.split_last() {
            Some((&b'.', head)) => head,
            _ => raw,
        };
        if raw.is_empty() || raw.len() > MAX_HOSTNAME {
            return None;
        }

        let mut bytes = [0u8; MAX_HOSTNAME];
        let mut label_len = 0usize;
        // Seeded as if a label had just ended, so a leading `-` or `.` is caught
        // by the same checks that catch one in the middle.
        let mut prev = b'.';

        // Zipping over the destination is what makes the write bounds-safe
        // without indexing: it stops at `MAX_HOSTNAME` by construction, and
        // `raw.len() <= MAX_HOSTNAME` was checked above.
        for (slot, byte) in bytes.iter_mut().zip(raw.iter().copied()) {
            if byte == b'.' {
                if label_len == 0 || prev == b'-' {
                    return None; // empty label, or label ending in `-`
                }
                label_len = 0;
            } else {
                if !is_ldh(byte) {
                    return None;
                }
                if label_len == 0 && byte == b'-' {
                    return None; // label starting with `-`
                }
                label_len = label_len.checked_add(1)?;
                if label_len > MAX_LABEL {
                    return None;
                }
            }
            let lowered = ascii_lower(byte);
            *slot = lowered;
            prev = lowered;
        }

        if label_len == 0 || prev == b'-' {
            return None; // ended on a dot (after the single strip) or on a `-`
        }

        // `raw.len() <= 253` was checked, so this conversion always succeeds.
        let len = u8::try_from(raw.len()).ok()?;
        Some(Self { bytes, len })
    }

    /// The validated bytes. Lowercased, LDH-only, never empty.
    #[inline]
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        self.bytes.get(..usize::from(self.len)).unwrap_or(&[])
    }

    /// Length in bytes. Always 1..=253.
    #[inline]
    #[must_use]
    pub fn len(&self) -> usize {
        usize::from(self.len)
    }

    /// Always `false` - a `Hostname` cannot be empty. Present because clippy
    /// asks for it wherever `len` exists.
    #[inline]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// FNV-1a over the validated bytes, used to short-circuit the stats table's
    /// linear probe before falling back to a full comparison.
    #[must_use]
    pub fn fnv1a(&self) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in self.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash
    }
}

impl PartialEq for Hostname {
    fn eq(&self, other: &Self) -> bool {
        self.as_bytes() == other.as_bytes()
    }
}

impl Eq for Hostname {}

impl fmt::Display for Hostname {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // LDH bytes are always valid UTF-8; `unwrap_or` keeps the no-panic
        // guarantee without pretending the fallback is reachable.
        f.write_str(core::str::from_utf8(self.as_bytes()).unwrap_or("?"))
    }
}

impl fmt::Debug for Hostname {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Hostname({self})")
    }
}

/// Display adapter for logging bytes that have **not** been validated.
///
/// The contract is explicit that a raw hostname must never reach a log without
/// its control bytes sanitised: log output ends up in journald, in PolySIEM's UI
/// and in support bundles, and a name containing `\n`, an ANSI escape or a NUL is
/// a log-injection vector. Anything outside printable ASCII becomes `?`, and the
/// output is truncated to [`MAX_HOSTNAME`].
pub struct Sanitised<'a>(pub &'a [u8]);

impl fmt::Display for Sanitised<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for byte in self.0.iter().copied().take(MAX_HOSTNAME) {
            let shown = if byte.is_ascii_graphic() {
                char::from(byte)
            } else {
                '?'
            };
            f.write_char(shown)?;
        }
        Ok(())
    }
}

impl fmt::Debug for Sanitised<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "\"{self}\"")
    }
}

/// A hostname condition from the rule list: exact, or a `*.` suffix.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostPattern {
    /// Matches one name exactly.
    Exact(Hostname),
    /// `*.example.com`. Stores `example.com`.
    ///
    /// **Matches the apex too**: `*.example.com` matches `example.com`,
    /// `a.example.com` and `a.b.example.com`. DNS wildcards do not work this way,
    /// but a routing rule is not a DNS record - an operator who writes
    /// `*.netflix.com` to pin Netflix to an exit means the apex as well, and the
    /// surprising alternative is a flow silently taking a different egress than
    /// the one the rule names. This is asserted in the tests so it cannot drift,
    /// and `proxy-config.ts` documents the same reading on the TypeScript side.
    Suffix(Hostname),
}

impl HostPattern {
    /// Parse a rule's hostname field. `None` if it is not a usable pattern.
    #[must_use]
    pub fn parse(raw: &[u8]) -> Option<Self> {
        match raw.strip_prefix(b"*.") {
            Some(rest) => Hostname::parse(rest).map(Self::Suffix),
            None => Hostname::parse(raw).map(Self::Exact),
        }
    }

    /// Does `host` satisfy this condition?
    #[must_use]
    pub fn matches(&self, host: &Hostname) -> bool {
        let observed = host.as_bytes();
        match self {
            Self::Exact(want) => observed == want.as_bytes(),
            Self::Suffix(base) => {
                let base = base.as_bytes();
                if observed == base {
                    return true; // apex - see the doc comment on `Suffix`
                }
                let Some(cut) = observed.len().checked_sub(base.len()) else {
                    return false;
                };
                // The byte immediately before the suffix must be the label
                // separator, so `notexample.com` does not match `*.example.com`.
                let Some(dot_at) = cut.checked_sub(1) else {
                    return false;
                };
                match observed.get(dot_at..).and_then(<[u8]>::split_first) {
                    Some((&b'.', tail)) => tail == base,
                    _ => false,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    // Test code is allowed to index and unwrap; the production paths above are
    // not. `forbid(unsafe_code)` still applies and is not relaxable.
    #![allow(
        clippy::indexing_slicing,
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::arithmetic_side_effects
    )]

    use super::*;

    fn host(text: &str) -> Hostname {
        Hostname::parse(text.as_bytes()).expect("valid hostname")
    }

    #[test]
    fn lowercases_ascii_only() {
        assert_eq!(host("ExAmPlE.CoM").as_bytes(), b"example.com");
        assert_eq!(host("XN--BCHER-KVA.DE").as_bytes(), b"xn--bcher-kva.de");
    }

    #[test]
    fn strips_exactly_one_trailing_dot() {
        assert_eq!(host("example.com.").as_bytes(), b"example.com");
        assert!(Hostname::parse(b"example.com..").is_none());
    }

    #[test]
    fn rejects_non_ldh_and_malformed_labels() {
        for bad in [
            &b""[..],
            b".",
            b"..",
            b".example.com",
            b"example..com",
            b"-example.com",
            b"example-.com",
            b"exa_mple.com",
            b"exa mple.com",
            b"example.com\n",
            b"exa\0mple.com",
            b"[::1]",
        ] {
            assert!(Hostname::parse(bad).is_none(), "should reject {bad:?}");
        }
    }

    #[test]
    fn enforces_length_caps() {
        let label = "a".repeat(63);
        assert!(Hostname::parse(label.as_bytes()).is_some());
        assert!(Hostname::parse("a".repeat(64).as_bytes()).is_none());

        // 253 is allowed, 254 is not.
        let long = core::iter::repeat(label.as_str())
            .take(4)
            .collect::<Vec<_>>()
            .join(".");
        assert_eq!(long.len(), 255);
        assert!(Hostname::parse(long.as_bytes()).is_none());
        assert!(Hostname::parse(&long.as_bytes()[..253]).is_some());
    }

    #[test]
    fn suffix_pattern_matches_apex_and_subdomains_but_not_a_prefix_collision() {
        let pattern = HostPattern::parse(b"*.example.com").unwrap();
        assert!(pattern.matches(&host("example.com")));
        assert!(pattern.matches(&host("a.example.com")));
        assert!(pattern.matches(&host("a.b.example.com")));
        assert!(!pattern.matches(&host("notexample.com")));
        assert!(!pattern.matches(&host("example.com.evil.test")));
    }

    #[test]
    fn exact_pattern_is_case_insensitive_and_does_not_match_subdomains() {
        let pattern = HostPattern::parse(b"Example.COM").unwrap();
        assert!(pattern.matches(&host("example.com")));
        assert!(!pattern.matches(&host("a.example.com")));
    }

    #[test]
    fn sanitised_replaces_control_bytes() {
        assert_eq!(
            format!("{}", Sanitised(b"ev\xffil\n.test\0")),
            "ev?il?.test?"
        );
    }
}
