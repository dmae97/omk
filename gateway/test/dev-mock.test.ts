import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEV_MOCK_UPSTREAM_KEY, MOCK_TEXT, createDevMockUpstream, mockMode } from "../scripts/dev-mock-upstream.ts";
import { issueKey } from "../src/admin.ts";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb, type Db } from "../src/db.ts";
import { createLogger } from "../src/logger.ts";
import { parseSse } from "./helpers/sse.ts";
import { realConfigDir } from "./helpers/harness.ts";

const WEATHER_TOOL = [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }];
const FOLLOWUP = [
	{ role: "user", content: "weather?" },
	{ role: "assistant", content: null, tool_calls: [{ id: MOCK_TEXT.toolCallId, type: "function", function: { name: "get_weather", arguments: MOCK_TEXT.toolArgs } }] },
	{ role: "tool", tool_call_id: MOCK_TEXT.toolCallId, content: "18C clear" },
];

interface H {
	db: Db;
	token: string;
	chat: (body: unknown) => Promise<Response>;
	close: () => Promise<void>;
}

async function makeH(): Promise<H> {
	const mock = createDevMockUpstream();
	await mock.start();
	const db = await openDb();
	const now = new Date("2026-11-11T14:00:00+09:00");
	const user = await issueKey(db, { label: "dev", plan: "A", now });
	const app = createApp({
		config: loadConfig(realConfigDir),
		db,
		upstreamApiKey: DEV_MOCK_UPSTREAM_KEY,
		upstreamBaseUrl: mock.url,
		now: () => now,
		log: createLogger(() => {}),
	});
	return {
		db,
		token: user.token,
		chat: (body) =>
			Promise.resolve(
				app.request("/v1/chat/completions", {
					method: "POST",
					headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
					body: JSON.stringify(body),
				}),
			),
		close: async () => {
			await mock.stop();
			await db.close();
		},
	};
}

function joined(chunks: any[], key: "content" | "reasoning_content"): string {
	let s = "";
	for (const c of chunks) {
		const d = c?.choices?.[0]?.delta;
		if (typeof d?.[key] === "string") s += d[key];
	}
	return s;
}

function toolArgs(chunks: any[]): { id?: string; name?: string; arguments: string; finish: string | null } {
	let id: string | undefined;
	let name: string | undefined;
	let args = "";
	let finish: string | null = null;
	for (const c of chunks) {
		const ch = c?.choices?.[0];
		if (ch?.finish_reason) finish = ch.finish_reason;
		for (const tc of ch?.delta?.tool_calls ?? []) {
			if (typeof tc?.id === "string") id = tc.id;
			if (typeof tc?.function?.name === "string") name = tc.function.name;
			if (typeof tc?.function?.arguments === "string") args += tc.function.arguments;
		}
	}
	return { id, name, arguments: args, finish };
}

describe("mockMode (deterministic triggers)", () => {
	it("picks a mode only from the request body", () => {
		expect(mockMode({ messages: [{ role: "user", content: "hi" }] })).toBe("json");
		expect(mockMode({ stream: true, thinking: { type: "disabled" } })).toBe("stream");
		expect(mockMode({ stream: true, thinking: { type: "enabled" } })).toBe("stream-reasoner");
		expect(mockMode({ tools: WEATHER_TOOL })).toBe("tool-json");
		expect(mockMode({ stream: true, tools: WEATHER_TOOL })).toBe("tool-stream");
		expect(mockMode({ tools: WEATHER_TOOL, messages: FOLLOWUP })).toBe("tool-followup-json");
		expect(mockMode({ stream: true, tools: WEATHER_TOOL, thinking: { type: "enabled" }, messages: FOLLOWUP })).toBe("tool-followup-stream");
	});
});

describe("dev mock modes through the gateway", () => {
	let h: H;
	beforeEach(async () => {
		h = await makeH();
	});
	afterEach(() => h.close());

	async function lastRow() {
		return (await h.db.query("SELECT * FROM usage_events")).rows[0];
	}

	it("default non-stream JSON is still mock reply", async () => {
		const r = await h.chat({ model: "OMK/coder", messages: [{ role: "user", content: "hi" }] });
		expect(r.status).toBe(200);
		const j = (await r.json()) as any;
		expect(j.model).toBe("OMK/coder");
		expect(j.system_fingerprint).toBeUndefined();
		expect(j.choices[0].message.content).toBe(MOCK_TEXT.reply);
		expect(j.choices[0].finish_reason).toBe("stop");
		expect(j.usage.completion_tokens).toBe(5);
		const row = await lastRow();
		expect(row).toMatchObject({ estimated: false, end_reason: "complete", completion_tokens: 5 });
	});

	it("coder stream: content deltas, usage chunk, [DONE]", async () => {
		const r = await h.chat({ model: "OMK/coder", messages: [{ role: "user", content: "hi" }], stream: true });
		expect(r.status).toBe(200);
		expect(r.headers.get("content-type") ?? "").toMatch(/text\/event-stream/);
		const { chunks, done } = parseSse(await r.text());
		expect(done).toBe(true);
		expect(joined(chunks, "content")).toBe(MOCK_TEXT.reply);
		expect(joined(chunks, "reasoning_content")).toBe("");
		expect(chunks.every((c) => c.model === "OMK/coder" && c.system_fingerprint === undefined)).toBe(true);
		const last = chunks.at(-1);
		expect(last.choices[0].finish_reason).toBe("stop");
		expect(last.usage.completion_tokens).toBe(5);
		expect((await lastRow()).estimated).toBe(false);
	});

	it("reasoner stream: reasoning_content then content, usage, [DONE]", async () => {
		const r = await h.chat({ model: "OMK/reasoner", messages: [{ role: "user", content: "hi" }], stream: true });
		expect(r.status).toBe(200);
		const { chunks, done } = parseSse(await r.text());
		expect(done).toBe(true);
		expect(joined(chunks, "reasoning_content")).toBe(MOCK_TEXT.reasoning);
		expect(joined(chunks, "content")).toBe(MOCK_TEXT.reply);
		const last = chunks.at(-1);
		expect(last.model).toBe("OMK/reasoner");
		expect(last.choices[0].finish_reason).toBe("stop");
		expect(last.usage.completion_tokens_details.reasoning_tokens).toBe(7);
		expect((await lastRow()).reasoning_tokens).toBe(7);
	});

	it("tools, non-stream: tool_calls with finish_reason tool_calls", async () => {
		const r = await h.chat({ model: "OMK/coder", messages: [{ role: "user", content: "weather?" }], tools: WEATHER_TOOL });
		expect(r.status).toBe(200);
		const j = (await r.json()) as any;
		expect(j.choices[0].finish_reason).toBe("tool_calls");
		expect(j.choices[0].message.tool_calls).toEqual([
			{ id: MOCK_TEXT.toolCallId, type: "function", function: { name: "get_weather", arguments: MOCK_TEXT.toolArgs } },
		]);
		expect((await lastRow()).finish_reason).toBe("tool_calls");
	});

	it("tools, stream: tool_calls deltas reconstruct the call and finish_reason tool_calls", async () => {
		const r = await h.chat({ model: "OMK/coder", messages: [{ role: "user", content: "weather?" }], tools: WEATHER_TOOL, stream: true });
		expect(r.status).toBe(200);
		const { chunks, done } = parseSse(await r.text());
		expect(done).toBe(true);
		expect(toolArgs(chunks)).toEqual({ id: MOCK_TEXT.toolCallId, name: "get_weather", arguments: MOCK_TEXT.toolArgs, finish: "tool_calls" });
		expect(chunks.at(-1).usage).toBeTruthy();
		expect((await lastRow()).finish_reason).toBe("tool_calls");
	});

	it("follow-up with a tool result returns a normal answer (non-stream and stream)", async () => {
		const json = await h.chat({ model: "OMK/coder", messages: FOLLOWUP, tools: WEATHER_TOOL });
		expect(json.status).toBe(200);
		const j = (await json.json()) as any;
		expect(j.choices[0].finish_reason).toBe("stop");
		expect(j.choices[0].message.content).toBe(MOCK_TEXT.followup);
		expect(j.choices[0].message.tool_calls).toBeUndefined();

		const stream = await h.chat({ model: "OMK/coder", messages: FOLLOWUP, tools: WEATHER_TOOL, stream: true });
		expect(stream.status).toBe(200);
		const { chunks, done } = parseSse(await stream.text());
		expect(done).toBe(true);
		expect(joined(chunks, "content")).toBe(MOCK_TEXT.followup);
		expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
	});

	it("reasoner follow-up includes reasoning then the same normal answer", async () => {
		const r = await h.chat({ model: "OMK/reasoner", messages: FOLLOWUP, tools: WEATHER_TOOL, stream: true });
		expect(r.status).toBe(200);
		const { chunks, done } = parseSse(await r.text());
		expect(done).toBe(true);
		expect(joined(chunks, "reasoning_content")).toBe(MOCK_TEXT.reasoning);
		expect(joined(chunks, "content")).toBe(MOCK_TEXT.followup);
		expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
	});
});
