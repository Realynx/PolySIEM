//! **The only module in this crate that may contain `unsafe`.**
//!
//! Everything here is a thin, safe wrapper over a syscall. Every `unsafe` block
//! carries a `// SAFETY:` comment naming the precondition it relies on, and
//! `unsafe_op_in_unsafe_fn` is denied crate-wide so an `unsafe fn` does not get
//! an implicit `unsafe` block for free.
//!
//! The rules this module holds itself to:
//!
//! * **No raw fd escapes.** Every descriptor is returned as an [`OwnedFd`], so
//!   it is closed exactly once, by the type system, on every path including
//!   early returns and unwinds. Nothing in this crate calls `close`.
//! * **No pointer arithmetic.** Buffers are passed as slices and their lengths
//!   come from `slice::len`, never from a separate parameter that could drift.
//! * **Errors are `io::Result`.** A negative return becomes
//!   `io::Error::last_os_error()` immediately, at the call site, before any
//!   other libc call can overwrite `errno`.
//! * **`EAGAIN` is not an error.** On non-blocking sockets it is the normal way
//!   to learn there is nothing to do, so it is modelled in the return type
//!   rather than as an `Err` the caller has to pattern-match on.
//!
//! Constants that describe a kernel ABI are defined here rather than taken from
//! `libc`, because a few of them are absent from older `libc` releases and a
//! build failure on someone's CI is a worse outcome than four documented
//! integers. Each cites its kernel header.

// Every cast in this module is a width conversion between C types whose widths
// the kernel ABI fixes: `size_of::<sockaddr_in>()` into `socklen_t`, `AF_INET`
// into `sa_family_t`, the `EPOLL*` constants into the `u32` field that holds
// them. `try_from` at these sites would add a fallible path to values that are
// compile-time constants well inside range, so the lints are relaxed here - and
// only here. They stay on for the rest of the crate, where a narrowing cast
// really can lose data.
#![allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]

use std::ffi::CString;
use std::io;
use std::mem::size_of;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::os::fd::{AsRawFd, BorrowedFd, FromRawFd, OwnedFd, RawFd};

/// `include/uapi/linux/in.h` - the `SOL_IP` socket level.
const SOL_IP: libc::c_int = 0;
/// `include/uapi/linux/netfilter_ipv4.h` - retrieves the pre-DNAT destination.
const SO_ORIGINAL_DST: libc::c_int = 80;
/// `include/uapi/linux/fcntl.h`.
const F_SETPIPE_SZ: libc::c_int = 1031;
/// `include/uapi/linux/fcntl.h`.
const F_GETPIPE_SZ: libc::c_int = 1032;
/// `include/uapi/linux/splice.h` - move pages rather than copy where possible.
const SPLICE_F_MOVE: libc::c_uint = 1;
/// `include/uapi/linux/splice.h` - never block, regardless of the fds' flags.
const SPLICE_F_NONBLOCK: libc::c_uint = 2;

/// Turn a negative libc return into an `io::Error`, capturing `errno` at once.
fn cvt(result: libc::c_int) -> io::Result<libc::c_int> {
    if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(result)
    }
}

/// As [`cvt`], for the `ssize_t`-returning calls.
fn cvt_ssize(result: libc::ssize_t) -> io::Result<libc::ssize_t> {
    if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(result)
    }
}

/// On Linux `EAGAIN` and `EWOULDBLOCK` are the same number, so matching both
/// explicitly is an unreachable pattern; `ErrorKind::WouldBlock` covers whichever
/// the platform actually uses.
fn is_would_block(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::WouldBlock
}

/// A zeroed `sockaddr_in`, built field by field so no `unsafe` is needed.
const fn empty_sockaddr_in() -> libc::sockaddr_in {
    libc::sockaddr_in {
        sin_family: 0,
        sin_port: 0,
        sin_addr: libc::in_addr { s_addr: 0 },
        sin_zero: [0; 8],
    }
}

fn to_sockaddr_in(addr: SocketAddrV4) -> libc::sockaddr_in {
    libc::sockaddr_in {
        sin_family: libc::AF_INET as libc::sa_family_t,
        sin_port: addr.port().to_be(),
        sin_addr: libc::in_addr {
            s_addr: u32::from(*addr.ip()).to_be(),
        },
        sin_zero: [0; 8],
    }
}

fn from_sockaddr_in(raw: &libc::sockaddr_in) -> Option<SocketAddrV4> {
    if raw.sin_family != libc::AF_INET as libc::sa_family_t {
        return None;
    }
    Some(SocketAddrV4::new(
        Ipv4Addr::from(u32::from_be(raw.sin_addr.s_addr)),
        u16::from_be(raw.sin_port),
    ))
}

/// Wrap a raw descriptor the kernel just handed us.
///
/// # Safety
/// `fd` must be a fresh, valid, unowned descriptor. Callers pass the return
/// value of a syscall that creates one and nothing else.
unsafe fn own(fd: RawFd) -> OwnedFd {
    // SAFETY: the caller guarantees `fd` is a valid descriptor that nothing else
    // owns, which is exactly `OwnedFd::from_raw_fd`'s contract.
    unsafe { OwnedFd::from_raw_fd(fd) }
}

fn set_int_option(
    fd: BorrowedFd<'_>,
    level: libc::c_int,
    name: libc::c_int,
    value: libc::c_int,
) -> io::Result<()> {
    let value: libc::c_int = value;
    // SAFETY: `&value` points to one initialised `c_int` and the length passed is
    // exactly its size, which is what every integer socket option expects.
    unsafe {
        cvt(libc::setsockopt(
            fd.as_raw_fd(),
            level,
            name,
            std::ptr::addr_of!(value).cast(),
            size_of::<libc::c_int>() as libc::socklen_t,
        ))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------

/// Create a non-blocking, close-on-exec IPv4 TCP socket.
pub fn tcp_socket() -> io::Result<OwnedFd> {
    // SAFETY: a plain socket(2) with constant arguments; the return value is
    // checked and, if valid, immediately given an owner.
    let fd = unsafe {
        cvt(libc::socket(
            libc::AF_INET,
            libc::SOCK_STREAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
            0,
        ))?
    };
    // SAFETY: `socket` returned a fresh descriptor that nothing else owns.
    Ok(unsafe { own(fd) })
}

/// Bind a listening socket to `0.0.0.0:port` with `SO_REUSEPORT`.
///
/// `SO_REUSEPORT` is what lets every worker thread own its own listening socket
/// on the same port: the kernel hashes each incoming connection to one of them,
/// so there is no shared accept queue and no thundering herd, and no lock on the
/// accept path at all.
///
/// The listener binds `0.0.0.0` rather than loopback because netfilter `REDIRECT`
/// rewrites the destination to an address on the *input* interface, never to
/// `127.0.0.1`. The agent's input chain is what keeps the port unreachable from
/// the LAN directly - only a connection netfilter itself redirected carries
/// `ct status dnat`.
pub fn listener(port: u16, backlog: libc::c_int) -> io::Result<OwnedFd> {
    let fd = tcp_socket()?;
    let borrowed = fd.as_fd_ref();
    set_int_option(borrowed, libc::SOL_SOCKET, libc::SO_REUSEADDR, 1)?;
    set_int_option(borrowed, libc::SOL_SOCKET, libc::SO_REUSEPORT, 1)?;
    bind_v4(borrowed, SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port))?;
    // SAFETY: a plain listen(2) on a descriptor we just bound.
    unsafe {
        cvt(libc::listen(fd.as_raw_fd(), backlog))?;
    }
    Ok(fd)
}

/// Bind a socket to a local address.
///
/// Used by [`listener`], and by `tests/datapath.rs` to pin a client's SOURCE
/// address. That is not incidental: the datapath test's netfilter `REDIRECT`
/// rule matches on source address so that the proxy's own upstream connections
/// are not redirected back into itself, and there is no way to set a client's
/// source address through `std::net::TcpStream`.
pub fn bind_v4(fd: BorrowedFd<'_>, addr: SocketAddrV4) -> io::Result<()> {
    let raw = to_sockaddr_in(addr);
    // SAFETY: `raw` is a fully initialised `sockaddr_in` and the length passed
    // is exactly its size.
    unsafe {
        cvt(libc::bind(
            fd.as_raw_fd(),
            std::ptr::addr_of!(raw).cast(),
            size_of::<libc::sockaddr_in>() as libc::socklen_t,
        ))?;
    }
    Ok(())
}

/// Accept one connection, or `None` when the queue is empty.
pub fn accept(fd: BorrowedFd<'_>) -> io::Result<Option<(OwnedFd, SocketAddrV4)>> {
    let mut raw = empty_sockaddr_in();
    let mut len = size_of::<libc::sockaddr_in>() as libc::socklen_t;
    // SAFETY: `raw` is an initialised `sockaddr_in` and `len` holds its size;
    // accept4 writes at most `len` bytes and updates `len` to what it wrote.
    let accepted = unsafe {
        libc::accept4(
            fd.as_raw_fd(),
            std::ptr::addr_of_mut!(raw).cast(),
            std::ptr::addr_of_mut!(len),
            libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
        )
    };
    if accepted < 0 {
        let error = io::Error::last_os_error();
        if is_would_block(&error) {
            return Ok(None);
        }
        return Err(error);
    }
    // SAFETY: accept4 returned a fresh descriptor that nothing else owns.
    let owned = unsafe { own(accepted) };
    let peer = from_sockaddr_in(&raw)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "peer is not IPv4"))?;
    Ok(Some((owned, peer)))
}

/// The destination the client originally asked for, before `REDIRECT`.
///
/// This is the whole reason a transparent proxy can work: netfilter keeps the
/// pre-DNAT tuple in the conntrack entry, and this is how userspace reads it back.
pub fn original_dst(fd: BorrowedFd<'_>) -> io::Result<SocketAddrV4> {
    let mut raw = empty_sockaddr_in();
    let mut len = size_of::<libc::sockaddr_in>() as libc::socklen_t;
    // SAFETY: `raw` is an initialised `sockaddr_in` and `len` its exact size;
    // getsockopt writes at most `len` bytes and updates `len` to what it wrote.
    unsafe {
        cvt(libc::getsockopt(
            fd.as_raw_fd(),
            SOL_IP,
            SO_ORIGINAL_DST,
            std::ptr::addr_of_mut!(raw).cast(),
            std::ptr::addr_of_mut!(len),
        ))?;
    }
    from_sockaddr_in(&raw).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "SO_ORIGINAL_DST did not return an IPv4 address",
        )
    })
}

/// Pin this socket's egress to one interface.
///
/// `SO_BINDTODEVICE`, not fwmark. Design doc §3 is emphatic about why: all three
/// Proton configs on the real box carry the same interface address `10.2.0.2/32`,
/// so any scheme that picks an exit by consulting a routing table has to
/// disambiguate identical source addresses. Binding the socket to the device
/// sidesteps routing entirely - the source address is taken from that interface
/// and replies match by `sk_bound_dev_if`.
///
/// Requires `CAP_NET_RAW`, which the systemd unit grants ambiently.
pub fn bind_to_device(fd: BorrowedFd<'_>, ifname: &str) -> io::Result<()> {
    // `SO_BINDTODEVICE` takes the name as bytes, not a pointer to a C string,
    // but the kernel still expects it NUL-terminated within IFNAMSIZ.
    let name = CString::new(ifname)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "interface name contains NUL"))?;
    let bytes = name.as_bytes_with_nul();
    if bytes.len() > libc::IFNAMSIZ {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "interface name is too long",
        ));
    }
    // SAFETY: `bytes` is a live slice for the duration of the call and the length
    // passed is exactly `bytes.len()`.
    unsafe {
        cvt(libc::setsockopt(
            fd.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_BINDTODEVICE,
            bytes.as_ptr().cast(),
            bytes.len() as libc::socklen_t,
        ))?;
    }
    Ok(())
}

/// Disable Nagle. Both sides, always: this is an interactive proxy and a 40ms
/// delay waiting to coalesce a small write is exactly what it must not add.
pub fn set_nodelay(fd: BorrowedFd<'_>) -> io::Result<()> {
    set_int_option(fd, libc::IPPROTO_TCP, libc::TCP_NODELAY, 1)
}

/// Outcome of a non-blocking `connect`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConnectState {
    /// Completed immediately, which happens for a local destination.
    Connected,
    /// In flight. Wait for writability, then check [`socket_error`].
    InProgress,
}

/// Start a non-blocking connection to `addr`.
pub fn connect(fd: BorrowedFd<'_>, addr: SocketAddrV4) -> io::Result<ConnectState> {
    let raw = to_sockaddr_in(addr);
    // SAFETY: `raw` is a fully initialised `sockaddr_in` and the length passed is
    // exactly its size.
    let result = unsafe {
        libc::connect(
            fd.as_raw_fd(),
            std::ptr::addr_of!(raw).cast(),
            size_of::<libc::sockaddr_in>() as libc::socklen_t,
        )
    };
    if result == 0 {
        return Ok(ConnectState::Connected);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::EINPROGRESS) {
        Ok(ConnectState::InProgress)
    } else {
        Err(error)
    }
}

/// Read and clear `SO_ERROR`. Zero means the connection succeeded.
pub fn socket_error(fd: BorrowedFd<'_>) -> io::Result<libc::c_int> {
    let mut value: libc::c_int = 0;
    let mut len = size_of::<libc::c_int>() as libc::socklen_t;
    // SAFETY: `value` is an initialised `c_int` and `len` its exact size.
    unsafe {
        cvt(libc::getsockopt(
            fd.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_ERROR,
            std::ptr::addr_of_mut!(value).cast(),
            std::ptr::addr_of_mut!(len),
        ))?;
    }
    Ok(value)
}

/// Peek at buffered bytes without consuming them.
///
/// `MSG_PEEK` is what makes the ClientHello inspection free of re-injection: the
/// bytes stay in the socket's receive queue, so once the upstream is open the
/// very same bytes are `splice`d across like any other payload. Nothing has to
/// remember and replay the prelude, and the prelude is not copied twice.
///
/// Returns `Ok(None)` when nothing is buffered yet, and `Ok(Some(0))` on EOF.
pub fn peek(fd: BorrowedFd<'_>, buf: &mut [u8]) -> io::Result<Option<usize>> {
    // SAFETY: the pointer and length come from the same slice, so the kernel
    // writes at most `buf.len()` bytes into memory we own for the call's duration.
    let read = unsafe {
        libc::recv(
            fd.as_raw_fd(),
            buf.as_mut_ptr().cast(),
            buf.len(),
            libc::MSG_PEEK | libc::MSG_DONTWAIT,
        )
    };
    if read < 0 {
        let error = io::Error::last_os_error();
        if is_would_block(&error) {
            return Ok(None);
        }
        return Err(error);
    }
    Ok(Some(usize::try_from(read).unwrap_or(0)))
}

/// Half-close: tell the peer we will send nothing more.
pub fn shutdown_write(fd: BorrowedFd<'_>) -> io::Result<()> {
    // SAFETY: a plain shutdown(2) on a descriptor the caller holds open.
    unsafe {
        cvt(libc::shutdown(fd.as_raw_fd(), libc::SHUT_WR))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Pipes and splice
// ---------------------------------------------------------------------------

/// A pipe pair used as the kernel-side buffer for one relay direction.
#[derive(Debug)]
pub struct Pipe {
    /// Read end - spliced *into* the destination socket.
    pub read: OwnedFd,
    /// Write end - spliced *from* the source socket.
    pub write: OwnedFd,
    /// Capacity the kernel actually granted, which may be less than requested.
    pub capacity: usize,
}

/// Create a non-blocking pipe and try to enlarge it to `requested` bytes.
///
/// **The kernel is allowed to refuse.** `fs.pipe-user-pages-soft` defaults to
/// 16384 pages (64 MiB) per user, and once an unprivileged process is over it
/// `F_SETPIPE_SZ` returns `EPERM`. At the requested 1 MiB that ceiling is reached
/// after roughly 64 pipes, i.e. 32 concurrent flows - far below the flow cap. So
/// the enlargement is best-effort: on refusal the pipe keeps its default 64 KiB,
/// which is ample for line rate on a home connection, and the caller raises
/// `DEGRADED pipe_size_capped` so the operator can see it rather than guessing.
pub fn pipe_pair(requested: usize) -> io::Result<Pipe> {
    let mut fds: [libc::c_int; 2] = [-1, -1];
    // SAFETY: `fds` is a two-element array, which is exactly what pipe2 writes.
    unsafe {
        cvt(libc::pipe2(
            fds.as_mut_ptr(),
            libc::O_NONBLOCK | libc::O_CLOEXEC,
        ))?;
    }
    // SAFETY: pipe2 succeeded, so both entries are fresh descriptors nothing
    // else owns. Taking ownership immediately means an early return below still
    // closes them.
    let read = unsafe { own(fds[0]) };
    // SAFETY: as above, for the write end.
    let write = unsafe { own(fds[1]) };

    let wanted = libc::c_int::try_from(requested).unwrap_or(libc::c_int::MAX);
    // SAFETY: fcntl with F_SETPIPE_SZ takes an int by value.
    let granted = unsafe { libc::fcntl(read.as_raw_fd(), F_SETPIPE_SZ, wanted) };
    let capacity = if granted > 0 {
        usize::try_from(granted).unwrap_or(0)
    } else {
        // SAFETY: fcntl with F_GETPIPE_SZ takes no further argument.
        let current = unsafe { libc::fcntl(read.as_raw_fd(), F_GETPIPE_SZ) };
        usize::try_from(current).unwrap_or(0)
    };

    Ok(Pipe {
        read,
        write,
        capacity,
    })
}

/// What one `splice` call achieved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Splice {
    /// Bytes moved.
    Moved(usize),
    /// Nothing to move, or nowhere to put it, right now.
    WouldBlock,
    /// The source reached end of file.
    Eof,
}

/// Move up to `len` bytes from `from` to `to` without copying them to userspace.
///
/// One end must be a pipe; this is the kernel's constraint, not ours, and it is
/// why each relay direction owns a pipe pair. `SPLICE_F_MOVE` asks the kernel to
/// move page references rather than copy, and `SPLICE_F_NONBLOCK` makes the call
/// non-blocking regardless of the descriptors' own flags.
pub fn splice(from: BorrowedFd<'_>, to: BorrowedFd<'_>, len: usize) -> io::Result<Splice> {
    // SAFETY: both offset pointers are null, which tells splice to use each
    // descriptor's own file position - the only correct choice for sockets and
    // pipes, neither of which is seekable.
    let moved = unsafe {
        libc::splice(
            from.as_raw_fd(),
            std::ptr::null_mut(),
            to.as_raw_fd(),
            std::ptr::null_mut(),
            len,
            SPLICE_F_MOVE | SPLICE_F_NONBLOCK,
        )
    };
    if moved < 0 {
        let error = io::Error::last_os_error();
        if is_would_block(&error) {
            return Ok(Splice::WouldBlock);
        }
        return Err(error);
    }
    if moved == 0 {
        return Ok(Splice::Eof);
    }
    let moved = cvt_ssize(moved)?;
    Ok(Splice::Moved(usize::try_from(moved).unwrap_or(0)))
}

// ---------------------------------------------------------------------------
// epoll
// ---------------------------------------------------------------------------

/// Register for readability.
pub const READABLE: u32 = libc::EPOLLIN as u32;
/// Register for writability.
pub const WRITABLE: u32 = libc::EPOLLOUT as u32;
/// Edge-triggered. Every registration in this crate uses it.
pub const EDGE: u32 = libc::EPOLLET as u32;
/// Peer closed its write side.
pub const HANGUP: u32 = libc::EPOLLRDHUP as u32;
/// Error, always reported whether requested or not.
pub const ERROR: u32 = libc::EPOLLERR as u32;
/// Hangup, always reported whether requested or not.
pub const CLOSED: u32 = libc::EPOLLHUP as u32;

/// An epoll instance.
#[derive(Debug)]
pub struct Epoll {
    fd: OwnedFd,
}

impl Epoll {
    /// Create an epoll instance.
    pub fn new() -> io::Result<Self> {
        // SAFETY: epoll_create1 with a constant flag; the result is checked.
        let fd = unsafe { cvt(libc::epoll_create1(libc::EPOLL_CLOEXEC))? };
        // SAFETY: epoll_create1 returned a fresh descriptor nothing else owns.
        Ok(Self {
            fd: unsafe { own(fd) },
        })
    }

    fn ctl(&self, op: libc::c_int, fd: RawFd, events: u32, token: u64) -> io::Result<()> {
        let mut event = libc::epoll_event { events, u64: token };
        // SAFETY: `event` is a fully initialised `epoll_event` living for the
        // duration of the call.
        unsafe {
            cvt(libc::epoll_ctl(
                self.fd.as_raw_fd(),
                op,
                fd,
                std::ptr::addr_of_mut!(event),
            ))?;
        }
        Ok(())
    }

    /// Start watching `fd`.
    pub fn add(&self, fd: BorrowedFd<'_>, events: u32, token: u64) -> io::Result<()> {
        self.ctl(libc::EPOLL_CTL_ADD, fd.as_raw_fd(), events, token)
    }

    /// Change what we are watching `fd` for.
    pub fn modify(&self, fd: BorrowedFd<'_>, events: u32, token: u64) -> io::Result<()> {
        self.ctl(libc::EPOLL_CTL_MOD, fd.as_raw_fd(), events, token)
    }

    /// Stop watching `fd`. Closing it would do this too; being explicit keeps
    /// the interest list from briefly disagreeing with reality.
    pub fn delete(&self, fd: BorrowedFd<'_>) -> io::Result<()> {
        // SAFETY: `epoll_ctl(EPOLL_CTL_DEL)` ignores its event argument on
        // kernels after 2.6.9, but passing a valid pointer is still correct.
        let mut event = libc::epoll_event { events: 0, u64: 0 };
        unsafe {
            cvt(libc::epoll_ctl(
                self.fd.as_raw_fd(),
                libc::EPOLL_CTL_DEL,
                fd.as_raw_fd(),
                std::ptr::addr_of_mut!(event),
            ))?;
        }
        Ok(())
    }

    /// Wait for events. Returns how many entries of `events` were filled.
    ///
    /// `EINTR` becomes `Ok(0)` so a signal simply ends the current wait and the
    /// caller loops round to check its shutdown and reload flags.
    pub fn wait(
        &self,
        events: &mut [libc::epoll_event],
        timeout_ms: libc::c_int,
    ) -> io::Result<usize> {
        let capacity = libc::c_int::try_from(events.len()).unwrap_or(libc::c_int::MAX);
        // SAFETY: the pointer and capacity come from the same slice, so the
        // kernel fills at most `events.len()` entries of memory we own.
        let count = unsafe {
            libc::epoll_wait(
                self.fd.as_raw_fd(),
                events.as_mut_ptr(),
                capacity,
                timeout_ms,
            )
        };
        if count < 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EINTR) {
                return Ok(0);
            }
            return Err(error);
        }
        Ok(usize::try_from(count).unwrap_or(0))
    }
}

/// An all-zero event slot, for preallocating the `epoll_wait` buffer.
#[must_use]
pub const fn empty_event() -> libc::epoll_event {
    libc::epoll_event { events: 0, u64: 0 }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/// Interface index, or `None` when the interface does not exist.
///
/// Paired with [`interface_is_up`] this is the "is the exit usable?" test. The
/// deliberately *absent* alternative is `ioctl(SIOCGIFFLAGS)`, which needs the
/// `ifreq` union whose layout differs across `libc` releases; reading
/// `/sys/class/net` instead keeps that fragility out of the unsafe module
/// entirely.
#[must_use]
pub fn interface_index(name: &str) -> Option<u32> {
    let Ok(cname) = CString::new(name) else {
        return None;
    };
    // SAFETY: `cname` is a valid NUL-terminated C string alive for the call.
    let index = unsafe { libc::if_nametoindex(cname.as_ptr()) };
    if index == 0 {
        None
    } else {
        Some(index)
    }
}

/// Is the interface present and administratively up?
///
/// Reads `IFF_UP` out of `/sys/class/net/<if>/flags`. WireGuard interfaces do not
/// set a meaningful `operstate` (it reads `unknown`), so `flags` is the field
/// that actually answers the question.
///
/// A tunnel can be `IFF_UP` with a dead peer, in which case the upstream
/// `connect` simply times out and the flow is closed. Either way the flow never
/// escapes over the WAN, which is the property that matters.
#[must_use]
pub fn interface_is_up(name: &str) -> bool {
    /// `include/uapi/linux/if.h`.
    const IFF_UP: u64 = 0x1;

    if interface_index(name).is_none() {
        return false;
    }
    let path = format!("/sys/class/net/{name}/flags");
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    let trimmed = text.trim();
    let digits = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    u64::from_str_radix(digits, 16).is_ok_and(|flags| flags & IFF_UP != 0)
}

// ---------------------------------------------------------------------------
// Process and signals
// ---------------------------------------------------------------------------

/// Online CPU count, floored at 1.
#[must_use]
pub fn nproc() -> usize {
    // SAFETY: sysconf with a constant name has no pointer arguments.
    let count = unsafe { libc::sysconf(libc::_SC_NPROCESSORS_ONLN) };
    usize::try_from(count).unwrap_or(1).max(1)
}

/// Raise `RLIMIT_NOFILE` towards the hard limit. Returns the effective soft limit.
///
/// Each flow costs two sockets plus two pipes, i.e. six descriptors, so the flow
/// cap is meaningless if the descriptor limit is lower than it implies.
pub fn raise_nofile(target: u64) -> io::Result<u64> {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: `limit` is an initialised `rlimit` the kernel fills in.
    unsafe {
        cvt(libc::getrlimit(
            libc::RLIMIT_NOFILE,
            std::ptr::addr_of_mut!(limit),
        ))?;
    }
    let wanted = target.min(limit.rlim_max);
    if wanted > limit.rlim_cur {
        let updated = libc::rlimit {
            rlim_cur: wanted,
            rlim_max: limit.rlim_max,
        };
        // SAFETY: `updated` is a fully initialised `rlimit`.
        unsafe {
            cvt(libc::setrlimit(
                libc::RLIMIT_NOFILE,
                std::ptr::addr_of!(updated),
            ))?;
        }
        return Ok(wanted);
    }
    Ok(limit.rlim_cur)
}

/// Block `signals` in the calling thread, and therefore in every thread it goes
/// on to spawn.
///
/// This is called before any worker starts, so the whole process has the set
/// blocked and exactly one dedicated thread collects them with [`wait_signal`].
/// That avoids async-signal-safety entirely: no handler runs, nothing has to be
/// reentrant, and reload/stats work happens on an ordinary thread.
pub fn block_signals(signals: &[libc::c_int]) -> io::Result<()> {
    let mut set = new_sigset();
    // SAFETY: `set` is an initialised `sigset_t` that sigemptyset overwrites.
    unsafe {
        cvt(libc::sigemptyset(std::ptr::addr_of_mut!(set)))?;
        for signal in signals {
            cvt(libc::sigaddset(std::ptr::addr_of_mut!(set), *signal))?;
        }
        let result = libc::pthread_sigmask(
            libc::SIG_BLOCK,
            std::ptr::addr_of!(set),
            std::ptr::null_mut(),
        );
        if result != 0 {
            return Err(io::Error::from_raw_os_error(result));
        }
    }
    Ok(())
}

/// Block until one of `signals` arrives, and return which.
pub fn wait_signal(signals: &[libc::c_int]) -> io::Result<libc::c_int> {
    let mut set = new_sigset();
    let mut caught: libc::c_int = 0;
    // SAFETY: `set` and `caught` are initialised locals; sigwait writes the
    // signal number into `caught` and reads the set.
    unsafe {
        cvt(libc::sigemptyset(std::ptr::addr_of_mut!(set)))?;
        for signal in signals {
            cvt(libc::sigaddset(std::ptr::addr_of_mut!(set), *signal))?;
        }
        let result = libc::sigwait(std::ptr::addr_of!(set), std::ptr::addr_of_mut!(caught));
        if result != 0 {
            return Err(io::Error::from_raw_os_error(result));
        }
    }
    Ok(caught)
}

/// A zeroed `sigset_t`.
///
/// `sigset_t` is an opaque array of words on both glibc and musl, so zeroing it
/// is well defined; `sigemptyset` then initialises it properly before use.
fn new_sigset() -> libc::sigset_t {
    // SAFETY: `sigset_t` is a plain array of integers on Linux, for which the
    // all-zero bit pattern is valid. It is passed to `sigemptyset` before any
    // read, so even a hypothetical padding concern never materialises.
    unsafe { std::mem::zeroed() }
}

/// Send a signal to our own process.
///
/// Used to wake the `sigwait` thread when some other thread decides the process
/// should stop - it is blocked in `sigwait`, so a flag alone would not reach it
/// until the next signal arrived from outside.
pub fn signal_self(signal: libc::c_int) -> io::Result<()> {
    // SAFETY: both calls take integers only and have no pointer arguments.
    unsafe {
        let pid = libc::getpid();
        cvt(libc::kill(pid, signal))?;
    }
    Ok(())
}

/// Seconds since the Unix epoch, or 0 if the clock is before it.
#[must_use]
pub fn epoch_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

/// Convenience so callers can write `fd.as_fd_ref()` on an `OwnedFd`.
trait AsFdRef {
    fn as_fd_ref(&self) -> BorrowedFd<'_>;
}

impl AsFdRef for OwnedFd {
    fn as_fd_ref(&self) -> BorrowedFd<'_> {
        use std::os::fd::AsFd as _;
        self.as_fd()
    }
}
