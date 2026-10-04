//! Per-hostname traffic accounting and the stats file.
//!
//! # Cumulative, never reset on read
//!
//! Counters run from `STARTED` and are never zeroed. Design doc §5.2 is explicit
//! about why: PolySIEM differences successive samples against the previous one
//! carrying the same `STARTED`, so a duplicate or concurrent poll is harmless. A
//! reset-on-read design silently loses whatever happened between the two reads,
//! which is the single most likely way this feature ships subtly broken.
//! A changed `STARTED` tells the control plane the proxy restarted and the
//! sample is a new baseline.
//!
//! # Bounded cardinality
//!
//! At most [`SERVICE_MAX`] `SERVICE` lines are ever emitted, **including the
//! `other` rows**. That total is the cap, not the number of named entries: the
//! shell agent truncates STATUS at 512 lines, so a table that could emit 513
//! would silently drop exactly one entry on every poll of a saturated router.
//!
//! Slots are handed out from both ends of one 512-entry array - named pairs from
//! the front, `other` rows from the back - and allocation stops when the two
//! meet. The last slot is reserved so an `other` row is always available, which
//! is what makes the fold a fold rather than a loss.
//!
//! The key is the **(hostname, action) pair**, not the hostname alone. That
//! matters: when a rule change moves a service from `direct` to `exit:us-nyc`,
//! keying by pair freezes the old counter and starts a new one, so the control
//! plane sees the switch instead of watching one cumulative counter behave
//! impossibly. It is also what makes a direct-vs-VPN split reportable at all.
//!
//! On a 512 MB box an unbounded map keyed by attacker-chosen SNI is a memory
//! exhaustion primitive; this is the mitigation.
//!
//! # Concurrency
//!
//! The steady-state path is lock-free. A flow takes a slot index once, when its
//! hostname becomes known, under a mutex that also guards the key array; from
//! then on every byte accounted is a `fetch_add(Relaxed)` on that slot. Relaxed
//! is sufficient because nothing orders on these values - they are counters read
//! by a poller five seconds later, not synchronisation.
//!
//! # Output format
//!
//! ```text
//! STARTED<TAB><epochSeconds>
//! FLOWS<TAB><activeFlows><TAB><totalFlows>
//! SERVICE<TAB><hostname><TAB><action><TAB><bytesIn><TAB><bytesOut><TAB><flows>
//! DEGRADED<TAB><reason>[,<reason>...]
//! ```
//!
//! The agent reads these with `awk '$1 == want { print $col; exit }'`, so **there
//! is at most one `DEGRADED` line** and multiple reasons are comma-joined onto
//! it. Emitting several lines would silently hide all but the first.
//!
//! The file is replaced atomically - written to a sibling temp file, `fsync`ed,
//! then `rename`d - so a poller never observes a half-written table.

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

use core::fmt::Write as _;
use core::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::path::Path;
use std::sync::Mutex;

use crate::hostname::{Hostname, MAX_HOSTNAME};
use crate::rules::ActionLabel;

/// Ceiling on `SERVICE` lines, mirroring `PRIVACY_ROUTER_SERVICE_MAX`.
///
/// This is the TOTAL, `other` rows included. The agent truncates STATUS at the
/// same number, so emitting more would lose an entry per poll rather than
/// reporting a bounded table.
pub const SERVICE_MAX: usize = 512;

/// Ceiling on distinct `other` rows: `direct`, `block`, and one per exit.
const OVERFLOW_SLOTS: usize = crate::config::MAX_EXITS.saturating_add(2);

/// Named pairs never take the final slot, so an `other` row is always reachable.
const NAMED_MAX: usize = SERVICE_MAX.saturating_sub(1);
/// Literal hostname everything past [`SERVICE_MAX`] folds into.
pub const OTHER_HOST: &[u8] = b"other";
/// Literal hostname for a flow whose name was never learned.
///
/// `-` is this codebase's established "no value" token and it satisfies the
/// agent's `^[A-Za-z0-9._-]{1,253}$` check on the hostname field.
pub const UNKNOWN_HOST: &[u8] = b"-";

// Degraded reasons. Each is a stable `[a-z_]` token; PolySIEM shows them and the
// agent passes them through `sanitize`.
/// The concurrent-flow cap was hit and a connection was refused.
pub const DEGRADED_FLOW_CAP: u32 = 1 << 0;
/// An exit named by a rule was unusable, so flows for it were closed.
pub const DEGRADED_EXIT_DOWN: u32 = 1 << 1;
/// A `SIGHUP` reload failed to parse; the previous config is still serving.
pub const DEGRADED_CONFIG_RELOAD: u32 = 1 << 2;
/// The kernel refused the requested pipe capacity.
pub const DEGRADED_PIPE_SIZE: u32 = 1 << 3;
/// A worker thread died and was respawned.
pub const DEGRADED_WORKER_RESTART: u32 = 1 << 4;
/// Ran out of file descriptors.
pub const DEGRADED_FD_LIMIT: u32 = 1 << 5;

const DEGRADED_NAMES: [(u32, &str); 6] = [
    (DEGRADED_FLOW_CAP, "flow_cap"),
    (DEGRADED_EXIT_DOWN, "exit_down"),
    (DEGRADED_CONFIG_RELOAD, "config_reload_failed"),
    (DEGRADED_PIPE_SIZE, "pipe_size_capped"),
    (DEGRADED_WORKER_RESTART, "worker_restarted"),
    (DEGRADED_FD_LIMIT, "fd_limit"),
];

/// A fixed-size hostname key. Unlike [`Hostname`] it may also hold the literals
/// `other` and `-`, which are not valid hostnames.
#[derive(Clone, Copy)]
struct HostKey {
    bytes: [u8; MAX_HOSTNAME],
    len: u8,
}

impl HostKey {
    fn literal(text: &[u8]) -> Self {
        let mut bytes = [0u8; MAX_HOSTNAME];
        let mut len = 0u8;
        for (slot, byte) in bytes.iter_mut().zip(text.iter()) {
            *slot = *byte;
            len = len.saturating_add(1);
        }
        Self { bytes, len }
    }

    fn from_host(host: Option<&Hostname>) -> Self {
        match host {
            Some(found) => Self::literal(found.as_bytes()),
            None => Self::literal(UNKNOWN_HOST),
        }
    }

    fn as_bytes(&self) -> &[u8] {
        self.bytes.get(..usize::from(self.len)).unwrap_or(&[])
    }

    fn hash(&self, label: &ActionLabel) -> u64 {
        let mut value: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in self.as_bytes().iter().chain(label.as_bytes()) {
            value ^= u64::from(*byte);
            value = value.wrapping_mul(0x0000_0100_0000_01b3);
        }
        value
    }
}

/// Live counters for one (hostname, action) pair.
#[derive(Debug, Default)]
struct Slot {
    bytes_in: AtomicU64,
    bytes_out: AtomicU64,
    flows: AtomicU64,
}

struct Entry {
    hash: u64,
    host: HostKey,
    label: ActionLabel,
    /// Index into [`Stats::slots`].
    ///
    /// Carried explicitly rather than implied by this entry's position in
    /// `entries`: named pairs are allocated upward from 0 and `other` rows
    /// downward from `SERVICE_MAX - 1`, so the two regions interleave in push
    /// order and position would not track the slot once anything has overflowed.
    slot: usize,
}

struct Index {
    entries: Vec<Entry>,
    /// Named slots handed out so far, growing UP from index 0.
    named: usize,
    /// `other` slots handed out so far, growing DOWN from `SERVICE_MAX - 1`.
    overflow: usize,
}

impl Index {
    /// Total entries, which is exactly the number of `SERVICE` lines emitted.
    fn total(&self) -> usize {
        self.named.saturating_add(self.overflow)
    }
}

/// The whole accounting table.
pub struct Stats {
    started_epoch: u64,
    active: AtomicU64,
    total: AtomicU64,
    slots: Vec<Slot>,
    index: Mutex<Index>,
    degraded: AtomicU32,
}

impl core::fmt::Debug for Stats {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Stats")
            .field("started_epoch", &self.started_epoch)
            .field("active", &self.active.load(Ordering::Relaxed))
            .field("total", &self.total.load(Ordering::Relaxed))
            .finish_non_exhaustive()
    }
}

impl Stats {
    /// Allocate the whole table up front. Nothing here grows later.
    #[must_use]
    pub fn new(started_epoch: u64) -> Self {
        // Exactly SERVICE_MAX slots: named pairs and `other` rows share them.
        let capacity = SERVICE_MAX;
        let mut slots = Vec::with_capacity(capacity);
        slots.resize_with(capacity, Slot::default);
        Self {
            started_epoch,
            active: AtomicU64::new(0),
            total: AtomicU64::new(0),
            slots,
            index: Mutex::new(Index {
                entries: Vec::with_capacity(capacity),
                named: 0,
                overflow: 0,
            }),
            degraded: AtomicU32::new(0),
        }
    }

    /// Epoch second the proxy started. Identity of the counter baseline.
    #[must_use]
    pub const fn started_epoch(&self) -> u64 {
        self.started_epoch
    }

    /// Find or create the slot for `(host, label)`.
    ///
    /// Called once per flow, when its hostname becomes known. Falls back to the
    /// `other` slot for `label` once [`SERVICE_MAX`] names are tracked, and to
    /// slot 0 in the impossible case that the overflow region is also full -
    /// misattributing a byte is strictly better than dropping a flow.
    pub fn slot_for(&self, host: Option<&Hostname>, label: &ActionLabel) -> usize {
        let key = HostKey::from_host(host);
        if let Some(found) = self.lookup_or_insert(key, label, false) {
            return found;
        }
        // Named region full: fold into the `other` row for this action.
        if let Some(folded) = self.lookup_or_insert(HostKey::literal(OTHER_HOST), label, true) {
            return folded;
        }
        // Even the `other` region is exhausted - more distinct actions than
        // slots left. Attribute to the first `other` row rather than inventing a
        // 513th line. Its action label will be wrong for this flow; the byte
        // total stays right, which is the property that matters at this point.
        SERVICE_MAX.saturating_sub(1)
    }

    fn lookup_or_insert(&self, key: HostKey, label: &ActionLabel, overflow: bool) -> Option<usize> {
        let hash = key.hash(label);
        let Ok(mut index) = self.index.lock() else {
            // A poisoned mutex means a thread panicked while holding it. The
            // table is still structurally sound (only pushes happen under it),
            // but rather than reason about that, degrade to slot 0.
            return Some(0);
        };
        let found = index
            .entries
            .iter()
            .find(|entry| {
                entry.hash == hash
                    && entry.host.as_bytes() == key.as_bytes()
                    && entry.label.as_bytes() == label.as_bytes()
            })
            .map(|entry| entry.slot);
        if let Some(slot) = found {
            return Some(slot);
        }

        // Named pairs grow up from 0, `other` rows grow down from SERVICE_MAX-1.
        // Both stop when `total()` reaches SERVICE_MAX, which is what keeps the
        // two regions disjoint AND caps the emitted line count at 512.
        let slot = if overflow {
            if index.overflow >= OVERFLOW_SLOTS || index.total() >= SERVICE_MAX {
                return None;
            }
            let next = SERVICE_MAX
                .checked_sub(1)
                .and_then(|last| last.checked_sub(index.overflow))?;
            index.overflow = index.overflow.saturating_add(1);
            next
        } else {
            if index.named >= NAMED_MAX || index.total() >= SERVICE_MAX {
                return None;
            }
            let next = index.named;
            index.named = index.named.saturating_add(1);
            next
        };
        index.entries.push(Entry {
            hash,
            host: key,
            label: *label,
            slot,
        });
        Some(slot)
    }

    /// A flow started on `slot`.
    pub fn flow_started(&self, slot: usize) {
        if let Some(entry) = self.slots.get(slot) {
            entry.flows.fetch_add(1, Ordering::Relaxed);
        }
        self.active.fetch_add(1, Ordering::Relaxed);
        self.total.fetch_add(1, Ordering::Relaxed);
    }

    /// A flow ended. Not tied to a slot: a flow can end before it has one.
    pub fn flow_ended(&self) {
        // `fetch_update` rather than `fetch_sub` so an accounting slip can never
        // wrap the gauge to u64::MAX and report 18 quintillion active flows.
        let _ = self
            .active
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                Some(current.saturating_sub(1))
            });
    }

    /// Bytes travelling from the upstream to the client.
    pub fn add_in(&self, slot: usize, bytes: u64) {
        if let Some(entry) = self.slots.get(slot) {
            entry.bytes_in.fetch_add(bytes, Ordering::Relaxed);
        }
    }

    /// Bytes travelling from the client to the upstream.
    pub fn add_out(&self, slot: usize, bytes: u64) {
        if let Some(entry) = self.slots.get(slot) {
            entry.bytes_out.fetch_add(bytes, Ordering::Relaxed);
        }
    }

    /// Currently active flows.
    #[must_use]
    pub fn active(&self) -> u64 {
        self.active.load(Ordering::Relaxed)
    }

    /// Raise a degraded flag. Idempotent.
    pub fn degrade(&self, flag: u32) {
        self.degraded.fetch_or(flag, Ordering::Relaxed);
    }

    /// Clear a degraded flag, for conditions that recover (an exit coming back).
    pub fn recover(&self, flag: u32) {
        self.degraded.fetch_and(!flag, Ordering::Relaxed);
    }

    /// Render the whole file into `out`, which is cleared first.
    pub fn render(&self, out: &mut String) {
        out.clear();
        let _ = writeln!(out, "STARTED\t{}", self.started_epoch);
        let _ = writeln!(
            out,
            "FLOWS\t{}\t{}",
            self.active.load(Ordering::Relaxed),
            self.total.load(Ordering::Relaxed)
        );

        if let Ok(index) = self.index.lock() {
            for entry in &index.entries {
                let Some(slot) = self.slots.get(entry.slot) else {
                    continue;
                };
                let flows = slot.flows.load(Ordering::Relaxed);
                let bytes_in = slot.bytes_in.load(Ordering::Relaxed);
                let bytes_out = slot.bytes_out.load(Ordering::Relaxed);
                if flows == 0 && bytes_in == 0 && bytes_out == 0 {
                    continue;
                }
                let _ = writeln!(
                    out,
                    "SERVICE\t{}\t{}\t{bytes_in}\t{bytes_out}\t{flows}",
                    core::str::from_utf8(entry.host.as_bytes()).unwrap_or("-"),
                    entry.label,
                );
            }
        }

        // Exactly one DEGRADED line - the agent's awk stops at the first match.
        let flags = self.degraded.load(Ordering::Relaxed);
        if flags != 0 {
            let reasons: Vec<&str> = DEGRADED_NAMES
                .iter()
                .filter(|(bit, _)| flags & bit != 0)
                .map(|(_, name)| *name)
                .collect();
            let _ = writeln!(out, "DEGRADED\t{}", reasons.join(","));
        }
    }

    /// Write the stats file atomically: temp file, `fsync`, `rename`.
    ///
    /// # Errors
    /// Any I/O failure. The caller logs and carries on - failing to publish
    /// stats must never take the datapath down.
    pub fn write_atomic(&self, path: &Path, scratch: &mut String) -> std::io::Result<()> {
        use std::io::Write as _;

        self.render(scratch);

        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("stats");
        let temp = path.with_file_name(format!(".{file_name}.tmp"));

        {
            let mut file = std::fs::File::create(&temp)?;
            set_owner_readable(&file)?;
            file.write_all(scratch.as_bytes())?;
            // Durable before the rename: a crash between the two must not leave
            // the published name pointing at a truncated file.
            file.sync_all()?;
        }
        match std::fs::rename(&temp, path) {
            Ok(()) => Ok(()),
            Err(error) => {
                let _ = std::fs::remove_file(&temp);
                Err(error)
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn set_owner_readable(file: &std::fs::File) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    // 0640: hostnames are privacy-sensitive, and root (the agent) reads it
    // regardless of mode. Matches the 0640 the config file uses.
    file.set_permissions(std::fs::Permissions::from_mode(0o640))
}

#[cfg(not(target_os = "linux"))]
fn set_owner_readable(_file: &std::fs::File) -> std::io::Result<()> {
    Ok(())
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
    use crate::rules::Action;

    fn host(text: &str) -> Hostname {
        Hostname::parse(text.as_bytes()).unwrap()
    }

    fn direct() -> ActionLabel {
        ActionLabel::simple(Action::Direct)
    }

    #[test]
    fn the_same_pair_always_maps_to_the_same_slot() {
        let stats = Stats::new(1000);
        let first = stats.slot_for(Some(&host("example.com")), &direct());
        let again = stats.slot_for(Some(&host("example.com")), &direct());
        assert_eq!(first, again);

        // A different action for the same hostname is a different row.
        let blocked = stats.slot_for(
            Some(&host("example.com")),
            &ActionLabel::simple(Action::Block),
        );
        assert_ne!(first, blocked);
    }

    #[test]
    fn a_flow_with_no_hostname_is_recorded_as_the_dash_literal() {
        let stats = Stats::new(1000);
        let slot = stats.slot_for(None, &direct());
        stats.flow_started(slot);
        stats.add_in(slot, 10);
        let mut out = String::new();
        stats.render(&mut out);
        assert!(out.contains("SERVICE\t-\tdirect\t10\t0\t1\n"), "{out}");
    }

    fn service_lines(stats: &Stats) -> Vec<String> {
        let mut out = String::new();
        stats.render(&mut out);
        out.lines()
            .filter(|line| line.starts_with("SERVICE\t"))
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn overflow_folds_into_other_and_the_total_line_count_never_exceeds_the_cap() {
        let stats = Stats::new(1000);
        for n in 0..(SERVICE_MAX * 4) {
            let slot = stats.slot_for(Some(&host(&format!("h{n}.test"))), &direct());
            stats.flow_started(slot);
            stats.add_in(slot, 1);
        }

        let lines = service_lines(&stats);
        // The agent truncates STATUS at SERVICE_MAX lines. Emitting more would
        // silently drop one entry per poll on a saturated router.
        assert!(
            lines.len() <= SERVICE_MAX,
            "emitted {} SERVICE lines, cap is {SERVICE_MAX}",
            lines.len()
        );
        assert!(
            lines
                .iter()
                .any(|line| line.starts_with("SERVICE\tother\tdirect\t")),
            "the remainder must fold into `other`"
        );
    }

    #[test]
    fn the_cap_holds_across_many_actions_as_well_as_many_hostnames() {
        let stats = Stats::new(1000);
        let labels = [
            direct(),
            ActionLabel::simple(Action::Block),
            ActionLabel::exit("a").unwrap(),
            ActionLabel::exit("b").unwrap(),
            ActionLabel::exit("c").unwrap(),
        ];
        for n in 0..(SERVICE_MAX * 2) {
            for label in &labels {
                let slot = stats.slot_for(Some(&host(&format!("h{n}.test"))), label);
                stats.flow_started(slot);
            }
        }
        let lines = service_lines(&stats);
        assert!(
            lines.len() <= SERVICE_MAX,
            "emitted {} SERVICE lines with 5 actions in play",
            lines.len()
        );
    }

    #[test]
    fn a_named_pair_and_its_other_row_never_share_a_slot() {
        // Named slots grow up from 0 and `other` slots grow down from the end;
        // if the two regions ever overlapped, two different rows would report
        // one counter.
        let stats = Stats::new(1000);
        let mut seen = std::collections::HashSet::new();
        for n in 0..(SERVICE_MAX * 2) {
            let slot = stats.slot_for(Some(&host(&format!("h{n}.test"))), &direct());
            seen.insert(slot);
        }
        assert!(seen.len() <= SERVICE_MAX);
        assert!(seen.iter().all(|slot| *slot < SERVICE_MAX));
    }

    #[test]
    fn counters_are_cumulative_and_render_matches_the_agent_grammar() {
        let stats = Stats::new(1_700_000_000);
        let slot = stats.slot_for(
            Some(&host("netflix.com")),
            &ActionLabel::exit("us").unwrap(),
        );
        stats.flow_started(slot);
        stats.add_in(slot, 4096);
        stats.add_out(slot, 512);
        stats.add_in(slot, 4096);
        stats.flow_ended();

        let mut out = String::new();
        stats.render(&mut out);
        assert!(out.starts_with("STARTED\t1700000000\n"), "{out}");
        assert!(out.contains("FLOWS\t0\t1\n"), "{out}");
        assert!(
            out.contains("SERVICE\tnetflix.com\texit:us\t8192\t512\t1\n"),
            "{out}"
        );
    }

    #[test]
    fn active_flows_never_wrap_below_zero() {
        let stats = Stats::new(1000);
        stats.flow_ended();
        stats.flow_ended();
        assert_eq!(stats.active(), 0);
    }

    #[test]
    fn degraded_is_one_comma_joined_line_because_the_agent_reads_only_the_first() {
        let stats = Stats::new(1000);
        stats.degrade(DEGRADED_FLOW_CAP);
        stats.degrade(DEGRADED_EXIT_DOWN);
        let mut out = String::new();
        stats.render(&mut out);
        assert_eq!(out.matches("DEGRADED\t").count(), 1, "{out}");
        assert!(out.contains("DEGRADED\tflow_cap,exit_down\n"), "{out}");

        stats.recover(DEGRADED_EXIT_DOWN);
        stats.render(&mut out);
        assert!(out.contains("DEGRADED\tflow_cap\n"), "{out}");
    }
}
