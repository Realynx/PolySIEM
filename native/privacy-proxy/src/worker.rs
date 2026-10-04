//! One worker: an epoll loop, a slab of flows, and a pipe pool.
//!
//! # Threading
//!
//! `min(nproc, 4)` workers, each with its **own** epoll instance and its **own**
//! listening sockets bound with `SO_REUSEPORT`. The kernel hashes each incoming
//! connection to one listener, so there is no shared accept queue, no lock on the
//! accept path, and no thundering herd. A flow is owned start to finish by the
//! worker that accepted it and is never handed off, so no flow state is shared
//! and no flow state needs a lock.
//!
//! The only cross-worker state is the stats table (a lock-free `fetch_add` on a
//! preallocated slot), the shared config generation (one `Mutex<Arc<_>>` read per
//! accepted connection), and the per-rule token buckets - which are only touched
//! by flows matching a rule that actually carries a rate limit.
//!
//! # Memory
//!
//! Everything a flow needs is allocated before the first connection arrives: the
//! slab, the `epoll_wait` event array, and the 8 KiB peek scratch buffer. Pipes
//! come from a pool that grows lazily and is never shrunk. Past the flow cap
//! connections are **refused**, not queued and not grown into - on a 512 MB box
//! the alternative to a hard cap is the OOM killer.
//!
//! # The rule that outranks throughput
//!
//! **When the chosen exit is unusable the connection is closed.** Not retried
//! over the WAN, not "temporarily degraded to direct". A flow the operator
//! assigned to a VPN exit leaking out of the normal WAN is a privacy failure, and
//! the whole point of the feature is that it cannot happen. Every path that could
//! fail to reach an exit - interface missing, interface down, `SO_BINDTODEVICE`
//! refused, `connect` failed - ends in [`Worker::close`], and there is no code
//! path anywhere in this file that opens an unpinned socket after an exit rule
//! matched.

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
use std::net::{Ipv4Addr, SocketAddrV4};
use std::os::fd::{AsFd as _, BorrowedFd, OwnedFd};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::config::Listener;
use crate::hostname::Hostname;
use crate::parser::{self, Peek, PeekMode};
use crate::relay::{PipePool, Pump, Step};
use crate::rules::{Action, FlowKey};
use crate::server::{Generation, Shared};
use crate::stats::{DEGRADED_EXIT_DOWN, DEGRADED_FLOW_CAP, DEGRADED_PIPE_SIZE};
use crate::sys::{self, ConnectState, Epoll};
use crate::MAX_PEEK;

/// Set on a token that refers to a listener rather than a flow.
const LISTENER_BIT: u64 = 1 << 63;
/// Longest an epoll wait blocks, so shutdown and the idle sweep stay responsive.
const MAX_WAIT: Duration = Duration::from_millis(200);
/// How often idle flows are reaped.
const SWEEP_INTERVAL: Duration = Duration::from_secs(1);
/// `epoll_wait` batch size.
const EVENT_BATCH: usize = 256;

/// Which socket of a flow an event refers to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    Client,
    Upstream,
}

fn token_for(index: usize, side: Side) -> u64 {
    let side_bit = match side {
        Side::Client => 0,
        Side::Upstream => 1,
    };
    (u64::try_from(index).unwrap_or(0) << 1) | side_bit
}

fn decode_token(token: u64) -> (usize, Side) {
    let side = if token & 1 == 0 {
        Side::Client
    } else {
        Side::Upstream
    };
    (usize::try_from(token >> 1).unwrap_or(usize::MAX), side)
}

/// How many bytes a flow may move now, and how long to wait if that runs out.
#[derive(Clone, Copy, Debug)]
struct Allowance {
    /// Bytes permitted this pass. `usize::MAX` when the flow has no rate limit.
    bytes: usize,
    /// `Some` only for a rate-limited flow; how long until the bucket refills.
    retry_after: Option<Duration>,
}

/// Where a flow is in its life.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    /// Reading the prelude with `MSG_PEEK`.
    Peeking,
    /// Upstream `connect` in flight.
    Connecting,
    /// Splicing both ways.
    Relaying,
}

/// One connection.
#[derive(Debug)]
struct Flow {
    live: bool,
    state: State,
    client: Option<OwnedFd>,
    upstream: Option<OwnedFd>,
    source: Ipv4Addr,
    destination: SocketAddrV4,
    mode: PeekMode,
    generation: Option<Arc<Generation>>,
    /// Index into the stats table, once the action is known.
    stats_slot: Option<usize>,
    /// Index of the matched rule, for the shared token bucket.
    rule: Option<usize>,
    to_upstream: Option<Pump>,
    to_client: Option<Pump>,
    last_active: Instant,
    /// Set while throttled: do not read from the source before this.
    retry_at: Option<Instant>,
}

impl Flow {
    fn vacant(now: Instant) -> Self {
        Self {
            live: false,
            state: State::Peeking,
            client: None,
            upstream: None,
            source: Ipv4Addr::UNSPECIFIED,
            destination: SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0),
            mode: PeekMode::Tls,
            generation: None,
            stats_slot: None,
            rule: None,
            to_upstream: None,
            to_client: None,
            last_active: now,
            retry_at: None,
        }
    }
}

/// One worker thread's world.
pub struct Worker {
    shared: Arc<Shared>,
    epoll: Epoll,
    listeners: Vec<OwnedFd>,
    modes: Vec<PeekMode>,
    flows: Vec<Flow>,
    free: Vec<usize>,
    pool: PipePool,
    events: Vec<libc::epoll_event>,
    /// The one userspace buffer in the whole datapath.
    scratch: Box<[u8; MAX_PEEK]>,
    last_sweep: Instant,
    /// Reused across sweeps so housekeeping does not allocate either.
    pending: Vec<usize>,
}

impl core::fmt::Debug for Worker {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Worker")
            .field("listeners", &self.listeners.len())
            .field("capacity", &self.flows.len())
            .finish_non_exhaustive()
    }
}

impl Worker {
    /// Build a worker around listeners that are already bound.
    ///
    /// # Errors
    /// Any failure creating the epoll instance or registering a listener.
    pub fn new(
        shared: Arc<Shared>,
        listeners: Vec<(OwnedFd, Listener)>,
        capacity: usize,
        pipe_bytes: usize,
    ) -> io::Result<Self> {
        let now = Instant::now();
        let epoll = Epoll::new()?;

        let mut sockets = Vec::with_capacity(listeners.len());
        let mut modes = Vec::with_capacity(listeners.len());
        for (index, (socket, listener)) in listeners.into_iter().enumerate() {
            let token = LISTENER_BIT | u64::try_from(index).unwrap_or(0);
            epoll.add(socket.as_fd(), sys::READABLE | sys::EDGE, token)?;
            sockets.push(socket);
            modes.push(listener.mode);
        }

        let mut flows = Vec::with_capacity(capacity);
        flows.resize_with(capacity, || Flow::vacant(now));
        let mut free = Vec::with_capacity(capacity);
        for index in (0..capacity).rev() {
            free.push(index);
        }

        Ok(Self {
            shared,
            epoll,
            listeners: sockets,
            modes,
            flows,
            free,
            // Two pipes per flow, one per direction.
            pool: PipePool::new(pipe_bytes, capacity.saturating_mul(2)),
            events: vec![sys::empty_event(); EVENT_BATCH],
            scratch: Box::new([0u8; MAX_PEEK]),
            last_sweep: now,
            pending: Vec::with_capacity(capacity),
        })
    }

    /// Run until the shared stop flag is set.
    ///
    /// # Errors
    /// Only a failure of `epoll_wait` itself propagates. Every per-flow error
    /// closes that flow and is otherwise swallowed: one broken connection must
    /// never take down a worker serving hundreds of others.
    pub fn run(&mut self) -> io::Result<()> {
        while !self.shared.stop.load(Ordering::Relaxed) {
            let timeout = self.timeout_ms();
            let ready = self.epoll.wait(&mut self.events, timeout)?;

            for slot in 0..ready {
                // `epoll_event` is a packed struct, so these are value reads; a
                // reference to either field would not be well aligned.
                let Some((token, mask)) = self.events.get(slot).map(|e| (e.u64, e.events)) else {
                    break;
                };
                if token & LISTENER_BIT != 0 {
                    let index = usize::try_from(token & !LISTENER_BIT).unwrap_or(0);
                    self.accept_ready(index);
                } else {
                    let (index, side) = decode_token(token);
                    self.flow_ready(index, side, mask);
                }
            }

            self.maintain();
        }
        Ok(())
    }

    /// How long to block. Shortened when a throttled flow is waiting to resume.
    fn timeout_ms(&self) -> i32 {
        let now = Instant::now();
        let mut wait = MAX_WAIT;
        for flow in self.flows.iter().filter(|flow| flow.live) {
            if let Some(at) = flow.retry_at {
                wait = wait.min(at.saturating_duration_since(now));
            }
        }
        i32::try_from(wait.as_millis()).unwrap_or(0)
    }

    // -----------------------------------------------------------------------
    // Accept
    // -----------------------------------------------------------------------

    fn accept_ready(&mut self, listener_index: usize) {
        // Edge-triggered: drain the queue, or the readiness edge is lost and the
        // remaining connections sit there until the next one arrives.
        loop {
            let accepted = {
                let Some(listener) = self.listeners.get(listener_index) else {
                    return;
                };
                match sys::accept(listener.as_fd()) {
                    Ok(Some(pair)) => pair,
                    Ok(None) => return,
                    Err(_) => return,
                }
            };
            let mode = self
                .modes
                .get(listener_index)
                .copied()
                .unwrap_or(PeekMode::Tls);
            self.admit(accepted.0, accepted.1, mode);
        }
    }

    fn admit(&mut self, client: OwnedFd, peer: SocketAddrV4, mode: PeekMode) {
        // The destination the client actually wanted, recovered from conntrack.
        // A connection that netfilter did not redirect has no original
        // destination, and is not ours to serve.
        let Ok(destination) = sys::original_dst(client.as_fd()) else {
            return;
        };
        let _ = sys::set_nodelay(client.as_fd());

        let Some(index) = self.free.pop() else {
            // At the cap. Refusing is the correct answer: growing would trade a
            // bounded refusal for an unbounded memory footprint.
            self.shared.stats.degrade(DEGRADED_FLOW_CAP);
            drop(client);
            return;
        };

        let generation = self.shared.current();
        let now = Instant::now();

        let registered = {
            let Some(flow) = self.flows.get_mut(index) else {
                self.free.push(index);
                return;
            };
            *flow = Flow::vacant(now);
            flow.live = true;
            flow.state = State::Peeking;
            flow.source = *peer.ip();
            flow.destination = destination;
            flow.mode = mode;
            flow.generation = Some(generation);
            flow.last_active = now;

            let ok = self
                .epoll
                .add(
                    client.as_fd(),
                    sys::READABLE | sys::EDGE | sys::HANGUP,
                    token_for(index, Side::Client),
                )
                .is_ok();
            if ok {
                flow.client = Some(client);
            } else {
                flow.live = false;
            }
            ok
        };
        if !registered {
            self.free.push(index);
            return;
        }

        // Data is usually already waiting: `accept` consumed the edge that
        // announced it, so nothing else will report it.
        self.flow_ready(index, Side::Client, sys::READABLE);
    }

    // -----------------------------------------------------------------------
    // Per-flow events
    // -----------------------------------------------------------------------

    fn flow_ready(&mut self, index: usize, side: Side, mask: u32) {
        let Some((live, state)) = self.flows.get(index).map(|flow| (flow.live, flow.state)) else {
            return;
        };
        if !live {
            return;
        }
        // An error or hangup while still setting up is terminal. During relay it
        // is not: there may be buffered bytes still to deliver the other way,
        // and `splice` returning EOF is how that is discovered properly.
        let failed = mask & (sys::ERROR | sys::CLOSED) != 0;

        let outcome = match state {
            State::Peeking if failed => Err(()),
            State::Peeking => self.peek(index),
            State::Connecting if side == Side::Upstream => self.connected(index, failed),
            State::Connecting => Ok(()),
            State::Relaying => self.relay(index),
        };

        if outcome.is_err() {
            self.close(index);
        }
    }

    /// Read the prelude and, once it is conclusive, decide the flow.
    fn peek(&mut self, index: usize) -> Result<(), ()> {
        let read = {
            let Some(flow) = self.flows.get(index) else {
                return Err(());
            };
            let Some(client) = flow.client.as_ref() else {
                return Err(());
            };
            match sys::peek(client.as_fd(), self.scratch.as_mut_slice()) {
                Ok(Some(0)) => return Err(()), // closed before saying anything
                Ok(Some(count)) => count,
                Ok(None) => return Ok(()), // nothing buffered yet
                Err(_) => return Err(()),
            }
        };

        let mode = self
            .flows
            .get(index)
            .map_or(PeekMode::Tls, |flow| flow.mode);
        let Some(seen) = self.scratch.get(..read) else {
            return Err(());
        };
        let verdict = parser::peek(mode, seen);

        if let Some(flow) = self.flows.get_mut(index) {
            flow.last_active = Instant::now();
        }

        let host = match verdict {
            Peek::Hostname(found) => Some(found),
            Peek::NoHostname => None,
            Peek::NeedMore if read >= MAX_PEEK => {
                // The 8 KiB cap is the answer: fall through to the IP/port rules
                // rather than waiting for a prelude that will never end.
                None
            }
            Peek::NeedMore => return Ok(()),
        };
        self.decide(index, host)
    }

    /// Evaluate the ordered rule list and open the upstream.
    fn decide(&mut self, index: usize, host: Option<Hostname>) -> Result<(), ()> {
        let (generation, key) = {
            let Some(flow) = self.flows.get(index) else {
                return Err(());
            };
            let Some(generation) = flow.generation.clone() else {
                return Err(());
            };
            let key = FlowKey {
                src: flow.source,
                dst: *flow.destination.ip(),
                dport: flow.destination.port(),
                host,
            };
            (generation, key)
        };

        let (action, label, rule_index) =
            match crate::rules::match_rule(&generation.config.rules, &key) {
                Some((position, rule)) => (rule.action, rule.label, Some(position)),
                None => (
                    generation.config.default_action,
                    generation.config.default_label,
                    None,
                ),
            };

        // Account the flow before anything that can fail, so a blocked flow and a
        // flow refused for a dead exit both still appear in the breakdown. That
        // visibility is the difference between "the VPN is broken" and "these
        // three services were refused because the Stockholm exit is down".
        let slot = self.shared.stats.slot_for(host.as_ref(), &label);
        self.shared.stats.flow_started(slot);

        if let Some(flow) = self.flows.get_mut(index) {
            flow.stats_slot = Some(slot);
            flow.rule = rule_index;
        } else {
            return Err(());
        }

        match action {
            Action::Block => Err(()),
            Action::Direct => self.open_upstream(index, None),
            Action::Exit(exit) => {
                let up = generation
                    .exit_up
                    .get(exit)
                    .is_some_and(|flag| flag.load(Ordering::Relaxed));
                let ifname = generation.config.exits.get(exit).map(|e| e.ifname.as_str());
                match (up, ifname) {
                    (true, Some(name)) => self.open_upstream(index, Some(name)),
                    _ => {
                        // THE rule. The exit this flow was assigned to is not
                        // usable, so the flow is closed. It is never retried over
                        // the WAN: that would be a privacy leak wearing the
                        // costume of graceful degradation.
                        self.shared.stats.degrade(DEGRADED_EXIT_DOWN);
                        Err(())
                    }
                }
            }
        }
    }

    fn open_upstream(&mut self, index: usize, exit_ifname: Option<&str>) -> Result<(), ()> {
        let Some(destination) = self.flows.get(index).map(|flow| flow.destination) else {
            return Err(());
        };

        let Ok(socket) = sys::tcp_socket() else {
            return Err(());
        };
        if let Some(ifname) = exit_ifname {
            // Pinning to the device is what selects the exit. If the kernel
            // refuses - interface gone, or CAP_NET_RAW missing - the flow dies
            // here. It does not proceed on an unpinned socket.
            if sys::bind_to_device(socket.as_fd(), ifname).is_err() {
                self.shared.stats.degrade(DEGRADED_EXIT_DOWN);
                return Err(());
            }
        }
        let _ = sys::set_nodelay(socket.as_fd());

        let Ok(state) = sys::connect(socket.as_fd(), destination) else {
            return Err(());
        };
        if self
            .epoll
            .add(
                socket.as_fd(),
                sys::WRITABLE | sys::EDGE,
                token_for(index, Side::Upstream),
            )
            .is_err()
        {
            return Err(());
        }

        let Some(flow) = self.flows.get_mut(index) else {
            return Err(());
        };
        flow.upstream = Some(socket);
        flow.state = State::Connecting;
        flow.last_active = Instant::now();

        if state == ConnectState::Connected {
            return self.connected(index, false);
        }
        Ok(())
    }

    fn connected(&mut self, index: usize, failed: bool) -> Result<(), ()> {
        {
            let Some(flow) = self.flows.get(index) else {
                return Err(());
            };
            let Some(upstream) = flow.upstream.as_ref() else {
                return Err(());
            };
            if failed || !matches!(sys::socket_error(upstream.as_fd()), Ok(0)) {
                // Connect failed. Same rule as an exit being down: there is no
                // fallback path, by construction.
                return Err(());
            }
        }

        // Only now are pipes worth spending: a flow that never connected never
        // holds one, so a burst of unreachable destinations cannot drain the pool.
        let (Ok(Some(outbound)), Ok(Some(inbound))) = (self.pool.acquire(), self.pool.acquire())
        else {
            self.shared.stats.degrade(DEGRADED_FLOW_CAP);
            return Err(());
        };
        if self.pool.degraded() {
            self.shared.stats.degrade(DEGRADED_PIPE_SIZE);
        }

        let watch = sys::READABLE | sys::WRITABLE | sys::EDGE | sys::HANGUP;
        let registered = {
            let Some(flow) = self.flows.get_mut(index) else {
                return Err(());
            };
            flow.to_upstream = Some(Pump::new(outbound));
            flow.to_client = Some(Pump::new(inbound));
            flow.state = State::Relaying;
            flow.last_active = Instant::now();

            let client_ok = flow.client.as_ref().is_some_and(|fd| {
                self.epoll
                    .modify(fd.as_fd(), watch, token_for(index, Side::Client))
                    .is_ok()
            });
            let upstream_ok = flow.upstream.as_ref().is_some_and(|fd| {
                self.epoll
                    .modify(fd.as_fd(), watch, token_for(index, Side::Upstream))
                    .is_ok()
            });
            client_ok && upstream_ok
        };
        if !registered {
            return Err(());
        }

        self.relay(index)
    }

    // -----------------------------------------------------------------------
    // Relay
    // -----------------------------------------------------------------------

    /// Pump both directions until neither can make progress.
    fn relay(&mut self, index: usize) -> Result<(), ()> {
        let now = Instant::now();
        let allowance = self.budget(index, now);

        // Borrowed before the slab, so the stats table and the flow slab are two
        // disjoint field borrows rather than one aliasing conflict.
        let stats = &self.shared.stats;
        let Some(flow) = self.flows.get_mut(index) else {
            return Err(());
        };
        // Destructuring the flow is what makes the sockets and the pumps
        // independently borrowable: `client` and `to_upstream` are separate
        // fields, so one can be read while the other is mutated.
        let Flow {
            client: Some(client),
            upstream: Some(upstream),
            to_upstream,
            to_client,
            stats_slot,
            last_active,
            retry_at,
            ..
        } = flow
        else {
            return Err(());
        };
        let client = client.as_fd();
        let upstream = upstream.as_fd();

        let mut budget = allowance.bytes;
        let mut moved_out: u64 = 0;
        let mut moved_in: u64 = 0;

        // Terminates because "progress" means one of exactly two things, both
        // finite: bytes actually moved, or one of the two one-shot EOF
        // transitions fired. Bytes moved per call are bounded by what is already
        // buffered in the sockets and pipes - `splice` returns EAGAIN as soon as
        // a socket is drained - so this returns to epoll promptly even mid-way
        // through a large transfer, and no single flow can monopolise a worker.
        loop {
            let mut progress = false;

            if let Some(pump) = to_upstream.as_mut() {
                let (bytes, active) = step(pump, client, upstream, budget)?;
                budget = budget.saturating_sub(bytes);
                moved_out = moved_out.saturating_add(u64::try_from(bytes).unwrap_or(0));
                progress |= active;
            }
            if let Some(pump) = to_client.as_mut() {
                let (bytes, active) = step(pump, upstream, client, budget)?;
                budget = budget.saturating_sub(bytes);
                moved_in = moved_in.saturating_add(u64::try_from(bytes).unwrap_or(0));
                progress |= active;
            }

            if !progress {
                break;
            }
        }

        if let Some(slot) = *stats_slot {
            if moved_in > 0 {
                stats.add_in(slot, moved_in);
            }
            if moved_out > 0 {
                stats.add_out(slot, moved_out);
            }
        }
        if moved_in > 0 || moved_out > 0 {
            *last_active = now;
        }

        // Schedule our own wakeup if, and only if, we stopped because the rate
        // limit ran out rather than because the sockets did.
        //
        // This is the one place the relay cannot rely on epoll. Registration is
        // EDGE-TRIGGERED, so a socket whose data we deliberately left unread
        // never fires again - the readable edge was already consumed. A throttled
        // flow that exhausts its allowance mid-read and does not reschedule
        // itself therefore hangs until the idle reaper kills it, delivering a
        // truncated response. `budget > 0` here means the sockets blocked first,
        // in which case epoll will notify us and an extra timer would just be a
        // wasted wakeup on every idle throttled flow.
        *retry_at = match allowance.retry_after {
            Some(wait) if budget == 0 => Some(now.checked_add(wait).unwrap_or(now)),
            _ => None,
        };

        let done = to_upstream.as_ref().is_some_and(Pump::finished)
            && to_client.as_ref().is_some_and(Pump::finished);
        if done {
            // `Err` here means "tear this flow down", not "something went wrong".
            return Err(());
        }
        Ok(())
    }

    /// How many bytes this flow may move right now.
    ///
    /// `retry_after` is `Some` only for a flow that actually has a rate limit,
    /// and tells the caller how long to wait before looking again IF the
    /// allowance runs out. That distinction is the whole of the throttling
    /// scheduler - see the comment in [`Worker::relay`].
    fn budget(&self, index: usize, now: Instant) -> Allowance {
        let unlimited = Allowance {
            bytes: usize::MAX,
            retry_after: None,
        };
        let Some(flow) = self.flows.get(index) else {
            return Allowance {
                bytes: 0,
                retry_after: None,
            };
        };
        // The overwhelmingly common case: no rate limit, so no lock and no
        // bookkeeping on the datapath at all.
        let (Some(rule), Some(generation)) = (flow.rule, flow.generation.as_ref()) else {
            return unlimited;
        };
        let Some(Some(bucket)) = generation.buckets.get(rule) else {
            return unlimited;
        };
        let Ok(mut bucket) = bucket.lock() else {
            return unlimited;
        };
        Allowance {
            bytes: bucket.take(usize::MAX, now),
            retry_after: Some(bucket.wait_hint()),
        }
    }

    // -----------------------------------------------------------------------
    // Teardown and housekeeping
    // -----------------------------------------------------------------------

    fn close(&mut self, index: usize) {
        let recycled = {
            let Some(flow) = self.flows.get_mut(index) else {
                return;
            };
            if !flow.live {
                return;
            }
            flow.live = false;

            if let Some(fd) = flow.client.take() {
                let _ = self.epoll.delete(fd.as_fd());
            }
            if let Some(fd) = flow.upstream.take() {
                let _ = self.epoll.delete(fd.as_fd());
            }
            let counted = flow.stats_slot.take().is_some();
            flow.generation = None;
            flow.rule = None;
            flow.retry_at = None;
            (flow.to_upstream.take(), flow.to_client.take(), counted)
        };
        if let Some(pump) = recycled.0 {
            pump.recycle(&mut self.pool);
        }
        if let Some(pump) = recycled.1 {
            pump.recycle(&mut self.pool);
        }
        if recycled.2 {
            self.shared.stats.flow_ended();
        }
        self.free.push(index);
    }

    /// Resume throttled flows and reap idle ones.
    fn maintain(&mut self) {
        let now = Instant::now();

        self.pending.clear();
        for (index, flow) in self.flows.iter().enumerate() {
            if flow.live && flow.retry_at.is_some_and(|at| at <= now) {
                self.pending.push(index);
            }
        }
        for slot in 0..self.pending.len() {
            let Some(index) = self.pending.get(slot).copied() else {
                break;
            };
            if let Some(flow) = self.flows.get_mut(index) {
                flow.retry_at = None;
            }
            if self.relay(index).is_err() {
                self.close(index);
            }
        }

        if now.saturating_duration_since(self.last_sweep) < SWEEP_INTERVAL {
            return;
        }
        self.last_sweep = now;

        let idle = Duration::from_secs(self.shared.idle_secs());
        self.pending.clear();
        for (index, flow) in self.flows.iter().enumerate() {
            if flow.live && now.saturating_duration_since(flow.last_active) > idle {
                self.pending.push(index);
            }
        }
        for slot in 0..self.pending.len() {
            let Some(index) = self.pending.get(slot).copied() else {
                break;
            };
            self.close(index);
        }
    }
}

/// One direction's fill-then-drain.
///
/// Returns the bytes pulled from the source (which is what the token bucket is
/// charged for) and whether anything at all happened, which is what stops the
/// caller's loop.
fn step(
    pump: &mut Pump,
    source: BorrowedFd<'_>,
    destination: BorrowedFd<'_>,
    budget: usize,
) -> Result<(usize, bool), ()> {
    let mut moved = 0usize;
    let mut progress = false;

    if budget > 0 {
        match pump.fill(source, budget) {
            Ok(Step::Moved(bytes)) => {
                moved = moved.saturating_add(bytes);
                progress = true;
            }
            Ok(Step::Blocked) => {}
            // A one-shot transition, so this is progress exactly once. `fill`
            // reports `Blocked` on every later call - see the comment there for
            // why treating EOF as a repeatable state wedges the worker.
            Ok(Step::Eof) => progress = true,
            Err(_) => return Err(()),
        }
    }

    match pump.drain(destination) {
        Ok(Step::Moved(_)) => progress = true,
        Ok(Step::Blocked | Step::Eof) => {}
        Err(_) => return Err(()),
    }

    if pump.finished() && pump.finish(destination).is_err() {
        return Err(());
    }
    Ok((moved, progress))
}
