import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BRAND_RE } from "../src/config.js";
import { enqueueOutbox } from "../src/store.js";
import { editJson, makeHarness, msg, okJson, tempConfig, U, type Harness } from "./helpers/harness.js";

describe("T-12 Polar outbox (outbox only, no network)", () => {
	let h: Harness;
	let fetched: string[] = [];
	const realFetch = globalThis.fetch;
	beforeAll(async () => {
		h = await makeHarness();
		globalThis.fetch = ((input: any, init?: any) => {
			fetched.push(String(typeof input === "string" ? input : (input.url ?? input)));
			return realFetch(input, init);
		}) as typeof fetch;
	});
	afterAll(async () => {
		globalThis.fetch = realFetch;
		await h.close();
	});

	it("one outbox row per usage event, keyed by the event id, public model only, within Polar metadata limits", async () => {
		h.mock.setDefault(okJson("deepseek-flash", U(100, 200, 220, 150)));
		await h.chat(h.users.plain!.token, { model: "OMK/reasoner", messages: msg() });
		const ev = (await h.db.query("SELECT * FROM usage_events")).rows[0];
		const rows = (await h.db.query("SELECT * FROM polar_outbox")).rows;
		expect(rows).toHaveLength(1);
		expect(rows[0].external_id).toBe(ev.id);
		expect(rows[0].sent_at).toBeNull();
		const p = rows[0].payload;
		expect(p).toMatchObject({ name: "omk_usage", external_customer_id: h.users.plain!.userId, external_id: ev.id });
		expect(p.timestamp).toBe(new Date(ev.ts_start).toISOString());
		expect(p.metadata).toMatchObject({ model: "OMK/reasoner", input_miss_tokens: 200, input_hit_tokens: 100, output_tokens: 220, reasoning_tokens: 150, answer_tokens: 70, total_tokens: 520, peak: false, estimated: false, cost_nano_usd: 324600, price_table_version: "2026-11-11" });
		const keys = Object.keys(p.metadata);
		expect(keys.length).toBeLessThanOrEqual(50);
		for (const k of keys) {
			expect(k.length).toBeLessThanOrEqual(40);
			const v = p.metadata[k];
			expect(["string", "number", "boolean"]).toContain(typeof v);
			if (typeof v === "string") expect(v.length).toBeLessThanOrEqual(500);
		}
		expect(BRAND_RE.test(JSON.stringify(p))).toBe(false);
	});

	it("dedup: re-enqueueing the same external_id (a retry) is a no-op", async () => {
		const ev = (await h.db.query("SELECT id FROM usage_events")).rows[0];
		expect(await enqueueOutbox(h.db, ev.id, { name: "omk_usage" })).toBe(false);
		expect(await enqueueOutbox(h.db, ev.id, { name: "omk_usage" })).toBe(false);
		expect((await h.db.query("SELECT count(*)::int n FROM polar_outbox")).rows[0].n).toBe(1);
		expect(await enqueueOutbox(h.db, "evt_new", { name: "omk_usage" })).toBe(true);
	});

	it("no network call other than the upstream (mock) was made by anything, outbox included", () => {
		expect(fetched.length).toBeGreaterThan(0);
		for (const u of fetched) expect(u.startsWith(h.mock.url), u).toBe(true);
	});
});

describe("T-19 /v1/models and routing", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await makeHarness();
	});
	afterAll(() => h.close());

	it("exactly two entries (no third ID), 1A fields, owned_by omk", async () => {
		const r = await h.call("/v1/models", { token: h.users.plain!.token });
		expect(r.status).toBe(200);
		const j = await r.json();
		expect(j.object).toBe("list");
		expect(j.data.map((m: any) => m.id)).toEqual(["OMK/coder", "OMK/reasoner"]);
		for (const m of j.data) {
			expect(m).toMatchObject({ object: "model", owned_by: "omk" });
			expect(m.omk.input_modalities).toEqual(["text"]);
			expect(m.omk.context_length).toBe(1_000_000);
		}
		expect(j.data[0].omk.thinking).toBe("off");
		expect(j.data[1].omk).toMatchObject({ thinking: "always", reasoning_effort: ["low", "high", "max"], max_tokens_ceiling: 32768 });
		expect(j.data[0].omk).not.toHaveProperty("max_tokens_ceiling"); // coder ceiling is unset in config
		expect(BRAND_RE.test(JSON.stringify(j))).toBe(false);
	});

	it("base URL includes /v1: only /v1/* is served (no double /v1, no bare /chat/completions)", async () => {
		const t = h.users.plain!.token;
		expect((await h.call("/v1/models", { token: t })).status).toBe(200);
		expect((await h.call("/v1/v1/models", { token: t })).status).toBe(404);
		expect((await h.call("/models", { token: t })).status).toBe(404);
		expect((await h.call("/chat/completions", { method: "POST", token: t, body: {} })).status).toBe(404);
	});

	it("/v1/models requires a token", async () => {
		expect((await h.call("/v1/models", {})).status).toBe(401);
	});
});

describe("T-05 config-only mapping switch", () => {
	it("editing the reasoner row in models.json (no code change) sends the larger upstream model and its prices", async () => {
		const before = await makeHarness();
		before.mock.setDefault(okJson("x", U(500, 700, 900, 600)));
		await before.chat(before.users.plain!.token, { model: "OMK/reasoner", messages: msg() });
		expect(before.mock.requests[0]!.body.model).toBe("deepseek-flash");
		const flash = (await before.db.query("SELECT billed_cost_nano_usd::float8 b, model_upstream FROM usage_events")).rows[0];
		await before.close();

		const dir = tempConfig((d) => editJson(d, "models.json", (m) => (m.models["OMK/reasoner"].upstream = "deepseek-v4-pro")));
		const after = await makeHarness({ configDir: dir });
		try {
			after.mock.setDefault(okJson("x", U(500, 700, 900, 600)));
			await after.chat(after.users.plain!.token, { model: "OMK/reasoner", messages: msg() });
			await after.chat(after.users.plain!.token, { model: "OMK/coder", messages: msg() });
			expect(after.mock.requests.map((r) => r.body.model)).toEqual(["deepseek-v4-pro", "deepseek-flash"]);
			const rows = (await after.db.query("SELECT billed_cost_nano_usd::float8 b, model_upstream, model_public FROM usage_events ORDER BY ts_start, id")).rows;
			const pro = rows.find((r) => r.model_public === "OMK/reasoner")!;
			expect(pro.model_upstream).toBe("deepseek-v4-pro");
			expect(pro.b).toBe(4_510_000); // 500*44 + 700*1320 + 900*3960 nano-USD
			expect(flash.model_upstream).toBe("deepseek-flash");
			expect(flash.b).toBe(500 * 6 + 700 * 300 + 900 * 1200);
			// still exactly two public IDs
			const j = await (await after.call("/v1/models", { token: after.users.plain!.token })).json();
			expect(j.data.map((m: any) => m.id)).toEqual(["OMK/coder", "OMK/reasoner"]);
			// and the response model is the public ID, not the upstream one
			const r = await after.chat(after.users.plain!.token, { model: "OMK/reasoner", messages: msg() });
			expect((await r.json()).model).toBe("OMK/reasoner");
		} finally {
			await after.close();
		}
	});
	void vi;
});
