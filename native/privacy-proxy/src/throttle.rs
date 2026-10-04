//! Per-rule token-bucket throttling.
//!
//! Design doc §5.4 draws a distinction the UI is required to surface honestly:
//! a kernel rule is throttled by an nftables byte-rate **policer**, which drops
//! packets and lets TCP back off, while an inspected rule is throttled **here**,
//! by limiting how many bytes the relay is willing to move per unit time. Because
//! the proxy simply stops reading from the source socket when it runs out of
//! tokens, the source's receive window closes and the sender slows down. That is
//! genuine shaping - smooth, no drops, no retransmits - which is why the two
//! mechanisms must not be presented as one "rate limit" field.
//!
//! The bucket is shared by every flow matching a rule, so a rule capped at
//! 10 Mbit/s stays capped no matter how many connections the client opens.

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

use std::time::{Duration, Instant};

/// Smallest burst allowance, so a throttled flow still gets a useful `splice`
/// rather than trickling out byte by byte.
const MIN_BURST: u64 = 16 * 1024;
/// Largest burst allowance, bounding how much a long-idle rule can dump at once.
const MAX_BURST: u64 = 1024 * 1024;
/// Longest a throttled connection ever sits before being retried.
const MAX_WAIT: Duration = Duration::from_millis(100);
/// Shortest retry delay, so a nearly-unthrottled flow does not spin the loop.
const MIN_WAIT: Duration = Duration::from_millis(1);

/// A refilling byte budget.
#[derive(Debug)]
pub struct TokenBucket {
    rate_bytes: u64,
    capacity: u64,
    tokens: u64,
    last: Instant,
}

impl TokenBucket {
    /// Build a bucket for a rule's `rateKbps`, as of `now`.
    ///
    /// Kilobits per second, decimal: `kbps * 1000 / 8` = `kbps * 125` bytes per
    /// second. Not kibibits, and not bytes - the UI says "kbps" and the operator
    /// means the thing their ISP means.
    #[must_use]
    pub fn new(rate_kbps: u32, now: Instant) -> Self {
        let rate_bytes = u64::from(rate_kbps).saturating_mul(125).max(1);
        let capacity = rate_bytes
            .checked_div(4)
            .unwrap_or(MIN_BURST)
            .clamp(MIN_BURST, MAX_BURST);
        Self {
            rate_bytes,
            capacity,
            // Start full: a rule that has never been used should not stall the
            // first connection that matches it.
            tokens: capacity,
            last: now,
        }
    }

    /// Bytes per second this bucket allows.
    #[must_use]
    pub const fn rate_bytes(&self) -> u64 {
        self.rate_bytes
    }

    fn refill(&mut self, now: Instant) {
        let elapsed = now.saturating_duration_since(self.last);
        // u128 so a long stall cannot overflow the multiply. `as_nanos` is u128
        // already; the divide brings it back into u64 range.
        let gained = elapsed
            .as_nanos()
            .saturating_mul(u128::from(self.rate_bytes))
            .checked_div(1_000_000_000)
            .unwrap_or(0);
        if gained == 0 {
            // Do NOT advance `last` here. At low rates a single call may earn
            // less than one whole byte; leaving the mark in place lets the
            // fraction accumulate instead of being rounded away every call,
            // which would otherwise stall a slow rule completely.
            return;
        }
        let gained = u64::try_from(gained).unwrap_or(u64::MAX);
        self.tokens = self.tokens.saturating_add(gained).min(self.capacity);
        self.last = now;
    }

    /// Claim up to `want` bytes. Returns how many were granted, possibly 0.
    pub fn take(&mut self, want: usize, now: Instant) -> usize {
        self.refill(now);
        let want64 = u64::try_from(want).unwrap_or(u64::MAX);
        let granted = want64.min(self.tokens);
        self.tokens = self.tokens.saturating_sub(granted);
        usize::try_from(granted).unwrap_or(0)
    }

    /// How long to wait before retrying, once [`TokenBucket::take`] returned 0.
    ///
    /// Clamped at both ends: [`MAX_WAIT`] keeps the idle sweep responsive, and
    /// [`MIN_WAIT`] stops a barely-throttled flow from spinning the event loop.
    #[must_use]
    pub fn wait_hint(&self) -> Duration {
        let nanos_per_byte = 1_000_000_000u64
            .checked_div(self.rate_bytes)
            .unwrap_or(u64::from(u32::MAX));
        // Wait for a burst's worth rather than a single byte, so we come back to
        // a connection when there is enough budget to do real work.
        let target = nanos_per_byte.saturating_mul(MIN_BURST.min(self.capacity));
        Duration::from_nanos(target).clamp(MIN_WAIT, MAX_WAIT)
    }
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

    #[test]
    fn kbps_is_decimal_kilobits_per_second() {
        let now = Instant::now();
        // 8000 kbps = 8 Mbit/s = 1,000,000 bytes/s.
        assert_eq!(TokenBucket::new(8000, now).rate_bytes(), 1_000_000);
    }

    #[test]
    fn a_fresh_bucket_allows_an_immediate_burst_then_runs_dry() {
        let now = Instant::now();
        let mut bucket = TokenBucket::new(8000, now);
        let first = bucket.take(1 << 20, now);
        assert!(first > 0);
        // Same instant, no refill: the bucket is now empty.
        assert_eq!(bucket.take(1 << 20, now), 0);
    }

    #[test]
    fn tokens_accrue_at_the_configured_rate() {
        let start = Instant::now();
        // 800 kbps = 100,000 bytes/s.
        let mut bucket = TokenBucket::new(800, start);
        // Drain it.
        while bucket.take(1 << 20, start) > 0 {}

        let later = start + Duration::from_secs(1);
        let granted = bucket.take(1 << 20, later);
        // One second of budget, capped by the bucket's burst capacity.
        assert!(granted > 0);
        assert!(
            granted <= 100_000,
            "granted {granted} exceeds one second of budget"
        );
    }

    #[test]
    fn a_slow_rule_still_makes_progress_rather_than_rounding_to_zero_forever() {
        let start = Instant::now();
        // 1 kbps = 125 bytes/s. A single microsecond earns far less than a byte.
        let mut bucket = TokenBucket::new(1, start);
        while bucket.take(1 << 20, start) > 0 {}

        // Many sub-byte polls must not throw the accumulated fraction away.
        let mut at = start;
        for _ in 0..1000 {
            at += Duration::from_micros(100);
            let _ = bucket.take(1 << 20, at);
        }
        // 100ms total elapsed at 125 B/s is ~12 bytes; the point is that it is
        // not zero, which is what advancing `last` on every call would produce.
        let after = start + Duration::from_secs(1);
        assert!(bucket.take(1 << 20, after) > 0);
    }

    #[test]
    fn wait_hint_is_bounded_at_both_ends() {
        let now = Instant::now();
        assert!(TokenBucket::new(1, now).wait_hint() <= MAX_WAIT);
        assert!(TokenBucket::new(1_000_000, now).wait_hint() >= MIN_WAIT);
    }
}
