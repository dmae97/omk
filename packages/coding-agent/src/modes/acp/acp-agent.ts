import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

export class AcpError extends Error {
	readonly code: number;
	constructor(code: number, message: string) {
		super(message);
		this.code = code;
	}
}

export interface AcpSession {
	prompt(text: string, emit: (text: string) => void): Promise<"end_turn" | "cancelled" | "max_tokens">;
	cancel(): Promise<void>;
	dispose(): void;
}

export type AcpSessionFactory = (cwd: string) => Promise<AcpSession>;

type SessionState = { session: AcpSession; running: boolean };

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new AcpError(-32602, "Expected object");
	return value as Record<string, unknown>;
}

function promptText(value: unknown): string {
	if (!Array.isArray(value) || value.length === 0) throw new AcpError(-32602, "Expected nonempty prompt");
	return value
		.map((item) => {
			const block = object(item);
			if (block.type === "text" && typeof block.text === "string") return block.text;
			if (block.type === "resource_link" && typeof block.uri === "string" && typeof block.name === "string") {
				// Links are context, never permission to retrieve files or URLs.
				return JSON.stringify({ resource_link: { name: block.name, uri: block.uri } });
			}
			throw new AcpError(-32602, "Unsupported prompt content");
		})
		.join("\n");
}

/** Restricted ACP v1 conversation profile. Does not grant tools or launch client MCP commands. */
export class AcpAgent {
	private initialized = false;
	private closed = false;
	private creating = 0;
	private readonly sessions = new Map<string, SessionState>();

	private readonly createSession: AcpSessionFactory;
	private readonly version: string;
	private readonly notify: (message: object) => void;
	constructor(createSession: AcpSessionFactory, version: string, notify: (message: object) => void) {
		this.createSession = createSession;
		this.version = version;
		this.notify = notify;
	}

	async dispatch(method: string, rawParams: unknown): Promise<object> {
		if (this.closed) throw new AcpError(-32000, "Connection closed");
		const params = object(rawParams);
		if (method === "initialize") {
			if (this.initialized) throw new AcpError(-32600, "Already initialized");
			if (!Number.isSafeInteger(params.protocolVersion) || Number(params.protocolVersion) < 1) {
				throw new AcpError(-32602, "Invalid protocolVersion");
			}
			this.initialized = true;
			return {
				protocolVersion: 1,
				agentInfo: { name: "omk", title: "OMK", version: this.version },
				agentCapabilities: {
					loadSession: false,
					promptCapabilities: { image: false, audio: false, embeddedContext: false },
					mcpCapabilities: { http: false, sse: false },
					_meta: { "omk/profile": "conversation-only", "omk/client-mcp": false },
				},
				authMethods: [],
			};
		}
		if (!this.initialized) throw new AcpError(-32000, "Initialize first");
		if (method === "session/new") {
			if (typeof params.cwd !== "string" || !isAbsolute(params.cwd))
				throw new AcpError(-32602, "cwd must be absolute");
			if (!Array.isArray(params.mcpServers) || params.mcpServers.length !== 0) {
				throw new AcpError(-32602, "This restricted profile requires an empty mcpServers list");
			}
			if (params.additionalDirectories !== undefined) throw new AcpError(-32602, "Additional roots unsupported");
			if (this.sessions.size + this.creating >= 8) throw new AcpError(-32000, "Session limit reached");
			this.creating++;
			try {
				const session = await this.createSession(params.cwd);
				if (this.closed) {
					session.dispose();
					throw new AcpError(-32000, "Connection closed");
				}
				const sessionId = randomUUID();
				this.sessions.set(sessionId, { session, running: false });
				return { sessionId };
			} finally {
				this.creating--;
			}
		}
		if (method !== "session/prompt" && method !== "session/cancel") throw new AcpError(-32601, "Method not found");
		const state = typeof params.sessionId === "string" ? this.sessions.get(params.sessionId) : undefined;
		if (!state) throw new AcpError(-32602, "Unknown session");
		if (method === "session/cancel") {
			await state.session.cancel();
			return {};
		}
		if (state.running) throw new AcpError(-32000, "Session busy");
		const text = promptText(params.prompt);
		state.running = true;
		try {
			const stopReason = await state.session.prompt(text, (delta) =>
				this.notify({
					jsonrpc: "2.0",
					method: "session/update",
					params: {
						sessionId: params.sessionId,
						update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: delta } },
					},
				}),
			);
			return { stopReason };
		} finally {
			state.running = false;
		}
	}

	async close(): Promise<void> {
		this.closed = true;
		await Promise.all(
			[...this.sessions.values()].map(async ({ session }) => {
				await session.cancel();
				session.dispose();
				return undefined;
			}),
		);
		this.sessions.clear();
	}
}
