//! **The datapath test: real sockets, real netfilter, real `splice`, real bytes.**
//!
//! Everything else in this crate's test suite exercises pure functions. This file
//! exercises the part that actually carries a household's traffic: `accept4`,
//! `getsockopt(SO_ORIGINAL_DST)`, the `MSG_PEEK` classification, `connect` with
//! `SO_BINDTODEVICE`, and the `splice(2)` relay. It runs the real binary, not a
//! stub, with netfilter genuinely redirecting connections into it.
//!
//! # How the network is built
//!
//! ```text
//!   client (source pinned to 127.0.0.3)
//!      |  connect -> 127.0.0.2:443
//!      v
//!   nftables nat/output:  ip saddr 127.0.0.3 tcp dport 443 redirect to :18443
//!      |
//!      v
//!   polysiem-privacy-proxy (listening 0.0.0.0:18443)
//!      |  getsockopt(SO_ORIGINAL_DST) -> 127.0.0.2:443   <- genuinely exercised
//!      |  peek ClientHello -> SNI -> match rules -> SO_BINDTODEVICE
//!      v
//!   origin server on 127.0.0.2:443
//! ```
//!
//! **The source-address pin is what stops the proxy eating its own tail.** The
//! proxy's upstream connection goes to the same `127.0.0.2:443` the client asked
//! for, so a redirect rule matching only on destination would send the proxy's
//! own connection straight back into the proxy, forever. Matching on
//! `ip saddr 127.0.0.3` - an address only the test clients bind - keeps the two
//! apart. There is no way to set a client's source address through
//! `std::net::TcpStream`, which is why `sys::bind_v4` is public.
//!
//! # Skipping
//!
//! The test needs Linux, `nft`, `NET_ADMIN`, and the ability to bind port 443. It
//! detects all four and skips with a printed reason otherwise, so `cargo test` on
//! a developer's machine stays green. **Set `POLYSIEM_DATAPATH_TESTS=required` to
//! turn a skip into a failure** - CI does exactly that, so this can never quietly
//! stop running and leave the datapath untested.

#![cfg(target_os = "linux")]
#![allow(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::arithmetic_side_effects
)]

use std::collections::HashMap;
use std::io::{Read as _, Write as _};
use std::net::{Ipv4Addr, Shutdown, SocketAddrV4, TcpListener, TcpStream};
use std::os::fd::AsFd as _;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use polysiem_privacy_proxy::sys::{self, ConnectState, Epoll};

// --- Addressing -------------------------------------------------------------

/// Source address every test client pins, and the only one netfilter redirects.
const CLIENT_SOURCE: Ipv4Addr = Ipv4Addr::new(127, 0, 0, 3);
/// Bulk-transfer origin: the payload-integrity path.
const BULK_ORIGIN: Ipv4Addr = Ipv4Addr::new(127, 0, 0, 2);
/// Small-transfer origin, on both 443 and 80.
const SMALL_ORIGIN: Ipv4Addr = Ipv4Addr::new(127, 0, 0, 5);
/// Origin used only by the stats scenario, so its counters are unpolluted.
const STATS_ORIGIN: Ipv4Addr = Ipv4Addr::new(127, 0, 0, 6);
/// Destination a `block` rule covers. Nothing must ever reach it.
const BLOCK_DEST: Ipv4Addr = Ipv4Addr::new(127, 0, 0, 7);
/// Destination routed to an exit whose interface exists but is DOWN.
const DEAD_EXIT_DEST: Ipv4Addr = Ipv4Addr::new(127, 0, 0, 8);
/// Destination routed to an exit whose interface does not exist at all.
const GHOST_EXIT_DEST: Ipv4Addr = Ipv4Addr::new(127, 0, 0, 9);
/// Destination covered by a rule carrying a `rateKbps` token bucket.
const THROTTLE_DEST: Ipv4Addr = Ipv4Addr::new(127, 0, 0, 10);

/// Rate the throttled rule enforces: 8192 kbps = 1,024,000 bytes/second.
const THROTTLE_KBPS: u32 = 8192;
/// Downstream size for the throttle scenario: at the rate above, ~0.8 s.
const THROTTLE_BYTES: usize = 1024 * 1024;
const DOWN_SEED_THROTTLE: u64 = 0xB0B0;

const PROXY_HTTPS_PORT: u16 = 18443;
const PROXY_HTTP_PORT: u16 = 18080;

const NFT_TABLE: &str = "psvpn_datapath_test";
const DEAD_IFACE: &str = "psvpn-dead";

/// 4 MiB each way. Far past any socket buffer or pipe, so the relay has to loop.
const BULK_BYTES: usize = 4 * 1024 * 1024;
const SMALL_BYTES: usize = 4096;
const DOWN_SEED_BULK: u64 = 0x51D2;
const DOWN_SEED_SMALL: u64 = 0x7E11;
const DOWN_SEED_STATS: u64 = 0x9A03;

// ---------------------------------------------------------------------------
// Deterministic payloads
// ---------------------------------------------------------------------------

/// xorshift64 keyed on `seed`, so both ends can generate the same stream without
/// either sending it.
fn payload(seed: u64, len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len + 8);
    let mut state = seed | 1;
    while out.len() < len {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        out.extend_from_slice(&state.to_le_bytes());
    }
    out.truncate(len);
    out
}

#[derive(Clone, Copy)]
struct Fnv(u64);

impl Fnv {
    fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }
    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    fn finish(self) -> u64 {
        self.0
    }
}

fn checksum(bytes: &[u8]) -> u64 {
    let mut hasher = Fnv::new();
    hasher.write(bytes);
    hasher.finish()
}

/// A minimal valid ClientHello carrying one `host_name`.
///
/// `parser_vectors.rs` has a richer builder parameterised over extension lists
/// and name types, because it is testing the parser's structural handling. This
/// one only ever needs to produce something a real TLS stack would send.
fn client_hello(host: &str) -> Vec<u8> {
    let host = host.as_bytes();
    let mut list = vec![0u8];
    list.extend_from_slice(&u16::try_from(host.len()).unwrap().to_be_bytes());
    list.extend_from_slice(host);

    let mut sni = Vec::new();
    sni.extend_from_slice(&u16::try_from(list.len()).unwrap().to_be_bytes());
    sni.extend_from_slice(&list);

    let mut extensions = Vec::new();
    extensions.extend_from_slice(&0x0000u16.to_be_bytes());
    extensions.extend_from_slice(&u16::try_from(sni.len()).unwrap().to_be_bytes());
    extensions.extend_from_slice(&sni);

    let mut body = Vec::new();
    body.extend_from_slice(&[0x03, 0x03]);
    body.extend_from_slice(&[0x5A; 32]);
    body.push(0);
    body.extend_from_slice(&[0x00, 0x02, 0x13, 0x01]);
    body.extend_from_slice(&[0x01, 0x00]);
    body.extend_from_slice(&u16::try_from(extensions.len()).unwrap().to_be_bytes());
    body.extend_from_slice(&extensions);

    let mut handshake = vec![0x01];
    handshake.extend_from_slice(&u32::try_from(body.len()).unwrap().to_be_bytes()[1..4]);
    handshake.extend_from_slice(&body);

    let mut record = vec![0x16, 0x03, 0x01];
    record.extend_from_slice(&u16::try_from(handshake.len()).unwrap().to_be_bytes());
    record.extend_from_slice(&handshake);
    record
}

// ---------------------------------------------------------------------------
// Origin servers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
struct Received {
    bytes: usize,
    checksum: u64,
}

/// What an origin does with a connection.
#[derive(Clone, Copy)]
enum OriginMode {
    /// Read to EOF, record, then send `len` deterministic bytes from `seed`.
    Echo { len: usize, seed: u64 },
    /// Accept, count, close. Used where the test's assertion is that the count
    /// stays at zero.
    CountOnly,
}

#[derive(Clone)]
struct Origin {
    accepted: Arc<AtomicUsize>,
    received: Arc<Mutex<Vec<Received>>>,
}

impl Origin {
    fn accepts(&self) -> usize {
        self.accepted.load(Ordering::SeqCst)
    }

    /// Wait until at least `count` connections have finished being read.
    fn wait_for(&self, count: usize, timeout: Duration) -> Option<Received> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if let Ok(records) = self.received.lock() {
                if records.len() >= count {
                    return records.get(count - 1).copied();
                }
            }
            thread::sleep(Duration::from_millis(20));
        }
        None
    }
}

fn spawn_origin(addr: SocketAddrV4, mode: OriginMode) -> std::io::Result<Origin> {
    let listener = TcpListener::bind(addr)?;
    let origin = Origin {
        accepted: Arc::new(AtomicUsize::new(0)),
        received: Arc::new(Mutex::new(Vec::new())),
    };
    let handle = origin.clone();
    thread::spawn(move || {
        while let Ok((stream, _)) = listener.accept() {
            handle.accepted.fetch_add(1, Ordering::SeqCst);
            let received = Arc::clone(&handle.received);
            thread::spawn(move || serve_origin(stream, mode, &received));
        }
    });
    Ok(origin)
}

fn serve_origin(mut stream: TcpStream, mode: OriginMode, received: &Mutex<Vec<Received>>) {
    let OriginMode::Echo { len, seed } = mode else {
        let _ = stream.shutdown(Shutdown::Both);
        return;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));

    let mut hasher = Fnv::new();
    let mut total = 0usize;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                hasher.write(&buffer[..read]);
                total += read;
            }
            Err(_) => break,
        }
    }
    if let Ok(mut records) = received.lock() {
        records.push(Received {
            bytes: total,
            checksum: hasher.finish(),
        });
    }
    if len > 0 {
        let _ = stream.write_all(&payload(seed, len));
    }
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Both);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/// Connect with the source address pinned, so netfilter redirects us.
fn connect_via_redirect(destination: SocketAddrV4) -> std::io::Result<TcpStream> {
    let fd = sys::tcp_socket()?;
    sys::bind_v4(fd.as_fd(), SocketAddrV4::new(CLIENT_SOURCE, 0))?;

    if sys::connect(fd.as_fd(), destination)? == ConnectState::InProgress {
        let epoll = Epoll::new()?;
        epoll.add(fd.as_fd(), sys::WRITABLE, 0)?;
        let mut events = [sys::empty_event(); 1];
        if epoll.wait(&mut events, 10_000)? == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "connect timed out",
            ));
        }
        let error = sys::socket_error(fd.as_fd())?;
        if error != 0 {
            return Err(std::io::Error::from_raw_os_error(error));
        }
    }

    let stream = TcpStream::from(fd);
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    stream.set_write_timeout(Some(Duration::from_secs(30)))?;
    Ok(stream)
}

/// Send `prelude` then `up`, half-close, and read everything that comes back.
fn exchange(destination: SocketAddrV4, prelude: &[u8], up: &[u8]) -> Result<Vec<u8>, String> {
    let mut stream = connect_via_redirect(destination).map_err(|e| format!("connect: {e}"))?;
    stream
        .write_all(prelude)
        .map_err(|e| format!("write prelude: {e}"))?;

    // The upload runs on this thread while the origin drains it, so a payload
    // larger than every buffer in the path cannot deadlock.
    if !up.is_empty() {
        stream
            .write_all(up)
            .map_err(|e| format!("write payload: {e}"))?;
    }
    stream
        .shutdown(Shutdown::Write)
        .map_err(|e| format!("shutdown: {e}"))?;

    let mut down = Vec::new();
    stream
        .read_to_end(&mut down)
        .map_err(|e| format!("read: {e}"))?;
    Ok(down)
}

// ---------------------------------------------------------------------------
// Stats file
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Service {
    action: String,
    bytes_in: u64,
    bytes_out: u64,
    flows: u64,
}

#[derive(Debug, Default)]
struct Stats {
    started: u64,
    active: u64,
    total: u64,
    services: HashMap<String, Service>,
    degraded: Option<String>,
}

fn parse_stats(text: &str) -> Stats {
    let mut stats = Stats::default();
    for line in text.lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        match fields.first().copied() {
            Some("STARTED") => {
                stats.started = fields.get(1).and_then(|v| v.parse().ok()).unwrap_or(0)
            }
            Some("FLOWS") => {
                stats.active = fields.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
                stats.total = fields.get(2).and_then(|v| v.parse().ok()).unwrap_or(0);
            }
            Some("DEGRADED") => stats.degraded = fields.get(1).map(|v| (*v).to_owned()),
            // SERVICE <host> <action> <bytesIn> <bytesOut> <flows>.
            // bytesIn is what came DOWN from the service, bytesOut is what went
            // UP to it - the column order is the design doc's, and getting it
            // backwards here once already produced a very convincing-looking
            // "proxy bug" that was entirely this parser's fault.
            Some("SERVICE") if fields.len() >= 6 => {
                stats.services.insert(
                    fields[1].to_owned(),
                    Service {
                        action: fields[2].to_owned(),
                        bytes_in: fields[3].parse().unwrap_or(0),
                        bytes_out: fields[4].parse().unwrap_or(0),
                        flows: fields[5].parse().unwrap_or(0),
                    },
                );
            }
            _ => {}
        }
    }
    stats
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

struct Harness {
    proxy: Child,
    directory: PathBuf,
    config_path: PathBuf,
    stats_path: PathBuf,
    dead_iface_created: bool,
    bulk: Origin,
    small_tls: Origin,
    small_http: Origin,
    stats_origin: Origin,
    throttled: Origin,
    blocked: Origin,
    dead_exit: Origin,
    ghost_exit: Origin,
}

/// The rule list every scenario is written against.
///
/// One config covers all of them because scenarios are separated by DESTINATION
/// address, which keeps the netfilter setup to a single pair of rules.
fn base_config() -> String {
    format!(
        "VPNPROXY 1\n\
         LISTEN {PROXY_HTTP_PORT} http\n\
         LISTEN {PROXY_HTTPS_PORT} tls\n\
         EXIT dead {DEAD_IFACE}\n\
         EXIT ghost psvpn-ghost\n\
         EXIT good lo\n\
         DEFAULT direct\n\
         RULE 1 block - {BLOCK_DEST}/32 - - - -\n\
         RULE 2 exit:dead - {DEAD_EXIT_DEST}/32 - - - -\n\
         RULE 3 exit:ghost - {GHOST_EXIT_DEST}/32 - - - -\n\
         RULE 4 direct - {THROTTLE_DEST}/32 - - - {THROTTLE_KBPS}\n\
         RULE 5 exit:good - - - - *.sni.test -\n\
         RULE 6 direct - - - - - -\n\
         LIMITS 64 30 1048576 2\n"
    )
}

fn run(command: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    Command::new(command).args(args).output()
}

fn nft_script(script: &str) -> Result<(), String> {
    let mut child = Command::new("nft")
        .arg("-f")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawning nft: {e}"))?;
    child
        .stdin
        .as_mut()
        .ok_or("nft stdin")?
        .write_all(script.as_bytes())
        .map_err(|e| format!("writing nft script: {e}"))?;
    let output = child.wait_with_output().map_err(|e| format!("nft: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "nft failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

/// Everything the test needs from the environment, checked before anything is
/// set up so a skip is clean rather than half-built.
fn probe_environment() -> Result<(), String> {
    if run("nft", &["--version"]).is_err() {
        return Err("`nft` is not installed".into());
    }
    // The cheapest possible NET_ADMIN check: create a table and remove it.
    nft_script(&format!("add table ip {NFT_TABLE}_probe\n"))
        .map_err(|e| format!("no NET_ADMIN (cannot create an nftables table): {e}"))?;
    let _ = nft_script(&format!("delete table ip {NFT_TABLE}_probe\n"));

    // Origins listen on port 443, which needs privilege.
    TcpListener::bind(SocketAddrV4::new(BULK_ORIGIN, 443)).map_err(|e| {
        format!("cannot bind {BULK_ORIGIN}:443 (need root or CAP_NET_BIND_SERVICE): {e}")
    })?;
    Ok(())
}

impl Harness {
    fn start() -> Result<Self, String> {
        probe_environment()?;

        let directory = PathBuf::from("/tmp/polysiem-privacy-proxy-datapath");
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).map_err(|e| format!("creating {directory:?}: {e}"))?;
        let config_path = directory.join("privacy-proxy.conf");
        let stats_path = directory.join("stats");
        std::fs::write(&config_path, base_config()).map_err(|e| format!("writing config: {e}"))?;

        // An exit interface that exists but is DOWN. If the dummy module is
        // unavailable the `ghost` exit still proves the same invariant, so this
        // is best-effort rather than fatal.
        let dead_iface_created = run("ip", &["link", "add", DEAD_IFACE, "type", "dummy"])
            .map(|output| output.status.success())
            .unwrap_or(false);

        // Deliberately NOT brought up: `interface_is_up` must report false.
        nft_script(&format!(
            "add table ip {NFT_TABLE}\n\
             flush table ip {NFT_TABLE}\n\
             add chain ip {NFT_TABLE} output {{ type nat hook output priority -100 ; policy accept ; }}\n\
             add rule ip {NFT_TABLE} output ip saddr {CLIENT_SOURCE} tcp dport 443 redirect to :{PROXY_HTTPS_PORT}\n\
             add rule ip {NFT_TABLE} output ip saddr {CLIENT_SOURCE} tcp dport 80 redirect to :{PROXY_HTTP_PORT}\n"
        ))?;

        let bulk = spawn_origin(
            SocketAddrV4::new(BULK_ORIGIN, 443),
            OriginMode::Echo {
                len: BULK_BYTES,
                seed: DOWN_SEED_BULK,
            },
        )
        .map_err(|e| format!("bulk origin: {e}"))?;
        let small_tls = spawn_origin(
            SocketAddrV4::new(SMALL_ORIGIN, 443),
            OriginMode::Echo {
                len: SMALL_BYTES,
                seed: DOWN_SEED_SMALL,
            },
        )
        .map_err(|e| format!("small tls origin: {e}"))?;
        let small_http = spawn_origin(
            SocketAddrV4::new(SMALL_ORIGIN, 80),
            OriginMode::Echo {
                len: SMALL_BYTES,
                seed: DOWN_SEED_SMALL,
            },
        )
        .map_err(|e| format!("small http origin: {e}"))?;
        let stats_origin = spawn_origin(
            SocketAddrV4::new(STATS_ORIGIN, 443),
            OriginMode::Echo {
                len: SMALL_BYTES,
                seed: DOWN_SEED_STATS,
            },
        )
        .map_err(|e| format!("stats origin: {e}"))?;
        let throttled = spawn_origin(
            SocketAddrV4::new(THROTTLE_DEST, 443),
            OriginMode::Echo {
                len: THROTTLE_BYTES,
                seed: DOWN_SEED_THROTTLE,
            },
        )
        .map_err(|e| format!("throttle origin: {e}"))?;
        let blocked = spawn_origin(SocketAddrV4::new(BLOCK_DEST, 443), OriginMode::CountOnly)
            .map_err(|e| format!("block origin: {e}"))?;
        let dead_exit = spawn_origin(
            SocketAddrV4::new(DEAD_EXIT_DEST, 443),
            OriginMode::CountOnly,
        )
        .map_err(|e| format!("dead-exit origin: {e}"))?;
        let ghost_exit = spawn_origin(
            SocketAddrV4::new(GHOST_EXIT_DEST, 443),
            OriginMode::CountOnly,
        )
        .map_err(|e| format!("ghost-exit origin: {e}"))?;

        let proxy = Command::new(env!("CARGO_BIN_EXE_polysiem-privacy-proxy"))
            .arg("--config")
            .arg(&config_path)
            .arg("--stats")
            .arg(&stats_path)
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("spawning the proxy: {e}"))?;

        let harness = Self {
            proxy,
            directory,
            config_path,
            stats_path,
            dead_iface_created,
            bulk,
            small_tls,
            small_http,
            stats_origin,
            throttled,
            blocked,
            dead_exit,
            ghost_exit,
        };
        harness.wait_until_listening()?;
        Ok(harness)
    }

    fn wait_until_listening(&self) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if TcpStream::connect(SocketAddrV4::new(Ipv4Addr::LOCALHOST, PROXY_HTTPS_PORT)).is_ok()
            {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(50));
        }
        Err("the proxy never started listening".into())
    }

    fn signal(&self, name: &str) -> Result<(), String> {
        run("kill", &[name, &self.proxy.id().to_string()])
            .map_err(|e| format!("kill {name}: {e}"))
            .and_then(|output| {
                if output.status.success() {
                    Ok(())
                } else {
                    Err(format!("kill {name} failed"))
                }
            })
    }

    fn is_alive(&mut self) -> bool {
        matches!(self.proxy.try_wait(), Ok(None))
    }

    /// Ask for a stats dump and wait until the named service appears.
    fn stats_containing(&self, host: &str, timeout: Duration) -> Result<Stats, String> {
        let deadline = Instant::now() + timeout;
        loop {
            self.signal("-USR1")?;
            thread::sleep(Duration::from_millis(120));
            let text = std::fs::read_to_string(&self.stats_path).unwrap_or_default();
            let stats = parse_stats(&text);
            if stats.services.contains_key(host) {
                return Ok(stats);
            }
            if Instant::now() >= deadline {
                return Err(format!(
                    "no SERVICE line for {host:?} after {timeout:?}; stats file was:\n{text}"
                ));
            }
        }
    }

    fn write_config(&self, text: &str) -> Result<(), String> {
        std::fs::write(&self.config_path, text).map_err(|e| format!("writing config: {e}"))
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = self.proxy.kill();
        let _ = self.proxy.wait();
        let _ = nft_script(&format!("delete table ip {NFT_TABLE}\n"));
        if self.dead_iface_created {
            let _ = run("ip", &["link", "del", DEAD_IFACE]);
        }
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/// A TLS flow classified by SNI, relayed through `splice`, with both directions
/// verified byte for byte.
fn scenario_tls_bulk_integrity(harness: &Harness) -> Result<(), String> {
    let hello = client_hello("bulk.sni.test");
    let up = payload(0xA111, BULK_BYTES);

    let down = exchange(SocketAddrV4::new(BULK_ORIGIN, 443), &hello, &up)?;

    // Downstream: every byte the origin sent, in order.
    let expected_down = payload(DOWN_SEED_BULK, BULK_BYTES);
    if down.len() != expected_down.len() {
        return Err(format!(
            "downstream length {} != {}",
            down.len(),
            expected_down.len()
        ));
    }
    if checksum(&down) != checksum(&expected_down) {
        return Err("downstream payload was corrupted in the relay".into());
    }

    // Upstream: the origin must have received the ClientHello followed by the
    // payload. The hello is spliced across like any other byte - `MSG_PEEK`
    // leaves it in the socket queue rather than consuming it, and this is what
    // proves that.
    let record = harness
        .bulk
        .wait_for(1, Duration::from_secs(30))
        .ok_or("the bulk origin never completed a connection")?;
    let mut expected_up = hello.clone();
    expected_up.extend_from_slice(&up);
    if record.bytes != expected_up.len() {
        return Err(format!(
            "origin received {} bytes, expected {}",
            record.bytes,
            expected_up.len()
        ));
    }
    if record.checksum != checksum(&expected_up) {
        return Err("upstream payload was corrupted in the relay".into());
    }
    Ok(())
}

/// A plain-HTTP flow classified by its `Host:` header.
fn scenario_http_host(harness: &Harness) -> Result<(), String> {
    let request = b"GET /index.html HTTP/1.1\r\nHost: http.test\r\nAccept: */*\r\n\r\n";
    let up = payload(0xB222, SMALL_BYTES);

    let down = exchange(SocketAddrV4::new(SMALL_ORIGIN, 80), request, &up)?;
    if checksum(&down) != checksum(&payload(DOWN_SEED_SMALL, SMALL_BYTES)) {
        return Err("downstream payload was corrupted on the HTTP path".into());
    }
    harness
        .small_http
        .wait_for(1, Duration::from_secs(20))
        .ok_or("the HTTP origin never completed a connection")?;

    let stats = harness.stats_containing("http.test", Duration::from_secs(10))?;
    let service = stats
        .services
        .get("http.test")
        .ok_or("no http.test service")?;
    if service.action != "direct" {
        return Err(format!(
            "http.test took action {:?}, expected direct",
            service.action
        ));
    }
    Ok(())
}

/// Non-TLS traffic on 443 must fall through to the IP/port rules, not be dropped.
fn scenario_non_tls_on_443(harness: &Harness) -> Result<(), String> {
    let before = harness.small_tls.accepts();
    // Deliberately not a ClientHello: the first byte is not `handshake`.
    let prelude = b"NOT-TLS-AT-ALL\x00\x01\x02 just some other protocol\n";
    let up = payload(0xC333, SMALL_BYTES);

    let down = exchange(SocketAddrV4::new(SMALL_ORIGIN, 443), prelude, &up)?;
    if checksum(&down) != checksum(&payload(DOWN_SEED_SMALL, SMALL_BYTES)) {
        return Err("non-TLS flow did not relay cleanly".into());
    }
    if harness.small_tls.accepts() <= before {
        return Err("the non-TLS flow never reached the origin - it was dropped".into());
    }

    // It is recorded under the "no hostname" token, taking the default rule.
    let stats = harness.stats_containing("-", Duration::from_secs(10))?;
    let service = stats.services.get("-").ok_or("no `-` service line")?;
    if service.action != "direct" {
        return Err(format!("unnamed flow took action {:?}", service.action));
    }
    Ok(())
}

/// A ClientHello dribbled across three TCP segments with real delays.
///
/// This is where buffering bugs hide: the peek path has to hold partial state
/// across several `EPOLLIN` edges and only classify once the hello is complete.
fn scenario_split_client_hello(harness: &Harness) -> Result<(), String> {
    let hello = client_hello("split.sni.test");
    let up = payload(0xD444, SMALL_BYTES);
    let before = harness.small_tls.accepts();

    let mut stream = connect_via_redirect(SocketAddrV4::new(SMALL_ORIGIN, 443))
        .map_err(|e| format!("connect: {e}"))?;

    let chunk = hello.len().div_ceil(3);
    for (index, piece) in hello.chunks(chunk).enumerate() {
        stream
            .write_all(piece)
            .map_err(|e| format!("segment {index}: {e}"))?;
        stream.flush().map_err(|e| format!("flush {index}: {e}"))?;
        // A real delay, so these are genuinely separate segments and the proxy
        // genuinely has to wait for more bytes.
        thread::sleep(Duration::from_millis(60));
    }
    stream.write_all(&up).map_err(|e| format!("payload: {e}"))?;
    stream
        .shutdown(Shutdown::Write)
        .map_err(|e| format!("shutdown: {e}"))?;

    let mut down = Vec::new();
    stream
        .read_to_end(&mut down)
        .map_err(|e| format!("read: {e}"))?;
    if checksum(&down) != checksum(&payload(DOWN_SEED_SMALL, SMALL_BYTES)) {
        return Err("split-hello flow did not relay cleanly".into());
    }
    if harness.small_tls.accepts() <= before {
        return Err("the split-hello flow never reached the origin".into());
    }

    // And it was classified by the name that arrived in pieces.
    let stats = harness.stats_containing("split.sni.test", Duration::from_secs(10))?;
    let service = stats
        .services
        .get("split.sni.test")
        .ok_or("no split.sni.test service")?;
    if service.action != "exit:good" {
        return Err(format!(
            "split.sni.test took action {:?}, expected exit:good",
            service.action
        ));
    }
    Ok(())
}

/// A `block` rule closes the connection and nothing reaches the destination.
fn scenario_block(harness: &Harness) -> Result<(), String> {
    let hello = client_hello("blocked.example");
    let mut stream = connect_via_redirect(SocketAddrV4::new(BLOCK_DEST, 443))
        .map_err(|e| format!("connect: {e}"))?;
    let _ = stream.write_all(&hello);

    let mut down = Vec::new();
    let _ = stream.read_to_end(&mut down);
    if !down.is_empty() {
        return Err(format!("a blocked flow returned {} bytes", down.len()));
    }
    if harness.blocked.accepts() != 0 {
        return Err("a blocked flow reached its destination".into());
    }
    Ok(())
}

/// **The privacy invariant, proven rather than reasoned.**
///
/// When the exit a rule names is unusable the flow is CLOSED. It is never
/// retried over the normal WAN. The assertion is not "the client saw an error" -
/// it is that a live listener sitting at the destination accepted **zero**
/// connections, and then accepted one the moment the test connected to it
/// directly. That control is what makes the zero mean something: without it, a
/// broken listener would produce the same evidence as a working killswitch.
fn scenario_exit_down_never_leaks(harness: &Harness) -> Result<(), String> {
    let cases: &[(&str, Ipv4Addr, &Origin, bool)] = &[
        (
            "ghost (interface does not exist)",
            GHOST_EXIT_DEST,
            &harness.ghost_exit,
            true,
        ),
        (
            "dead (interface exists but is DOWN)",
            DEAD_EXIT_DEST,
            &harness.dead_exit,
            harness.dead_iface_created,
        ),
    ];

    for (name, destination, origin, enabled) in cases {
        if !enabled {
            println!("      - skipping {name}: the dummy interface could not be created");
            continue;
        }
        let hello = client_hello("leak-check.example");
        let mut stream = connect_via_redirect(SocketAddrV4::new(*destination, 443))
            .map_err(|e| format!("{name}: connect: {e}"))?;
        let _ = stream.write_all(&hello);

        let mut down = Vec::new();
        let _ = stream.read_to_end(&mut down);
        if !down.is_empty() {
            return Err(format!("{name}: the flow returned {} bytes", down.len()));
        }
        if origin.accepts() != 0 {
            return Err(format!(
                "{name}: PRIVACY LEAK - the flow reached its destination directly \
                 despite its exit being unusable"
            ));
        }

        // The control: prove the listener would have accepted had anything come.
        TcpStream::connect(SocketAddrV4::new(*destination, 443))
            .map_err(|e| format!("{name}: control connection failed: {e}"))?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while origin.accepts() == 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if origin.accepts() == 0 {
            return Err(format!(
                "{name}: the listener never accepted even a direct connection, \
                 so the zero-accept assertion above proves nothing"
            ));
        }
    }
    Ok(())
}

/// Byte counters are exact and accumulate across flows rather than resetting.
fn scenario_stats_are_cumulative(harness: &Harness) -> Result<(), String> {
    let hello = client_hello("stats.sni.test");
    let up = payload(0xE555, SMALL_BYTES);
    let expected_out = (hello.len() + up.len()) as u64;
    let expected_in = SMALL_BYTES as u64;

    exchange(SocketAddrV4::new(STATS_ORIGIN, 443), &hello, &up)?;
    harness
        .stats_origin
        .wait_for(1, Duration::from_secs(20))
        .ok_or("the stats origin never completed the first connection")?;
    let first = harness.stats_containing("stats.sni.test", Duration::from_secs(10))?;
    let one = first
        .services
        .get("stats.sni.test")
        .ok_or("no stats.sni.test service")?
        .clone();

    if one.action != "exit:good" {
        return Err(format!("stats.sni.test took action {:?}", one.action));
    }
    if one.flows != 1 {
        return Err(format!("expected 1 flow, saw {}", one.flows));
    }
    if one.bytes_out != expected_out {
        return Err(format!("bytesOut {} != {expected_out}", one.bytes_out));
    }
    if one.bytes_in != expected_in {
        return Err(format!("bytesIn {} != {expected_in}", one.bytes_in));
    }

    // A second identical flow must ADD to the counters, not replace them.
    exchange(SocketAddrV4::new(STATS_ORIGIN, 443), &hello, &up)?;
    harness
        .stats_origin
        .wait_for(2, Duration::from_secs(20))
        .ok_or("the stats origin never completed the second connection")?;

    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let second = harness.stats_containing("stats.sni.test", Duration::from_secs(10))?;
        let two = second
            .services
            .get("stats.sni.test")
            .ok_or("no stats.sni.test service on the second read")?;
        if two.flows == 2 {
            if two.bytes_out != expected_out * 2 {
                return Err(format!(
                    "cumulative bytesOut {} != {}",
                    two.bytes_out,
                    expected_out * 2
                ));
            }
            if two.bytes_in != expected_in * 2 {
                return Err(format!(
                    "cumulative bytesIn {} != {}",
                    two.bytes_in,
                    expected_in * 2
                ));
            }
            if second.started != first.started {
                return Err("STARTED changed without the proxy restarting".into());
            }
            if second.total < 2 {
                return Err(format!("FLOWS total {} is implausible", second.total));
            }
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("second flow never appeared; flows = {}", two.flows));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

/// A rule carrying `rateKbps` shapes the flow without stalling it.
///
/// The throttled path is the only part of the relay with its own scheduling: when
/// the token bucket is empty the flow stops reading and has to be woken again by
/// the worker's own sweep. Edge-triggered epoll will NOT re-notify a socket whose
/// data we deliberately left unread, so a flow that runs out of budget mid-read
/// and is not rescheduled simply hangs until the idle reaper kills it. That is a
/// silent stall, and it is exactly what this scenario is here to catch.
fn scenario_throttled_flow(harness: &Harness) -> Result<(), String> {
    let hello = client_hello("slow.example");
    let before = harness.throttled.accepts();

    let started = Instant::now();
    let down = exchange(SocketAddrV4::new(THROTTLE_DEST, 443), &hello, &[])?;
    let elapsed = started.elapsed();

    let expected = payload(DOWN_SEED_THROTTLE, THROTTLE_BYTES);
    if down.len() != expected.len() {
        return Err(format!(
            "throttled flow delivered {} bytes, expected {} (a stalled shaper truncates)",
            down.len(),
            expected.len()
        ));
    }
    if checksum(&down) != checksum(&expected) {
        return Err("throttled flow corrupted the payload".into());
    }
    if harness.throttled.accepts() <= before {
        return Err("the throttled flow never reached the origin".into());
    }

    // The bucket starts full, so roughly a quarter of the transfer arrives as an
    // immediate burst and the rest is paced. A generous lower bound: the point is
    // that shaping happened at all, not that it is accurate to the millisecond.
    let floor = Duration::from_millis(300);
    if elapsed < floor {
        return Err(format!(
            "1 MiB at {THROTTLE_KBPS} kbps finished in {elapsed:?}, under {floor:?} - \
             the rate limit was not applied"
        ));
    }
    if elapsed > Duration::from_secs(15) {
        return Err(format!(
            "throttled flow took {elapsed:?}, far beyond its rate"
        ));
    }
    Ok(())
}

/// `SIGHUP` must not disturb a flow that is already running, must survive a
/// malformed file, and must take effect for new flows.
fn scenario_reload(harness: &mut Harness) -> Result<(), String> {
    let hello = client_hello("reload.sni.test");
    let up = payload(0xF666, BULK_BYTES);
    let expected_down = payload(DOWN_SEED_BULK, BULK_BYTES);
    let before = harness.bulk.accepts();

    // A transfer paced to last about a second, so the reloads below genuinely
    // land mid-flight rather than racing a transfer that already finished.
    let transfer = {
        let hello = hello.clone();
        let up = up.clone();
        thread::spawn(move || -> Result<Vec<u8>, String> {
            let mut stream = connect_via_redirect(SocketAddrV4::new(BULK_ORIGIN, 443))
                .map_err(|e| format!("connect: {e}"))?;
            stream
                .write_all(&hello)
                .map_err(|e| format!("hello: {e}"))?;
            for chunk in up.chunks(64 * 1024) {
                stream.write_all(chunk).map_err(|e| format!("chunk: {e}"))?;
                thread::sleep(Duration::from_millis(15));
            }
            stream
                .shutdown(Shutdown::Write)
                .map_err(|e| format!("shutdown: {e}"))?;
            let mut down = Vec::new();
            stream
                .read_to_end(&mut down)
                .map_err(|e| format!("read: {e}"))?;
            Ok(down)
        })
    };

    thread::sleep(Duration::from_millis(200));

    // 1. A malformed config must be rejected without the proxy exiting.
    harness.write_config("this is not a valid configuration at all\n")?;
    harness.signal("-HUP")?;
    thread::sleep(Duration::from_millis(200));
    if !harness.is_alive() {
        return Err("the proxy EXITED on a malformed config reload".into());
    }

    // 2. A valid config that changes behaviour for NEW flows.
    let mut changed = base_config();
    changed = changed.replace(
        "RULE 6 direct - - - - - -\n",
        &format!("RULE 6 block - {STATS_ORIGIN}/32 - - - -\nRULE 7 direct - - - - - -\n"),
    );
    harness.write_config(&changed)?;
    harness.signal("-HUP")?;
    thread::sleep(Duration::from_millis(300));
    if !harness.is_alive() {
        return Err("the proxy exited on a valid config reload".into());
    }

    // 3. The in-flight transfer must be untouched by either reload.
    let down = transfer
        .join()
        .map_err(|_| "the transfer thread panicked")??;
    if down.len() != expected_down.len() || checksum(&down) != checksum(&expected_down) {
        return Err(format!(
            "an in-flight flow was corrupted or truncated by SIGHUP: got {} bytes, expected {}",
            down.len(),
            expected_down.len()
        ));
    }
    let record = harness
        .bulk
        .wait_for(before + 1, Duration::from_secs(30))
        .ok_or("the in-flight transfer never completed at the origin")?;
    let mut expected_up = hello.clone();
    expected_up.extend_from_slice(&up);
    if record.checksum != checksum(&expected_up) {
        return Err("an in-flight flow's upstream payload was corrupted by SIGHUP".into());
    }

    // 4. The new rules apply to a new flow: this destination is now blocked.
    let accepts_before = harness.stats_origin.accepts();
    let mut stream = connect_via_redirect(SocketAddrV4::new(STATS_ORIGIN, 443))
        .map_err(|e| format!("post-reload connect: {e}"))?;
    let _ = stream.write_all(&client_hello("post-reload.example"));
    let mut nothing = Vec::new();
    let _ = stream.read_to_end(&mut nothing);
    if !nothing.is_empty() || harness.stats_origin.accepts() != accepts_before {
        return Err("the reloaded configuration did not take effect for new flows".into());
    }

    // Restore, so the harness is left as the other scenarios expect it.
    harness.write_config(&base_config())?;
    harness.signal("-HUP")?;
    thread::sleep(Duration::from_millis(200));
    Ok(())
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// A scenario that only reads from the harness, so they can share one setup.
type Scenario = fn(&Harness) -> Result<(), String>;

/// One test rather than several: the scenarios share one nftables setup, one
/// proxy process and one set of origin ports, and `Drop` on the harness is what
/// guarantees the netfilter table and the dummy interface are removed even when
/// an assertion fails. Every scenario reports individually and all failures are
/// listed together, so a single failing case does not hide the rest.
#[test]
fn datapath_moves_bytes_and_honours_the_rules() {
    let required = std::env::var("POLYSIEM_DATAPATH_TESTS").as_deref() == Ok("required");

    let mut harness = match Harness::start() {
        Ok(harness) => harness,
        Err(reason) => {
            assert!(
                !required,
                "POLYSIEM_DATAPATH_TESTS=required but the datapath test could not run: {reason}"
            );
            println!("SKIP datapath test: {reason}");
            println!("      (set POLYSIEM_DATAPATH_TESTS=required to make this a failure)");
            return;
        }
    };

    let mut failures: Vec<String> = Vec::new();
    let read_only: &[(&str, Scenario)] = &[
        (
            "TLS SNI flow relays several MB intact both ways",
            scenario_tls_bulk_integrity,
        ),
        ("HTTP Host: header classifies the flow", scenario_http_host),
        (
            "non-TLS on 443 falls through to IP/port rules",
            scenario_non_tls_on_443,
        ),
        (
            "ClientHello split across three delayed segments",
            scenario_split_client_hello,
        ),
        (
            "a block rule closes and never reaches the destination",
            scenario_block,
        ),
        (
            "an unusable exit closes and NEVER leaks direct",
            scenario_exit_down_never_leaks,
        ),
        (
            "SERVICE counters are exact and cumulative",
            scenario_stats_are_cumulative,
        ),
        (
            "a rateKbps rule shapes without stalling the flow",
            scenario_throttled_flow,
        ),
    ];

    for (name, scenario) in read_only {
        match scenario(&harness) {
            Ok(()) => println!("   ok  {name}"),
            Err(reason) => {
                println!("  FAIL {name}: {reason}");
                failures.push(format!("{name}: {reason}"));
            }
        }
    }

    match scenario_reload(&mut harness) {
        Ok(()) => println!("   ok  SIGHUP reloads without dropping in-flight flows"),
        Err(reason) => {
            println!("  FAIL SIGHUP reload: {reason}");
            failures.push(format!("SIGHUP reload: {reason}"));
        }
    }

    if !harness.is_alive() {
        failures.push("the proxy process did not survive the test run".into());
    }

    assert!(
        failures.is_empty(),
        "{} datapath scenario(s) failed:\n  - {}",
        failures.len(),
        failures.join("\n  - ")
    );
}
