import type { Context } from "omk-ai";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

/**
 * Spec 096 B7/B8/B9 at the session level: toggling OMK_TASK_RESULT must not
 * change the model request, the settlement events or the event sequence.
 */
async function run(flag: string | undefined): Promise<{ requests: string[]; events: string[]; settled: unknown[] }> {
	const previous = process.env.OMK_TASK_RESULT;
	if (flag === undefined) delete process.env.OMK_TASK_RESULT;
	else process.env.OMK_TASK_RESULT = flag;
	let harness: Harness | undefined;
	// Pin the clock so message timestamps match across the two runs.
	const clock = vi.spyOn(Date, "now").mockReturnValue(1_792_500_000_000);
	try {
		harness = await createHarness({ systemPrompt: "fixed system prompt" });
		const requests: string[] = [];
		const h = harness;
		harness.setResponses([
			(context: Context) => {
				requests.push(
					JSON.stringify({ ...context, systemPrompt: context.systemPrompt?.replaceAll(h.tempDir, "<TMP>") }),
				);
				return fauxAssistantMessage("All tests passed.");
			},
		]);
		await harness.session.prompt("say hi");
		const events = harness.events.map((e) => e.type).filter((t, i, a) => !(t === "message_update" && a[i - 1] === t));
		const settled = harness
			.eventsOfType("prompt_settled")
			.map(({ promptRunId: _id, durationMs: _ms, ...rest }) => rest);
		return { requests, events, settled };
	} finally {
		clock.mockRestore();
		harness?.cleanup();
		if (previous === undefined) delete process.env.OMK_TASK_RESULT;
		else process.env.OMK_TASK_RESULT = previous;
	}
}

describe("OMK_TASK_RESULT flag (spec 096)", () => {
	const keep = process.env.OMK_TASK_RESULT;
	afterEach(() => {
		if (keep === undefined) delete process.env.OMK_TASK_RESULT;
		else process.env.OMK_TASK_RESULT = keep;
	});

	it("B9: model request is byte-identical with the flag on and off", async () => {
		const off = await run(undefined);
		const on = await run("1");
		expect(off.requests.length).toBe(1);
		expect(on.requests).toEqual(off.requests);
	});

	it("B7/B8: settlement payload and event sequence unchanged; flag off emits no task_result", async () => {
		const off = await run(undefined);
		const zero = await run("0");
		const on = await run("1");
		expect(off.events).not.toContain("task_result");
		expect(zero.events).toEqual(off.events);
		expect(zero.settled).toEqual(off.settled);
		expect(on.settled).toEqual(off.settled);
		// Flag on adds exactly one new event right after prompt_settled; everything else is unchanged.
		const settledAt = off.events.indexOf("prompt_settled");
		expect(on.events).toEqual([
			...off.events.slice(0, settledAt + 1),
			"task_result",
			...off.events.slice(settledAt + 1),
		]);
	});
});
