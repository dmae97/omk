import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueKey, revoke } from "../src/admin.ts";
import { generateToken, hashToken } from "../src/tokens.ts";
import { gatewayRoot, makeHarness, msg, okJson, U, type Harness } from "./helpers/harness.ts";
import { UPSTREAM_SENTINEL_KEY } from "./helpers/mock-upstream.ts";

// Patterns are assembled from parts so this file is not a hit for its own scan.
const OMK_TOKEN_RE = new RegExp(`${"omk"}_[a-z]+_`);
const SK_RE = new RegExp(`\\b${"sk"}-[A-Za-z0-9]`);
const BEARER_VALUE_RE = /Bearer\s+(?!\[redacted\])\S+/i;
const LEGACY_A = `${"deepseek"}-${"chat"}`;
const LEGACY_B = `${"deepseek"}-${"reasoner"}`;
const OLD_ENV = `${"OMK_GATEWAY_"}${"TOKEN"}`;

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (["node_modules", ".data", ".git", "e2e"].includes(name)) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}
const treeFiles = () => walk(gatewayRoot).filter((p) => !p.endsWith("package-lock.json"));
const ciFile = join(gatewayRoot, "..", ".github", "workflows", "gateway-ci.yml");

let h: Harness;
const bodies: string[] = [];
const normalize = (l: string) => l.replace(/"(request_id|event_id)":"[^"]+"/g, '"$1":"<id>"').replace(/"ms":\d+/g, '"ms":0').replace(/"key":"[0-9a-f]{8}"/g, '"key":"<hash8>"');

beforeAll(async () => {
	h = await makeHarness();
	const t = h.users.plain!.token;
	const PROMPT_MARKER = "PROMPT_MARKER_7f3a";
	h.mock.enqueue(okJson("deepseek-flash", U(10, 20, 30)));
	bodies.push(await (await h.chat(t, { model: "OMK/coder", messages: msg(PROMPT_MARKER) })).text());
	h.mock.enqueue({ kind: "sse", body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "a" }, finish_reason: "stop" }], usage: U(1, 1, 1) })}\n\ndata: [DONE]\n\n` });
	bodies.push(await (await h.chat(t, { model: "OMK/coder", messages: msg(PROMPT_MARKER), stream: true })).text());
	bodies.push(await (await h.chat(null, { model: "OMK/coder", messages: msg() })).text());
	bodies.push(await (await h.chat(generateToken(), { model: "OMK/coder", messages: msg() })).text());
	bodies.push(await (await h.chat("garbage-token-value", { model: "OMK/coder", messages: msg() })).text());
	const rev = await issueKey(h.db, { userId: h.users.plain!.userId, label: "rev", plan: "A", now: h.clock.now });
	await revoke(h.db, rev.keyId, h.clock.now);
	bodies.push(await (await h.chat(rev.token, { model: "OMK/coder", messages: msg() })).text());
	h.mock.enqueue({ kind: "json", status: 500, body: { error: { message: "boom" } } });
	bodies.push(await (await h.chat(t, { model: "OMK/coder", messages: msg() })).text());
	bodies.push(await (await h.chat(t, { model: "OMK/reasoner", messages: msg(), max_tokens: 99999 })).text());
	bodies.push(await (await h.chat(t, { model: "OMK/coder", messages: msg(PROMPT_MARKER), thinking: 5 })).text());
	h.users.rev = rev;
});
afterAll(() => h.close());

describe("T-08 secrets", () => {
	it("logs: structured, whitelisted, only the first 8 chars of the token HASH, no tokens, no upstream key, no Bearer values, no prompts", () => {
		expect(h.logs.length).toBeGreaterThan(8);
		const tokens = Object.values(h.users).map((u) => u.token);
		const hashes8 = new Set(tokens.map((t) => hashToken(t).slice(0, 8)));
		for (const line of h.logs) {
			const o = JSON.parse(line);
			expect(Object.keys(o).every((k) => ["level", "event", "request_id", "event_id", "key", "status", "code", "model", "ms", "stream", "estimated", "end_reason", "method", "path", "total_tokens", "msg"].includes(k)), line).toBe(true);
			if (o.key !== undefined) expect(o.key).toMatch(/^[0-9a-f]{8}$/);
			for (const t of tokens) expect(line).not.toContain(t);
			expect(line).not.toContain(UPSTREAM_SENTINEL_KEY);
			expect(line).not.toContain("PROMPT_MARKER");
			expect(BEARER_VALUE_RE.test(line), line).toBe(false);
			expect(OMK_TOKEN_RE.test(line), line).toBe(false);
			expect(SK_RE.test(line), line).toBe(false);
		}
		const keyed = h.logs.map((l) => JSON.parse(l)).filter((o) => o.key);
		expect(keyed.some((o) => hashes8.has(o.key))).toBe(true);
	});

	it("responses never echo a token, the upstream key, or a Bearer value", () => {
		const tokens = Object.values(h.users).map((u) => u.token);
		for (const b of bodies) {
			for (const t of tokens) expect(b).not.toContain(t);
			expect(b).not.toContain(UPSTREAM_SENTINEL_KEY);
			expect(BEARER_VALUE_RE.test(b)).toBe(false);
		}
	});

	it("DB dump (every table): tokens are hashed only, no upstream key, no prompt text, no raw token anywhere", async () => {
		const tokens = Object.values(h.users).map((u) => u.token);
		const tables = ["users", "api_keys", "usage_events", "usage_monthly", "reservations", "denied_events", "polar_outbox"];
		let dump = "";
		for (const t of tables) dump += JSON.stringify((await h.db.query(`SELECT * FROM ${t}`)).rows);
		for (const t of tokens) expect(dump).not.toContain(t);
		expect(dump).not.toContain(UPSTREAM_SENTINEL_KEY);
		expect(dump).not.toContain("PROMPT_MARKER");
		const keys = (await h.db.query("SELECT token_hash FROM api_keys")).rows.map((r) => r.token_hash);
		expect(keys.sort()).toEqual(tokens.map(hashToken).sort());
		for (const k of keys) expect(k).toMatch(/^[0-9a-f]{64}$/);
		expect(OMK_TOKEN_RE.test(dump)).toBe(false);
	});

	it("log sample and error table snapshots; the snapshot content itself is scanned", () => {
		const sample = h.logs.map(normalize);
		const text = sample.join("\n");
		expect(OMK_TOKEN_RE.test(text)).toBe(false);
		expect(SK_RE.test(text)).toBe(false);
		expect(sample).toMatchSnapshot("log sample");
		const errors = bodies
			.map((b) => {
				try {
					return JSON.parse(b).error;
				} catch {
					return null;
				}
			})
			.filter(Boolean);
		expect(errors.length).toBeGreaterThan(5);
		expect(JSON.stringify(errors)).not.toMatch(OMK_TOKEN_RE);
		expect(errors).toMatchSnapshot("error bodies");
	});

	it("committed snapshot files contain no token-shaped or key-shaped strings", () => {
		const dir = join(gatewayRoot, "test", "__snapshots__");
		if (!existsSync(dir)) return;
		for (const f of readdirSync(dir)) {
			const txt = readFileSync(join(dir, f), "utf8");
			expect(OMK_TOKEN_RE.test(txt), f).toBe(false);
			expect(SK_RE.test(txt), f).toBe(false);
		}
	});
});

describe("repo-wide guards (code, config, fixtures, tests, README, CI file)", () => {
	const files = () => [...treeFiles(), ...(existsSync(ciFile) ? [ciFile] : [])];

	it("no token-shaped or upstream-key-shaped string anywhere in the gateway tree", () => {
		for (const f of files()) {
			const txt = readFileSync(f, "utf8");
			expect(OMK_TOKEN_RE.test(txt), relative(gatewayRoot, f)).toBe(false);
			expect(SK_RE.test(txt), relative(gatewayRoot, f)).toBe(false);
		}
	});

	it("T-14: the retired legacy model names appear nowhere", () => {
		for (const f of files()) {
			const txt = readFileSync(f, "utf8");
			expect(txt.includes(LEGACY_A) || txt.includes(LEGACY_B), relative(gatewayRoot, f)).toBe(false);
		}
	});

	it("the client env var is OMK_ACCOUNT_TOKEN everywhere; the retired name never appears", () => {
		let found = false;
		for (const f of files()) {
			const txt = readFileSync(f, "utf8");
			expect(txt.includes(OLD_ENV), relative(gatewayRoot, f)).toBe(false);
			if (txt.includes("OMK_ACCOUNT_TOKEN")) found = true;
		}
		expect(found).toBe(true);
	});

	it("upstream key comes from the environment only (no key literal, no key column)", async () => {
		const src = readFileSync(join(gatewayRoot, "src", "server.ts"), "utf8");
		expect(src).toMatch(/process\.env\.DEEPSEEK_API_KEY/);
		expect(readFileSync(join(gatewayRoot, "src", "schema.ts"), "utf8")).not.toMatch(/upstream_key|api_secret/i);
	});
});
