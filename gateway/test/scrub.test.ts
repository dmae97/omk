import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRAND_RE } from "../src/config.ts";
import { gatewayRoot, makeHarness, msg, U, type Harness, type Res } from "./helpers/harness.ts";
import { parseSse } from "./helpers/sse.ts";

const brand = `${"deep"}${"seek"}`;
let h: Harness;
const seen: string[] = [];
const ALLOWED_HEADERS = new Set(["content-type", "x-request-id", "cache-control", "retry-after", "x-omk-retryable", "x-omk-limit", "x-omk-remaining"]);

async function capture(r: Res): Promise<string> {
	const text = await r.text();
	const hs = [...r.headers.entries()];
	for (const [k] of hs) expect(ALLOWED_HEADERS.has(k), `unexpected header ${k}`).toBe(true);
	const blob = `${hs.map(([k, v]) => `${k}: ${v}`).join("\n")}\n${text}`;
	seen.push(blob);
	return text;
}

beforeAll(async () => {
	h = await makeHarness();
});
afterAll(() => h.close());

describe("T-07 upstream brand scrub", () => {
	it("non-stream: model/id/fingerprint rewritten, upstream headers dropped, answer text untouched", async () => {
		h.mock.enqueue({
			kind: "json",
			body: {
				id: `chatcmpl-${brand}-1`,
				object: "chat.completion",
				model: `${brand}-flash`,
				system_fingerprint: `fp_${brand}`,
				choices: [{ index: 0, message: { role: "assistant", content: `I was trained by ${brand}.`, reasoning_content: `${brand} thinking` }, finish_reason: "stop" }],
				usage: U(1, 1, 1, 1),
			},
		});
		const text = await capture(await h.chat(h.users.plain!.token, { model: "OMK/reasoner", messages: msg() }));
		const j = JSON.parse(text);
		expect(j.model).toBe("OMK/reasoner");
		expect(j).not.toHaveProperty("system_fingerprint");
		expect(j.id).not.toMatch(BRAND_RE);
		// model-generated text is NOT rewritten (room decision; open question Q8)
		expect(j.choices[0].message.content).toBe(`I was trained by ${brand}.`);
		expect(j.choices[0].message.reasoning_content).toBe(`${brand} thinking`);
		seen.pop(); // the planted answer text is allowed to carry the name; everything else is scanned below
	});

	it("stream: every chunk and the reassembled stream carry only the public model", async () => {
		const chunk = (delta: object, finish: string | null, usage?: object) => `data: ${JSON.stringify({ id: `chatcmpl-${brand}-s`, model: `${brand}-flash`, system_fingerprint: `fp_${brand}`, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
		h.mock.enqueue({ kind: "sse", body: `: ${brand} says hello\n\n${chunk({ content: "a" }, null)}${chunk({ content: "" }, "stop", U(1, 1, 1))}data: [DONE]\n\n` });
		const text = await capture(await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg(), stream: true }));
		const s = parseSse(text);
		expect(s.chunks.length).toBe(2);
		for (const c of s.chunks) {
			expect(c.model).toBe("OMK/coder");
			expect(c).not.toHaveProperty("system_fingerprint");
		}
		expect(s.comments).toBe(1); // comment text is normalized, the brand inside it is gone
		expect(BRAND_RE.test(text)).toBe(false);
	});

	it.each([
		[400, `${brand}: invalid parameter`],
		[401, `Authentication failed for ${brand}`],
		[402, `${brand} balance insufficient`],
		[429, `${brand} rate limit`],
		[500, `${brand} internal`],
		[503, `${brand} overloaded`],
	])("upstream %s with a brand-bearing body -> neutral gateway error", async (status, message) => {
		h.mock.enqueue({ kind: "json", status, body: { error: { message, type: "x" } }, headers: status === 429 ? { "retry-after": "5" } : {} });
		const r = await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg() });
		expect(r.status).toBe(status === 400 ? 400 : status === 429 ? 429 : 502);
		const text = await capture(r);
		expect(JSON.parse(text).error.code).toMatch(/^(invalid_request|rate_limited|upstream_unavailable)$/);
	});

	it("garbled upstream body (not JSON) and a non-JSON stream line do not leak", async () => {
		h.mock.enqueue({ kind: "raw", status: 200, body: `<html>${brand}</html>` });
		const r = await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg() });
		expect(r.status).toBe(502);
		await capture(r);
		h.mock.enqueue({ kind: "sse", body: `data: ${brand} not json\n\nevent: ${brand}\n\ndata: [DONE]\n\n` });
		const s = await capture(await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg(), stream: true }));
		expect(BRAND_RE.test(s)).toBe(false);
	});

	it("gateway surfaces: /v1/models, /v1/account, /healthz, 404, auth errors", async () => {
		await capture(await h.call("/v1/models", { token: h.users.plain!.token }));
		await capture(await h.call("/v1/account", { token: h.users.plain!.token }));
		await capture(await h.call("/healthz", {}));
		await capture(await h.call("/nope", {}));
		await capture(await h.chat(null, { model: "OMK/coder", messages: msg() }));
		await capture(await h.chat(h.users.plain!.token, { model: brand, messages: msg() }));
		await capture(await h.chat(h.users.plain!.token, { model: "OMK/coder", messages: msg(), thinking: { type: "bad" } }));
	});

	it("scan: zero hits in everything captured, the Polar outbox payloads, and the repo docs", async () => {
		const outbox = (await h.db.query("SELECT payload FROM polar_outbox")).rows.map((r) => JSON.stringify(r.payload));
		expect(outbox.length).toBeGreaterThan(0);
		for (const s of [...seen, ...outbox]) expect(BRAND_RE.test(s), s.slice(0, 200)).toBe(false);
		expect(seen.length).toBeGreaterThan(10);
		const readme = readFileSync(join(gatewayRoot, "README.md"), "utf8");
		expect(BRAND_RE.test(readme)).toBe(false);
	});
});
