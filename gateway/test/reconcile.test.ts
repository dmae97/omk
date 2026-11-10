import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkInvariants, compareToUpstream, reportFromDb } from "../src/reconcile.js";
import { editJson, gatewayRoot, makeHarness, realConfigDir, tempConfig, type Harness } from "./helpers/harness.js";
import { parseSse, usageOf } from "./helpers/sse.js";

interface Case {
	id: string;
	description: string;
	upstreamFile: string;
	clock: string;
	model: string;
	user: string;
	request: Record<string, any>;
	configSwap?: Record<string, string>;
	expect: { peak: boolean; upstreamModel: string; stream: boolean; effort?: string; keepAlive?: number; replay?: boolean };
}

const cases: Case[] = JSON.parse(readFileSync(join(gatewayRoot, "test/fixtures/cases.json"), "utf8"));
const upstreamText = (c: Case) => readFileSync(join(gatewayRoot, "test/fixtures/upstream", c.upstreamFile), "utf8");
const rawPrices = JSON.parse(readFileSync(join(realConfigDir, "prices.json"), "utf8"));

// Independent cost oracle (plain float math from the raw price file, rounded to nano-USD).
const oracle = (upModel: string, tier: "peak" | "offpeak", u: any) => {
	const p = rawPrices.models[upModel][tier];
	const hit = u.prompt_cache_hit_tokens;
	const miss = u.prompt_cache_miss_tokens;
	return Math.round((hit * p.hit + miss * p.miss + u.completion_tokens * p.out) * 1000);
};

const results: { id: string; ok: boolean; problems: string[] }[] = [];
let h: Harness;
let h17: Harness;

beforeAll(async () => {
	h = await makeHarness();
	const dir = tempConfig((d) => editJson(d, "models.json", (m) => (m.models["OMK/reasoner"].upstream = "deepseek-v4-pro")));
	h17 = await makeHarness({ configDir: dir });
});
afterAll(async () => {
	await h.close();
	await h17.close();
});

describe("reconciliation fixtures R01-R20: metered tokens == upstream usage", () => {
	it.each(cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
		const hh = c.configSwap ? h17 : h;
		hh.mock.reset();
		const raw = upstreamText(c);
		hh.mock.enqueue(c.upstreamFile.endsWith(".sse") ? { kind: "sse", body: raw } : { kind: "json", body: JSON.parse(raw) });
		hh.clock.now = new Date(c.clock);
		const res = await hh.chat(hh.users[c.user]!.token, { model: c.model, ...c.request });
		expect(res.status).toBe(200);
		const text = await res.text();
		const rid = res.headers.get("x-request-id")!;

		// what the client received: usage identical to upstream, public model ID only
		let clientUsage: any;
		let upstreamUsage: any;
		if (c.expect.stream) {
			const s = parseSse(text);
			expect(s.done).toBe(true);
			clientUsage = usageOf(s.chunks);
			upstreamUsage = usageOf(parseSse(raw).chunks);
			for (const ch of s.chunks) expect(ch.model).toBe(c.model);
			if (c.expect.keepAlive !== undefined) expect(s.comments).toBe(c.expect.keepAlive);
		} else {
			const j = JSON.parse(text);
			clientUsage = j.usage;
			upstreamUsage = JSON.parse(raw).usage;
			expect(j.model).toBe(c.model);
		}
		expect(clientUsage).toEqual(upstreamUsage);

		// what the mock saw
		const seen = hh.mock.requests[0]!;
		expect(seen.authOk).toBe(true);
		expect(seen.body.model).toBe(c.expect.upstreamModel);
		expect(seen.body.thinking).toEqual({ type: c.model === "OMK/coder" ? "disabled" : "enabled" });
		if (c.expect.effort) expect(seen.body.reasoning_effort).toBe(c.expect.effort);
		else expect(seen.body.reasoning_effort).toBeUndefined();
		if (c.expect.stream) expect(seen.body.stream_options).toEqual({ include_usage: true });
		if (c.expect.replay) expect(seen.body.messages[1].reasoning_content).toBe("I should call the tool.");

		// what was metered
		const r = await hh.db.query("SELECT *, billed_cost_nano_usd::float8 b, upstream_cost_nano_usd::float8 u FROM usage_events WHERE request_id=$1", [rid]);
		expect(r.rows).toHaveLength(1);
		const row = r.rows[0]!;
		const problems = [...compareToUpstream(row, upstreamUsage), ...checkInvariants(row)];
		const finish = (c.expect.stream ? parseSse(raw).chunks.map((x) => x.choices?.[0]?.finish_reason).filter(Boolean).at(-1) : JSON.parse(raw).choices[0].finish_reason) as string;
		if (row.finish_reason !== finish) problems.push(`finish_reason ${row.finish_reason} != ${finish}`);
		if (row.peak !== c.expect.peak) problems.push(`peak ${row.peak} != ${c.expect.peak}`);
		if (row.b !== oracle(c.expect.upstreamModel, "peak", upstreamUsage)) problems.push("billed cost != peak oracle");
		if (row.u !== oracle(c.expect.upstreamModel, c.expect.peak ? "peak" : "offpeak", upstreamUsage)) problems.push("upstream cost != oracle");
		if (row.estimated !== false || row.usage_anomaly !== false) problems.push("unexpected estimated/anomaly flag");
		if (row.model_public !== c.model || row.model_upstream !== c.expect.upstreamModel) problems.push("model mapping");
		if (row.price_table_version !== "2026-11-11") problems.push("price table version");
		expect(new Date(row.ts_start).toISOString()).toBe(new Date(c.clock).toISOString());
		expect(problems).toEqual([]);
		results.push({ id: c.id, ok: problems.length === 0, problems });
	});

	it("all 20 fixtures reconcile 100% and the report keeps estimated rows separate", async () => {
		expect(cases).toHaveLength(20);
		expect(cases.map((c) => c.id)).toEqual(Array.from({ length: 20 }, (_, i) => `R${String(i + 1).padStart(2, "0")}`));
		expect(results.filter((r) => r.ok)).toHaveLength(20);
		const rep = await reportFromDb(h.db);
		const rep17 = await reportFromDb(h17.db);
		expect(rep.exact.rows + rep17.exact.rows).toBe(20);
		expect(rep.estimated.rows + rep17.estimated.rows).toBe(0);
		expect(rep.invariant_violations).toEqual([]);
		console.log(`reconciliation: ${results.filter((r) => r.ok).length}/20 fixtures exact (0 estimated)`);
	});
});
