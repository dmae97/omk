import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/types.ts";
import { isRetryableAssistantError, retryAssistantCall } from "../src/utils/retry.ts";

const errorMessage = (text: string) =>
	({
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: text,
		timestamp: 0,
	}) as AssistantMessage;

const callsWithOneRetry = async (text: string) => {
	let calls = 0;
	await retryAssistantCall(
		async () => {
			calls++;
			return errorMessage(text);
		},
		{ enabled: true, maxRetries: 1, baseDelayMs: 1 },
		undefined,
	);
	return calls;
};

describe("retryAssistantCall reads a status code, not any number in the error body", () => {
	it.each([
		"400 invalid input: maximum is 5000 characters",
		"400 saved 502 records then rejected",
		"Error: HTTP 400 limit 1500 tokens",
		"400 invalid input: maximum is characters",
	])("does not retry a deterministic 400: %s", async (text) => {
		expect(isRetryableAssistantError(errorMessage(text))).toBe(false);
		expect(await callsWithOneRetry(text)).toBe(1);
	});

	it.each([
		"503 Service Unavailable",
		"520 status code (no body)",
		"500 Internal Server Error",
		"429 Too Many Requests",
		"502 Bad Gateway",
		"504 Gateway Timeout",
		"Error: 503",
		"Request failed with status code 502",
		"HTTP 500",
	])("still retries a transient status: %s", async (text) => {
		expect(isRetryableAssistantError(errorMessage(text))).toBe(true);
		expect(await callsWithOneRetry(text)).toBe(2);
	});
});
