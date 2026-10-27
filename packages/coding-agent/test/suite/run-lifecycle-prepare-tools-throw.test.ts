/**
 * Regression: `prepareTools` throwing on the `agent.continue` path (a goal follow-up
 * under spec 104 required-tools admission) used to end the run with
 * "run journal received agent_end without run_started". The run must journal
 * run_started and fail with the admission error, before any provider request.
 */

import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it } from "vitest";
import { setRequiredToolSource } from "../../src/core/agent-session-turn-admission-host.ts";
import { RequiredCapabilityUnavailable, type RequiredToolContract } from "../../src/core/required-tools.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;
afterEach(() => {
	harness?.cleanup();
	harness = undefined;
	delete process.env.OMK_REQUIRED_TOOLS;
});

const contract = (...tools: string[]): RequiredToolContract => ({
	taskSegmentId: "goal-1",
	tools: new Set(tools),
	source: "acceptance",
});

const followUp = (text: string) => ({
	role: "user" as const,
	content: [{ type: "text" as const, text }],
	timestamp: Date.now(),
});

describe("run lifecycle: prepareTools throws on the continue path", () => {
	it("flag on: a goal follow-up missing a required tool journals run_started and fails with RequiredCapabilityUnavailable", async () => {
		process.env.OMK_REQUIRED_TOOLS = "1";
		harness = await createHarness();
		const session = harness.session;
		let required: RequiredToolContract | undefined;
		setRequiredToolSource(session, () => required);
		harness.setResponses([fauxAssistantMessage("first done"), fauxAssistantMessage("never sent")]);
		let queued = false;
		session.subscribe((event) => {
			if (event.type !== "agent_end" || queued) return;
			queued = true;
			// Goal follow-up: queued after the first run, delivered through agent.continue().
			required = contract("browser__verify");
			session.agent.followUp(followUp("continue the goal"));
		});

		const error = await session.prompt("start goal").catch((caught: unknown) => caught);

		expect(queued).toBe(true);
		expect(error).toBeInstanceOf(RequiredCapabilityUnavailable);
		expect(error).toMatchObject({ kind: "absent", missing: ["browser__verify"], taskSegmentId: "goal-1" });
		expect(String((error as Error).message)).not.toContain("without run_started");
		expect(harness.faux.state.callCount).toBe(1);
		const events = session.runJournalRecords.map((record) => record.event);
		expect(events).toEqual(["run_started", "run_finished", "run_started", "run_finished"]);
		const json = JSON.stringify(session.runJournalRecords);
		expect(json).not.toContain("without run_started");
	});

	it("flag off: an absent required tool never makes prepareTools throw; prompt and the goal follow-up both reach the provider", async () => {
		delete process.env.OMK_REQUIRED_TOOLS;
		harness = await createHarness();
		const session = harness.session;
		setRequiredToolSource(session, () => contract("browser__verify"));
		const prepareTools = session.agent.prepareTools;
		expect(prepareTools).toBeDefined();
		expect(() => prepareTools?.(session.agent.state.tools.slice(), [])).not.toThrow();
		harness.setResponses([fauxAssistantMessage("first done"), fauxAssistantMessage("follow-up done")]);
		let queued = false;
		session.subscribe((event) => {
			if (event.type !== "agent_end" || queued) return;
			queued = true;
			session.agent.followUp(followUp("continue the goal"));
		});

		await session.prompt("start goal");

		expect(queued).toBe(true);
		expect(harness.faux.state.callCount).toBe(2);
		expect(session.lastTermination?.kind).toBe("completed");
		const events = session.runJournalRecords.map((record) => record.event);
		expect(events).toEqual(["run_started", "run_finished", "run_started", "run_finished"]);
	});
});
