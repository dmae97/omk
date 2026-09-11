import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import type { AgentTool } from "omk-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { createHarness } from "./harness.ts";

it("holds prompt settlement and the resource lease until an owned Node child actually closes", async () => {
	let child: ChildProcessWithoutNullStreams | undefined;
	let closed: Promise<unknown> | undefined;
	const tool: AgentTool = {
		name: "child_writer",
		label: "Child writer",
		description: "Test a child that ignores tool cancellation",
		parameters: Type.Object({}),
		execute: async () => {
			child = spawn(process.execPath, ["-e", "process.stdin.once('data', () => process.exit(0))"], {
				stdio: "pipe",
				env: {},
			});
			closed = once(child, "close");
			await closed;
			return { content: [{ type: "text", text: "terminated" }], details: {} };
		},
	};
	const harness = await createHarness({
		tools: [tool],
		settings: {
			agent: { toolTimeouts: { child_writer: 20 } },
			retry: { enabled: false },
			resourceGovernor: {
				mode: "adaptive",
				cpuSampleMs: 150,
				constrainedAvailableMemoryMiB: 1_048_576,
				criticalAvailableMemoryMiB: 1_048_576,
			},
		},
	});
	harness.session.agent.maxToolConcurrency = 4;
	const settled = new Promise<void>((resolve) => {
		harness.session.subscribe((event) => {
			if (event.type === "prompt_settled") resolve();
		});
	});
	harness.setResponses([fauxAssistantMessage([fauxToolCall("child_writer", {})], { stopReason: "toolUse" })]);
	try {
		await harness.session.prompt("run the owned child");
		expect(child?.pid).toBeTypeOf("number");
		expect(child?.exitCode).toBeNull();
		expect(harness.eventsOfType("prompt_settled")).toEqual([]);
		expect(harness.session.agent.maxToolConcurrency).toBe(1);
		child?.stdin.end("stop\n");
		await closed;
		await settled;
		expect(child?.exitCode).toBe(0);
		expect(harness.session.agent.maxToolConcurrency).toBe(4);
		expect(harness.eventsOfType("prompt_settled")).toHaveLength(1);
		expect(harness.eventsOfType("prompt_settled")[0]?.outcome).toBe("failed");
	} finally {
		if (child?.exitCode === null) child.kill("SIGKILL");
		await closed;
		harness.cleanup();
	}
});
