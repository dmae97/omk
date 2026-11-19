import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "./suite/harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
	while (harnesses.length) harnesses.pop()?.cleanup();
});

async function setup(maxRetries = 2, baseDelayMs = 1) {
	const events: string[] = [];
	const harness = await createHarness({
		settings: {
			retry: { enabled: true, maxRetries, baseDelayMs },
			providerResilience: { autoFailoverOnQuotaExhaustion: false, failoverCandidates: [] },
		},
		extensionFactories: [
			(omk) => {
				omk.on("agent_end", () => {
					events.push("end");
				});
				omk.on("agent_settled", () => {
					events.push("settled");
				});
			},
		],
	});
	harnesses.push(harness);
	return { harness, events };
}

const failure = (errorMessage: string) => fauxAssistantMessage("", { stopReason: "error", errorMessage });

describe("actual terminal settlement", () => {
	it("settles when quota has no failover, despite a positive retry budget", async () => {
		const { harness, events } = await setup();
		harness.setResponses([failure("insufficient_quota")]);
		await harness.session.prompt("fixture");
		expect(events).toEqual(["end", "settled"]);
	});

	it("settles once after retry exhaustion", async () => {
		const { harness, events } = await setup();
		harness.setResponses(Array.from({ length: 3 }, () => failure("503 service unavailable")));
		await harness.session.prompt("fixture");
		expect(events).toEqual(["end", "end", "end", "settled"]);
	});

	it("settles after cancellation during retry wait", async () => {
		const { harness, events } = await setup(2, 60_000);
		harness.setResponses([failure("503 service unavailable")]);
		const run = harness.session.prompt("fixture");
		await vi.waitFor(() => expect(harness.session.isRetrying).toBe(true));
		await harness.session.abort();
		await run;
		expect(events).toEqual(["end", "settled"]);
	});

	it("settles only after an agent_end handler's queued continuation", async () => {
		const { harness, events } = await setup();
		let queued = false;
		harness.session.subscribe((event) => {
			if (event.type === "agent_end" && !queued) {
				queued = true;
				void harness.session.sendCustomMessage(
					{ customType: "fixture", content: "continue", display: false },
					{ triggerTurn: true },
				);
			}
		});
		harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("last")]);
		await harness.session.prompt("fixture");
		expect(events).toEqual(["end", "end", "settled"]);
	});
});
