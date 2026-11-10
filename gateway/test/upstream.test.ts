import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkInvariants, reportFromDb } from "../src/reconcile.ts";
import { editJson, makeHarness, msg, okJson, tempConfig, U, type Harness } from "./helpers/harness.ts";

const chunk = (delta: object, finish: string | null = null, usage?: object) =>
	`data: ${JSON.stringify({ id: "x", model: "up", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => Promise<boolean> | boolean, ms = 3000) {
	const t = Date.now();
	while (Date.now() - t < ms) {
		if (await fn()) return;
		await sleep(25);
	}
	throw new Error("condition not met in time");
}

describe("T-10 upstream failures: neutral error, no usage row, no double billing", () => {
	let h: Harness;
	beforeEach(async () => {
		h = await makeHarness();
	});
	afterEach(() => h.close());
	const rows = async () => (await h.db.query("SELECT count(*)::int n FROM usage_events")).rows[0].n as number;
	const free = async () => {
		expect((await h.db.query("SELECT count(*)::int n FROM reservations")).rows[0].n).toBe(0);
		expect(h.mock.requests.length).toBeGreaterThan(0);
	};

	it("upstream 429 -> 429 rate_limited with the upstream Retry-After, one upstream call (no retry)", async () => {
		h.mock.enqueue({ kind: "json", status: 429, body: { error: {} }, headers: { "retry-after": "7" } });
		const r = await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg() });
		expect(r.status).toBe(429);
		expect(r.headers.get("retry-after")).toBe("7");
		expect((await r.json()).error.code).toBe("rate_limited");
		expect(h.mock.requests).toHaveLength(1);
		expect(await rows()).toBe(0);
		await free();
	});

	it.each([500, 502, 503, 401, 402])("upstream %s -> 502 upstream_unavailable", async (status) => {
		h.mock.enqueue({ kind: "json", status, body: { error: { message: "x" } } });
		const r = await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg() });
		expect(r.status).toBe(502);
		expect((await r.json()).error).toMatchObject({ code: "upstream_unavailable", type: "api_error" });
		expect(await rows()).toBe(0);
		await free();
	});

	it("upstream 400 -> neutral 400 invalid_request", async () => {
		h.mock.enqueue({ kind: "json", status: 400, body: { error: { message: "bad" } } });
		const r = await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg() });
		expect(r.status).toBe(400);
		expect((await r.json()).error.code).toBe("invalid_request");
		await free();
	});

	it("timeout -> 503 and the reservation + concurrency slot are released", async () => {
		const dir = tempConfig((d) => editJson(d, "gateway.json", (g) => (g.upstream_timeout_ms = 150)));
		await h.close();
		h = await makeHarness({ configDir: dir });
		h.mock.setDefault({ kind: "hang" });
		const r = await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg() });
		expect(r.status).toBe(503);
		expect((await r.json()).error.code).toBe("upstream_unavailable");
		expect(await rows()).toBe(0);
		await free();
	});

	it("upstream key missing -> 503, nothing is sent, and no usage", async () => {
		await h.close();
		h = await makeHarness({ upstreamKey: null });
		const r = await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg() });
		expect(r.status).toBe(503);
		expect(h.mock.requests).toHaveLength(0);
		expect(await rows()).toBe(0);
	});

	it("a wrong upstream key is our problem, never the user's: 502, not 401", async () => {
		await h.close();
		h = await makeHarness({ upstreamKey: "WRONG_KEY_FOR_TEST" });
		const r = await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg() });
		expect(r.status).toBe(502);
		expect(h.mock.requests[0]!.authOk).toBe(false);
	});

	it("a user retry after a failure is billed once", async () => {
		h.mock.enqueue({ kind: "json", status: 500, body: {} });
		h.mock.enqueue(okJson("up", U(10, 10, 5)));
		const t = h.users.plain!.token;
		expect((await h.chat(t, { model: "OMK/coder", messages: msg() })).status).toBe(502);
		expect((await h.chat(t, { model: "OMK/coder", messages: msg() })).status).toBe(200);
		expect(await rows()).toBe(1);
		expect(Number((await h.db.query("SELECT tokens::float8 t FROM usage_monthly")).rows[0].t)).toBe(25);
	});
});

describe("T-11 aborted / truncated streams: estimate, estimated=true, never the reserved max", () => {
	let h: Harness;
	let server: ReturnType<typeof serve>;
	let base = "";
	beforeEach(async () => {
		h = await makeHarness();
		server = serve({ fetch: h.app.fetch, port: 0, hostname: "127.0.0.1" });
		await new Promise((r) => server.once("listening", r));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterEach(async () => {
		(server as any).closeAllConnections?.();
		await new Promise((r) => server.close(() => r(null)));
		await h.close();
	});

	it("client aborts mid-stream: upstream request aborted, estimated row (input from request body, all cache miss; output from received text)", async () => {
		let release!: () => void;
		const hold = new Promise<void>((r) => (release = r));
		const first = chunk({ role: "assistant", content: "", reasoning_content: "" }) + chunk({ reasoning_content: "x".repeat(40) }) + chunk({ content: "y".repeat(80) });
		h.mock.enqueue({ kind: "sse-slow", first, then: () => hold });
		const ac = new AbortController();
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: { authorization: `Bearer ${h.users.plain!.token}`, "content-type": "application/json" },
			body: JSON.stringify({ model: "OMK/reasoner", messages: msg("p".repeat(100)), stream: true, max_tokens: 20000 }),
			signal: ac.signal,
		});
		expect(res.status).toBe(200);
		const reader = res.body!.getReader();
		let got = "";
		const dec = new TextDecoder();
		while (!got.includes("yyyy")) got += dec.decode((await reader.read()).value);
		ac.abort();
		await until(() => h.mock.requests[0]!.aborted); // the gateway aborted its upstream request
		release();
		await until(async () => (await h.db.query("SELECT count(*)::int n FROM usage_events")).rows[0].n === 1);
		const row = (await h.db.query("SELECT * FROM usage_events")).rows[0];
		expect(row).toMatchObject({ estimated: true, end_reason: "client_abort", prompt_tokens: 25, cache_hit_tokens: 0, cache_miss_tokens: 25, reasoning_tokens: 10, completion_tokens: 30, answer_tokens: 20, total_tokens: 55, finish_reason: null, upstream_usage_json: null });
		expect(checkInvariants(row)).toEqual([]);
		expect(row.total_tokens).toBeLessThan(20000); // never the reserved max
		await until(() => h.mock.requests[0]!.aborted);
		expect((await h.db.query("SELECT count(*)::int n FROM reservations")).rows[0].n).toBe(0);
		const ob = (await h.db.query("SELECT payload FROM polar_outbox")).rows[0].payload;
		expect(ob.metadata.estimated).toBe(true);
		const rep = await reportFromDb(h.db);
		expect(rep.estimated.rows).toBe(1);
		expect(rep.exact.rows).toBe(0);
	});

	it("reasoner stream aborted during thinking (only reasoning_content received): output estimate counts reasoning chars, not ~0", async () => {
		let release!: () => void;
		const hold = new Promise<void>((r) => (release = r));
		const first = chunk({ role: "assistant", content: "", reasoning_content: "" }) + chunk({ reasoning_content: "x".repeat(40) });
		h.mock.enqueue({ kind: "sse-slow", first, then: () => hold });
		const ac = new AbortController();
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: { authorization: `Bearer ${h.users.plain!.token}`, "content-type": "application/json" },
			body: JSON.stringify({ model: "OMK/reasoner", messages: msg("p".repeat(100)), stream: true, max_tokens: 20000 }),
			signal: ac.signal,
		});
		expect(res.status).toBe(200);
		const reader = res.body!.getReader();
		let got = "";
		const dec = new TextDecoder();
		while (!got.includes("xxxxx")) got += dec.decode((await reader.read()).value);
		ac.abort();
		await until(() => h.mock.requests[0]!.aborted);
		release();
		await until(async () => (await h.db.query("SELECT count(*)::int n FROM usage_events")).rows[0].n === 1);
		const row = (await h.db.query("SELECT * FROM usage_events")).rows[0];
		// 40 reasoning chars / 4 = 10 tokens; no content, so answer is 0 and completion is not ~0
		expect(row).toMatchObject({ estimated: true, end_reason: "client_abort", prompt_tokens: 25, cache_hit_tokens: 0, cache_miss_tokens: 25, reasoning_tokens: 10, completion_tokens: 10, answer_tokens: 0, total_tokens: 35, finish_reason: null, upstream_usage_json: null });
		expect(checkInvariants(row)).toEqual([]);
		expect((await h.db.query("SELECT count(*)::int n FROM reservations")).rows[0].n).toBe(0);
	});

	it("upstream ends normally but without usage: estimated, flagged, reconciliation keeps it separate", async () => {
		h.mock.enqueue({ kind: "sse", body: chunk({ content: "z".repeat(21) }, "stop") + "data: [DONE]\n\n" });
		h.mock.enqueue(okJson("up", U(5, 5, 4)));
		const t = h.users.plain!.token;
		await (await h.chat(t, { model: "OMK/coder", messages: msg(), stream: true })).text();
		await (await h.chat(t, { model: "OMK/coder", messages: msg() })).text();
		const rows = (await h.db.query("SELECT * FROM usage_events ORDER BY ts_start, id")).rows;
		const est = rows.find((r) => r.estimated)!;
		expect(est).toMatchObject({ end_reason: "upstream_ended_without_usage", prompt_tokens: 1, cache_hit_tokens: 0, cache_miss_tokens: 1, completion_tokens: 6, total_tokens: 7, finish_reason: "stop" });
		expect(Number(est.billed_cost_nano_usd)).toBe(1 * 300 + 6 * 1200); // input as cache miss + output, both at the peak price
		const rep = await reportFromDb(h.db);
		expect(rep.estimated).toMatchObject({ rows: 1, tokens: 7 });
		expect(rep.exact).toMatchObject({ rows: 1, tokens: 14 });
	});

	it("upstream connection dies mid-stream: row is estimated with end_reason upstream_error, slot released", async () => {
		h.mock.enqueue({ kind: "sse-slow", first: chunk({ content: "q".repeat(8) }), then: async () => { await sleep(150); h.mock.server.closeAllConnections(); } });
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: { authorization: `Bearer ${h.users.plain!.token}`, "content-type": "application/json" },
			body: JSON.stringify({ model: "OMK/coder", messages: msg(), stream: true }),
		});
		await res.text().catch(() => {});
		await until(async () => (await h.db.query("SELECT count(*)::int n FROM usage_events")).rows[0].n === 1);
		const row = (await h.db.query("SELECT * FROM usage_events")).rows[0];
		expect(row.estimated).toBe(true);
		expect(["upstream_error", "upstream_ended_without_usage"]).toContain(row.end_reason);
		expect((await h.db.query("SELECT count(*)::int n FROM reservations")).rows[0].n).toBe(0);
	});
});
