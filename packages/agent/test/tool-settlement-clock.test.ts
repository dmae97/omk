import { afterEach, expect, it, vi } from "vitest";
import type { FinalizedToolCallOutcome } from "../src/tool-execution-boundary.ts";
import { DEFAULT_TOOL_TEARDOWN_GRACE_MS, hasUnsettledTimeout } from "../src/tool-timeout-settlement.ts";
import { createToolResultEnvelope } from "../src/types.ts";

afterEach(() => vi.useRealTimers());

it.each([-60_000, 60_000])("keeps the teardown window bounded across a wall-clock jump of %dms", async (jump) => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
	let terminated = false;
	const call: FinalizedToolCallOutcome = {
		toolCall: { type: "toolCall", id: "call", name: "wait", arguments: {} },
		result: { content: [], details: {} },
		isError: true,
		envelope: createToolResultEnvelope({
			disposition: "timeout",
			synthetic: true,
			executionStarted: true,
			timeoutMs: 10,
		}),
		isRealPromiseSettled: () => terminated,
	};
	let result: boolean | undefined;
	const pending = hasUnsettledTimeout([call]).then((value) => {
		result = value;
	});
	vi.setSystemTime(Date.now() + jump);
	await vi.advanceTimersByTimeAsync(5);
	const early = result;
	await vi.advanceTimersByTimeAsync(DEFAULT_TOOL_TEARDOWN_GRACE_MS);
	const afterGrace = result;
	terminated = true;
	await vi.advanceTimersByTimeAsync(5);
	await pending;
	expect(early).toBeUndefined();
	expect(afterGrace).toBe(true);
});
