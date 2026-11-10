import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeHarness, msg, okJson, U, type Harness } from "./helpers/harness.ts";

let h: Harness;
beforeAll(async () => {
	h = await makeHarness();
	h.mock.setDefault(okJson("deepseek-flash", U(1, 1, 1)));
});
afterAll(() => h.close());
const last = () => h.mock.requests.at(-1)!.body;
const plain = () => h.users.plain!.token;

describe("T-06/T-16 thinking passthrough (omk payload table, spec 1.1)", () => {
	it("coder: the client sends neither field (reasoning:false) -> upstream still gets thinking disabled", async () => {
		await h.chat(plain(), { model: "OMK/coder", messages: msg(), max_tokens: 100 });
		expect(last().thinking).toEqual({ type: "disabled" });
		expect(last()).not.toHaveProperty("reasoning_effort");
	});
	it("coder: client-sent thinking enabled + effort is dropped, never trusted", async () => {
		await h.chat(plain(), { model: "OMK/coder", messages: msg(), thinking: { type: "enabled" }, reasoning_effort: "max" });
		expect(last().thinking).toEqual({ type: "disabled" });
		expect(last()).not.toHaveProperty("reasoning_effort");
	});
	it.each([
		["low", "low"],
		["high", "high"],
		["minimal", "low"],
		["medium", "high"],
	])("reasoner: thinking enabled + effort %s -> upstream %s", async (sent, want) => {
		await h.chat(plain(), { model: "OMK/reasoner", messages: msg(), thinking: { type: "enabled" }, reasoning_effort: sent });
		expect(last().thinking).toEqual({ type: "enabled" });
		expect(last().reasoning_effort).toBe(want);
	});
	it("reasoner: effort max is rejected with 429 for every user and never reaches upstream", async () => {
		const before = h.mock.requests.length;
		const r = await h.chat(h.users.maxeffort!.token, { model: "OMK/reasoner", messages: msg(), thinking: { type: "enabled" }, reasoning_effort: "max" });
		expect(r.status).toBe(429);
		expect(h.mock.requests.length).toBe(before);
	});
	it("reasoner: thinking omitted -> explicit enabled + the default effort from config", async () => {
		await h.chat(plain(), { model: "OMK/reasoner", messages: msg() });
		expect(last().thinking).toEqual({ type: "enabled" });
		expect(last().reasoning_effort).toBe("low");
	});
	it("reasoner: level off (thinking disabled) -> 400 thinking_required, no upstream call", async () => {
		const n = h.mock.requests.length;
		const r = await h.chat(plain(), { model: "OMK/reasoner", messages: msg(), thinking: { type: "disabled" } });
		expect(r.status).toBe(400);
		const e = (await r.json()).error;
		expect(e.code).toBe("thinking_required");
		expect(e.message).toBe("OMK/reasoner always uses thinking. Use OMK/coder for non-thinking requests.");
		expect(h.mock.requests).toHaveLength(n);
	});
	it("invalid effort / thinking shapes are 400", async () => {
		expect((await h.chat(plain(), { model: "OMK/reasoner", messages: msg(), reasoning_effort: "extreme" })).status).toBe(400);
		expect((await h.chat(plain(), { model: "OMK/reasoner", messages: msg(), thinking: { type: "auto" } })).status).toBe(400);
	});
});

describe("passthrough whitelist", () => {
	it("forwards the contracted fields (incl. response_format json_object, tools, reasoning_content replay) and drops the rest", async () => {
		await h.chat(plain(), {
			model: "OMK/coder",
			messages: [{ role: "assistant", content: null, reasoning_content: "r", tool_calls: [] }, { role: "user", content: "x" }],
			response_format: { type: "json_object" },
			tools: [{ type: "function", function: { name: "f", parameters: {} } }],
			tool_choice: "auto",
			temperature: 0.2,
			top_p: 0.9,
			stop: ["END"],
			max_completion_tokens: 77,
			user: "someone@example.test",
			user_id: "spoofed",
			foo: "bar",
			stream_options: { include_usage: false },
		});
		const b = last();
		expect(b.response_format).toEqual({ type: "json_object" });
		expect(b.tools).toHaveLength(1);
		expect(b.tool_choice).toBe("auto");
		expect(b.temperature).toBe(0.2);
		expect(b.top_p).toBe(0.9);
		expect(b.stop).toEqual(["END"]);
		expect(b.max_tokens).toBe(77);
		expect(b.messages[0].reasoning_content).toBe("r");
		expect(b.user_id).toBe(h.users.plain!.userId); // opaque per-user id, never client-supplied
		expect(b).not.toHaveProperty("user");
		expect(b).not.toHaveProperty("foo");
		expect(b).not.toHaveProperty("stream_options"); // non-stream: not sent
	});
	it("stream: include_usage is forced on regardless of the client", async () => {
		h.mock.enqueue({ kind: "sse", body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "a" }, finish_reason: "stop" }], usage: U(1, 1, 1) })}\n\ndata: [DONE]\n\n` });
		const r = await h.chat(plain(), { model: "OMK/coder", messages: msg(), stream: true, stream_options: { include_usage: false } });
		await r.text();
		expect(last().stream_options).toEqual({ include_usage: true });
	});
});

describe("T-15 image / file parts (text-only v1)", () => {
	it.each(["image_url", "image", "input_image", "file", "input_file"])("%s part -> 400 image_input_unsupported on both models, no upstream call", async (type) => {
		for (const model of ["OMK/coder", "OMK/reasoner"]) {
			const n = h.mock.requests.length;
			const r = await h.chat(plain(), { model, messages: [{ role: "user", content: [{ type: "text", text: "see" }, { type, [type]: { url: "u" } }] }] });
			expect(r.status).toBe(400);
			expect((await r.json()).error.code).toBe("image_input_unsupported");
			expect(h.mock.requests).toHaveLength(n);
		}
	});
	it("text parts are accepted", async () => {
		const r = await h.chat(plain(), { model: "OMK/coder", messages: [{ role: "user", content: [{ type: "text", text: "ok" }] }] });
		expect(r.status).toBe(200);
	});
});

describe("T-17 FIM / prefix", () => {
	it("prefix:true is 400 unsupported_feature on the reasoner AND (flag off) on the coder", async () => {
		for (const model of ["OMK/reasoner", "OMK/coder"]) {
			const r = await h.chat(plain(), { model, messages: [{ role: "user", content: "x" }, { role: "assistant", content: "pre", prefix: true }] });
			expect(r.status).toBe(400);
			expect((await r.json()).error.code).toBe("unsupported_feature");
		}
	});
	it("reasoning_content replay on the reasoner is NOT blocked", async () => {
		const r = await h.chat(plain(), { model: "OMK/reasoner", messages: [{ role: "user", content: "x" }, { role: "assistant", content: "a", reasoning_content: "why" }, { role: "user", content: "y" }] });
		expect(r.status).toBe(200);
	});
	it.each([["coder", "OMK/coder"], ["reasoner", "OMK/reasoner"]])("bare wire model name %s is accepted as %s", async (bare) => {
		const r = await h.chat(plain(), { model: bare, messages: msg() });
		expect(r.status).toBe(200);
	});
	it.each(["deepseek-flash", "qwen3-coder-plus", "experientiallabs/qwen3-coder-plus", "coder-plus", "Coder", "omk/coder", "OMK/flash", "deepseek/coder"])(
		"name %s is not mapped to an OMK model (403, no upstream call)",
		async (name) => {
			const before = h.mock.requests.length;
			const r = await h.chat(plain(), { model: name, messages: msg() });
			expect(r.status).toBe(403);
			expect(((await r.json()) as any).error.code).toBe("model_not_allowed");
			expect(h.mock.requests.length).toBe(before);
		},
	);
});
