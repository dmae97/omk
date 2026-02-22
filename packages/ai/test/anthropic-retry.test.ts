import { describe, expect, it } from "bun:test";
import { isProviderRetryableError } from "@oh-my-pi/pi-ai/providers/anthropic";

describe("isProviderRetryableError", () => {
	it("retries known transient rate-limit errors", () => {
		expect(isProviderRetryableError(new Error("Rate limit exceeded"))).toBe(true);
		expect(isProviderRetryableError(new Error("error 1302 from upstream"))).toBe(true);
	});

	it("retries transient stream envelope parse errors", () => {
		expect(isProviderRetryableError(new Error("JSON Parse error: Unterminated string"))).toBe(true);
		expect(isProviderRetryableError(new Error("Unexpected end of JSON input"))).toBe(true);
	});

	it("does not retry non-transient validation errors", () => {
		expect(isProviderRetryableError(new Error("Invalid tool schema"))).toBe(false);
		expect(isProviderRetryableError(new Error("Bad request"))).toBe(false);
	});
});
