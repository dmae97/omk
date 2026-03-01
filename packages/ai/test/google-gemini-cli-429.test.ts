import { describe, expect, it } from "bun:test";
import { extractRetryDelay } from "@oh-my-pi/pi-ai/providers/google-gemini-cli";

// The fail-fast regex used inside the provider to distinguish "known quota errors" (throw immediately)
// from "ambiguous 429s" (retry up to RATE_LIMIT_BUDGET_MS).
const FAIL_FAST_RE = /quota|exhausted|too many requests|per minute|rate limit/i;
const shouldFailFast = (errorText: string) => FAIL_FAST_RE.test(errorText);

// normalizeDelay adds a 1 second buffer and rounds up:
//   normalizeDelay(ms) = Math.ceil(ms + 1000)
// So all extractRetryDelay results are at least 1 second more than the raw delay.

describe("google-gemini-cli 429 fail-fast detection", () => {
	it("fails fast on 'Quota exceeded'", () => {
		expect(shouldFailFast("Quota exceeded")).toBe(true);
	});

	it("fails fast on 'Resource has been exhausted'", () => {
		expect(shouldFailFast("Resource has been exhausted")).toBe(true);
	});

	it("fails fast on 'Too many requests'", () => {
		expect(shouldFailFast("Too many requests")).toBe(true);
	});

	it("fails fast on 'rate limit exceeded'", () => {
		expect(shouldFailFast("rate limit exceeded")).toBe(true);
	});

	it("fails fast on per-minute quota message", () => {
		expect(shouldFailFast("Exceeded per minute quota for generateContent")).toBe(true);
	});

	it("does NOT fail fast on generic 429 with empty body", () => {
		expect(shouldFailFast("")).toBe(false);
	});

	it("does NOT fail fast on unknown 429 message", () => {
		expect(shouldFailFast("Internal server error")).toBe(false);
	});

	it("is case-insensitive for all variants", () => {
		expect(shouldFailFast("QUOTA EXHAUSTED")).toBe(true);
		expect(shouldFailFast("Rate Limit Exceeded")).toBe(true);
		expect(shouldFailFast("TOO MANY REQUESTS")).toBe(true);
	});
});

describe("extractRetryDelay – header parsing", () => {
	it("reads retry-after header as seconds → normalizeDelay(5000) = 6000", () => {
		const headers = new Headers({ "retry-after": "5" });
		// normalizeDelay(5 * 1000) = Math.ceil(5000 + 1000) = 6000
		expect(extractRetryDelay("", headers)).toBe(6000);
	});

	it("reads x-ratelimit-reset-after header as seconds → normalizeDelay(30000) = 31000", () => {
		const headers = new Headers({ "x-ratelimit-reset-after": "30" });
		// normalizeDelay(30 * 1000) = Math.ceil(30000 + 1000) = 31000
		expect(extractRetryDelay("", headers)).toBe(31000);
	});

	it("prefers retry-after over x-ratelimit-reset-after when both are present", () => {
		const headers = new Headers({ "retry-after": "5", "x-ratelimit-reset-after": "30" });
		// retry-after is checked first → 6000
		expect(extractRetryDelay("", headers)).toBe(6000);
	});
});

describe("extractRetryDelay – body text parsing", () => {
	it("parses 'retryDelay' JSON field in seconds → normalizeDelay(3000) = 4000", () => {
		// Regex: /"retryDelay":\s*"([0-9.]+)(ms|s)"/i
		const body = '"retryDelay": "3s"';
		// normalizeDelay(3 * 1000) = Math.ceil(3000 + 1000) = 4000
		expect(extractRetryDelay(body)).toBe(4000);
	});

	it("parses 'retryDelay' JSON field in milliseconds → normalizeDelay(500) = 1500", () => {
		const body = '"retryDelay": "500ms"';
		// normalizeDelay(500) = Math.ceil(500 + 1000) = 1500
		expect(extractRetryDelay(body)).toBe(1500);
	});

	it("parses 'Please retry in Xs' pattern → normalizeDelay(5000) = 6000", () => {
		// Regex: /Please retry in ([0-9.]+)(ms|s)/i
		expect(extractRetryDelay("Please retry in 5s")).toBe(6000);
	});

	it("parses 'quota will reset after Xs' simple duration → normalizeDelay(39000) = 40000", () => {
		// Regex: /reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i
		// totalMs = 39 * 1000 = 39000 → normalizeDelay = 40000
		expect(extractRetryDelay("Your quota will reset after 39s")).toBe(40000);
	});

	it("parses compound duration 'reset after 1h30m10s'", () => {
		// (1*3600 + 30*60 + 10) * 1000 = 5 410 000 ms
		// normalizeDelay(5410000) = Math.ceil(5410000 + 1000) = 5411000
		expect(extractRetryDelay("Your quota will reset after 1h30m10s")).toBe(5411000);
	});

	it("returns undefined when body contains no recognised delay pattern", () => {
		expect(extractRetryDelay("Quota exceeded, please try again later")).toBeUndefined();
	});

	it("returns undefined for empty error string and no headers", () => {
		expect(extractRetryDelay("")).toBeUndefined();
	});
});
