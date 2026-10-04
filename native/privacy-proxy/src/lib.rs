//! `polysiem-privacy-proxy` - the SNI-inspecting transparent TCP proxy that backs
//! the PolySIEM privacy router's "Inspected" tier.
//!
//! # What it does, per connection
//!
//! ```text
//! accept4()                       -> a client the kernel REDIRECTed to us
//! getsockopt(SO_ORIGINAL_DST)     -> the destination the client actually wanted
//! recv(MSG_PEEK)                  -> <= 8 KiB: TLS ClientHello, or the HTTP Host header
//! match the ordered rule list     -> direct | exit:<key> | block
//! socket() + SO_BINDTODEVICE      -> pin the upstream to the chosen exit interface
//! splice() <-> splice()           -> relay, without the payload ever entering userspace
//! ```
//!
//! # Module map, and why it is split this way
//!
//! The split is a security boundary, not an organisational one.
//!
//! | Module | `unsafe`? | Eats hostile bytes? |
//! |---|---|---|
//! | [`hostname`] | forbidden | yes |
//! | [`parser`]   | forbidden | yes - this is the module the whole design is about |
//! | [`config`]   | forbidden | no (agent-written file) |
//! | [`rules`]    | forbidden | no |
//! | [`stats`]    | forbidden | no |
//! | [`throttle`] | forbidden | no |
//! | `relay`, `worker`, `server` | forbidden | no |
//! | `sys` | **the only module with `unsafe`** | no (syscall ABI only) |
//!
//! Every module except `sys` carries `#![forbid(unsafe_code)]`, so the entire
//! `unsafe` surface of the binary is one file of syscall wrappers whose blocks
//! each carry a `// SAFETY:` comment. `parser` and `hostname` additionally deny
//! the lints that let a panic reach a connection handler - `indexing_slicing`,
//! `unwrap_used`, `expect_used`, `panic`, `arithmetic_side_effects` - because a
//! panic triggered by a remote peer is a denial of service, not a bug report.
//!
//! # Portability
//!
//! The upper half of the crate (everything in the table above except the last
//! two rows) is plain portable Rust and compiles and tests anywhere, which is
//! how the parser's property test can run on a developer's machine regardless of
//! platform. The datapath is Linux-only by nature - `splice`, `epoll`,
//! `SO_ORIGINAL_DST` and `SO_BINDTODEVICE` have no equivalents elsewhere - and is
//! gated on `target_os = "linux"`.

pub mod config;
pub mod hostname;
pub mod parser;
pub mod rules;
pub mod stats;
pub mod throttle;

#[cfg(target_os = "linux")]
pub mod relay;
#[cfg(target_os = "linux")]
pub mod server;
#[cfg(target_os = "linux")]
pub mod sys;
#[cfg(target_os = "linux")]
pub mod worker;

/// Largest number of bytes ever read into userspace from a client connection.
///
/// A ClientHello may legitimately span several TCP segments and several TLS
/// records; this is the cap on the reassembled total. Everything past it is
/// treated as "no hostname" and falls through to the IP/port rules, which is
/// the same outcome as any other unparseable prelude.
pub const MAX_PEEK: usize = 8 * 1024;

/// Version string reported by `--version` and written into the stats file.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
