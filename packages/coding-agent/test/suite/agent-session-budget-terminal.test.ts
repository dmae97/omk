import { fauxAssistantMessage } from "omk-ai";
import { afterEach, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;
afterEach(() => {
	harness?.cleanup();
	harness = undefined;
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("checks the deadline before declaring completion even when its timer has not fired", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const clock = vi.spyOn(performance, "now").mockReturnValue(0);
	harness = await createHarness({
		settings: { resourceGovernor: { mode: "off" } },
		extensionFactories: [
			(omk) => {
				omk.on("agent_end", async () => {
					clock.mockReturnValue(200);
				});
			},
		],
	});
	harness.setResponses([fauxAssistantMessage("finished after deadline")]);

	await expect(harness.session.prompt("bounded", { runBudget: { timeoutMs: 100 } })).rejects.toMatchObject({
		code: "deadline",
	});
	expect(harness.eventsOfType("prompt_settled").map((event) => event.outcome)).toEqual(["failed"]);
	expect(harness.session.lastTermination).toMatchObject({ kind: "budget_exhausted", causeCode: "budget.deadline" });
});

it("persists request exhaustion as a budget termination without leaving the journal open", async () => {
	harness = await createHarness({
		persistSession: true,
		settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 }, resourceGovernor: { mode: "off" } },
	});
	harness.setResponses([
		fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
		fauxAssistantMessage("must not dispatch"),
	]);

	await expect(harness.session.prompt("bounded", { runBudget: { maxRequests: 1 } })).rejects.toMatchObject({
		code: "requests",
	});
	expect(harness.session.runJournalRecords.at(-1)).toMatchObject({
		event: "run_finished",
		termination: { kind: "budget_exhausted", causeCode: "budget.requests", retryable: false },
	});
});
