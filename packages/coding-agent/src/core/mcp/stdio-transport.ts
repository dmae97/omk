/**
 * Child-process stdio transport for MCP.
 *
 * Owns exactly one server process: writes newline-delimited JSON to stdin,
 * decodes stdout into messages, keeps a bounded tail of stderr for diagnostics,
 * and reports exit exactly once. It never interprets MCP semantics — that is
 * the client's job.
 *
 * Every configured OMK MCP server uses a `command`, so stdio is the whole
 * transport surface today. HTTP servers would get a sibling module rather than
 * a flag on this one.
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import spawn from "cross-spawn";
import { validateMcpTimeoutMs } from "./deadline-policy.ts";
import { createLineDecoder, encodeMessage, type JsonRpcMessage } from "./protocol.ts";

/** How much stderr tail to keep per server for error reporting. */
export const MAX_STDERR_TAIL_CHARS = 8192;
/** Grace period between SIGTERM and SIGKILL on close. */
export const DEFAULT_KILL_GRACE_MS = 2000;
/** Framed bytes allowed to sit in the child's stdin buffer before sends refuse. */
export const DEFAULT_MAX_PENDING_WRITE_BYTES = 16 * 1024 * 1024;

export interface StdioTransportOptions {
	readonly command: string;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	readonly cwd?: string;
	/** Grace period before SIGKILL. */
	readonly killGraceMs?: number;
	/** Inherit the parent environment. Default `true`. */
	readonly inheritEnv?: boolean;
	/** Framed bytes allowed to sit unwritten before `send` refuses. */
	readonly maxPendingWriteBytes?: number;
}

export interface StdioTransportHandlers {
	readonly onMessage: (message: JsonRpcMessage) => void;
	/** Malformed frames are surfaced, never silently dropped. */
	readonly onDecodeError?: (reason: string) => void;
	/** Called at most once, with the exit code or signal. */
	readonly onExit: (info: { readonly code: number | null; readonly signal: string | null }) => void;
}

export class McpStdioTransport {
	private child: ChildProcessWithoutNullStreams | undefined;
	private readonly decoder = createLineDecoder();
	private readonly killGraceMs: number;
	private stderrTail = "";
	private exited = false;
	private directExitObserved = false;
	private closing = false;
	private readonly closedPromise: Promise<void>;
	private resolveClosed: (() => void) | undefined;
	private killTimer: ReturnType<typeof setTimeout> | undefined;
	/** Conservative estimate of frames retained after a backpressured write. */
	private pendingWriteBytes = 0;
	private readonly maxPendingWriteBytes: number;
	private waitingForDrain = false;
	private readonly options: StdioTransportOptions;
	private readonly handlers: StdioTransportHandlers;

	constructor(options: StdioTransportOptions, handlers: StdioTransportHandlers) {
		this.options = options;
		this.handlers = handlers;
		this.killGraceMs = validateMcpTimeoutMs(options.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
		this.closedPromise = new Promise<void>((resolve) => {
			this.resolveClosed = resolve;
		});
		const cap = options.maxPendingWriteBytes ?? DEFAULT_MAX_PENDING_WRITE_BYTES;
		if (!Number.isSafeInteger(cap) || cap < 0) throw new RangeError("mcp.invalid_pending_write_cap");
		this.maxPendingWriteBytes = cap;
	}

	/** Bounded tail of the server's stderr. Empty when the server has been quiet. */
	get stderr(): string {
		return this.stderrTail;
	}

	get running(): boolean {
		return this.child !== undefined && !this.directExitObserved && !this.exited;
	}

	/** Resolves after direct-process stdio closure, never just after kill() or error. */
	waitForClose(): Promise<void> {
		return this.closedPromise;
	}

	/**
	 * Spawn the server process. Throws synchronously only on an invalid
	 * configuration; a spawn failure surfaces through `onExit`, so callers have
	 * one failure path instead of two.
	 */
	start(): void {
		if (this.child || this.closing || this.exited) throw new Error("MCP stdio transport already started or closed");
		const env = this.options.inheritEnv === false ? { ...this.options.env } : { ...process.env, ...this.options.env };
		const child = spawn(this.options.command, [...(this.options.args ?? [])], {
			cwd: this.options.cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		}) as ChildProcessWithoutNullStreams;
		this.child = child;

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			for (const decoded of this.decoder.push(chunk)) {
				if (decoded.message) this.handlers.onMessage(decoded.message);
				else if (decoded.error) this.handlers.onDecodeError?.(decoded.error);
			}
		});

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			this.stderrTail = `${this.stderrTail}${chunk}`.slice(-MAX_STDERR_TAIL_CHARS);
		});

		// A stdin EPIPE after the server exits is expected, not an error worth throwing.
		child.stdin.on("error", () => {});
		child.on("error", (error: Error) => {
			this.stderrTail = `${this.stderrTail}${error.message}\n`.slice(-MAX_STDERR_TAIL_CHARS);
			// `error` can mean a failed kill, not termination. `close` owns finality.
		});
		child.on("exit", () => {
			this.directExitObserved = true;
			if (this.killTimer !== undefined) clearTimeout(this.killTimer);
			this.killTimer = undefined;
		});
		// stdout may deliver a valid final response AFTER `exit`, but before `close`.
		child.on("close", (code, signal) => this.settleExit(code, signal));
	}

	/**
	 * Write one message. Returns `false` when the server is no longer writable
	 * or the outbound buffer is already saturated — the client treats that as
	 * a send failure rather than queueing unbounded frames.
	 */
	send(message: JsonRpcMessage): boolean {
		const child = this.child;
		if (!child || this.closing || this.directExitObserved || this.exited || !child.stdin.writable) return false;
		const frame = encodeMessage(message);
		const frameBytes = Buffer.byteLength(frame, "utf8");
		// write() may return true while bytes remain queued; the old counter only
		// covered false returns. Both signals describe the same queue, so use the
		// larger observation rather than summing and double-counting frames.
		const queued = child.stdin.writableLength;
		if (!Number.isSafeInteger(queued) || queued < 0) return false;
		if (Math.max(this.pendingWriteBytes, queued) > this.maxPendingWriteBytes - frameBytes) return false;
		try {
			const flushed = child.stdin.write(frame);
			if (!flushed) {
				// Kernel/user buffer is saturated: account the frame and release it
				// on drain so the pending estimate tracks the real backlog.
				this.pendingWriteBytes += frameBytes;
				if (!this.waitingForDrain) {
					this.waitingForDrain = true;
					child.stdin.once("drain", () => {
						this.waitingForDrain = false;
						this.pendingWriteBytes = 0;
					});
				}
			}
			return true;
		} catch {
			return false;
		}
	}

	/** Terminate the server: SIGTERM, then SIGKILL after the grace period. */
	close(): void {
		if (this.closing) return;
		this.closing = true;
		const child = this.child;
		if (!child) {
			this.resolveClosed?.();
			return;
		}
		if (this.exited || this.directExitObserved) return;
		try {
			child.stdin.end();
		} catch {
			// Already closed.
		}
		try {
			child.kill("SIGTERM");
		} catch {
			// Already gone.
		}
		if (this.exited || this.directExitObserved || this.killTimer !== undefined) return;
		this.killTimer = setTimeout(() => {
			this.killTimer = undefined;
			if (this.exited || this.directExitObserved) return;
			try {
				child.kill("SIGKILL");
			} catch {
				// Already gone.
			}
		}, this.killGraceMs);
		this.killTimer.unref?.();
	}

	private settleExit(code: number | null, signal: string | null): void {
		if (this.exited) return;
		this.exited = true;
		this.pendingWriteBytes = 0;
		this.waitingForDrain = false;
		if (this.killTimer !== undefined) {
			clearTimeout(this.killTimer);
			this.killTimer = undefined;
		}
		this.decoder.reset();
		this.resolveClosed?.();
		this.handlers.onExit({ code, signal });
	}
}
