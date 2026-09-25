/**
 * Minimal MCP client: initialize handshake, `tools/list`, `tools/call`.
 *
 * Deliberately dependency-free. The upstream SDK carries a full server
 * implementation, resource/prompt/sampling surfaces, and its own transport
 * stack; OMK needs a client for three methods, so the client is ~200 lines of
 * request correlation over a transport this repo already owns.
 *
 * Fail-closed contract:
 * - Every request has a deadline. A hung server rejects, it does not stall a turn.
 * - A transport exit rejects every in-flight request with the server's stderr tail.
 * - Calling before a completed handshake throws instead of guessing.
 */

import { validateMcpTimeoutMs } from "./deadline-policy.ts";
import { parseMcpInitializeResult } from "./initialize-contract.ts";
import {
	formatJsonRpcError,
	isJsonRpcResponse,
	type JsonRpcId,
	type JsonRpcMessage,
	type JsonRpcResponse,
} from "./protocol.ts";
import { validateMcpCallResult } from "./result-contract.ts";
import { McpStdioTransport, type StdioTransportOptions } from "./stdio-transport.ts";

/** Protocol revision this client implements. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
/**
 * Protocol revisions this client accepts from a server. The handshake fails
 * closed on any other value instead of guessing at forward compatibility.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ["2024-11-05", MCP_PROTOCOL_VERSION];
/** Default per-request deadline. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Default handshake deadline. Servers that install on first run need more room than a normal call. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 60_000;
/** Page ceiling for `tools/list` so a looping cursor cannot stall a session forever. */
export const MAX_LIST_PAGES = 128;
/** Tool ceiling across all `tools/list` pages for one server. */
export const MAX_LIST_TOOLS = 4096;
/** Overall `tools/list` deadline; per-request timeouts do not bound the total. */
export const LIST_TOOLS_TIMEOUT_MS = 120_000;
/** In-flight request ceiling per server. */
export const MAX_PENDING_REQUESTS = 128;

export interface McpToolSchema {
	readonly name: string;
	readonly description?: string;
	readonly inputSchema?: Record<string, unknown>;
	readonly title?: string;
}

export interface McpTextBlock {
	readonly type: "text";
	readonly text: string;
}

export type McpContentBlock =
	| McpTextBlock
	| { readonly type: "image"; readonly data: string; readonly mimeType: string }
	| { readonly type: string; readonly [key: string]: unknown };

export interface McpToolCallResult {
	readonly content: readonly McpContentBlock[];
	readonly isError: boolean;
	readonly structuredContent?: unknown;
}

export interface McpServerInfo {
	readonly name?: string;
	readonly version?: string;
}

export interface McpClientOptions {
	/** Server label used in error messages. */
	readonly name: string;
	readonly transport: StdioTransportOptions;
	readonly requestTimeoutMs?: number;
	readonly handshakeTimeoutMs?: number;
	/** Client identity reported during the handshake. */
	readonly clientInfo?: { readonly name: string; readonly version: string };
}

interface PendingRequest {
	readonly resolve: (result: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
	readonly method: string;
	readonly deadline: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class McpClient {
	private readonly transport: McpStdioTransport;
	private readonly pending = new Map<JsonRpcId, PendingRequest>();
	private readonly requestTimeoutMs: number;
	private readonly handshakeTimeoutMs: number;
	private nextId = 1;
	private initialized = false;
	private closed = false;
	private exitReason: string | undefined;
	private info: McpServerInfo = {};
	private lastProtocolErrorReason: string | undefined;
	private readonly options: McpClientOptions;

	constructor(options: McpClientOptions) {
		this.options = options;
		this.requestTimeoutMs = validateMcpTimeoutMs(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
		this.handshakeTimeoutMs = validateMcpTimeoutMs(options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);
		this.transport = new McpStdioTransport(options.transport, {
			onMessage: (message) => this.handleMessage(message),
			onDecodeError: (reason) => {
				this.lastProtocolErrorReason = reason;
			},
			onExit: ({ code, signal }) => this.handleExit(code, signal),
		});
	}

	get name(): string {
		return this.options.name;
	}

	get serverInfo(): McpServerInfo {
		return this.info;
	}

	get ready(): boolean {
		return this.initialized && !this.closed;
	}

	/**
	 * Spawn the server and complete the MCP handshake. Safe to await once; a
	 * second call after a failure re-throws the recorded reason rather than
	 * silently reusing a dead process.
	 */
	async connect(): Promise<void> {
		if (this.closed) throw new Error(this.exitReason ?? `MCP server "${this.options.name}" is closed`);
		if (this.initialized) return;
		this.transport.start();

		const result = await this.request(
			"initialize",
			{
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: this.options.clientInfo ?? { name: "omk", version: "0.0.0" },
			},
			this.handshakeTimeoutMs,
		);
		this.info = parseMcpInitializeResult(result, this.options.name, SUPPORTED_PROTOCOL_VERSIONS);
		if (!this.transport.send({ jsonrpc: "2.0", method: "notifications/initialized" })) {
			throw new Error("mcp.initialized_notification_not_sent");
		}
		this.initialized = true;
	}

	/**
	 * Protocol-level liveness probe. Rejects when the server is closed, dead,
	 * or fails to answer within `timeoutMs`, so callers can tell a silently
	 * killed process apart from a genuinely connected one.
	 */
	async ping(timeoutMs?: number): Promise<void> {
		this.assertReady();
		await this.request("ping", {}, timeoutMs);
	}

	/**
	 * List the server's tools. Requires a completed handshake.
	 *
	 * Pagination is bounded three ways — an overall deadline, a page count, and
	 * a tool count — and a repeated cursor is a protocol error, so a misbehaving
	 * server cannot keep the listing loop alive indefinitely. Duplicate tool
	 * names in one listing are rejected instead of silently overwritten.
	 */
	async listTools(): Promise<McpToolSchema[]> {
		this.assertReady();
		const tools: McpToolSchema[] = [];
		const seenNames = new Set<string>();
		const seenCursors = new Set<string>();
		const deadline = performance.now() + LIST_TOOLS_TIMEOUT_MS;
		let cursor: string | undefined;
		const fail = (what: string): never => {
			throw new Error(`MCP server "${this.options.name}" ${what}`);
		};
		for (let page = 0; page < MAX_LIST_PAGES; page++) {
			const remainingMs = deadline - performance.now();
			if (remainingMs <= 0) fail(`tools/list exceeded ${LIST_TOOLS_TIMEOUT_MS}ms`);
			const result = await this.request(
				"tools/list",
				cursor ? { cursor } : {},
				Math.min(Math.ceil(remainingMs), this.requestTimeoutMs),
			);
			if (performance.now() >= deadline) fail(`tools/list exceeded ${LIST_TOOLS_TIMEOUT_MS}ms`);
			const record = isRecord(result) ? result : fail("returned an invalid tools/list result");
			const rawTools = Array.isArray(record.tools) ? record.tools : fail("returned an invalid tools/list result");
			for (const raw of rawTools) {
				if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) continue;
				if (seenNames.has(raw.name)) fail(`listed duplicate tool "${raw.name}"`);
				seenNames.add(raw.name);
				tools.push({
					name: raw.name,
					description: typeof raw.description === "string" ? raw.description : undefined,
					title: typeof raw.title === "string" ? raw.title : undefined,
					inputSchema: isRecord(raw.inputSchema) ? raw.inputSchema : undefined,
				});
				if (tools.length > MAX_LIST_TOOLS) fail(`exceeded ${MAX_LIST_TOOLS} tools`);
			}
			const next =
				typeof record.nextCursor === "string" && record.nextCursor.length > 0 ? record.nextCursor : undefined;
			if (!next) return tools;
			if (seenCursors.has(next)) fail("repeated tools/list cursor");
			seenCursors.add(next);
			cursor = next;
		}
		return fail(`exceeded ${MAX_LIST_PAGES} tools/list pages`);
	}

	/**
	 * Invoke a tool. A protocol-level failure rejects; a tool-level failure
	 * resolves with `isError: true`, matching MCP semantics so the model sees
	 * the server's own error text instead of a harness exception.
	 */
	async callTool(name: string, args: unknown, timeoutMs?: number): Promise<McpToolCallResult> {
		this.assertReady();
		const result = await this.request("tools/call", { name, arguments: args ?? {} }, timeoutMs);
		return validateMcpCallResult(result);
	}

	/** Terminate the server and reject anything still in flight. */
	close(): void {
		if (this.closed) return;
		this.transport.close();
		this.handleExit(null, null);
	}

	/** Physical direct-process/stdio settlement is separate from logical request rejection. */
	waitForTransportClose(): Promise<void> {
		return this.transport.waitForClose();
	}

	/** Why the server is unusable, when it is; includes the latest decode failure. */
	get failure(): string | undefined {
		return this.exitReason ?? this.lastProtocolErrorReason;
	}

	private assertReady(): void {
		if (this.closed) throw new Error(this.exitReason ?? `MCP server "${this.options.name}" is closed`);
		if (!this.initialized) throw new Error(`MCP server "${this.options.name}" is not initialized`);
	}

	private request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
		if (this.closed) {
			return Promise.reject(new Error(this.exitReason ?? `MCP server "${this.options.name}" is closed`));
		}
		if (this.pending.size >= MAX_PENDING_REQUESTS) {
			return Promise.reject(
				new Error(`MCP server "${this.options.name}" has ${MAX_PENDING_REQUESTS} pending requests (${method})`),
			);
		}
		const id = this.nextId++;
		const effectiveTimeout = validateMcpTimeoutMs(timeoutMs ?? this.requestTimeoutMs);
		const deadline = performance.now() + effectiveTimeout;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`MCP server "${this.options.name}" timed out after ${effectiveTimeout}ms on ${method}`));
			}, effectiveTimeout);
			timer.unref?.();
			this.pending.set(id, { resolve, reject, timer, method, deadline });
			try {
				if (effectiveTimeout === 0) throw new Error("mcp.request_deadline_exhausted");
				if (!this.transport.send({ jsonrpc: "2.0", id, method, params })) {
					throw new Error(`MCP server "${this.options.name}" is not writable (${method})`);
				}
			} catch {
				// Serialization can throw before the transport's write try/catch.
				this.pending.delete(id);
				clearTimeout(timer);
				reject(new Error("mcp.request_not_sent"));
			}
		});
	}

	private handleMessage(message: JsonRpcMessage): void {
		if (!isJsonRpcResponse(message)) return; // Server-initiated requests/notifications are not used yet.
		const response: JsonRpcResponse = message;
		const pending = this.pending.get(response.id);
		if (!pending) return;
		this.pending.delete(response.id);
		clearTimeout(pending.timer);
		if (performance.now() >= pending.deadline) {
			pending.reject(new Error(`MCP response arrived after deadline (${pending.method})`));
			return;
		}
		if (response.error) {
			pending.reject(new Error(`MCP server "${this.options.name}": ${formatJsonRpcError(response.error)}`));
			return;
		}
		pending.resolve(response.result);
	}

	private handleExit(code: number | null, signal: string | null): void {
		if (this.closed) return;
		this.closed = true;
		this.initialized = false;
		const detail = signal ? `signal ${signal}` : code === null ? "spawn failure" : `exit code ${code}`;
		const stderr = this.transport.stderr.trim();
		this.exitReason = `MCP server "${this.options.name}" stopped (${detail})${stderr ? `: ${stderr}` : ""}`;
		const reason = new Error(this.exitReason);
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			this.pending.delete(id);
			pending.reject(reason);
		}
	}
}
