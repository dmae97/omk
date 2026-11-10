import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueKey, revoke } from "../src/admin.ts";
import { BRAND_RE } from "../src/config.ts";
import { generateToken } from "../src/tokens.ts";
import { editJson, makeHarness, msg, okJson, tempConfig, U, type Harness, type Res } from "./helpers/harness.ts";

let h: Harness;
beforeAll(async () => {
	h = await makeHarness();
});
afterAll(() => h.close());

const hdr = (r: Res, k: string) => r.headers.get(k);
async function expectErr(r: Res, status: number, code: string, type: string) {
	expect(r.status).toBe(status);
	const b = await r.json();
	expect(Object.keys(b)).toEqual(["error"]);
	expect(b.error).toMatchObject({ code, type });
	expect(typeof b.error.message).toBe("string");
	expect(BRAND_RE.test(JSON.stringify(b))).toBe(false);
	if (status === 429) expect(hdr(r, "retry-after")).toMatch(/^\d+$/);
	return b.error;
}

describe("error contract (spec 1A table)", () => {
	const body = { model: "OMK/coder", messages: msg() };

	it("401 token_missing / token_invalid (garbage, unknown well-formed, wrong scheme)", async () => {
		await expectErr(await h.chat(null, body), 401, "token_missing", "authentication_error");
		await expectErr(await h.chat("garbage", body), 401, "token_invalid", "authentication_error");
		await expectErr(await h.chat(generateToken(), body), 401, "token_invalid", "authentication_error");
		const basic = await h.call("/v1/chat/completions", { method: "POST", body, headers: { authorization: "Basic abc" } });
		await expectErr(basic, 401, "token_invalid", "authentication_error");
		expect(h.mock.requests).toHaveLength(0);
	});

	it("401 token_expired after expires_at; no Retry-After", async () => {
		const k = await issueKey(h.db, { userId: h.users.plain!.userId, label: "short", plan: "A", expiresAt: new Date(h.clock.now.getTime() + 60_000), now: h.clock.now });
		h.mock.enqueue(okJson("deepseek-flash", U(1, 1, 1)));
		expect((await h.chat(k.token, body)).status).toBe(200);
		h.clock.now = new Date(h.clock.now.getTime() + 61_000);
		const e = await h.chat(k.token, body);
		await expectErr(e, 401, "token_expired", "authentication_error");
		expect(hdr(e, "retry-after")).toBeNull();
		h.clock.now = new Date("2026-11-11T14:00:00+09:00");
	});

	it("403 token_revoked (not 401) after a CLI revoke", async () => {
		const k = await issueKey(h.db, { userId: h.users.plain!.userId, label: "r", plan: "A", now: h.clock.now });
		expect(await revoke(h.db, k.keyId, h.clock.now)).toBe(true);
		await expectErr(await h.chat(k.token, body), 403, "token_revoked", "permission_error");
	});

	it("403 model_not_allowed for unknown IDs, a third ID, and an allow-list miss", async () => {
		await expectErr(await h.chat(h.users.plain!.token, { ...body, model: "gpt-4o" }), 403, "model_not_allowed", "permission_error");
		await expectErr(await h.chat(h.users.plain!.token, { ...body, model: "OMK/pro" }), 403, "model_not_allowed", "permission_error");
		await expectErr(await h.chat(h.users.plain!.token, { ...body, model: "__proto__" }), 403, "model_not_allowed", "permission_error");
		const k = await issueKey(h.db, { label: "coder-only", plan: "A", allowedModels: ["OMK/coder"], now: h.clock.now });
		await expectErr(await h.chat(k.token, { ...body, model: "OMK/reasoner" }), 403, "model_not_allowed", "permission_error");
		const list = await (await h.call("/v1/models", { token: k.token })).json();
		expect(list.data.map((m: any) => m.id)).toEqual(["OMK/coder"]);
	});

	it("400s: thinking_required, image_input_unsupported, unsupported_feature, invalid json/shape", async () => {
		const t = h.users.plain!.token;
		await expectErr(await h.chat(t, { model: "OMK/reasoner", messages: msg(), thinking: { type: "disabled" } }), 400, "thinking_required", "invalid_request_error");
		await expectErr(await h.chat(t, { model: "OMK/coder", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }] }), 400, "image_input_unsupported", "invalid_request_error");
		await expectErr(await h.chat(t, { model: "OMK/reasoner", messages: [{ role: "user", content: "x" }, { role: "assistant", content: "pre", prefix: true }] }), 400, "unsupported_feature", "invalid_request_error");
		await expectErr(await h.chat(t, "{not json"), 400, "invalid_json", "invalid_request_error");
		await expectErr(await h.chat(t, { model: "OMK/coder" }), 400, "invalid_request", "invalid_request_error");
		await expectErr(await h.chat(t, { model: "OMK/coder", messages: msg(), max_tokens: -5 }), 400, "invalid_request", "invalid_request_error");
		expect(h.mock.requests).toHaveLength(1); // only the allowed one in the expired test above reached upstream
	});

	it("429 quota_exceeded: Retry-After = seconds to KST month start, x-omk-retryable false, no upstream call, no usage row", async () => {
		const k = await issueKey(h.db, { label: "capped", plan: "A", capOverride: 1000, now: h.clock.now });
		h.mock.enqueue(okJson("deepseek-flash", U(0, 900, 100)));
		const first = await h.chat(k.token, { ...body, max_tokens: 100 });
		expect(first.status).toBe(200);
		const calls = h.mock.requests.length;
		const rows = (await h.db.query("SELECT count(*)::int n FROM usage_events")).rows[0].n;
		const r = await h.chat(k.token, body);
		const err = await expectErr(r, 429, "quota_exceeded", "rate_limit_error");
		expect(hdr(r, "retry-after")).toBe(String((19 * 24 + 10) * 3600));
		expect(hdr(r, "x-omk-retryable")).toBe("false");
		expect(hdr(r, "x-omk-limit")).toBe("1000");
		expect(hdr(r, "x-omk-remaining")).toBe("0");
		expect(err.message).toContain("1000 of 1000");
		expect(err.message).toContain("2026-12-01 00:00 KST");
		expect(h.mock.requests).toHaveLength(calls);
		expect((await h.db.query("SELECT count(*)::int n FROM usage_events")).rows[0].n).toBe(rows);
		expect((await h.db.query("SELECT count(*)::int n FROM denied_events WHERE code='quota_exceeded'")).rows[0].n).toBe(1);
	});

	it("429 request_limit_exceeded: max_tokens ceiling and effort above allowed, Retry-After always present", async () => {
		const t = h.users.plain!.token;
		const a = await h.chat(t, { model: "OMK/reasoner", messages: msg(), max_tokens: 40_000 });
		const ea = await expectErr(a, 429, "request_limit_exceeded", "rate_limit_error");
		expect(ea.param).toBe("max_tokens");
		expect(ea.message).toContain("40000");
		expect(ea.message).toContain("32768");
		expect(hdr(a, "retry-after")).toBe("0");
		expect(hdr(a, "x-omk-retryable")).toBe("false");
		const b = await h.chat(t, { model: "OMK/reasoner", messages: msg(), reasoning_effort: "max" });
		const eb = await expectErr(b, 429, "request_limit_exceeded", "rate_limit_error");
		expect(eb.param).toBe("reasoning_effort");
		// no allow-list: a user issued with allow_max_effort is still capped at high
		const c = await h.chat(h.users.maxeffort!.token, { model: "OMK/reasoner", messages: msg(), reasoning_effort: "max" });
		await expectErr(c, 429, "request_limit_exceeded", "rate_limit_error");
	});

	it("429 rate_limited: rpm window with Retry-After, retryable (no x-omk-retryable header)", async () => {
		const dir = tempConfig((d) => editJson(d, "limits.json", (l) => (l.rpm_per_key = 2)));
		const hh = await makeHarness({ configDir: dir });
		try {
			hh.mock.setDefault(okJson("deepseek-flash", U(1, 1, 1)));
			const t = hh.users.plain!.token;
			expect((await hh.chat(t, body)).status).toBe(200);
			expect((await hh.chat(t, body)).status).toBe(200);
			const r = await hh.chat(t, body);
			await expectErr(r, 429, "rate_limited", "rate_limit_error");
			expect(hdr(r, "retry-after")).toBe("60");
			expect(hdr(r, "x-omk-retryable")).toBeNull();
			hh.mono.ms += 30_000;
			expect(hdr(await hh.chat(t, body), "retry-after")).toBe("30");
			hh.mono.ms += 31_000;
			expect((await hh.chat(t, body)).status).toBe(200);
		} finally {
			await hh.close();
		}
	});

	it("404 for unrouted surfaces (no /v1/completions, no /beta), still an OpenAI envelope", async () => {
		await expectErr(await h.call("/v1/completions", { method: "POST", token: h.users.plain!.token, body: {} }), 404, "not_found", "invalid_request_error");
		await expectErr(await h.call("/beta/chat/completions", { method: "POST", token: h.users.plain!.token, body: {} }), 404, "not_found", "invalid_request_error");
	});

	it("error messages never contain a token", async () => {
		const tok = generateToken();
		const r = await h.chat(tok, body);
		expect(JSON.stringify(await r.json())).not.toContain(tok);
	});
});
