/**
 * Minimal MCP stdio client for `aside mcp`.
 *
 * Speaks JSON-RPC 2.0 over the process stdin/stdout (newline-delimited),
 * implements `initialize`, `notifications/initialized`, `tools/list` (with
 * cursor pagination), and `tools/call`. Only stdout JSON-RPC frames are parsed;
 * stderr is surfaced for diagnostics but never parsed as protocol.
 *
 * The process is spawned lazily on first use and closed via `close()`.
 * All reads honor an AbortSignal so an OMK session shutdown can interrupt a
 * pending call.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { McpCallResult, McpTool } from "./types.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_STDOUT_BUFFER_BYTES = 1_048_576;
const DEFAULT_MAX_FRAME_BYTES = 1_048_576;
const DEFAULT_STDERR_PREVIEW_BYTES = 500;

interface Pending {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly cleanup: () => void;
}

interface ResolvedAsideMcpClientOptions {
	readonly executable: string;
	readonly args: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	readonly cwd?: string;
	readonly requestTimeoutMs: number;
	readonly clientName: string;
	readonly clientVersion: string;
	readonly maxStdoutBufferBytes: number;
	readonly maxFrameBytes: number;
	readonly stderrPreviewBytes: number;
}

export interface AsideMcpClientOptions {
	executable: string;
	args?: readonly string[];
	env?: Readonly<Record<string, string>>;
	cwd?: string;
	/** Per-request timeout in ms (default 60_000). */
	requestTimeoutMs?: number;
	clientName?: string;
	clientVersion?: string;
	/** Maximum buffered stdout bytes without a complete frame (default 1 MiB). */
	maxStdoutBufferBytes?: number;
	/** Maximum single JSON-RPC stdout frame bytes (default 1 MiB). */
	maxFrameBytes?: number;
	/** Maximum stderr diagnostic preview bytes per burst (default 500). */
	stderrPreviewBytes?: number;
}

/** Raised when the `aside` binary cannot be spawned. */
export class AsideUnavailableError extends Error {
	constructor(message: string, cause?: NodeJS.ErrnoException) {
		super(message, { cause });
		this.name = "AsideUnavailableError";
	}
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestCancellation(error: Error): boolean {
	return /MCP request (aborted|timed out):/.test(error.message);
}

function validateToolsListResult(result: unknown): { tools: McpTool[]; nextCursor?: string } {
	if (!isRecord(result)) throw new Error("malformed tools/list result: expected object");
	if (!Array.isArray(result.tools)) throw new Error("malformed tools/list result: tools must be an array");
	if (result.nextCursor !== undefined && typeof result.nextCursor !== "string") {
		throw new Error("malformed tools/list result: nextCursor must be a string");
	}
	const tools: McpTool[] = [];
	for (const descriptor of result.tools) {
		if (!isRecord(descriptor)) throw new Error("malformed tools/list descriptor: expected object");
		if (typeof descriptor.name !== "string" || descriptor.name.length === 0) {
			throw new Error("malformed tools/list descriptor: name must be a non-empty string");
		}
		if (descriptor.description !== undefined && typeof descriptor.description !== "string") {
			throw new Error("malformed tools/list descriptor: description must be a string");
		}
		if (!isRecord(descriptor.inputSchema)) {
			throw new Error("malformed tools/list descriptor: inputSchema must be an object");
		}
		tools.push({ name: descriptor.name, description: descriptor.description, inputSchema: descriptor.inputSchema });
	}
	return { tools, nextCursor: result.nextCursor };
}

function validateCallResult(result: unknown): McpCallResult {
	if (!isRecord(result) || !Array.isArray(result.content)) throw new Error("malformed tools/call result");
	return result as unknown as McpCallResult;
}

export class AsideMcpClient {
	private readonly opts: ResolvedAsideMcpClientOptions;
	private proc: ChildProcessWithoutNullStreams | undefined;
	private buffer = "";
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private initialized = false;
	private initPromise: Promise<void> | undefined;
	private initError: Error | undefined;
	private closed = false;

	constructor(options: AsideMcpClientOptions) {
		this.opts = {
			executable: options.executable,
			args: options.args ?? ["mcp"],
			env: options.env,
			cwd: options.cwd,
			requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
			clientName: options.clientName ?? "omk-aside-bridge",
			clientVersion: options.clientVersion ?? "0.1.0",
			maxStdoutBufferBytes: options.maxStdoutBufferBytes ?? DEFAULT_MAX_STDOUT_BUFFER_BYTES,
			maxFrameBytes: options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
			stderrPreviewBytes: options.stderrPreviewBytes ?? DEFAULT_STDERR_PREVIEW_BYTES,
		};
	}

	private ensureProcess(): ChildProcessWithoutNullStreams {
		if (this.closed) throw new Error("aside mcp client closed");
		if (this.proc) return this.proc;
		let proc: ChildProcessWithoutNullStreams;
		try {
			proc = spawn(this.opts.executable, [...this.opts.args], {
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, ...this.opts.env },
				cwd: this.opts.cwd,
			});
		} catch (error) {
			throw new AsideUnavailableError(
				`failed to spawn ${this.opts.executable}: ${(error as Error).message}`,
				error as NodeJS.ErrnoException,
			);
		}
		if (!proc.stdin || !proc.stdout) {
			throw new AsideUnavailableError(`${this.opts.executable} spawned without stdio`);
		}
		proc.on("error", (error) => {
			this.initError =
				this.initError ??
				new AsideUnavailableError(`${this.opts.executable} process error: ${error.message}`, error);
			this.failAll(this.initError);
		});
		proc.on("exit", (code, signal) => {
			this.proc = undefined;
			if (!this.closed) {
				this.initError =
					this.initError ?? new Error(`${this.opts.executable} exited (code=${code} signal=${signal})`);
				this.failAll(this.initError);
			}
		});
		proc.stderr?.on("data", (chunk: Buffer) => {
			// Diagnostics only — never parsed as protocol. Truncate large bursts.
			const text = chunk.toString("utf8").trim();
			if (text) console.error(`[aside stderr] ${text.slice(0, this.opts.stderrPreviewBytes)}`);
		});
		proc.stdout.setEncoding("utf8");
		proc.stdout.on("data", (chunk: string) => this.onData(chunk));
		this.proc = proc;
		return proc;
	}

	private onData(chunk: string): void {
		if (this.closed) return;
		const nextBuffer = this.buffer + chunk;
		if (Buffer.byteLength(nextBuffer, "utf8") > this.opts.maxStdoutBufferBytes) {
			this.protocolFailure(new Error("MCP stdout buffer exceeded maximum size"));
			return;
		}
		this.buffer = nextBuffer;
		let idx = this.buffer.indexOf("\n");
		while (idx !== -1) {
			const rawLine = this.buffer.slice(0, idx);
			this.buffer = this.buffer.slice(idx + 1);
			if (Buffer.byteLength(rawLine, "utf8") > this.opts.maxFrameBytes) {
				this.protocolFailure(new Error("MCP stdout frame exceeded maximum size"));
				return;
			}
			const line = rawLine.trim();
			if (line) this.handleFrame(line);
			idx = this.buffer.indexOf("\n");
		}
	}

	private handleFrame(line: string): void {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			return; // ignore non-JSON lines (banner etc.)
		}
		const obj = message as { id?: number; result?: unknown; error?: { message?: string }; method?: string };
		if (typeof obj.id !== "number") return; // notification — ignored
		const pending = this.pending.get(obj.id);
		if (!pending) return;
		this.pending.delete(obj.id);
		pending.cleanup();
		if (obj.error) {
			pending.reject(new Error(obj.error.message ?? "MCP error"));
		} else {
			pending.resolve(obj.result);
		}
	}

	private send(payload: Record<string, unknown>): void {
		if (this.closed) throw new Error("aside mcp client closed");
		const proc = this.ensureProcess();
		proc.stdin.write(`${JSON.stringify(payload)}\n`);
	}

	private request(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("aside mcp client closed"));
		if (this.initError) return Promise.reject(this.initError);
		if (signal?.aborted) return Promise.reject(new Error(`MCP request aborted: ${method}`));
		const id = this.nextId++;
		return new Promise<unknown>((resolve, reject) => {
			let timer: NodeJS.Timeout | undefined;
			let onAbort: (() => void) | undefined;
			const cleanup = () => {
				if (timer) clearTimeout(timer);
				if (signal && onAbort) signal.removeEventListener("abort", onAbort);
				timer = undefined;
				onAbort = undefined;
			};
			const rejectPending = (error: Error) => {
				const pending = this.pending.get(id);
				if (!pending) return;
				this.pending.delete(id);
				pending.cleanup();
				reject(error);
			};
			timer = setTimeout(
				() => rejectPending(new Error(`MCP request timed out: ${method}`)),
				this.opts.requestTimeoutMs,
			);
			timer.unref?.();
			onAbort = () => rejectPending(new Error(`MCP request aborted: ${method}`));
			signal?.addEventListener("abort", onAbort, { once: true });
			this.pending.set(id, { resolve, reject, cleanup });
			const payload: Record<string, unknown> = { jsonrpc: "2.0", id, method };
			if (params) payload.params = params;
			try {
				this.send(payload);
			} catch (error) {
				rejectPending(toError(error));
			}
		});
	}

	private async initialize(signal?: AbortSignal): Promise<void> {
		const result = (await this.request(
			"initialize",
			{
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: this.opts.clientName, version: this.opts.clientVersion },
			},
			signal,
		)) as { serverInfo?: { name?: string; version?: string } };
		void result; // server info accepted; capability negotiation done.
		this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		this.initialized = true;
	}

	private async ready(signal?: AbortSignal): Promise<void> {
		if (this.closed) throw new Error("aside mcp client closed");
		if (this.initialized) return;
		if (this.initError) throw this.initError;
		if (!this.initPromise) {
			this.initPromise = this.initialize(signal).catch((error: unknown) => {
				const normalized = toError(error);
				if (!isRequestCancellation(normalized) && !this.closed) this.initError = normalized;
				throw normalized;
			});
		}
		try {
			await this.initPromise;
		} finally {
			if (!this.initialized) this.initPromise = undefined;
		}
	}

	/** List tools, following pagination cursors until exhausted. */
	async listTools(signal?: AbortSignal): Promise<readonly McpTool[]> {
		if (signal?.aborted) throw new Error("MCP request aborted: tools/list");
		await this.ready(signal);
		const tools: McpTool[] = [];
		let cursor: string | undefined;
		do {
			const params: Record<string, unknown> = {};
			if (cursor) params.cursor = cursor;
			const result = validateToolsListResult(await this.request("tools/list", params, signal));
			tools.push(...result.tools);
			cursor = result.nextCursor;
		} while (cursor);
		return tools;
	}

	/** Invoke a tool by name with arguments. */
	async callTool(name: string, args: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<McpCallResult> {
		if (signal?.aborted) throw new Error("MCP request aborted: tools/call");
		await this.ready(signal);
		return validateCallResult(await this.request("tools/call", { name, arguments: args }, signal));
	}

	get isInitialized(): boolean {
		return this.initialized;
	}

	private protocolFailure(error: Error): void {
		this.buffer = "";
		this.initError = this.initError ?? error;
		this.failAll(error);
		this.terminateProcess();
	}

	private failAll(error: Error): void {
		for (const [, pending] of this.pending) {
			pending.cleanup();
			pending.reject(error);
		}
		this.pending.clear();
	}

	private terminateProcess(): void {
		const proc = this.proc;
		if (!proc) return;
		try {
			proc.kill("SIGKILL");
		} catch {
			// already dead
		}
	}

	/** Gracefully terminate the child process. Idempotent. */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		const closedError = new Error("aside mcp client closed");
		this.initError = this.initError ?? closedError;
		this.failAll(closedError);
		const proc = this.proc;
		this.proc = undefined;
		if (!proc) return;
		await new Promise<void>((resolve) => {
			let resolved = false;
			const done = () => {
				if (resolved) return;
				resolved = true;
				resolve();
			};
			proc.once("exit", done);
			try {
				proc.stdin.end();
			} catch {
				// ignore
			}
			setTimeout(() => {
				try {
					proc.kill("SIGKILL");
				} catch {
					// already dead
				}
				done();
			}, 2000).unref();
		});
	}
}
