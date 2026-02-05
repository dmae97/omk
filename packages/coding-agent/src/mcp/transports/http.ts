/**
 * MCP HTTP transport (Streamable HTTP).
 *
 * Implements JSON-RPC 2.0 over HTTP POST with optional SSE streaming.
 * Based on MCP spec 2025-03-26.
 */
import { readSseJson } from "@oh-my-pi/pi-utils";
import type {
	JsonRpcMessage,
	JsonRpcResponse,
	MCPHttpServerConfig,
	MCPSseServerConfig,
	MCPTransport,
} from "../../mcp/types";

/** Generate unique request ID */
function generateId(): string {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * HTTP transport for MCP servers.
 * Uses POST for requests, supports SSE responses.
 */
export class HttpTransport implements MCPTransport {
	private _connected = false;
	private sessionId: string | null = null;
	private sseConnection: AbortController | null = null;

	onClose?: () => void;
	onError?: (error: Error) => void;
	onNotification?: (method: string, params: unknown) => void;

	constructor(private config: MCPHttpServerConfig | MCPSseServerConfig) {}

	get connected(): boolean {
		return this._connected;
	}

	get url(): string {
		return this.config.url;
	}

	/**
	 * Mark transport as connected.
	 * HTTP doesn't need persistent connection, but we track state.
	 */
	async connect(): Promise<void> {
		if (this._connected) return;
		this._connected = true;
	}

	/**
	 * Start SSE listener for server-initiated messages.
	 * Optional - only needed if server sends notifications.
	 */
	async startSSEListener(): Promise<void> {
		if (!this._connected) return;
		if (this.sseConnection) return;

		this.sseConnection = new AbortController();
		const headers: Record<string, string> = {
			Accept: "text/event-stream",
			...this.config.headers,
		};

		if (this.sessionId) {
			headers["Mcp-Session-Id"] = this.sessionId;
		}

		try {
			const response = await fetch(this.config.url, {
				method: "GET",
				headers,
				signal: this.sseConnection.signal,
			});

			if (response.status === 405) {
				// Server doesn't support SSE listening, that's OK
				this.sseConnection = null;
				return;
			}

			if (!response.ok || !response.body) {
				this.sseConnection = null;
				return;
			}

			// Read SSE stream
			for await (const message of readSseJson<JsonRpcMessage>(response.body, this.sseConnection.signal)) {
				if (!this._connected) break;
				if ("method" in message && !("id" in message)) {
					this.onNotification?.(message.method, message.params);
				}
			}
		} catch (error) {
			if (error instanceof Error && error.name !== "AbortError") {
				this.onError?.(error);
			}
		} finally {
			this.sseConnection = null;
		}
	}

	async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
		if (!this._connected) {
			throw new Error("Transport not connected");
		}

		const id = generateId();
		const body = {
			jsonrpc: "2.0" as const,
			id,
			method,
			params: params ?? {},
		};

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			...this.config.headers,
		};

		if (this.sessionId) {
			headers["Mcp-Session-Id"] = this.sessionId;
		}

		const response = await fetch(this.config.url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});

		// Check for session ID in response
		const newSessionId = response.headers.get("Mcp-Session-Id");
		if (newSessionId) {
			this.sessionId = newSessionId;
		}

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`HTTP ${response.status}: ${text}`);
		}

		const contentType = response.headers.get("Content-Type") ?? "";

		// Handle SSE response
		if (contentType.includes("text/event-stream")) {
			return this.parseSSEResponse<T>(response, id);
		}

		// Handle JSON response
		const result = (await response.json()) as JsonRpcResponse;

		if (result.error) {
			throw new Error(`MCP error ${result.error.code}: ${result.error.message}`);
		}

		return result.result as T;
	}

	private async parseSSEResponse<T>(response: Response, expectedId: string | number): Promise<T> {
		if (!response.body) {
			throw new Error("No response body");
		}

		const timeout = this.config.timeout ?? 30000;

		const parse = async (): Promise<T> => {
			for await (const message of readSseJson<JsonRpcMessage>(response.body!)) {
				if ("id" in message && message.id === expectedId && ("result" in message || "error" in message)) {
					if (message.error) {
						throw new Error(`MCP error ${message.error.code}: ${message.error.message}`);
					}
					return message.result as T;
				}

				if ("method" in message && !("id" in message)) {
					this.onNotification?.(message.method, message.params);
				}
			}
			throw new Error(`No response received for request ID ${expectedId}`);
		};

		return Promise.race([
			parse(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error(`SSE response timeout after ${timeout}ms`)), timeout),
			),
		]);
	}

	async notify(method: string, params?: Record<string, unknown>): Promise<void> {
		if (!this._connected) {
			throw new Error("Transport not connected");
		}

		const body = {
			jsonrpc: "2.0" as const,
			method,
			params: params ?? {},
		};

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			...this.config.headers,
		};

		if (this.sessionId) {
			headers["Mcp-Session-Id"] = this.sessionId;
		}

		const response = await fetch(this.config.url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});

		// 202 Accepted is success for notifications
		if (!response.ok && response.status !== 202) {
			const text = await response.text();
			throw new Error(`HTTP ${response.status}: ${text}`);
		}
	}

	async close(): Promise<void> {
		if (!this._connected) return;
		this._connected = false;

		// Abort SSE listener
		if (this.sseConnection) {
			this.sseConnection.abort();
			this.sseConnection = null;
		}

		// Send session termination if we have a session
		if (this.sessionId) {
			try {
				const headers: Record<string, string> = {
					...this.config.headers,
					"Mcp-Session-Id": this.sessionId,
				};

				await fetch(this.config.url, {
					method: "DELETE",
					headers,
				});
			} catch {
				// Ignore termination errors
			}
			this.sessionId = null;
		}

		this.onClose?.();
	}
}

/**
 * Create and connect an HTTP transport.
 */
export async function createHttpTransport(config: MCPHttpServerConfig | MCPSseServerConfig): Promise<HttpTransport> {
	const transport = new HttpTransport(config);
	await transport.connect();
	return transport;
}
