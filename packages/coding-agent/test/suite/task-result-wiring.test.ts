import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/types.ts";
import type { TaskCheckFact, TaskResultEvent } from "../../src/core/task-result.ts";
import {
	currentTaskRunId,
	publishHostTaskFact,
	TASK_RESULT_FACT_CHANNEL,
} from "../../src/core/task-result-collector.ts";
import { createHarness, type Harness } from "./harness.ts";

/** Spec 096 phase 2: AgentSession emits `task_result` right after `prompt_settled`, flag on only. */
const keep = process.env.OMK_TASK_RESULT;
const harnesses: Harness[] = [];
afterEach(() => {
	for (const h of harnesses.splice(0)) h.cleanup();
	if (keep === undefined) delete process.env.OMK_TASK_RESULT;
	else process.env.OMK_TASK_RESULT = keep;
});

const failedReceipt: TaskCheckFact = {
	id: "goal-acceptance:r-1",
	source: "host_receipt",
	status: "failed",
	required: true,
	receiptId: "r-1",
};

async function runWith(
	flag: string | undefined,
	reply: string,
	publish?: (omk: ExtensionAPI) => void,
): Promise<Harness> {
	if (flag === undefined) delete process.env.OMK_TASK_RESULT;
	else process.env.OMK_TASK_RESULT = flag;
	const harness = await createHarness({
		extensionFactories: [
			(omk) => {
				omk.on("agent_settled", () => publish?.(omk));
			},
		],
	});
	harnesses.push(harness);
	harness.setResponses([fauxAssistantMessage(reply)]);
	await harness.session.prompt("go");
	return harness;
}

describe("task_result emission (spec 096 phase 2)", () => {
	it("flag off: no task_result event", async () => {
		const h = await runWith(undefined, "All tests passed.");
		expect(h.eventsOfType("task_result")).toEqual([]);
	});

	it("flag on: exactly one task_result, right after prompt_settled, same promptRunId", async () => {
		const h = await runWith("1", "done");
		const types = h.events.map((e) => e.type);
		const settledAt = types.indexOf("prompt_settled");
		expect(types.filter((t) => t === "task_result")).toHaveLength(1);
		expect(types[settledAt + 1]).toBe("task_result");
		const [event] = h.eventsOfType("task_result") as TaskResultEvent[];
		expect(event?.projection.promptRunId).toBe(h.eventsOfType("prompt_settled")[0]?.promptRunId);
		expect(event?.projection.execution).toBe("completed");
	});

	it("B2: model says passed, no host observation: check none, claim stays model_text", async () => {
		const h = await runWith("1", "All tests passed.");
		const projection = (h.eventsOfType("task_result") as TaskResultEvent[])[0]?.projection;
		expect(projection?.check).toBe("none");
		expect(projection?.checkSource).toBe("none");
		expect(projection?.modelClaims).toEqual([{ source: "model_text", says: "passed", text: "All tests passed." }]);
	});

	it("B10: model says passed, host recorded a failure: required_failed, claim never a host pass", async () => {
		const h = await runWith("1", "All tests passed.", (omk) =>
			publishHostTaskFact(omk.events, failedReceipt, currentTaskRunId(omk.events)),
		);
		const projection = (h.eventsOfType("task_result") as TaskResultEvent[])[0]?.projection;
		expect(projection?.check).toBe("required_failed");
		expect(projection?.coverage).toEqual({ checksRun: 1, checksTotal: 1, receiptsObserved: 1 });
		expect(projection?.modelClaims.every((c) => c.source === "model_text")).toBe(true);
	});

	it("B6: a plain object on the fact channel is not promoted to a host receipt", async () => {
		const forged = { ...failedReceipt, id: "goal-acceptance:forged", status: "passed" };
		const h = await runWith("1", "done", (omk) => omk.events.emit(TASK_RESULT_FACT_CHANNEL, forged));
		const projection = (h.eventsOfType("task_result") as TaskResultEvent[])[0]?.projection;
		expect(projection?.facts).toEqual([]);
		expect(projection?.check).toBe("none");
	});

	it("facts do not leak into the next run", async () => {
		let first = true;
		const h = await runWith("1", "ok", (omk) => {
			if (first) publishHostTaskFact(omk.events, failedReceipt, currentTaskRunId(omk.events));
			first = false;
		});
		h.setResponses([fauxAssistantMessage("ok")]);
		await h.session.prompt("again");
		const results = h.eventsOfType("task_result") as TaskResultEvent[];
		expect(results.map((r) => r.projection.check)).toEqual(["required_failed", "none"]);
	});

	it("drops receipts stamped with another run, after settle, or from an earlier run", async () => {
		let bus: ExtensionAPI["events"] | undefined;
		let firstRunId: string | undefined;
		let calls = 0;
		const h = await runWith("1", "ok", (omk) => {
			bus = omk.events;
			calls += 1;
			if (calls === 1) {
				firstRunId = currentTaskRunId(omk.events);
				publishHostTaskFact(omk.events, failedReceipt, "prompt-run-other");
			} else {
				// Second run: a receipt still carrying the first run's id (a late check) is dropped.
				publishHostTaskFact(omk.events, failedReceipt, firstRunId);
			}
		});
		expect(firstRunId).toBe(h.eventsOfType("prompt_settled")[0]?.promptRunId);
		// Between runs: no run is collecting, so this is dropped as well.
		if (bus) publishHostTaskFact(bus, failedReceipt, firstRunId);
		h.setResponses([fauxAssistantMessage("ok")]);
		await h.session.prompt("again");
		const results = h.eventsOfType("task_result") as TaskResultEvent[];
		expect(calls).toBe(2);
		expect(results.map((r) => r.projection.facts)).toEqual([[], []]);
		expect(results.map((r) => r.projection.check)).toEqual(["none", "none"]);
	});

	it("keeps a receipt stamped with the current run", async () => {
		const h = await runWith("1", "ok", (omk) =>
			publishHostTaskFact(omk.events, failedReceipt, currentTaskRunId(omk.events)),
		);
		const [result] = h.eventsOfType("task_result") as TaskResultEvent[];
		expect(result?.projection.facts.map((f) => f.id)).toEqual([failedReceipt.id]);
	});
});
