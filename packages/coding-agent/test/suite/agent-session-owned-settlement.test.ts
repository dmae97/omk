import type { AgentTool } from "omk-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const harnesses: Harness[] = [];
afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
});

async function startLateTool(
	termination: "timeout" | "abort" = "timeout",
	lateSettlement: "audit" | "ignore" = "audit",
) {
	const finish = deferred();
	const started = deferred();
	const tool: AgentTool = {
		name: "late_writer",
		label: "Late writer",
		description: "Wait for test-controlled termination",
		parameters: Type.Object({}),
		execute: async () => {
			started.resolve();
			await finish.promise;
			return { content: [{ type: "text", text: "late" }], details: {} };
		},
	};
	const harness = await createHarness({
		tools: [tool],
		settings: {
			agent: { toolTimeouts: { late_writer: termination === "timeout" ? 10 : 0 } },
			retry: { enabled: false },
			resourceGovernor: { mode: "off" },
		},
	});
	harnesses.push(harness);
	harness.session.agent.toolExecutionPolicy = { lateSettlement };
	harness.setResponses([
		fauxAssistantMessage([fauxToolCall("late_writer", {}, { id: "reused-id" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("next prompt"),
	]);
	const audited = deferred();
	const settled = deferred();
	harness.session.subscribe((event) => {
		if (event.type === "tool_execution_late_settlement") audited.resolve();
		if (event.type === "prompt_settled") settled.resolve();
	});
	const prompt = harness.session.prompt("run");
	if (termination === "abort") {
		await started.promise;
		await harness.session.abort();
	}
	await prompt;
	return { harness, finish, audited, settled };
}

describe("AgentSession actual execution settlement", () => {
	it.each(["timeout", "abort"] as const)(
		"does not emit prompt_settled while a tool still owns execution after %s",
		async (termination) => {
			const { harness, finish, audited } = await startLateTool(termination);
			const premature = [...harness.eventsOfType("prompt_settled")];
			finish.resolve();
			await audited.promise;
			expect(premature).toEqual([]);
			expect(harness.eventsOfType("prompt_settled")).toHaveLength(1);
			expect(harness.eventsOfType("prompt_settled")[0]?.outcome).toBe(
				termination === "timeout" ? "failed" : "aborted",
			);
			const auditIndex = harness.events.findIndex((event) => event.type === "tool_execution_late_settlement");
			const settlementIndex = harness.events.findIndex((event) => event.type === "prompt_settled");
			expect(settlementIndex).toBeGreaterThan(auditIndex);
		},
	);

	it.each(["timeout", "abort"] as const)(
		"rejects a new prompt after %s until the previous tool terminates",
		async (termination) => {
			const { harness, finish, audited } = await startLateTool(termination);
			try {
				const calls = harness.faux.state.callCount;
				await expect(harness.session.prompt("competing work")).rejects.toThrow(/unsettled|already processing/i);
				expect(harness.faux.state.callCount).toBe(calls);
			} finally {
				finish.resolve();
				await audited.promise;
			}
			await harness.session.prompt("safe next run");
			expect(harness.eventsOfType("prompt_settled")).toHaveLength(2);
			expect(new Set(harness.eventsOfType("prompt_settled").map((event) => event.promptRunId)).size).toBe(2);
		},
	);

	it("settles a drained run when the user clears its remaining follow-up queue", async () => {
		const { harness, finish, audited } = await startLateTool();
		await harness.session.followUp("queued work");
		finish.resolve();
		await audited.promise;
		expect(harness.eventsOfType("prompt_settled")).toEqual([]);
		expect(harness.session.clearQueue().followUp).toEqual(["queued work"]);
		expect(harness.eventsOfType("prompt_settled")).toHaveLength(1);
		await harness.session.prompt("next run");
		expect(harness.eventsOfType("prompt_settled")).toHaveLength(2);
	});

	it("settles real termination even when the caller disables late audit events", async () => {
		const { harness, finish, settled } = await startLateTool("timeout", "ignore");
		const premature = [...harness.eventsOfType("prompt_settled")];
		finish.resolve();
		await settled.promise;
		expect(premature).toEqual([]);
		expect(harness.eventsOfType("tool_execution_late_settlement")).toEqual([]);
		expect(harness.eventsOfType("prompt_settled")).toHaveLength(1);
	});
});
