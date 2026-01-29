/**
 * WASI Preview 1 Implementation
 *
 * A non-sandboxed, spec-accurate WASI implementation for TypeScript/Bun.
 * Preopens "/" (Unix) or all drive letters (Windows) for full filesystem access.
 *
 * Reference: https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as tty from "node:tty";

// =============================================================================
// WASI Error Codes (errno)
// https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md#-errno-variant
// =============================================================================

export const enum Errno {
	/** No error occurred. System call completed successfully. */
	SUCCESS = 0,
	/** Argument list too long. */
	E2BIG = 1,
	/** Permission denied. */
	EACCES = 2,
	/** Address in use. */
	EADDRINUSE = 3,
	/** Address not available. */
	EADDRNOTAVAIL = 4,
	/** Address family not supported. */
	EAFNOSUPPORT = 5,
	/** Resource unavailable, or operation would block. */
	EAGAIN = 6,
	/** Connection already in progress. */
	EALREADY = 7,
	/** Bad file descriptor. */
	EBADF = 8,
	/** Bad message. */
	EBADMSG = 9,
	/** Device or resource busy. */
	EBUSY = 10,
	/** Operation canceled. */
	ECANCELED = 11,
	/** No child processes. */
	ECHILD = 12,
	/** Connection aborted. */
	ECONNABORTED = 13,
	/** Connection refused. */
	ECONNREFUSED = 14,
	/** Connection reset. */
	ECONNRESET = 15,
	/** Resource deadlock would occur. */
	EDEADLK = 16,
	/** Destination address required. */
	EDESTADDRREQ = 17,
	/** Mathematics argument out of domain of function. */
	EDOM = 18,
	/** Reserved. */
	EDQUOT = 19,
	/** File exists. */
	EEXIST = 20,
	/** Bad address. */
	EFAULT = 21,
	/** File too large. */
	EFBIG = 22,
	/** Host is unreachable. */
	EHOSTUNREACH = 23,
	/** Identifier removed. */
	EIDRM = 24,
	/** Illegal byte sequence. */
	EILSEQ = 25,
	/** Operation in progress. */
	EINPROGRESS = 26,
	/** Interrupted function. */
	EINTR = 27,
	/** Invalid argument. */
	EINVAL = 28,
	/** I/O error. */
	EIO = 29,
	/** Socket is connected. */
	EISCONN = 30,
	/** Is a directory. */
	EISDIR = 31,
	/** Too many levels of symbolic links. */
	ELOOP = 32,
	/** File descriptor value too large. */
	EMFILE = 33,
	/** Too many links. */
	EMLINK = 34,
	/** Message too large. */
	EMSGSIZE = 35,
	/** Reserved. */
	EMULTIHOP = 36,
	/** Filename too long. */
	ENAMETOOLONG = 37,
	/** Network is down. */
	ENETDOWN = 38,
	/** Connection aborted by network. */
	ENETRESET = 39,
	/** Network unreachable. */
	ENETUNREACH = 40,
	/** Too many files open in system. */
	ENFILE = 41,
	/** No buffer space available. */
	ENOBUFS = 42,
	/** No such device. */
	ENODEV = 43,
	/** No such file or directory. */
	ENOENT = 44,
	/** Executable file format error. */
	ENOEXEC = 45,
	/** No locks available. */
	ENOLCK = 46,
	/** Reserved. */
	ENOLINK = 47,
	/** Not enough space. */
	ENOMEM = 48,
	/** No message of the desired type. */
	ENOMSG = 49,
	/** Protocol not available. */
	ENOPROTOOPT = 50,
	/** No space left on device. */
	ENOSPC = 51,
	/** Function not supported. */
	ENOSYS = 52,
	/** The socket is not connected. */
	ENOTCONN = 53,
	/** Not a directory or a symbolic link to a directory. */
	ENOTDIR = 54,
	/** Directory not empty. */
	ENOTEMPTY = 55,
	/** State not recoverable. */
	ENOTRECOVERABLE = 56,
	/** Not a socket. */
	ENOTSOCK = 57,
	/** Not supported, or operation not supported on socket. */
	ENOTSUP = 58,
	/** Inappropriate I/O control operation. */
	ENOTTY = 59,
	/** No such device or address. */
	ENXIO = 60,
	/** Value too large to be stored in data type. */
	EOVERFLOW = 61,
	/** Previous owner died. */
	EOWNERDEAD = 62,
	/** Operation not permitted. */
	EPERM = 63,
	/** Broken pipe. */
	EPIPE = 64,
	/** Protocol error. */
	EPROTO = 65,
	/** Protocol not supported. */
	EPROTONOSUPPORT = 66,
	/** Protocol wrong type for socket. */
	EPROTOTYPE = 67,
	/** Result too large. */
	ERANGE = 68,
	/** Read-only file system. */
	EROFS = 69,
	/** Invalid seek. */
	ESPIPE = 70,
	/** No such process. */
	ESRCH = 71,
	/** Reserved. */
	ESTALE = 72,
	/** Connection timed out. */
	ETIMEDOUT = 73,
	/** Text file busy. */
	ETXTBSY = 74,
	/** Cross-device link. */
	EXDEV = 75,
	/** Extension: Capabilities insufficient. */
	ENOTCAPABLE = 76,
}

/** Map Node.js error codes to WASI errno */
const NODE_ERROR_MAP: Record<string, Errno> = {
	E2BIG: Errno.E2BIG,
	EACCES: Errno.EACCES,
	EADDRINUSE: Errno.EADDRINUSE,
	EADDRNOTAVAIL: Errno.EADDRNOTAVAIL,
	EAFNOSUPPORT: Errno.EAFNOSUPPORT,
	EAGAIN: Errno.EAGAIN,
	EALREADY: Errno.EALREADY,
	EBADF: Errno.EBADF,
	EBADMSG: Errno.EBADMSG,
	EBUSY: Errno.EBUSY,
	ECANCELED: Errno.ECANCELED,
	ECHILD: Errno.ECHILD,
	ECONNABORTED: Errno.ECONNABORTED,
	ECONNREFUSED: Errno.ECONNREFUSED,
	ECONNRESET: Errno.ECONNRESET,
	EDEADLK: Errno.EDEADLK,
	EDEADLOCK: Errno.EDEADLK,
	EDESTADDRREQ: Errno.EDESTADDRREQ,
	EDOM: Errno.EDOM,
	EDQUOT: Errno.EDQUOT,
	EEXIST: Errno.EEXIST,
	EFAULT: Errno.EFAULT,
	EFBIG: Errno.EFBIG,
	EHOSTDOWN: Errno.EHOSTUNREACH,
	EHOSTUNREACH: Errno.EHOSTUNREACH,
	EIDRM: Errno.EIDRM,
	EILSEQ: Errno.EILSEQ,
	EINPROGRESS: Errno.EINPROGRESS,
	EINTR: Errno.EINTR,
	EINVAL: Errno.EINVAL,
	EIO: Errno.EIO,
	EISCONN: Errno.EISCONN,
	EISDIR: Errno.EISDIR,
	ELOOP: Errno.ELOOP,
	EMFILE: Errno.EMFILE,
	EMLINK: Errno.EMLINK,
	EMSGSIZE: Errno.EMSGSIZE,
	EMULTIHOP: Errno.EMULTIHOP,
	ENAMETOOLONG: Errno.ENAMETOOLONG,
	ENETDOWN: Errno.ENETDOWN,
	ENETRESET: Errno.ENETRESET,
	ENETUNREACH: Errno.ENETUNREACH,
	ENFILE: Errno.ENFILE,
	ENOBUFS: Errno.ENOBUFS,
	ENODEV: Errno.ENODEV,
	ENOENT: Errno.ENOENT,
	ENOEXEC: Errno.ENOEXEC,
	ENOLCK: Errno.ENOLCK,
	ENOLINK: Errno.ENOLINK,
	ENOMEM: Errno.ENOMEM,
	ENOMSG: Errno.ENOMSG,
	ENOPROTOOPT: Errno.ENOPROTOOPT,
	ENOSPC: Errno.ENOSPC,
	ENOSYS: Errno.ENOSYS,
	ENOTCONN: Errno.ENOTCONN,
	ENOTDIR: Errno.ENOTDIR,
	ENOTEMPTY: Errno.ENOTEMPTY,
	ENOTRECOVERABLE: Errno.ENOTRECOVERABLE,
	ENOTSOCK: Errno.ENOTSOCK,
	ENOTSUP: Errno.ENOTSUP,
	ENOTTY: Errno.ENOTTY,
	ENXIO: Errno.ENXIO,
	EOPNOTSUPP: Errno.ENOTSUP,
	EOVERFLOW: Errno.EOVERFLOW,
	EOWNERDEAD: Errno.EOWNERDEAD,
	EPERM: Errno.EPERM,
	EPIPE: Errno.EPIPE,
	EPROTO: Errno.EPROTO,
	EPROTONOSUPPORT: Errno.EPROTONOSUPPORT,
	EPROTOTYPE: Errno.EPROTOTYPE,
	ERANGE: Errno.ERANGE,
	EROFS: Errno.EROFS,
	ESPIPE: Errno.ESPIPE,
	ESRCH: Errno.ESRCH,
	ESTALE: Errno.ESTALE,
	ETIMEDOUT: Errno.ETIMEDOUT,
	ETXTBSY: Errno.ETXTBSY,
	EWOULDBLOCK: Errno.EAGAIN,
	EXDEV: Errno.EXDEV,
};

const INVERSE_ERROR_MAP: string[] = [];
for (const [key, value] of Object.entries(NODE_ERROR_MAP)) {
	INVERSE_ERROR_MAP[value as number] = key;
}

function getErrnoName(errno: Errno): string {
	if (errno < 0 || errno > INVERSE_ERROR_MAP.length) {
		return "UNKNOWN";
	}
	return INVERSE_ERROR_MAP[errno];
}

// =============================================================================
// WASI Clock IDs
// =============================================================================

export const enum ClockId {
	/** Wall clock time. */
	REALTIME = 0,
	/** Monotonic clock for measuring elapsed time. */
	MONOTONIC = 1,
	/** CPU-time clock for the current process. */
	PROCESS_CPUTIME_ID = 2,
	/** CPU-time clock for the current thread. */
	THREAD_CPUTIME_ID = 3,
}

// =============================================================================
// WASI File Types
// =============================================================================

export const enum FileType {
	/** The type of the file descriptor is unknown. */
	UNKNOWN = 0,
	/** The file descriptor refers to a block device. */
	BLOCK_DEVICE = 1,
	/** The file descriptor refers to a character device. */
	CHARACTER_DEVICE = 2,
	/** The file descriptor refers to a directory. */
	DIRECTORY = 3,
	/** The file descriptor refers to a regular file. */
	REGULAR_FILE = 4,
	/** The file descriptor refers to a datagram socket. */
	SOCKET_DGRAM = 5,
	/** The file descriptor refers to a stream socket. */
	SOCKET_STREAM = 6,
	/** The file descriptor refers to a symbolic link. */
	SYMBOLIC_LINK = 7,
}

// =============================================================================
// WASI FD Flags
// =============================================================================

export const enum FdFlags {
	/** Append mode: Data written to the file is always appended. */
	APPEND = 1 << 0,
	/** Write according to synchronized I/O data integrity completion. */
	DSYNC = 1 << 1,
	/** Non-blocking mode. */
	NONBLOCK = 1 << 2,
	/** Synchronized read I/O operations. */
	RSYNC = 1 << 3,
	/** Write according to synchronized I/O file integrity completion. */
	SYNC = 1 << 4,
}

// =============================================================================
// WASI Rights
// =============================================================================

export const Rights = {
	FD_DATASYNC: 1n << 0n,
	FD_READ: 1n << 1n,
	FD_SEEK: 1n << 2n,
	FD_FDSTAT_SET_FLAGS: 1n << 3n,
	FD_SYNC: 1n << 4n,
	FD_TELL: 1n << 5n,
	FD_WRITE: 1n << 6n,
	FD_ADVISE: 1n << 7n,
	FD_ALLOCATE: 1n << 8n,
	PATH_CREATE_DIRECTORY: 1n << 9n,
	PATH_CREATE_FILE: 1n << 10n,
	PATH_LINK_SOURCE: 1n << 11n,
	PATH_LINK_TARGET: 1n << 12n,
	PATH_OPEN: 1n << 13n,
	FD_READDIR: 1n << 14n,
	PATH_READLINK: 1n << 15n,
	PATH_RENAME_SOURCE: 1n << 16n,
	PATH_RENAME_TARGET: 1n << 17n,
	PATH_FILESTAT_GET: 1n << 18n,
	PATH_FILESTAT_SET_SIZE: 1n << 19n,
	PATH_FILESTAT_SET_TIMES: 1n << 20n,
	FD_FILESTAT_GET: 1n << 21n,
	FD_FILESTAT_SET_SIZE: 1n << 22n,
	FD_FILESTAT_SET_TIMES: 1n << 23n,
	PATH_SYMLINK: 1n << 24n,
	PATH_REMOVE_DIRECTORY: 1n << 25n,
	PATH_UNLINK_FILE: 1n << 26n,
	POLL_FD_READWRITE: 1n << 27n,
	SOCK_SHUTDOWN: 1n << 28n,
	SOCK_ACCEPT: 1n << 29n,
} as const;

/** All rights combined */
const RIGHTS_ALL = Object.values(Rights).reduce((a, b) => a | b, 0n);

/** Rights for regular files */
const RIGHTS_FILE_BASE =
	Rights.FD_DATASYNC |
	Rights.FD_READ |
	Rights.FD_SEEK |
	Rights.FD_FDSTAT_SET_FLAGS |
	Rights.FD_SYNC |
	Rights.FD_TELL |
	Rights.FD_WRITE |
	Rights.FD_ADVISE |
	Rights.FD_ALLOCATE |
	Rights.FD_FILESTAT_GET |
	Rights.FD_FILESTAT_SET_SIZE |
	Rights.FD_FILESTAT_SET_TIMES |
	Rights.POLL_FD_READWRITE;

/** Rights for directories */
const RIGHTS_DIRECTORY_BASE =
	Rights.FD_FDSTAT_SET_FLAGS |
	Rights.FD_SYNC |
	Rights.FD_ADVISE |
	Rights.PATH_CREATE_DIRECTORY |
	Rights.PATH_CREATE_FILE |
	Rights.PATH_LINK_SOURCE |
	Rights.PATH_LINK_TARGET |
	Rights.PATH_OPEN |
	Rights.FD_READDIR |
	Rights.PATH_READLINK |
	Rights.PATH_RENAME_SOURCE |
	Rights.PATH_RENAME_TARGET |
	Rights.PATH_FILESTAT_GET |
	Rights.PATH_FILESTAT_SET_SIZE |
	Rights.PATH_FILESTAT_SET_TIMES |
	Rights.FD_FILESTAT_GET |
	Rights.FD_FILESTAT_SET_TIMES |
	Rights.PATH_SYMLINK |
	Rights.PATH_REMOVE_DIRECTORY |
	Rights.PATH_UNLINK_FILE |
	Rights.POLL_FD_READWRITE;

const RIGHTS_DIRECTORY_INHERITING = RIGHTS_DIRECTORY_BASE | RIGHTS_FILE_BASE;

/** Rights for TTY/character devices */
const RIGHTS_TTY =
	Rights.FD_READ | Rights.FD_FDSTAT_SET_FLAGS | Rights.FD_WRITE | Rights.FD_FILESTAT_GET | Rights.POLL_FD_READWRITE;

// =============================================================================
// WASI Open Flags (oflags)
// =============================================================================

export const enum OFlags {
	/** Create file if it does not exist. */
	CREAT = 1 << 0,
	/** Fail if not a directory. */
	DIRECTORY = 1 << 1,
	/** Fail if file already exists. */
	EXCL = 1 << 2,
	/** Truncate file to size 0. */
	TRUNC = 1 << 3,
}

// =============================================================================
// WASI Lookup Flags
// =============================================================================

export const enum LookupFlags {
	/** Follow symlinks. */
	SYMLINK_FOLLOW = 1 << 0,
}

// =============================================================================
// WASI Whence (for seek)
// =============================================================================

export const enum Whence {
	/** Seek relative to start of file. */
	SET = 0,
	/** Seek relative to current position. */
	CUR = 1,
	/** Seek relative to end of file. */
	END = 2,
}

// =============================================================================
// WASI Filestat Set Flags (fstflags)
// =============================================================================

export const enum FstFlags {
	/** Adjust the last data access timestamp to the provided value. */
	ATIM = 1 << 0,
	/** Adjust the last data access timestamp to the current time. */
	ATIM_NOW = 1 << 1,
	/** Adjust the last data modification timestamp to the provided value. */
	MTIM = 1 << 2,
	/** Adjust the last data modification timestamp to the current time. */
	MTIM_NOW = 1 << 3,
}

// =============================================================================
// WASI Event Types (for poll_oneoff)
// =============================================================================

export const enum EventType {
	/** Clock event. */
	CLOCK = 0,
	/** File descriptor read event. */
	FD_READ = 1,
	/** File descriptor write event. */
	FD_WRITE = 2,
}

// =============================================================================
// WASI Subscription Clock Flags
// =============================================================================

export const enum SubClockFlags {
	/** Clock is absolute (vs relative). */
	ABSTIME = 1 << 0,
}

// =============================================================================
// WASI Signals
// =============================================================================

export const enum Signal {
	NONE = 0,
	HUP = 1,
	INT = 2,
	QUIT = 3,
	ILL = 4,
	TRAP = 5,
	ABRT = 6,
	BUS = 7,
	FPE = 8,
	KILL = 9,
	USR1 = 10,
	SEGV = 11,
	USR2 = 12,
	PIPE = 13,
	ALRM = 14,
	TERM = 15,
	CHLD = 16,
	CONT = 17,
	STOP = 18,
	TSTP = 19,
	TTIN = 20,
	TTOU = 21,
	URG = 22,
	XCPU = 23,
	XFSZ = 24,
	VTALRM = 25,
	PROF = 26,
	WINCH = 27,
	POLL = 28,
	PWR = 29,
	SYS = 30,
}

const SIGNAL_MAP: Record<number, NodeJS.Signals> = {
	[Signal.HUP]: "SIGHUP",
	[Signal.INT]: "SIGINT",
	[Signal.QUIT]: "SIGQUIT",
	[Signal.ILL]: "SIGILL",
	[Signal.TRAP]: "SIGTRAP",
	[Signal.ABRT]: "SIGABRT",
	[Signal.BUS]: "SIGBUS",
	[Signal.FPE]: "SIGFPE",
	[Signal.KILL]: "SIGKILL",
	[Signal.USR1]: "SIGUSR1",
	[Signal.SEGV]: "SIGSEGV",
	[Signal.USR2]: "SIGUSR2",
	[Signal.PIPE]: "SIGPIPE",
	[Signal.ALRM]: "SIGALRM",
	[Signal.TERM]: "SIGTERM",
	[Signal.CHLD]: "SIGCHLD",
	[Signal.CONT]: "SIGCONT",
	[Signal.STOP]: "SIGSTOP",
	[Signal.TSTP]: "SIGTSTP",
	[Signal.TTIN]: "SIGTTIN",
	[Signal.TTOU]: "SIGTTOU",
	[Signal.URG]: "SIGURG",
	[Signal.XCPU]: "SIGXCPU",
	[Signal.XFSZ]: "SIGXFSZ",
	[Signal.VTALRM]: "SIGVTALRM",
};

// =============================================================================
// WASI Preopentype
// =============================================================================

export const enum PreopenType {
	/** A pre-opened directory. */
	DIR = 0,
}

// =============================================================================
// WASI Advice (for fd_advise)
// =============================================================================

export const enum Advice {
	NORMAL = 0,
	SEQUENTIAL = 1,
	RANDOM = 2,
	WILLNEED = 3,
	DONTNEED = 4,
	NOREUSE = 5,
}

// =============================================================================
// Custom Error Classes
// =============================================================================

export class WASIError extends Error {
	constructor(public errno: Errno) {
		super(`WASI error: ${getErrnoName(errno)} (${errno})`);
		this.name = "WASIError";
	}
}

export class WASIExitError extends Error {
	constructor(public code: number) {
		super(`WASI exit: ${code}`);
		this.name = "WASIExitError";
	}
}

// =============================================================================
// File Descriptor Entry
// =============================================================================

interface FdEntry {
	/** The real OS file descriptor or handle */
	fd: number;
	/** WASI file type */
	fileType: FileType;
	/** Base rights */
	rightsBase: bigint;
	/** Inheriting rights */
	rightsInheriting: bigint;
	/** Current file offset (for regular files) */
	offset?: bigint;
	/** Path on the real filesystem (for preopens/opened paths) */
	realPath?: string;
	/** Virtual path (for preopens) */
	preopenPath?: string;
	/** FD flags */
	fdFlags: number;
}

// =============================================================================
// WASI Configuration
// =============================================================================

export interface WASIOptions {
	/** Command-line arguments */
	args?: string[];
	/** Environment variables */
	env?: Record<string, string>;
	/** Preopened directories: map of virtual path -> real path */
	preopens?: Record<string, string>;
}

// =============================================================================
// Utility Functions
// =============================================================================

/** Convert milliseconds to nanoseconds (as bigint) */
function msToNs(ms: number): bigint {
	return BigInt(Math.trunc(ms * 1_000_000));
}

/** Convert nanoseconds to milliseconds */
function nsToMs(ns: bigint): number {
	return Number(ns / 1_000_000n);
}

/** Get current time in nanoseconds for a given clock */
function clockTimeNs(clockId: ClockId): bigint | null {
	switch (clockId) {
		case ClockId.REALTIME:
			return msToNs(Date.now());
		case ClockId.MONOTONIC:
			return process.hrtime.bigint();
		case ClockId.PROCESS_CPUTIME_ID:
		case ClockId.THREAD_CPUTIME_ID:
			// Use hrtime as approximation for CPU time
			return process.hrtime.bigint();
		default:
			return null;
	}
}

/** Convert Node.js fs.Stats to WASI FileType */
function statsToFileType(stats: fs.Stats): FileType {
	if (stats.isFile()) return FileType.REGULAR_FILE;
	if (stats.isDirectory()) return FileType.DIRECTORY;
	if (stats.isSymbolicLink()) return FileType.SYMBOLIC_LINK;
	if (stats.isCharacterDevice()) return FileType.CHARACTER_DEVICE;
	if (stats.isBlockDevice()) return FileType.BLOCK_DEVICE;
	if (stats.isFIFO()) return FileType.SOCKET_STREAM;
	if (stats.isSocket()) return FileType.SOCKET_STREAM;
	return FileType.UNKNOWN;
}

/** Get rights for a file type */
function rightsForFileType(fileType: FileType, isTTY: boolean): { base: bigint; inheriting: bigint } {
	switch (fileType) {
		case FileType.REGULAR_FILE:
			return { base: RIGHTS_FILE_BASE, inheriting: 0n };
		case FileType.DIRECTORY:
			return { base: RIGHTS_DIRECTORY_BASE, inheriting: RIGHTS_DIRECTORY_INHERITING };
		case FileType.CHARACTER_DEVICE:
			if (isTTY) {
				return { base: RIGHTS_TTY, inheriting: 0n };
			}
			return { base: RIGHTS_ALL, inheriting: RIGHTS_ALL };
		case FileType.BLOCK_DEVICE:
			return { base: RIGHTS_ALL, inheriting: RIGHTS_ALL };
		case FileType.SOCKET_STREAM:
		case FileType.SOCKET_DGRAM:
			return { base: RIGHTS_ALL, inheriting: RIGHTS_ALL };
		default:
			return { base: RIGHTS_ALL, inheriting: RIGHTS_ALL };
	}
}

/** Wrap a syscall function to catch errors and return errno */
function wrap<T extends (...args: any[]) => number>(fn: T): T {
	return ((...args: Parameters<T>): number => {
		try {
			return fn(...args);
		} catch (err: any) {
			if (err instanceof WASIError) {
				return err.errno;
			}
			if (err instanceof WASIExitError) {
				throw err;
			}
			// Map Node.js errors
			let e = err;
			while (e?.cause) e = e.cause;
			if (e?.code && typeof e.code === "string" && e.code in NODE_ERROR_MAP) {
				return NODE_ERROR_MAP[e.code];
			}
			console.error("WASI unexpected error:", err);
			return Errno.EIO;
		}
	}) as T;
}

/** Read a null-terminated string from memory */
function readString(memory: DataView, ptr: number, len: number): string {
	const bytes = new Uint8Array(memory.buffer, ptr, len);
	return new TextDecoder().decode(bytes);
}

/** Write a string to memory */
function writeString(memory: DataView, ptr: number, str: string): number {
	const bytes = new TextEncoder().encode(str);
	new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
	return bytes.length;
}

// =============================================================================
// WASI Class
// =============================================================================

const FD_INIT = [
	{ fd: 0, fileType: FileType.CHARACTER_DEVICE, rightsBase: RIGHTS_TTY, rightsInheriting: 0n, fdFlags: 0 },
	{ fd: 1, fileType: FileType.CHARACTER_DEVICE, rightsBase: RIGHTS_TTY, rightsInheriting: 0n, fdFlags: 0 },
	{ fd: 2, fileType: FileType.CHARACTER_DEVICE, rightsBase: RIGHTS_TTY, rightsInheriting: 0n, fdFlags: 0 },
];

export class WASI1 {
	#memory!: WebAssembly.Memory; /** WebAssembly memory */
	#args: string[]; /** Program arguments */
	#env: Record<string, string>; /** Environment variables */
	#fds = new Map<number, FdEntry>(); /** Map of WASI fd -> FdEntry */
	#nextFd = 3; /** Next free WASI fd */
	#wasiImport: ReturnType<WASI1["buildImports"]>; /** WASI imports object */

	constructor(options: WASIOptions = {}) {
		this.#args = options.args ?? [];
		this.#env = options.env ?? {};

		// Initialize stdin/stdout/stderr
		for (let i = 0; i < FD_INIT.length; i++) {
			this.#fds.set(FD_INIT[i].fd, FD_INIT[i]);
		}

		// Set up preopens
		const preopens = options.preopens ?? this.getDefaultPreopens();
		for (const [virtualPath, realPath] of Object.entries(preopens)) {
			this.addPreopen(virtualPath, realPath);
		}

		// Build the WASI imports
		this.#wasiImport = this.buildImports();
	}

	/** Get default preopens based on platform */
	private getDefaultPreopens(): Record<string, string> {
		if (os.platform() === "win32") {
			// On Windows, preopen all available drive letters
			const preopens: Record<string, string> = {};
			for (let i = 65; i <= 90; i++) {
				// A-Z
				const letter = String.fromCharCode(i);
				const drivePath = `${letter}:\\`;
				try {
					fs.accessSync(drivePath);
					preopens[`/${letter.toLowerCase()}`] = drivePath;
				} catch {
					// Drive doesn't exist, skip
				}
			}
			return preopens;
		} else {
			// On Unix, preopen root
			return { "/": "/" };
		}
	}

	/** Add a preopen directory */
	private addPreopen(virtualPath: string, realPath: string): void {
		try {
			const fd = fs.openSync(realPath, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
			const wasiFd = this.#nextFd++;
			this.#fds.set(wasiFd, {
				fd,
				fileType: FileType.DIRECTORY,
				rightsBase: RIGHTS_DIRECTORY_BASE,
				rightsInheriting: RIGHTS_DIRECTORY_INHERITING,
				realPath,
				preopenPath: virtualPath,
				fdFlags: 0,
			});
		} catch (err) {
			console.warn(`Failed to preopen ${virtualPath} -> ${realPath}:`, err);
		}
	}

	#view() {
		return new DataView(this.#memory.buffer);
	}

	#mem(ptr: number, len: number) {
		return new Uint8Array(this.#memory.buffer, ptr, len);
	}

	/** Get an FD entry, throwing if invalid */
	private getFd(fd: number): FdEntry {
		const entry = this.#fds.get(fd);
		if (!entry) {
			throw new WASIError(Errno.EBADF);
		}
		return entry;
	}

	/** Check rights on an FD */
	private checkRights(fd: number, rights: bigint): FdEntry {
		const entry = this.getFd(fd);
		if ((entry.rightsBase & rights) !== rights) {
			throw new WASIError(Errno.ENOTCAPABLE);
		}
		return entry;
	}

	/** Allocate a new WASI fd */
	private allocateFd(): number {
		return this.#nextFd++;
	}

	/** Read iovecs from memory */
	private readIovecs(iovsPtr: number, iovsLen: number): Uint8Array[] {
		const v = this.#view();
		const buffers: Uint8Array[] = [];
		for (let i = 0; i < iovsLen; i++) {
			const ptr = v.getUint32(iovsPtr + i * 8, true);
			const len = v.getUint32(iovsPtr + i * 8 + 4, true);
			buffers.push(this.#mem(ptr, len));
		}
		return buffers;
	}

	/** Resolve a path relative to a directory fd */
	private resolvePath(dirFd: number, pathPtr: number, pathLen: number): string {
		const entry = this.getFd(dirFd);
		if (entry.fileType !== FileType.DIRECTORY) {
			throw new WASIError(Errno.ENOTDIR);
		}
		const relativePath = readString(this.#view(), pathPtr, pathLen);
		if (!entry.realPath) {
			throw new WASIError(Errno.EINVAL);
		}
		return path.resolve(entry.realPath, relativePath);
	}

	/** Build all WASI imports */
	private buildImports() {
		return {
			// =========================================================================
			// Arguments
			// =========================================================================

			args_get: wrap((argvPtr: number, argvBufPtr: number): number => {
				const v = this.#view();
				let bufOffset = argvBufPtr;
				for (let i = 0; i < this.#args.length; i++) {
					v.setUint32(argvPtr + i * 4, bufOffset, true);
					bufOffset += writeString(v, bufOffset, `${this.#args[i]}\0`);
				}
				return Errno.SUCCESS;
			}),

			args_sizes_get: wrap((argcPtr: number, argvBufSizePtr: number): number => {
				const v = this.#view();
				v.setUint32(argcPtr, this.#args.length, true);
				const bufSize = this.#args.reduce((sum, arg) => sum + new TextEncoder().encode(arg).length + 1, 0);
				v.setUint32(argvBufSizePtr, bufSize, true);
				return Errno.SUCCESS;
			}),

			// =========================================================================
			// Environment
			// =========================================================================

			environ_get: wrap((environPtr: number, environBufPtr: number): number => {
				const v = this.#view();
				const entries = Object.entries(this.#env);
				let bufOffset = environBufPtr;
				for (let i = 0; i < entries.length; i++) {
					const [key, value] = entries[i];
					v.setUint32(environPtr + i * 4, bufOffset, true);
					bufOffset += writeString(v, bufOffset, `${key}=${value}\0`);
				}
				return Errno.SUCCESS;
			}),

			environ_sizes_get: wrap((environCountPtr: number, environBufSizePtr: number): number => {
				const v = this.#view();
				const entries = Object.entries(this.#env);
				v.setUint32(environCountPtr, entries.length, true);
				const bufSize = entries.reduce((sum, [k, v]) => sum + new TextEncoder().encode(`${k}=${v}`).length + 1, 0);
				v.setUint32(environBufSizePtr, bufSize, true);
				return Errno.SUCCESS;
			}),

			// =========================================================================
			// Clock
			// =========================================================================

			clock_res_get: wrap((clockId: number, resPtr: number): number => {
				const v = this.#view();
				let res: bigint;
				switch (clockId) {
					case ClockId.REALTIME:
						res = 1_000_000n; // 1ms
						break;
					case ClockId.MONOTONIC:
					case ClockId.PROCESS_CPUTIME_ID:
					case ClockId.THREAD_CPUTIME_ID:
						res = 1n; // 1ns
						break;
					default:
						return Errno.EINVAL;
				}
				v.setBigUint64(resPtr, res, true);
				return Errno.SUCCESS;
			}),

			clock_time_get: wrap((clockId: number, _precision: bigint, timePtr: number): number => {
				const v = this.#view();
				const time = clockTimeNs(clockId);
				if (time === null) {
					return Errno.EINVAL;
				}
				v.setBigUint64(timePtr, time, true);
				return Errno.SUCCESS;
			}),

			// =========================================================================
			// File Descriptor Operations
			// =========================================================================

			fd_advise: wrap((fd: number, _offset: bigint, _len: bigint, _advice: number): number => {
				this.checkRights(fd, Rights.FD_ADVISE);
				// Advisory only, no-op is valid
				return Errno.SUCCESS;
			}),

			fd_allocate: wrap((fd: number, offset: bigint, len: bigint): number => {
				const entry = this.checkRights(fd, Rights.FD_ALLOCATE);
				// Extend file if needed
				const stats = fs.fstatSync(entry.fd);
				const newSize = Number(offset + len);
				if (newSize > stats.size) {
					fs.ftruncateSync(entry.fd, newSize);
				}
				return Errno.SUCCESS;
			}),

			fd_close: wrap((fd: number): number => {
				const entry = this.getFd(fd);
				// Don't close stdin/stdout/stderr
				if (fd > 2) {
					fs.closeSync(entry.fd);
				}
				this.#fds.delete(fd);
				return Errno.SUCCESS;
			}),

			fd_datasync: wrap((fd: number): number => {
				const entry = this.checkRights(fd, Rights.FD_DATASYNC);
				fs.fdatasyncSync(entry.fd);
				return Errno.SUCCESS;
			}),

			fd_fdstat_get: wrap((fd: number, statPtr: number): number => {
				const v = this.#view();
				const entry = this.getFd(fd);

				// fdstat structure:
				// u8 fs_filetype
				// u16 fs_flags
				// u64 fs_rights_base
				// u64 fs_rights_inheriting
				v.setUint8(statPtr, entry.fileType);
				v.setUint16(statPtr + 2, entry.fdFlags, true);
				v.setBigUint64(statPtr + 8, entry.rightsBase, true);
				v.setBigUint64(statPtr + 16, entry.rightsInheriting, true);
				return Errno.SUCCESS;
			}),

			fd_fdstat_set_flags: wrap((fd: number, flags: number): number => {
				const entry = this.checkRights(fd, Rights.FD_FDSTAT_SET_FLAGS);
				entry.fdFlags = flags;
				// Note: Most flags don't have direct OS equivalents in sync I/O
				return Errno.SUCCESS;
			}),

			fd_fdstat_set_rights: wrap((fd: number, rightsBase: bigint, rightsInheriting: bigint): number => {
				const entry = this.getFd(fd);
				// Can only remove rights, not add
				if ((rightsBase & ~entry.rightsBase) !== 0n) {
					return Errno.ENOTCAPABLE;
				}
				if ((rightsInheriting & ~entry.rightsInheriting) !== 0n) {
					return Errno.ENOTCAPABLE;
				}
				entry.rightsBase = rightsBase;
				entry.rightsInheriting = rightsInheriting;
				return Errno.SUCCESS;
			}),

			fd_filestat_get: wrap((fd: number, statPtr: number): number => {
				const v = this.#view();
				const entry = this.checkRights(fd, Rights.FD_FILESTAT_GET);
				const stats = fs.fstatSync(entry.fd);

				// filestat structure (64 bytes):
				// u64 dev, u64 ino, u8 filetype, u64 nlink, u64 size,
				// u64 atim, u64 mtim, u64 ctim
				v.setBigUint64(statPtr, BigInt(stats.dev), true);
				v.setBigUint64(statPtr + 8, BigInt(stats.ino), true);
				v.setUint8(statPtr + 16, statsToFileType(stats));
				v.setBigUint64(statPtr + 24, BigInt(stats.nlink), true);
				v.setBigUint64(statPtr + 32, BigInt(stats.size), true);
				v.setBigUint64(statPtr + 40, msToNs(stats.atimeMs), true);
				v.setBigUint64(statPtr + 48, msToNs(stats.mtimeMs), true);
				v.setBigUint64(statPtr + 56, msToNs(stats.ctimeMs), true);
				return Errno.SUCCESS;
			}),

			fd_filestat_set_size: wrap((fd: number, size: bigint): number => {
				const entry = this.checkRights(fd, Rights.FD_FILESTAT_SET_SIZE);
				fs.ftruncateSync(entry.fd, Number(size));
				return Errno.SUCCESS;
			}),

			fd_filestat_set_times: wrap((fd: number, atim: bigint, mtim: bigint, fstFlags: number): number => {
				const entry = this.checkRights(fd, Rights.FD_FILESTAT_SET_TIMES);
				const stats = fs.fstatSync(entry.fd);

				let atime: Date;
				let mtime: Date;
				const now = new Date();

				if (fstFlags & FstFlags.ATIM_NOW) {
					atime = now;
				} else if (fstFlags & FstFlags.ATIM) {
					atime = new Date(nsToMs(atim));
				} else {
					atime = stats.atime;
				}

				if (fstFlags & FstFlags.MTIM_NOW) {
					mtime = now;
				} else if (fstFlags & FstFlags.MTIM) {
					mtime = new Date(nsToMs(mtim));
				} else {
					mtime = stats.mtime;
				}

				fs.futimesSync(entry.fd, atime, mtime);
				return Errno.SUCCESS;
			}),

			fd_pread: wrap((fd: number, iovsPtr: number, iovsLen: number, offset: bigint, nreadPtr: number): number => {
				const entry = this.checkRights(fd, Rights.FD_READ | Rights.FD_SEEK);
				const buffers = this.readIovecs(iovsPtr, iovsLen);

				let totalRead = 0;
				let currentOffset = Number(offset);
				for (const buf of buffers) {
					const bytesRead = fs.readSync(entry.fd, buf, 0, buf.length, currentOffset);
					totalRead += bytesRead;
					currentOffset += bytesRead;
					if (bytesRead < buf.length) break;
				}

				const v = this.#view();
				v.setUint32(nreadPtr, totalRead, true);
				return Errno.SUCCESS;
			}),

			fd_prestat_get: wrap((fd: number, prestatPtr: number): number => {
				const v = this.#view();
				const entry = this.getFd(fd);
				if (!entry.preopenPath) {
					return Errno.EBADF;
				}

				// prestat structure:
				// u8 tag (0 = dir)
				// u32 name_len
				v.setUint8(prestatPtr, PreopenType.DIR);
				const pathBytes = new TextEncoder().encode(entry.preopenPath);
				v.setUint32(prestatPtr + 4, pathBytes.length, true);
				return Errno.SUCCESS;
			}),

			fd_prestat_dir_name: wrap((fd: number, pathPtr: number, pathLen: number): number => {
				const entry = this.getFd(fd);
				if (!entry.preopenPath) {
					return Errno.EBADF;
				}

				const pathBytes = new TextEncoder().encode(entry.preopenPath);
				if (pathLen < pathBytes.length) {
					return Errno.ENOBUFS;
				}
				this.#mem(pathPtr, pathBytes.length).set(pathBytes);
				return Errno.SUCCESS;
			}),

			fd_pwrite: wrap(
				(fd: number, iovsPtr: number, iovsLen: number, offset: bigint, nwrittenPtr: number): number => {
					const entry = this.checkRights(fd, Rights.FD_WRITE | Rights.FD_SEEK);
					const buffers = this.readIovecs(iovsPtr, iovsLen);

					let totalWritten = 0;
					let currentOffset = Number(offset);
					for (const buf of buffers) {
						const bytesWritten = fs.writeSync(entry.fd, buf, 0, buf.length, currentOffset);
						totalWritten += bytesWritten;
						currentOffset += bytesWritten;
					}

					this.#view().setUint32(nwrittenPtr, totalWritten, true);
					return Errno.SUCCESS;
				},
			),

			fd_read: wrap((fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number): number => {
				const entry = this.checkRights(fd, Rights.FD_READ);
				const buffers = this.readIovecs(iovsPtr, iovsLen);

				let totalRead = 0;
				for (const buf of buffers) {
					const position = entry.offset !== undefined ? Number(entry.offset) : null;
					const bytesRead = fs.readSync(entry.fd, buf, 0, buf.length, position);
					totalRead += bytesRead;
					if (entry.offset !== undefined) {
						entry.offset += BigInt(bytesRead);
					}
					if (bytesRead < buf.length) break;
				}

				const v = this.#view();
				v.setUint32(nreadPtr, totalRead, true);
				return Errno.SUCCESS;
			}),

			fd_readdir: wrap((fd: number, bufPtr: number, bufLen: number, cookie: bigint, bufUsedPtr: number): number => {
				const v = this.#view();
				const entry = this.checkRights(fd, Rights.FD_READDIR);
				if (!entry.realPath) {
					return Errno.EINVAL;
				}

				const dirents = fs.readdirSync(entry.realPath, { withFileTypes: true });
				let offset = bufPtr;
				const startPtr = bufPtr;
				const cookieNum = Number(cookie);

				for (let i = cookieNum; i < dirents.length; i++) {
					const dirent = dirents[i];
					const nameBytes = new TextEncoder().encode(dirent.name);

					// dirent structure:
					// u64 d_next (cookie of next entry)
					// u64 d_ino
					// u32 d_namlen
					// u8 d_type
					// char d_name[]
					const direntSize = 24 + nameBytes.length;

					if (offset - startPtr + direntSize > bufLen) {
						break;
					}

					// Get inode
					let ino = 0n;
					try {
						const stats = fs.statSync(path.join(entry.realPath!, dirent.name));
						ino = BigInt(stats.ino);
					} catch {}

					v.setBigUint64(offset, BigInt(i + 1), true);
					v.setBigUint64(offset + 8, ino, true);
					v.setUint32(offset + 16, nameBytes.length, true);

					let fileType = FileType.UNKNOWN;
					if (dirent.isFile()) fileType = FileType.REGULAR_FILE;
					else if (dirent.isDirectory()) fileType = FileType.DIRECTORY;
					else if (dirent.isSymbolicLink()) fileType = FileType.SYMBOLIC_LINK;
					else if (dirent.isCharacterDevice()) fileType = FileType.CHARACTER_DEVICE;
					else if (dirent.isBlockDevice()) fileType = FileType.BLOCK_DEVICE;
					else if (dirent.isFIFO()) fileType = FileType.SOCKET_STREAM;
					else if (dirent.isSocket()) fileType = FileType.SOCKET_STREAM;

					v.setUint8(offset + 20, fileType);
					this.#mem(offset + 24, nameBytes.length).set(nameBytes);

					offset += direntSize;
				}

				v.setUint32(bufUsedPtr, offset - startPtr, true);
				return Errno.SUCCESS;
			}),

			fd_renumber: wrap((from: number, to: number): number => {
				const fromEntry = this.getFd(from);
				const toEntry = this.#fds.get(to);

				// Close the target if it exists
				if (toEntry && to > 2) {
					fs.closeSync(toEntry.fd);
				}

				this.#fds.set(to, fromEntry);
				this.#fds.delete(from);
				return Errno.SUCCESS;
			}),

			fd_seek: wrap((fd: number, offset: bigint, whence: number, newOffsetPtr: number): number => {
				const v = this.#view();
				const entry = this.checkRights(fd, Rights.FD_SEEK);

				if (entry.offset === undefined) {
					entry.offset = 0n;
				}

				let newOffset: bigint;
				switch (whence) {
					case Whence.SET:
						newOffset = offset;
						break;
					case Whence.CUR:
						newOffset = entry.offset + offset;
						break;
					case Whence.END: {
						const stats = fs.fstatSync(entry.fd);
						newOffset = BigInt(stats.size) + offset;
						break;
					}
					default:
						return Errno.EINVAL;
				}

				if (newOffset < 0n) {
					return Errno.EINVAL;
				}

				entry.offset = newOffset;
				v.setBigUint64(newOffsetPtr, newOffset, true);
				return Errno.SUCCESS;
			}),

			fd_sync: wrap((fd: number): number => {
				const entry = this.checkRights(fd, Rights.FD_SYNC);
				fs.fsyncSync(entry.fd);
				return Errno.SUCCESS;
			}),

			fd_tell: wrap((fd: number, offsetPtr: number): number => {
				const v = this.#view();
				const entry = this.checkRights(fd, Rights.FD_TELL);
				const offset = entry.offset ?? 0n;
				v.setBigUint64(offsetPtr, offset, true);
				return Errno.SUCCESS;
			}),

			fd_write: wrap((fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number => {
				const entry = this.checkRights(fd, Rights.FD_WRITE);
				const buffers = this.readIovecs(iovsPtr, iovsLen);

				let totalWritten = 0;
				for (const buf of buffers) {
					if (buf.length === 0) continue;
					const position = entry.offset !== undefined ? Number(entry.offset) : null;
					const bytesWritten = fs.writeSync(entry.fd, buf, 0, buf.length, position);
					totalWritten += bytesWritten;
					if (entry.offset !== undefined) {
						entry.offset += BigInt(bytesWritten);
					}
				}

				const v = this.#view();
				v.setUint32(nwrittenPtr, totalWritten, true);
				return Errno.SUCCESS;
			}),

			// =========================================================================
			// Path Operations
			// =========================================================================

			path_create_directory: wrap((fd: number, pathPtr: number, pathLen: number): number => {
				this.checkRights(fd, Rights.PATH_CREATE_DIRECTORY);
				const fullPath = this.resolvePath(fd, pathPtr, pathLen);
				fs.mkdirSync(fullPath);
				return Errno.SUCCESS;
			}),

			path_filestat_get: wrap(
				(fd: number, flags: number, pathPtr: number, pathLen: number, statPtr: number): number => {
					const v = this.#view();
					this.checkRights(fd, Rights.PATH_FILESTAT_GET);
					const fullPath = this.resolvePath(fd, pathPtr, pathLen);

					const stats = flags & LookupFlags.SYMLINK_FOLLOW ? fs.statSync(fullPath) : fs.lstatSync(fullPath);

					v.setBigUint64(statPtr, BigInt(stats.dev), true);
					v.setBigUint64(statPtr + 8, BigInt(stats.ino), true);
					v.setUint8(statPtr + 16, statsToFileType(stats));
					v.setBigUint64(statPtr + 24, BigInt(stats.nlink), true);
					v.setBigUint64(statPtr + 32, BigInt(stats.size), true);
					v.setBigUint64(statPtr + 40, msToNs(stats.atimeMs), true);
					v.setBigUint64(statPtr + 48, msToNs(stats.mtimeMs), true);
					v.setBigUint64(statPtr + 56, msToNs(stats.ctimeMs), true);
					return Errno.SUCCESS;
				},
			),

			path_filestat_set_times: wrap(
				(
					fd: number,
					flags: number,
					pathPtr: number,
					pathLen: number,
					atim: bigint,
					mtim: bigint,
					fstFlags: number,
				): number => {
					this.checkRights(fd, Rights.PATH_FILESTAT_SET_TIMES);
					const fullPath = this.resolvePath(fd, pathPtr, pathLen);

					const stats = flags & LookupFlags.SYMLINK_FOLLOW ? fs.statSync(fullPath) : fs.lstatSync(fullPath);

					let atime: Date;
					let mtime: Date;
					const now = new Date();

					if (fstFlags & FstFlags.ATIM_NOW) {
						atime = now;
					} else if (fstFlags & FstFlags.ATIM) {
						atime = new Date(nsToMs(atim));
					} else {
						atime = stats.atime;
					}

					if (fstFlags & FstFlags.MTIM_NOW) {
						mtime = now;
					} else if (fstFlags & FstFlags.MTIM) {
						mtime = new Date(nsToMs(mtim));
					} else {
						mtime = stats.mtime;
					}

					fs.utimesSync(fullPath, atime, mtime);
					return Errno.SUCCESS;
				},
			),

			path_link: wrap(
				(
					oldFd: number,
					_oldFlags: number,
					oldPathPtr: number,
					oldPathLen: number,
					newFd: number,
					newPathPtr: number,
					newPathLen: number,
				): number => {
					this.checkRights(oldFd, Rights.PATH_LINK_SOURCE);
					this.checkRights(newFd, Rights.PATH_LINK_TARGET);
					const oldPath = this.resolvePath(oldFd, oldPathPtr, oldPathLen);
					const newPath = this.resolvePath(newFd, newPathPtr, newPathLen);
					fs.linkSync(oldPath, newPath);
					return Errno.SUCCESS;
				},
			),

			path_open: wrap(
				(
					dirFd: number,
					_dirFlags: number,
					pathPtr: number,
					pathLen: number,
					oflags: number,
					fsRightsBase: bigint,
					fsRightsInheriting: bigint,
					fdFlags: number,
					fdPtr: number,
				): number => {
					const v = this.#view();
					const fullPath = this.resolvePath(dirFd, pathPtr, pathLen);

					// Build Node.js open flags
					let nodeFlags = 0;

					// Determine read/write mode from requested rights
					const wantsRead = (fsRightsBase & Rights.FD_READ) !== 0n;
					const wantsWrite =
						(fsRightsBase & (Rights.FD_WRITE | Rights.FD_ALLOCATE | Rights.FD_FILESTAT_SET_SIZE)) !== 0n;

					if (wantsRead && wantsWrite) {
						nodeFlags |= fs.constants.O_RDWR;
					} else if (wantsWrite) {
						nodeFlags |= fs.constants.O_WRONLY;
					} else {
						nodeFlags |= fs.constants.O_RDONLY;
					}

					// Handle oflags
					if (oflags & OFlags.CREAT) {
						nodeFlags |= fs.constants.O_CREAT;
					}
					if (oflags & OFlags.DIRECTORY) {
						nodeFlags |= fs.constants.O_DIRECTORY;
					}
					if (oflags & OFlags.EXCL) {
						nodeFlags |= fs.constants.O_EXCL;
					}
					if (oflags & OFlags.TRUNC) {
						nodeFlags |= fs.constants.O_TRUNC;
					}

					// Handle fdFlags
					if (fdFlags & FdFlags.APPEND) {
						nodeFlags |= fs.constants.O_APPEND;
					}
					if (fdFlags & FdFlags.DSYNC) {
						nodeFlags |= fs.constants.O_DSYNC || fs.constants.O_SYNC;
					}
					if (fdFlags & FdFlags.NONBLOCK) {
						nodeFlags |= fs.constants.O_NONBLOCK;
					}
					if (fdFlags & FdFlags.SYNC) {
						nodeFlags |= fs.constants.O_SYNC;
					}

					// Check if it's a directory that we need to open read-only
					let isDir = false;
					try {
						isDir = fs.statSync(fullPath).isDirectory();
					} catch {}

					if (isDir && !wantsWrite) {
						nodeFlags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY;
					}

					const realFd = fs.openSync(fullPath, nodeFlags);
					const stats = fs.fstatSync(realFd);
					const fileType = statsToFileType(stats);
					const { base, inheriting } = rightsForFileType(fileType, tty.isatty(realFd));

					const wasiFd = this.allocateFd();
					this.#fds.set(wasiFd, {
						fd: realFd,
						fileType,
						rightsBase: fsRightsBase & base,
						rightsInheriting: fsRightsInheriting & inheriting,
						offset: fileType === FileType.REGULAR_FILE ? 0n : undefined,
						realPath: fullPath,
						fdFlags,
					});

					v.setUint32(fdPtr, wasiFd, true);
					return Errno.SUCCESS;
				},
			),

			path_readlink: wrap(
				(
					fd: number,
					pathPtr: number,
					pathLen: number,
					bufPtr: number,
					bufLen: number,
					bufUsedPtr: number,
				): number => {
					const v = this.#view();
					this.checkRights(fd, Rights.PATH_READLINK);
					const fullPath = this.resolvePath(fd, pathPtr, pathLen);
					const target = fs.readlinkSync(fullPath);
					const targetBytes = new TextEncoder().encode(target);
					const len = Math.min(targetBytes.length, bufLen);
					this.#mem(bufPtr, len).set(targetBytes.subarray(0, len));
					v.setUint32(bufUsedPtr, len, true);
					return Errno.SUCCESS;
				},
			),

			path_remove_directory: wrap((fd: number, pathPtr: number, pathLen: number): number => {
				this.checkRights(fd, Rights.PATH_REMOVE_DIRECTORY);
				const fullPath = this.resolvePath(fd, pathPtr, pathLen);
				fs.rmdirSync(fullPath);
				return Errno.SUCCESS;
			}),

			path_rename: wrap(
				(
					oldFd: number,
					oldPathPtr: number,
					oldPathLen: number,
					newFd: number,
					newPathPtr: number,
					newPathLen: number,
				): number => {
					this.checkRights(oldFd, Rights.PATH_RENAME_SOURCE);
					this.checkRights(newFd, Rights.PATH_RENAME_TARGET);
					const oldPath = this.resolvePath(oldFd, oldPathPtr, oldPathLen);
					const newPath = this.resolvePath(newFd, newPathPtr, newPathLen);
					fs.renameSync(oldPath, newPath);
					return Errno.SUCCESS;
				},
			),

			path_symlink: wrap(
				(oldPathPtr: number, oldPathLen: number, fd: number, newPathPtr: number, newPathLen: number): number => {
					this.checkRights(fd, Rights.PATH_SYMLINK);
					const oldPath = readString(this.#view(), oldPathPtr, oldPathLen);
					const newPath = this.resolvePath(fd, newPathPtr, newPathLen);
					fs.symlinkSync(oldPath, newPath);
					return Errno.SUCCESS;
				},
			),

			path_unlink_file: wrap((fd: number, pathPtr: number, pathLen: number): number => {
				this.checkRights(fd, Rights.PATH_UNLINK_FILE);
				const fullPath = this.resolvePath(fd, pathPtr, pathLen);
				fs.unlinkSync(fullPath);
				return Errno.SUCCESS;
			}),

			// =========================================================================
			// Polling
			// =========================================================================

			poll_oneoff: wrap((inPtr: number, outPtr: number, nsubscriptions: number, neventsPtr: number): number => {
				const v = this.#view();

				let nevents = 0;
				let maxWaitNs = 0n;

				for (let i = 0; i < nsubscriptions; i++) {
					const subPtr = inPtr + i * 48;
					const userdata = v.getBigUint64(subPtr, true);
					const tag = v.getUint8(subPtr + 8);

					const eventPtr = outPtr + nevents * 32;

					switch (tag) {
						case EventType.CLOCK: {
							const clockId = v.getUint32(subPtr + 16, true);
							const timeout = v.getBigUint64(subPtr + 24, true);
							const _precision = v.getBigUint64(subPtr + 32, true);
							const flags = v.getUint16(subPtr + 40, true);

							const isAbsolute = (flags & SubClockFlags.ABSTIME) !== 0;
							const now = clockTimeNs(clockId);

							if (now === null) {
								v.setBigUint64(eventPtr, userdata, true);
								v.setUint16(eventPtr + 8, Errno.EINVAL, true);
								v.setUint8(eventPtr + 10, EventType.CLOCK);
							} else {
								let waitNs = isAbsolute ? timeout - now : timeout;
								if (waitNs < 0n) waitNs = 0n;
								if (waitNs > maxWaitNs) maxWaitNs = waitNs;

								v.setBigUint64(eventPtr, userdata, true);
								v.setUint16(eventPtr + 8, Errno.SUCCESS, true);
								v.setUint8(eventPtr + 10, EventType.CLOCK);
							}
							nevents++;
							break;
						}

						case EventType.FD_READ:
						case EventType.FD_WRITE: {
							const _fd = v.getUint32(subPtr + 16, true);

							// For simplicity, we just return immediately with success
							// A full implementation would use select/poll/epoll
							v.setBigUint64(eventPtr, userdata, true);
							v.setUint16(eventPtr + 8, Errno.SUCCESS, true);
							v.setUint8(eventPtr + 10, tag);
							// nbytes and flags at eventPtr + 16 and eventPtr + 24
							v.setBigUint64(eventPtr + 16, 0n, true);
							v.setUint16(eventPtr + 24, 0, true);
							nevents++;
							break;
						}

						default:
							return Errno.EINVAL;
					}
				}

				// Sleep if there's a timeout
				if (maxWaitNs > 0n && nevents > 0) {
					const sleepMs = Number(maxWaitNs / 1_000_000n);
					if (sleepMs > 0) {
						// Use Bun.sleepSync if available, otherwise busy-wait (not ideal)
						if (typeof Bun !== "undefined" && Bun.sleepSync) {
							Bun.sleepSync(sleepMs);
						} else {
							const end = Date.now() + sleepMs;
							while (Date.now() < end) {
								// Busy wait - not ideal but works
							}
						}
					}
				}

				v.setUint32(neventsPtr, nevents, true);
				return Errno.SUCCESS;
			}),

			// =========================================================================
			// Process
			// =========================================================================

			proc_exit: (code: number): never => {
				throw new WASIExitError(code);
			},

			proc_raise: wrap((sig: number): number => {
				const signal = SIGNAL_MAP[sig];
				if (!signal) {
					return Errno.EINVAL;
				}
				process.kill(process.pid, signal);
				return Errno.SUCCESS;
			}),

			// =========================================================================
			// Random
			// =========================================================================

			random_get: wrap((bufPtr: number, bufLen: number): number => {
				const buf = this.#mem(bufPtr, bufLen);
				crypto.getRandomValues(buf);
				return Errno.SUCCESS;
			}),

			// =========================================================================
			// Scheduler
			// =========================================================================

			sched_yield: wrap((): number => {
				// No-op in single-threaded JS
				return Errno.SUCCESS;
			}),

			// =========================================================================
			// Sockets (stubs - return ENOSYS)
			// =========================================================================

			sock_accept: wrap((_fd: number, _flags: number, _fdPtr: number): number => {
				return Errno.ENOSYS;
			}),

			sock_recv: wrap(
				(
					_fd: number,
					_iovs: number,
					_iovsLen: number,
					_flags: number,
					_nreadPtr: number,
					_flagsPtr: number,
				): number => {
					return Errno.ENOSYS;
				},
			),

			sock_send: wrap(
				(_fd: number, _iovs: number, _iovsLen: number, _flags: number, _nwrittenPtr: number): number => {
					return Errno.ENOSYS;
				},
			),

			sock_shutdown: wrap((_fd: number, _how: number): number => {
				return Errno.ENOSYS;
			}),
		};
	}

	/** Get imports for a WebAssembly module */
	getImportObject() {
		return {
			wasi_snapshot_preview1: this.#wasiImport,
			wasi_unstable: this.#wasiImport,
		};
	}

	/** Initialize WASI with a WebAssembly instance */
	initialize(instance: WebAssembly.Instance): void {
		const exports = instance.exports;
		if (exports.memory instanceof WebAssembly.Memory) {
			this.#memory = exports.memory;
		} else {
			throw new Error("WebAssembly instance must export memory");
		}
	}

	/** Start the WASI program */
	start(instance: WebAssembly.Instance): number {
		this.initialize(instance);
		const exports = instance.exports;

		if (typeof exports._start === "function") {
			try {
				(exports._start as () => void)();
				return 0;
			} catch (err) {
				if (err instanceof WASIExitError) {
					return err.code;
				}
				throw err;
			}
		} else if (typeof exports._initialize === "function") {
			(exports._initialize as () => void)();
			return 0;
		} else {
			throw new Error("WebAssembly instance must export _start or _initialize");
		}
	}
}

// =============================================================================
// Default Export
// =============================================================================

export default WASI1;
