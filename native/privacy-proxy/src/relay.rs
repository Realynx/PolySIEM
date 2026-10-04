//! The zero-copy relay: a pipe pair per direction, moved with `splice(2)`.
//!
//! # Why a pipe at all
//!
//! `splice` requires one end of every transfer to be a pipe - that is the
//! kernel's constraint, not a design choice. So each direction of a flow owns a
//! pipe used purely as a kernel-side buffer:
//!
//! ```text
//! client socket --splice--> [ pipe ] --splice--> upstream socket
//! client socket <--splice-- [ pipe ] <--splice-- upstream socket
//! ```
//!
//! Payload bytes move as page references between the socket buffer and the pipe
//! ring. They are never copied into this process's address space, never appear in
//! a `Vec`, and never touch a userspace buffer. The only bytes this program ever
//! reads are the <= 8 KiB prelude peeked with `MSG_PEEK`, and even those are left
//! in the socket queue to be spliced across later like any other payload.
//!
//! # The pipe pool, and a limit worth knowing about
//!
//! Pipes are pooled rather than created per flow: creating one costs two
//! descriptors and a kernel allocation, and the steady state must not allocate.
//! A closing flow returns its pipes; a new flow takes them back.
//!
//! The pool grows **lazily**, and that is deliberate. `fs.pipe-user-pages-soft`
//! defaults to 16384 pages (64 MiB) per user, and `F_SETPIPE_SZ` starts returning
//! `EPERM` for an unprivileged process once the total set size crosses it. At the
//! contract's requested 1 MiB per pipe that happens after about 64 pipes - 32
//! flows. Preallocating the whole pool at startup would therefore hand almost
//! every pipe the 4 KiB minimum and quietly destroy throughput. Growing on demand
//! means the flows that exist get the large buffers, and [`PipePool::degraded`]
//! reports it when the kernel starts refusing.

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
use std::os::fd::BorrowedFd;

use crate::sys::{self, Pipe, Splice};

/// Below this, the kernel has clearly clamped us and throughput will suffer.
const HEALTHY_PIPE_BYTES: usize = 64 * 1024;

/// What one relay step achieved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Bytes moved.
    Moved(usize),
    /// Nothing could move right now.
    Blocked,
    /// The source is at end of file.
    Eof,
}

/// A recycling pool of pipe pairs.
#[derive(Debug)]
pub struct PipePool {
    idle: Vec<Pipe>,
    requested: usize,
    limit: usize,
    live: usize,
    degraded: bool,
}

impl PipePool {
    /// A pool that will create at most `limit` pipes, each asking for
    /// `requested` bytes of capacity.
    #[must_use]
    pub fn new(requested: usize, limit: usize) -> Self {
        Self {
            idle: Vec::with_capacity(limit.min(64)),
            requested,
            limit,
            live: 0,
            degraded: false,
        }
    }

    /// Has the kernel refused the requested capacity at any point?
    #[must_use]
    pub const fn degraded(&self) -> bool {
        self.degraded
    }

    /// Take a pipe, reusing an idle one if there is one.
    pub fn acquire(&mut self) -> io::Result<Option<Pipe>> {
        if let Some(pipe) = self.idle.pop() {
            return Ok(Some(pipe));
        }
        if self.live >= self.limit {
            return Ok(None);
        }
        let pipe = sys::pipe_pair(self.requested)?;
        if pipe.capacity < self.requested.min(HEALTHY_PIPE_BYTES) {
            self.degraded = true;
        }
        self.live = self.live.saturating_add(1);
        Ok(Some(pipe))
    }

    /// Return a pipe for reuse.
    ///
    /// A pipe holding unread bytes cannot be recycled - the next flow would
    /// inherit them and inject someone else's data into an unrelated connection.
    /// Those are dropped, which closes them and gives the pages back.
    pub fn release(&mut self, pipe: Pipe, buffered: usize) {
        if buffered > 0 {
            self.live = self.live.saturating_sub(1);
            drop(pipe);
            return;
        }
        self.idle.push(pipe);
    }
}

/// One direction of a flow: source socket -> pipe -> destination socket.
#[derive(Debug)]
pub struct Pump {
    pipe: Pipe,
    buffered: usize,
    source_eof: bool,
    shutdown_sent: bool,
    moved: u64,
}

impl Pump {
    /// Wrap a freshly acquired pipe.
    #[must_use]
    pub fn new(pipe: Pipe) -> Self {
        Self {
            pipe,
            buffered: 0,
            source_eof: false,
            shutdown_sent: false,
            moved: 0,
        }
    }

    /// Bytes currently sitting in the pipe.
    #[must_use]
    pub const fn buffered(&self) -> usize {
        self.buffered
    }

    /// Total bytes moved in this direction.
    #[must_use]
    pub const fn moved(&self) -> u64 {
        self.moved
    }

    /// Has the source closed its write side?
    #[must_use]
    pub const fn source_eof(&self) -> bool {
        self.source_eof
    }

    /// Nothing left to read and nothing left to write.
    #[must_use]
    pub const fn finished(&self) -> bool {
        self.source_eof && self.buffered == 0
    }

    /// Free space in the pipe.
    #[must_use]
    pub const fn space(&self) -> usize {
        self.pipe.capacity.saturating_sub(self.buffered)
    }

    /// Give the pipe back to the pool. Consumes the pump.
    pub fn recycle(self, pool: &mut PipePool) {
        pool.release(self.pipe, self.buffered);
    }

    /// Pull up to `limit` bytes from `source` into the pipe.
    ///
    /// `limit` is where the token bucket applies: capping how much we are willing
    /// to read is what closes the source's receive window and slows the sender
    /// down, which is real shaping rather than the drop-and-back-off behaviour of
    /// the kernel-tier policer.
    pub fn fill(&mut self, source: BorrowedFd<'_>, limit: usize) -> io::Result<Step> {
        // `Step::Eof` is a ONE-SHOT TRANSITION, not a state report. Once the
        // source has closed there is nothing further to do here, so this reports
        // `Blocked` on every later call.
        //
        // This is not a nicety. The relay loop treats "did anything happen?" as
        // its termination condition, and re-reporting `Eof` forever makes that
        // condition permanently true: the loop stops going round to epoll, the
        // worker spins at 100% CPU, and the flow slot is never released. Two
        // half-closed flows would wedge both workers on a 2 vCPU box. The
        // datapath test caught exactly this, and `finished()` below is the right
        // way to ask about the state.
        if self.source_eof {
            return Ok(Step::Blocked);
        }
        let want = self.space().min(limit);
        if want == 0 {
            return Ok(Step::Blocked);
        }
        match sys::splice(source, self.pipe.write_end(), want)? {
            Splice::Moved(bytes) => {
                self.buffered = self.buffered.saturating_add(bytes);
                Ok(Step::Moved(bytes))
            }
            Splice::WouldBlock => Ok(Step::Blocked),
            Splice::Eof => {
                self.source_eof = true;
                Ok(Step::Eof)
            }
        }
    }

    /// Push buffered bytes out to `destination`.
    pub fn drain(&mut self, destination: BorrowedFd<'_>) -> io::Result<Step> {
        if self.buffered == 0 {
            return Ok(Step::Blocked);
        }
        match sys::splice(self.pipe.read_end(), destination, self.buffered)? {
            Splice::Moved(bytes) => {
                self.buffered = self.buffered.saturating_sub(bytes);
                self.moved = self.moved.saturating_add(u64::try_from(bytes).unwrap_or(0));
                Ok(Step::Moved(bytes))
            }
            // A pipe with buffered bytes cannot really be at EOF; treat it as
            // "not now" rather than inventing a shutdown.
            Splice::WouldBlock | Splice::Eof => Ok(Step::Blocked),
        }
    }

    /// Once the source is done and the pipe is empty, half-close the destination
    /// so the peer learns the stream ended. Idempotent.
    pub fn finish(&mut self, destination: BorrowedFd<'_>) -> io::Result<()> {
        if !self.finished() || self.shutdown_sent {
            return Ok(());
        }
        self.shutdown_sent = true;
        // A peer that has already vanished makes this fail; that is not an error
        // worth propagating, the flow is being torn down either way.
        let _ = sys::shutdown_write(destination);
        Ok(())
    }
}

impl Pipe {
    /// The write end, for splicing *into* the pipe.
    #[must_use]
    pub fn write_end(&self) -> BorrowedFd<'_> {
        use std::os::fd::AsFd as _;
        self.write.as_fd()
    }

    /// The read end, for splicing *out of* the pipe.
    #[must_use]
    pub fn read_end(&self) -> BorrowedFd<'_> {
        use std::os::fd::AsFd as _;
        self.read.as_fd()
    }
}
