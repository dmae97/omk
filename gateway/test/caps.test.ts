import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkInvariants } from "../src/reconcile.ts";
import { editJson, makeHarness, msg, okJson, tempConfig, U, type Harness } from "./helpers/harness.ts";

describe("caps and reservation (values come from config tables)", () => {
	let h: Harness;
	beforeAll(async () => {
		h = await makeHarness();
	});
	afterAll(() => h.close());

	it("default max_tokens is injected when omitted (config table, per model)", async () => {
		h.mock.setDefault(okJson("deepseek-flash", U(1, 1, 1)));
		await h.chat(h.users.plain!.token, { model: "OMK/reasoner", messages: msg() });
		await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg() });
		expect(h.mock.requests.map((r) => r.body.max_tokens)).toEqual([32768, 8192]);
	});

	it("the reasoner ceiling is exactly the configured value: at-limit passes, one above is 429", async () => {
		h.mock.reset();
		h.mock.setDefault(okJson("deepseek-flash", U(1, 1, 1, 1)));
		expect((await h.chat(h.users.plain!.token, { model: "OMK/reasoner", messages: msg(), max_tokens: 32768 })).status).toBe(200);
		expect((await h.chat(h.users.plain!.token, { model: "OMK/reasoner", messages: msg(), max_tokens: 32769 })).status).toBe(429);
	});

	it("changing the ceiling in config.json changes behavior with no code change", async () => {
		const dir = tempConfig((d) => editJson(d, "limits.json", (l) => (l.per_request.max_tokens_ceiling["OMK/reasoner"] = 1000)));
		const hh = await makeHarness({ configDir: dir });
		try {
			hh.mock.setDefault(okJson("deepseek-flash", U(1, 1, 1, 1)));
			expect((await hh.chat(hh.users.plain!.token, { model: "OMK/reasoner", messages: msg(), max_tokens: 1001 })).status).toBe(429);
			expect((await hh.chat(hh.users.plain!.token, { model: "OMK/reasoner", messages: msg(), max_tokens: 1000 })).status).toBe(200);
		} finally {
			await hh.close();
		}
	});

	it("plans A and B come from config (5M / 20M), shared by coder and reasoner", async () => {
		const a = await (await h.call("/v1/account", { token: h.users.plain!.token })).json();
		const b = await (await h.call("/v1/account", { token: h.users.maxeffort!.token })).json();
		expect(a.quota.monthly_token_cap).toBe(5_000_000);
		expect(b.quota.monthly_token_cap).toBe(20_000_000);
		expect(a.quota.resets_at).toBe("2026-12-01T00:00:00+09:00");
		h.mock.reset();
		h.mock.setDefault(okJson("deepseek-flash", U(0, 600, 400, 0)));
		await h.chat(h.users.maxeffort!.token, { model: "OMK/coder", messages: msg() });
		await h.chat(h.users.maxeffort!.token, { model: "OMK/reasoner", messages: msg() });
		const after = await (await h.call("/v1/account", { token: h.users.maxeffort!.token })).json();
		expect(after.quota.used).toBe(2000);
	});

	it("usage resets with the KST month: same user, December is a fresh budget", async () => {
		await h.db.query("UPDATE users SET monthly_cap_override=1000 WHERE id=$1", [h.users.plain!.userId]);
		h.mock.reset();
		h.mock.setDefault(okJson("deepseek-flash", U(0, 900, 100)));
		h.clock.now = new Date("2026-11-30T23:59:59+09:00");
		expect((await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg(), max_tokens: 100 })).status).toBe(200);
		expect((await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg(), max_tokens: 100 })).status).toBe(429);
		h.clock.now = new Date("2026-12-01T00:00:00+09:00");
		expect((await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg(), max_tokens: 100 })).status).toBe(200);
		h.clock.now = new Date("2026-11-11T14:00:00+09:00");
	});

	it("every metered row satisfies the T-01 invariants", async () => {
		const rows = (await h.db.query("SELECT * FROM usage_events")).rows;
		expect(rows.length).toBeGreaterThan(5);
		for (const r of rows) expect(checkInvariants(r)).toEqual([]);
	});
});

describe("reservation (T-04) and per-key concurrency", () => {
	it("concurrent requests cannot overshoot the monthly cap; the over-budget one gets 429 with no upstream call", async () => {
		const h = await makeHarness();
		try {
			await h.db.query("UPDATE users SET monthly_cap_override=1000 WHERE id=$1", [h.users.plain!.userId]);
			let open!: () => void;
			const gate = new Promise<void>((r) => (open = r));
			const usage = U(0, 40, 10);
			h.mock.setDefault({ ...okJson("deepseek-flash", usage), gate });
			const t = h.users.plain!.token;
			const req = () => h.chat(t, { model: "OMK/coder", messages: msg(), max_tokens: 400 }); // reserves 400 + 1
			const p1 = req();
			const p2 = req();
			await new Promise((r) => setTimeout(r, 100)); // let both reserve
			const r3 = await req(); // would reserve 401 more: 1203 > 1000
			expect(r3.status).toBe(429);
			expect((await r3.json()).error.code).toBe("request_limit_exceeded");
			expect(r3.headers.get("retry-after")).toBe("1");
			expect(r3.headers.get("x-omk-retryable")).toBeNull(); // transient: in-flight reservations
			expect(h.mock.requests).toHaveLength(2);
			open();
			expect((await p1).status).toBe(200);
			expect((await p2).status).toBe(200);
			const used = Number((await h.db.query("SELECT tokens::float8 t FROM usage_monthly WHERE user_id=$1", [h.users.plain!.userId])).rows[0].t);
			expect(used).toBe(100);
			expect(used).toBeLessThanOrEqual(1000);
			expect((await h.db.query("SELECT count(*)::int n FROM reservations")).rows[0].n).toBe(0);
			expect((await req()).status).toBe(200); // reservations were released, budget is available again
		} finally {
			await h.close();
		}
	});

	it("a request whose reservation can never fit gets request_limit_exceeded with retryable=false", async () => {
		const h = await makeHarness();
		try {
			await h.db.query("UPDATE users SET monthly_cap_override=1000 WHERE id=$1", [h.users.plain!.userId]);
			const r = await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg(), max_tokens: 5000 });
			expect(r.status).toBe(429);
			expect((await r.json()).error.code).toBe("request_limit_exceeded");
			expect(r.headers.get("x-omk-retryable")).toBe("false");
			expect(r.headers.get("retry-after")).toBe("0");
		} finally {
			await h.close();
		}
	});

	it("concurrent_per_key: second in-flight request gets rate_limited, slot is freed afterwards", async () => {
		const dir = tempConfig((d) => editJson(d, "limits.json", (l) => (l.concurrent_per_key = 1)));
		const h = await makeHarness({ configDir: dir });
		try {
			let open!: () => void;
			const gate = new Promise<void>((r) => (open = r));
			h.mock.setDefault({ ...okJson("deepseek-flash", U(1, 1, 1)), gate });
			const t = h.users.plain!.token;
			const p1 = h.chat(t, { model: "OMK/coder", messages: msg() });
			await new Promise((r) => setTimeout(r, 100));
			const r2 = await h.chat(t, { model: "OMK/coder", messages: msg() });
			expect(r2.status).toBe(429);
			expect((await r2.json()).error.code).toBe("rate_limited");
			expect(r2.headers.get("retry-after")).toBe("1");
			open();
			expect((await p1).status).toBe(200);
			expect((await h.chat(t, { model: "OMK/coder", messages: msg() })).status).toBe(200);
			expect((await h.db.query("SELECT count(*)::int n FROM reservations")).rows[0].n).toBe(0);
		} finally {
			await h.close();
		}
	});
});
