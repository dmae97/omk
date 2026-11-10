import { describe, expect, it } from "vitest";
import { editJson, makeHarness, msg, okJson, tempConfig, U } from "./helpers/harness.ts";

const url = process.env.OMK_GATEWAY_DATABASE_URL;
const describePg = url ? describe : describe.skip;

describePg("monthly cap reservation races on real Postgres", () => {
	it(
		"concurrent reservations never exceed the monthly cap; over-budget requests get 429 and usage_events sums match",
		async () => {
			if (!url) return;
			const dir = tempConfig((d) =>
				editJson(d, "limits.json", (l) => {
					l.concurrent_per_key = 100;
					l.rpm_per_key = 1000;
				}),
			);
			const h = await makeHarness({ configDir: dir, databaseUrl: url });
			try {
				const cap = 10_000;
				const n = 50;
				const maxTokens = 500;
				const need = maxTokens + Math.ceil(2 / h.config.gateway.estimateCharsPerToken); // "hi" is 2 chars
				// Remaining cap R=10000; each reserve is > R/n*2 (400), so a naive check-then-insert overspends.
				expect(need).toBeGreaterThan((cap / n) * 2);

				await h.db.query("UPDATE users SET monthly_cap_override=$1 WHERE id=$2", [cap, h.users.plain!.userId]);
				let open!: () => void;
				const gate = new Promise<void>((r) => (open = r));
				const usage = U(0, 10, 5); // 15 tokens charged per success
				h.mock.setDefault({ ...okJson("deepseek-flash", usage), gate });

				const token = h.users.plain!.token;
				let rejected = 0;
				const pending = Array.from({ length: n }, () =>
					h.chat(token, { model: "OMK/coder", messages: msg(), max_tokens: maxTokens }).then((r) => {
						if (r.status !== 200) rejected++;
						return r;
					}),
				);

				const deadline = Date.now() + 20_000;
				while (h.mock.requests.length + rejected < n) {
					if (Date.now() > deadline) {
						throw new Error(`timed out waiting for reserves: upstream=${h.mock.requests.length} rejected=${rejected} of ${n}`);
					}
					await new Promise((r) => setTimeout(r, 25));
				}

				const reserved = Number(
					(await h.db.query("SELECT COALESCE(SUM(tokens),0)::float8 AS n FROM reservations WHERE user_id=$1", [h.users.plain!.userId])).rows[0].n,
				);
				const upstream = h.mock.requests.length;
				expect(reserved).toBe(upstream * need);
				expect(reserved).toBeLessThanOrEqual(cap);
				expect(reserved + need).toBeGreaterThan(cap); // cap is tight: one more reserve would not fit
				expect(upstream).toBe(Math.floor(cap / need));

				open();
				const results = await Promise.all(pending);
				const ok = results.filter((r) => r.status === 200);
				const denied = results.filter((r) => r.status === 429);
				expect(ok).toHaveLength(upstream);
				expect(denied).toHaveLength(n - upstream);
				for (const r of denied) {
					const body = await r.json();
					expect(["request_limit_exceeded", "quota_exceeded"]).toContain(body.error.code);
				}

				const used = Number(
					(await h.db.query("SELECT tokens::float8 AS t FROM usage_monthly WHERE user_id=$1 AND month=$2", [h.users.plain!.userId, "2026-11"])).rows[0].t,
				);
				const eventSum = Number(
					(
						await h.db.query("SELECT COALESCE(SUM(total_tokens),0)::float8 AS t FROM usage_events WHERE user_id=$1 AND month=$2", [
							h.users.plain!.userId,
							"2026-11",
						])
					).rows[0].t,
				);
				expect(eventSum).toBe(used);
				expect(used).toBe(ok.length * 15);
				expect(used).toBeLessThanOrEqual(cap);
				expect((await h.db.query("SELECT count(*)::int AS n FROM reservations WHERE user_id=$1", [h.users.plain!.userId])).rows[0].n).toBe(0);
			} finally {
				await h.close();
			}
		},
		60_000,
	);
});
