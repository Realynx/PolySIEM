//! Process orchestration: startup, workers, signals, config reload, stats.
//!
//! # Signal handling without signal handlers
//!
//! `SIGHUP`, `SIGUSR1`, `SIGTERM`, `SIGINT` and `SIGPIPE` are **blocked in the
//! main thread before any other thread is spawned**, so every thread inherits the
//! block, and one dedicated thread collects them with `sigwait`. No signal
//! handler ever runs. That removes async-signal-safety from the picture entirely:
//! re-reading a config file, taking a mutex and writing to a log are all ordinary
//! operations on an ordinary thread, none of which would be legal inside a real
//! handler.
//!
//! `SIGPIPE` is in the set for the usual reason - writing to a socket whose peer
//! has gone must return `EPIPE`, not kill the process.
//!
//! # Reload can never kill the proxy
//!
//! `SIGHUP` re-reads the config. If it does not parse, the error is logged with
//! its line number, `DEGRADED config_reload_failed` is raised, and **the previous
//! configuration keeps serving**. The only configuration failure that is fatal is
//! the very first one at startup, where there is nothing to fall back to.
//!
//! A new configuration is published as a whole new [`Generation`]. Flows already
//! running keep the `Arc` they started with - including its rule list and its
//! token buckets - so a reload never re-evaluates a live flow against rules it
//! was not admitted under. New flows pick up the new generation on their next
//! `accept`.
//!
//! One honest limitation: **changing a `LISTEN` port needs a restart**, not a
//! reload. The sockets are bound once at startup and handed to the workers; the
//! reload path deliberately does not try to rebind them underneath a running
//! worker. The agent restarts the unit when a port moves.

#![forbid(unsafe_code)]
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented
)]

use std::io;
use std::net::SocketAddrV4;
use std::os::fd::{AsFd as _, OwnedFd};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::config::{Config, Listener};
use crate::stats::{Stats, DEGRADED_CONFIG_RELOAD, DEGRADED_EXIT_DOWN, DEGRADED_WORKER_RESTART};
use crate::sys::{self, Epoll};
use crate::throttle::TokenBucket;
use crate::worker::Worker;

/// Hard ceiling on worker threads. The target box has 2 vCPU; beyond a handful
/// the loops contend on the stats table for no throughput gain.
const MAX_WORKERS: usize = 4;
/// Stats file cadence.
const STATS_INTERVAL: Duration = Duration::from_secs(5);
/// Exit-liveness sweep cadence.
const HEALTH_INTERVAL: Duration = Duration::from_secs(1);
/// `listen(2)` backlog per worker.
const BACKLOG: libc::c_int = 512;
/// Descriptors per flow: two sockets plus two pipes (four descriptors).
const FDS_PER_FLOW: u64 = 6;
/// Default probe destination - a well-known anycast address that answers on 443.
const DEFAULT_PROBE_TARGET: &str = "1.1.1.1:443";

/// One published configuration, with everything derived from it.
///
/// A flow holds an `Arc` to the generation it was admitted under for its whole
/// life, so a reload cannot change the rules or the rate limit out from under a
/// connection that is already running.
#[derive(Debug)]
pub struct Generation {
    /// The parsed configuration.
    pub config: Arc<Config>,
    /// Per-rule token buckets, parallel to `config.rules`. `None` where the rule
    /// has no rate limit - which is the common case, and means an unthrottled
    /// flow never touches a mutex on the datapath.
    pub buckets: Vec<Option<Mutex<TokenBucket>>>,
    /// Per-exit liveness, parallel to `config.exits`, refreshed by the sweep.
    pub exit_up: Vec<AtomicBool>,
}

impl Generation {
    fn build(config: Config, now: Instant) -> Arc<Self> {
        let buckets = config
            .rules
            .iter()
            .map(|rule| {
                rule.rate_kbps
                    .map(|kbps| Mutex::new(TokenBucket::new(kbps, now)))
            })
            .collect();
        let exit_up = config
            .exits
            .iter()
            .map(|exit| AtomicBool::new(sys::interface_is_up(&exit.ifname)))
            .collect();
        Arc::new(Self {
            config: Arc::new(config),
            buckets,
            exit_up,
        })
    }
}

/// State every thread shares.
#[derive(Debug)]
pub struct Shared {
    generation: Mutex<Arc<Generation>>,
    /// The traffic accounting table.
    pub stats: Stats,
    /// Set to stop every worker.
    pub stop: AtomicBool,
    flush: Mutex<bool>,
    flush_signal: Condvar,
}

impl Shared {
    /// The generation new flows should be admitted under.
    #[must_use]
    pub fn current(&self) -> Arc<Generation> {
        match self.generation.lock() {
            Ok(guard) => Arc::clone(&guard),
            // A poisoned lock means a thread panicked mid-swap. The Arc inside
            // is still valid; recovering it beats refusing to serve.
            Err(poisoned) => Arc::clone(&poisoned.into_inner()),
        }
    }

    /// Idle timeout from the live configuration.
    #[must_use]
    pub fn idle_secs(&self) -> u64 {
        self.current().config.idle_secs
    }

    fn publish(&self, generation: Arc<Generation>) {
        match self.generation.lock() {
            Ok(mut guard) => *guard = generation,
            Err(poisoned) => *poisoned.into_inner() = generation,
        }
    }

    fn request_flush(&self) {
        if let Ok(mut pending) = self.flush.lock() {
            *pending = true;
        }
        self.flush_signal.notify_all();
    }
}

/// Sets `stop` if a worker leaves its loop unexpectedly - including by unwinding.
///
/// The panic lints on the parser make a panic very unlikely, but "very unlikely"
/// is not "impossible", and a worker that silently disappears would leave the
/// proxy quietly serving at a fraction of its capacity with no signal. Exiting
/// and letting systemd's `Restart=always` bring the process back is both more
/// visible and more correct.
struct WorkerGuard(Arc<Shared>);

impl Drop for WorkerGuard {
    fn drop(&mut self) {
        if self.0.stop.load(Ordering::Relaxed) {
            return; // orderly shutdown
        }
        self.0.stats.degrade(DEGRADED_WORKER_RESTART);
        self.0.stop.store(true, Ordering::Relaxed);
        // Wake the sigwait thread so the process actually exits.
        let _ = sys::signal_self(libc::SIGTERM);
    }
}

/// Entry point for the Linux datapath.
pub fn run(args: &[String]) -> ExitCode {
    if let Some(list) = flag(args, "--probe") {
        return probe(args, &list);
    }

    let Some(config_path) = flag(args, "--config").or_else(|| flag(args, "--ruleset")) else {
        eprintln!("polysiem-privacy-proxy: --config <path> is required");
        return ExitCode::from(2);
    };
    // `/run/polysiem-privacy-proxy/` is a DIRECTORY, created by the unit's
    // `RuntimeDirectory=polysiem-privacy-proxy`. It has to be: the atomic publish
    // writes a temp file beside the target and renames it, which needs write
    // access to the containing directory - and `ProtectSystem=strict` denies that
    // for `/run` itself. Pointing `--stats` straight at `/run/<name>.stats` would
    // parse fine, start fine, and then fail on every single write at runtime.
    let stats_path = flag(args, "--stats").map_or_else(
        || PathBuf::from("/run/polysiem-privacy-proxy/stats"),
        PathBuf::from,
    );

    match serve(Path::new(&config_path), &stats_path) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("polysiem-privacy-proxy: {error}");
            ExitCode::from(1)
        }
    }
}

fn serve(config_path: &Path, stats_path: &Path) -> io::Result<()> {
    // The first config is the only one that may be fatal.
    let text = std::fs::read_to_string(config_path)?;
    let config = Config::parse(&text)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;

    let workers = if config.workers == 0 {
        sys::nproc().min(MAX_WORKERS)
    } else {
        config.workers.min(MAX_WORKERS)
    }
    .max(1);
    let max_flows = config.max_flows;
    let pipe_bytes = config.pipe_bytes;
    let per_worker = max_flows.div_ceil(workers).max(1);

    // Descriptors before anything binds, so a low limit fails loudly at startup.
    let wanted = (max_flows as u64)
        .saturating_mul(FDS_PER_FLOW)
        .saturating_add(256);
    match sys::raise_nofile(wanted) {
        Ok(effective) if effective < wanted => {
            eprintln!(
                "polysiem-privacy-proxy: RLIMIT_NOFILE is {effective}, wanted {wanted}; \
                 the flow cap of {max_flows} may not be reachable"
            );
        }
        Ok(_) => {}
        Err(error) => eprintln!("polysiem-privacy-proxy: could not raise RLIMIT_NOFILE: {error}"),
    }

    // Bind every listener up front: a port clash must fail before any thread
    // starts, not leave half the workers serving.
    let mut bound: Vec<Vec<(OwnedFd, Listener)>> = Vec::with_capacity(workers);
    for _ in 0..workers {
        let mut set = Vec::with_capacity(config.listeners.len());
        for listener in &config.listeners {
            set.push((sys::listener(listener.port, BACKLOG)?, *listener));
        }
        bound.push(set);
    }

    // Signals blocked here, before any thread exists, so all of them inherit it.
    let signals = [
        libc::SIGHUP,
        libc::SIGUSR1,
        libc::SIGTERM,
        libc::SIGINT,
        libc::SIGPIPE,
    ];
    sys::block_signals(&signals)?;

    let shared = Arc::new(Shared {
        generation: Mutex::new(Generation::build(config, Instant::now())),
        stats: Stats::new(sys::epoch_seconds()),
        stop: AtomicBool::new(false),
        flush: Mutex::new(false),
        flush_signal: Condvar::new(),
    });

    eprintln!(
        "polysiem-privacy-proxy {}: {workers} worker(s), {max_flows} max flows, \
         {pipe_bytes} byte pipes requested",
        crate::VERSION
    );

    std::thread::scope(|scope| {
        for listeners in bound {
            let shared = Arc::clone(&shared);
            scope.spawn(move || {
                let _guard = WorkerGuard(Arc::clone(&shared));
                match Worker::new(Arc::clone(&shared), listeners, per_worker, pipe_bytes) {
                    Ok(mut worker) => {
                        if let Err(error) = worker.run() {
                            eprintln!("polysiem-privacy-proxy: worker stopped: {error}");
                        }
                    }
                    Err(error) => {
                        eprintln!("polysiem-privacy-proxy: worker failed to start: {error}")
                    }
                }
            });
        }

        let publisher = Arc::clone(&shared);
        let publisher_path = stats_path.to_path_buf();
        scope.spawn(move || publish_loop(&publisher, &publisher_path));

        signal_loop(&shared, config_path, &signals);
        shared.stop.store(true, Ordering::Relaxed);
        shared.request_flush();
    });

    Ok(())
}

/// Collect signals until told to stop.
fn signal_loop(shared: &Arc<Shared>, config_path: &Path, signals: &[libc::c_int]) {
    loop {
        let caught = match sys::wait_signal(signals) {
            Ok(signal) => signal,
            Err(error) => {
                eprintln!("polysiem-privacy-proxy: sigwait failed: {error}");
                return;
            }
        };
        if shared.stop.load(Ordering::Relaxed) {
            return;
        }
        match caught {
            libc::SIGHUP => reload(shared, config_path),
            libc::SIGUSR1 => shared.request_flush(),
            libc::SIGTERM | libc::SIGINT => return,
            // SIGPIPE: consumed and discarded. Writing to a dead peer returns
            // EPIPE to the caller, which is what the relay already handles.
            _ => {}
        }
    }
}

/// Re-read the configuration. A failure is reported and otherwise ignored.
fn reload(shared: &Arc<Shared>, config_path: &Path) {
    let parsed = std::fs::read_to_string(config_path)
        .map_err(|error| error.to_string())
        .and_then(|text| Config::parse(&text).map_err(|error| error.to_string()));

    match parsed {
        Ok(config) => {
            shared.publish(Generation::build(config, Instant::now()));
            shared.stats.recover(DEGRADED_CONFIG_RELOAD);
            eprintln!("polysiem-privacy-proxy: configuration reloaded");
        }
        Err(error) => {
            // Keep serving what we already have. Never exit on a bad config.
            shared.stats.degrade(DEGRADED_CONFIG_RELOAD);
            eprintln!(
                "polysiem-privacy-proxy: reload rejected, keeping the previous configuration: {error}"
            );
        }
    }
}

/// Write the stats file on a cadence, and refresh exit liveness.
fn publish_loop(shared: &Arc<Shared>, stats_path: &Path) {
    let mut scratch = String::with_capacity(64 * 1024);
    let mut last_write = Instant::now()
        .checked_sub(STATS_INTERVAL)
        .unwrap_or_else(Instant::now);

    while !shared.stop.load(Ordering::Relaxed) {
        let forced = wait_for_tick(shared);
        sweep_exits(shared);

        let now = Instant::now();
        if forced || now.saturating_duration_since(last_write) >= STATS_INTERVAL {
            last_write = now;
            if let Err(error) = shared.stats.write_atomic(stats_path, &mut scratch) {
                eprintln!("polysiem-privacy-proxy: could not write stats: {error}");
            }
        }
    }
    // A final sample on the way out, so a restart's baseline is complete.
    let _ = shared.stats.write_atomic(stats_path, &mut scratch);
}

/// Sleep until the health interval elapses or a flush is requested.
/// Returns true when a flush was explicitly requested.
fn wait_for_tick(shared: &Arc<Shared>) -> bool {
    let Ok(pending) = shared.flush.lock() else {
        std::thread::sleep(HEALTH_INTERVAL);
        return false;
    };
    let Ok((mut pending, _)) = shared.flush_signal.wait_timeout(pending, HEALTH_INTERVAL) else {
        return false;
    };
    let forced = *pending;
    *pending = false;
    forced
}

/// Refresh each exit's liveness so [`crate::worker`] can refuse a flow assigned
/// to a dead exit without an `ioctl` on the datapath.
fn sweep_exits(shared: &Arc<Shared>) {
    let generation = shared.current();
    let mut all_up = true;
    for (exit, flag) in generation
        .config
        .exits
        .iter()
        .zip(generation.exit_up.iter())
    {
        let up = sys::interface_is_up(&exit.ifname);
        flag.store(up, Ordering::Relaxed);
        all_up &= up;
    }
    if all_up {
        shared.stats.recover(DEGRADED_EXIT_DOWN);
    }
}

// ---------------------------------------------------------------------------
// --probe
// ---------------------------------------------------------------------------

/// Report whether each named interface can actually carry a flow.
///
/// Prints one `PROBE<TAB><ifname><TAB><ok|fail>` line per interface, which is
/// what the agent parses. "ok" means all of: the interface exists, it is
/// `IFF_UP`, `SO_BINDTODEVICE` succeeded on it (which also proves the process
/// really has `CAP_NET_RAW`), and a TCP connection to the probe target completed
/// within the timeout while pinned to it.
///
/// That last step is the part design doc §3 calls for - it verifies the exit
/// *independently forwards*, which is exactly the property that duplicate
/// `10.2.0.2/32` addressing across tunnels puts in doubt. It does mean a probe
/// reports `fail` for an exit that is up but cannot reach the target; that is a
/// true statement about the exit, and the agent's own WireGuard handshake check
/// covers the "tunnel is up but the internet is not" case separately.
fn probe(args: &[String], list: &str) -> ExitCode {
    let timeout = flag(args, "--probe-timeout")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(2)
        .clamp(1, 30);
    let target: SocketAddrV4 = flag(args, "--probe-target")
        .unwrap_or_else(|| DEFAULT_PROBE_TARGET.to_owned())
        .parse()
        .unwrap_or_else(|_| {
            DEFAULT_PROBE_TARGET
                .parse()
                .unwrap_or(SocketAddrV4::new(std::net::Ipv4Addr::new(1, 1, 1, 1), 443))
        });

    for name in list.split(',').map(str::trim).filter(|n| !n.is_empty()) {
        let verdict = if probe_one(name, target, Duration::from_secs(timeout)) {
            "ok"
        } else {
            "fail"
        };
        println!("PROBE\t{name}\t{verdict}");
    }
    ExitCode::SUCCESS
}

fn probe_one(ifname: &str, target: SocketAddrV4, timeout: Duration) -> bool {
    if !sys::interface_is_up(ifname) {
        return false;
    }
    let Ok(socket) = sys::tcp_socket() else {
        return false;
    };
    if sys::bind_to_device(socket.as_fd(), ifname).is_err() {
        return false;
    }
    match sys::connect(socket.as_fd(), target) {
        Ok(sys::ConnectState::Connected) => return true,
        Ok(sys::ConnectState::InProgress) => {}
        Err(_) => return false,
    }

    let Ok(epoll) = Epoll::new() else {
        return false;
    };
    if epoll.add(socket.as_fd(), sys::WRITABLE, 0).is_err() {
        return false;
    }
    let mut events = [sys::empty_event(); 1];
    let millis = i32::try_from(timeout.as_millis()).unwrap_or(2000);
    match epoll.wait(&mut events, millis) {
        Ok(0) => false, // timed out
        Ok(_) => matches!(sys::socket_error(socket.as_fd()), Ok(0)),
        Err(_) => false,
    }
}

/// `--flag value`, or `None`.
fn flag(args: &[String], name: &str) -> Option<String> {
    let at = args.iter().position(|arg| arg == name)?;
    args.get(at.checked_add(1)?).cloned()
}
