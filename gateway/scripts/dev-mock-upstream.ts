// Deterministic mock upstream used by `npm run dev:mock` and the gateway tests that cover it.
// Mode is chosen only from the request body; see gateway/README.md "Dev mock modes".
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const DEV_MOCK_UPSTREAM_KEY = "mock-key-not-real";

export const MOCK_TEXT = {
	reply: "mock reply",
	reasoning: "Let me think step by step.",
	toolArgs: '{"city":"Seoul"}',
	toolCallId: "call_1",
	followup: "It's 18C and clear in Seoul.",
} as const;

export type MockMode = "json" | "stream" | "stream-reasoner" | "tool-json" | "tool-stream" | "tool-followup-json" | "tool-followup-stream";

function isObj(v: unknown): v is Record<string, any> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstToolName(body: any): string {
	const name = body?.tools?.[0]?.function?.name;
	return typeof name === "string" && name ? name : "get_weather";
}

function hasToolResult(body: any): boolean {
	return Array.isArray(body?.messages) && body.messages.some((m: any) => isObj(m) && m.role === "tool");
}

function hasTools(body: any): boolean {
	return Array.isArray(body?.tools) && body.tools.length > 0;
}

function thinkingOn(body: any): boolean {
	return body?.thinking?.type === "enabled";
}

export function mockMode(body: any): MockMode {
	const stream = body?.stream === true;
	if (hasToolResult(body)) return stream ? "tool-followup-stream" : "tool-followup-json";
	if (hasTools(body)) return stream ? "tool-stream" : "tool-json";
	if (stream) return thinkingOn(body) ? "stream-reasoner" : "stream";
	return "json";
}

function usage(opts: { prompt?: number; hit?: number; completion: number; reasoning?: number }) {
	const hit = opts.hit ?? 0;
	const prompt = opts.prompt ?? 10;
	const reasoning = opts.reasoning ?? 0;
	return {
		prompt_tokens: prompt,
		completion_tokens: opts.completion,
		total_tokens: prompt + opts.completion,
		prompt_tokens_details: { cached_tokens: hit },
		prompt_cache_hit_tokens: hit,
		prompt_cache_miss_tokens: prompt - hit,
		completion_tokens_details: { reasoning_tokens: reasoning },
	};
}

function modelOf(body: any): string {
	return typeof body?.model === "string" && body.model ? body.model : "up";
}

function jsonBody(model: string, message: Record<string, unknown>, finish: string, u: ReturnType<typeof usage>) {
	return {
		id: "chatcmpl-mock",
		object: "chat.completion",
		created: 1790000000,
		model,
		system_fingerprint: "fp_mock",
		choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }],
		usage: u,
	};
}

function sseChunk(model: string, delta: object, finish: string | null = null, u?: ReturnType<typeof usage>): string {
	const o: Record<string, unknown> = {
		id: "chatcmpl-mock",
		object: "chat.completion.chunk",
		created: 1790000000,
		model,
		system_fingerprint: "fp_mock",
		choices: [{ index: 0, delta, finish_reason: finish }],
	};
	if (u) o.usage = u;
	return `data: ${JSON.stringify(o)}\n\n`;
}

function sseDone(chunks: string[]): string {
	return `${chunks.join("")}data: [DONE]\n\n`;
}

/** Full HTTP response for one upstream chat-completions request. */
export function buildMockResponse(body: any): { contentType: string; body: string } {
	const mode = mockMode(body);
	const model = modelOf(body);
	if (mode === "json") {
		return {
			contentType: "application/json",
			body: JSON.stringify(jsonBody(model, { content: MOCK_TEXT.reply }, "stop", usage({ completion: 5 }))),
		};
	}
	if (mode === "tool-json") {
		return {
			contentType: "application/json",
			body: JSON.stringify(
				jsonBody(
					model,
					{
						content: null,
						tool_calls: [{ id: MOCK_TEXT.toolCallId, type: "function", function: { name: firstToolName(body), arguments: MOCK_TEXT.toolArgs } }],
					},
					"tool_calls",
					usage({ completion: 8 }),
				),
			),
		};
	}
	if (mode === "tool-followup-json") {
		const message = thinkingOn(body)
			? { content: MOCK_TEXT.followup, reasoning_content: MOCK_TEXT.reasoning }
			: { content: MOCK_TEXT.followup };
		const reasoning = thinkingOn(body) ? 7 : 0;
		return {
			contentType: "application/json",
			body: JSON.stringify(jsonBody(model, message, "stop", usage({ completion: 12, reasoning }))),
		};
	}
	if (mode === "stream") {
		return {
			contentType: "text/event-stream",
			body: sseDone([
				sseChunk(model, { role: "assistant", content: "" }),
				sseChunk(model, { content: MOCK_TEXT.reply }),
				sseChunk(model, { content: "" }, "stop", usage({ completion: 5 })),
			]),
		};
	}
	if (mode === "stream-reasoner") {
		return {
			contentType: "text/event-stream",
			body: sseDone([
				sseChunk(model, { role: "assistant", content: null, reasoning_content: "" }),
				sseChunk(model, { reasoning_content: MOCK_TEXT.reasoning }),
				sseChunk(model, { content: MOCK_TEXT.reply }),
				sseChunk(model, { content: "" }, "stop", usage({ completion: 12, reasoning: 7 })),
			]),
		};
	}
	if (mode === "tool-stream") {
		const name = firstToolName(body);
		const mid = Math.ceil(MOCK_TEXT.toolArgs.length / 2);
		return {
			contentType: "text/event-stream",
			body: sseDone([
				sseChunk(model, { role: "assistant", content: null, tool_calls: [{ index: 0, id: MOCK_TEXT.toolCallId, type: "function", function: { name, arguments: "" } }] }),
				sseChunk(model, { tool_calls: [{ index: 0, function: { arguments: MOCK_TEXT.toolArgs.slice(0, mid) } }] }),
				sseChunk(model, { tool_calls: [{ index: 0, function: { arguments: MOCK_TEXT.toolArgs.slice(mid) } }] }, "tool_calls", usage({ completion: 8 })),
			]),
		};
	}
	// tool-followup-stream
	const chunks = thinkingOn(body)
		? [
				sseChunk(model, { role: "assistant", content: null, reasoning_content: "" }),
				sseChunk(model, { reasoning_content: MOCK_TEXT.reasoning }),
				sseChunk(model, { content: MOCK_TEXT.followup }),
				sseChunk(model, { content: "" }, "stop", usage({ completion: 12, reasoning: 7 })),
			]
		: [
				sseChunk(model, { role: "assistant", content: "" }),
				sseChunk(model, { content: MOCK_TEXT.followup }),
				sseChunk(model, { content: "" }, "stop", usage({ completion: 12 })),
			];
	return { contentType: "text/event-stream", body: sseDone(chunks) };
}

export interface DevMockUpstream {
	url: string;
	requests: { path: string; body: any }[];
	start(): Promise<void>;
	stop(): Promise<void>;
}

/** Local HTTP server that serves `buildMockResponse`. Listens on 127.0.0.1:<ephemeral>. */
export function createDevMockUpstream(): DevMockUpstream {
	const requests: { path: string; body: any }[] = [];
	const server = createServer((req, res) => void handle(req, res, requests));
	const api: DevMockUpstream = {
		url: "",
		requests,
		async start() {
			await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
			api.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		},
		async stop() {
			server.closeAllConnections();
			await new Promise<void>((r) => server.close(() => r()));
		},
	};
	return api;
}

async function handle(req: IncomingMessage, res: ServerResponse, requests: { path: string; body: any }[]): Promise<void> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	let body: any = null;
	try {
		body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		res.writeHead(400, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: { message: "invalid json" } }));
		return;
	}
	requests.push({ path: req.url ?? "", body });
	const out = buildMockResponse(body);
	if (out.contentType === "text/event-stream") {
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
		// Write events one at a time so a client can abort mid-stream.
		const events = out.body.split("\n\n").filter((e) => e.length > 0);
		for (const ev of events) {
			if (res.destroyed) return;
			res.write(`${ev}\n\n`);
		}
		if (!res.destroyed) res.end();
		return;
	}
	res.writeHead(200, { "content-type": "application/json" });
	res.end(out.body);
}
