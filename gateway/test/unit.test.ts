import { describe, expect, it } from "vitest";
import { BRAND_RE, loadConfig, toNano } from "../src/config.js";
import { costs } from "../src/cost.js";
import { isPeak, kstMonthKey, nextKstMonthStart, secondsUntil, isoKst } from "../src/time.js";
import { TOKEN_PREFIX, generateToken, hashToken, isWellFormedToken } from "../src/tokens.js";
import { normalizeUsage, estimateUsage } from "../src/meter.js";
import { editJson, realConfigDir, tempConfig } from "./helpers/harness.js";

const win = { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], hours: ["10:00-13:00", "15:00-19:00"] };
const peak = (iso: string, holidays: string[] = []) => isPeak(new Date(iso), win, holidays);

describe("peak window (KST, request start, [start,end))", () => {
	it.each([
		["2026-11-13T09:59:59+09:00", false],
		["2026-11-13T10:00:00+09:00", true],
		["2026-11-13T12:59:59+09:00", true],
		["2026-11-13T13:00:00+09:00", false],
		["2026-11-13T14:59:59+09:00", false],
		["2026-11-13T15:00:00+09:00", true],
		["2026-11-13T18:59:59+09:00", true],
		["2026-11-13T19:00:00+09:00", false],
		["2026-11-14T11:00:00+09:00", false], // Sat
		["2026-11-15T11:00:00+09:00", false], // Sun
		["2026-11-09T11:00:00+09:00", true], // Mon
		["2026-11-13T01:00:00Z", true], // UTC 01:00 == KST 10:00
	])("%s -> %s", (iso, want) => {
		expect(peak(iso)).toBe(want);
	});
	it("UTC input is converted: 2026-11-12T16:00:00Z is Fri 01:00 KST (off-peak)", () => expect(peak("2026-11-12T16:00:00Z")).toBe(false));
	it("holiday list (config placeholder) forces off-peak", () => {
		expect(peak("2026-11-13T11:00:00+09:00", ["2026-11-13"])).toBe(false);
		expect(peak("2026-11-13T11:00:00+09:00", [])).toBe(true);
	});
});

describe("KST month and reset", () => {
	it("month boundaries follow KST, not UTC", () => {
		expect(kstMonthKey(new Date("2026-11-30T23:59:59+09:00"))).toBe("2026-11");
		expect(kstMonthKey(new Date("2026-12-01T00:00:00+09:00"))).toBe("2026-12");
		expect(kstMonthKey(new Date("2026-11-30T15:00:00Z"))).toBe("2026-12");
	});
	it("next month start, incl. year rollover", () => {
		expect(isoKst(nextKstMonthStart(new Date("2026-11-11T14:00:00+09:00")))).toBe("2026-12-01T00:00:00+09:00");
		expect(isoKst(nextKstMonthStart(new Date("2026-12-15T00:00:00+09:00")))).toBe("2027-01-01T00:00:00+09:00");
	});
	it("seconds until reset is an exact integer", () => {
		const from = new Date("2026-11-11T14:00:00+09:00");
		expect(secondsUntil(from, nextKstMonthStart(from))).toBe((19 * 24 + 10) * 3600);
	});
});

describe("cost (nano-USD, hand-computed literals)", () => {
	const config = loadConfig(realConfigDir);
	it("flash: billed is peak; upstream follows the peak flag", () => {
		const t = { hit: 100, miss: 200, out: 220 };
		expect(costs(config, "deepseek-flash", t, true)).toEqual({ billedNano: 324_600, upstreamNano: 324_600 });
		expect(costs(config, "deepseek-flash", t, false)).toEqual({ billedNano: 324_600, upstreamNano: 162_300 });
	});
	it("larger model prices come from the table", () => {
		expect(costs(config, "deepseek-v4-pro", { hit: 500, miss: 700, out: 900 }, true).billedNano).toBe(4_510_000);
	});
	it("1M tokens of each line equals the per-1M price", () => {
		expect(costs(config, "deepseek-flash", { hit: 1e6, miss: 0, out: 0 }, true).billedNano).toBe(6_000_000); // $0.006
		expect(costs(config, "deepseek-flash", { hit: 0, miss: 1e6, out: 0 }, true).billedNano).toBe(300_000_000); // $0.30
		expect(costs(config, "deepseek-flash", { hit: 0, miss: 0, out: 1e6 }, true).billedNano).toBe(1_200_000_000); // $1.20
	});
	it("rejects prices that are not exact in nano-USD, and unknown upstreams", () => {
		expect(toNano(0.044, "x")).toBe(44);
		expect(() => toNano(0.0004, "x")).toThrow();
		const d1 = tempConfig((d) => editJson(d, "models.json", (m) => (m.models["OMK/reasoner"].upstream = "no-such-model")));
		expect(() => loadConfig(d1)).toThrow(/no price entry/);
		const d2 = tempConfig((d) => editJson(d, "models.json", (m) => (m.models["OMK/coder"].public.note = `${"deep"}${"seek"} inside`)));
		expect(() => loadConfig(d2)).toThrow(/brand/);
	});
});

describe("tokens", () => {
	it("format: fixed prefix + 32 alphanumerics from a CSPRNG; hash is SHA-256 hex", () => {
		const t = generateToken();
		expect(isWellFormedToken(t)).toBe(true);
		expect(t.length).toBe(TOKEN_PREFIX.length + 32);
		expect(generateToken()).not.toBe(t);
		expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
		expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});
	it("rejects malformed tokens", () => {
		expect(isWellFormedToken("garbage")).toBe(false);
		expect(isWellFormedToken(TOKEN_PREFIX + "short")).toBe(false);
		expect(isWellFormedToken(TOKEN_PREFIX + "!".repeat(32))).toBe(false);
	});
});

describe("usage normalization", () => {
	it("reads hit/miss/reasoning verbatim; answer = completion - reasoning", () => {
		const u = normalizeUsage({ prompt_tokens: 300, completion_tokens: 220, total_tokens: 520, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 200, completion_tokens_details: { reasoning_tokens: 150 } });
		expect(u).toMatchObject({ prompt: 300, hit: 100, miss: 200, completion: 220, reasoning: 150, answer: 70, total: 520, anomaly: false });
	});
	it("falls back to cached_tokens, and flags an inconsistent usage object", () => {
		const u = normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 4 } });
		expect(u).toMatchObject({ hit: 4, miss: 6, anomaly: false });
		expect(normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 99, prompt_cache_hit_tokens: 1, prompt_cache_miss_tokens: 1 }).anomaly).toBe(true);
	});
	it("estimate: input from request chars, all cache miss; output from received text", () => {
		expect(estimateUsage(10, { content: 40, reasoning: 20, tool: 0 }, 4)).toMatchObject({ prompt: 3, hit: 0, miss: 3, completion: 15, reasoning: 5, answer: 10, total: 18, anomaly: false });
		expect(estimateUsage(0, { content: 0, reasoning: 0, tool: 0 }, 4)).toMatchObject({ prompt: 0, miss: 0, completion: 0, total: 0 });
	});
});

describe("brand pattern", () => {
	it("matches the documented patterns", () => {
		for (const s of [`${"deep"}${"seek"}-flash`, "Deep-Seek", "ds-v4", "V4.1-Flash-1017", "V4-Pro-0813"]) expect(BRAND_RE.test(s), s).toBe(true);
		for (const s of ["OMK/coder", "req_abcdef0123456789", "chatcmpl-123"]) expect(BRAND_RE.test(s), s).toBe(false);
	});
});
