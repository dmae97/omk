import type { AgentMessage } from "omk-agent-core";
import { describe, expect, it } from "vitest";
import { overflowRetryBlocked } from "../src/core/compaction/overflow-retry-guard.ts";

/**
 * Overflow recovery compacts and resends the same request, so it only helps if
 * the compacted context actually fits. Compaction cuts at turn boundaries and
 * never inside a turn's tool results, so one oversized turn survives every
 * pass — and the loop retried regardless, spending a provider round-trip per
 * attempt before reporting advice that never said what was too big.
 */

const WINDOW = 100_000;

function user(chars: number): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text: "x".repeat(chars) }],
		timestamp: Date.now(),
	} as AgentMessage;
}

function assistant(chars: number, stopReason: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "x".repeat(chars) }],
		stopReason,
		timestamp: Date.now(),
	} as unknown as AgentMessage;
}

describe("overflowRetryBlocked", () => {
	it("permits a retry when the surviving context fits", () => {
		expect(overflowRetryBlocked([user(400)], WINDOW)).toBeUndefined();
	});

	it("blocks the retry when the surviving context cannot fit", () => {
		const blocked = overflowRetryBlocked([user(WINDOW * 8)], WINDOW);

		expect(blocked).toBeDefined();
		// The numbers are the payload: they identify the newest turn as the
		// blocker, which "reduce the latest input" on its own does not.
		expect(blocked).toMatch(/still ~[\d,]+ tokens/);
		expect(blocked).toContain(WINDOW.toLocaleString());
		expect(blocked).toMatch(/retrying cannot help/);
	});

	it("reports a token count at or above the window", () => {
		const blocked = overflowRetryBlocked([user(WINDOW * 8)], WINDOW) ?? "";
		const reported = Number(/still ~([\d,]+) tokens/.exec(blocked)?.[1]?.replace(/,/g, ""));

		expect(reported).toBeGreaterThanOrEqual(WINDOW);
	});

	it("excludes the trailing overflow error, which the retry drops", () => {
		// Only the error message is oversized, so the actual retry payload fits.
		const messages = [user(400), assistant(WINDOW * 8, "error")];

		expect(overflowRetryBlocked(messages, WINDOW)).toBeUndefined();
	});

	it("counts a trailing assistant message the retry keeps", () => {
		const messages = [user(400), assistant(WINDOW * 8, "stop")];

		expect(overflowRetryBlocked(messages, WINDOW)).toBeDefined();
	});

	it("only drops one trailing error, not an earlier one", () => {
		const messages = [assistant(WINDOW * 8, "error"), user(400)];

		expect(overflowRetryBlocked(messages, WINDOW)).toBeDefined();
	});

	describe("stays out of the way when it cannot measure", () => {
		it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("window %p yields no verdict", (window) => {
			expect(overflowRetryBlocked([user(WINDOW * 8)], window)).toBeUndefined();
		});

		it("handles an empty context", () => {
			expect(overflowRetryBlocked([], WINDOW)).toBeUndefined();
		});
	});

	it("is conservative: measures content, never a stale reported usage", () => {
		// After compaction the last assistant's reported usage describes a context
		// that no longer exists. A guard trusting it would block a retry that
		// would have succeeded, so a small message with a huge usage must pass.
		const withStaleUsage = {
			role: "assistant",
			content: [{ type: "text", text: "short" }],
			stopReason: "stop",
			usage: { input: WINDOW * 4, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: WINDOW * 4 },
			timestamp: Date.now(),
		} as unknown as AgentMessage;

		expect(overflowRetryBlocked([user(400), withStaleUsage], WINDOW)).toBeUndefined();
	});
});
