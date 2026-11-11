import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { afterEach, expect, it, vi } from "vitest";
import type { SubagentLaneSpec } from "../../src/core/subagent-orchestration.ts";
import { createHarness } from "./harness.ts";

afterEach(() => vi.unstubAllEnvs());
const lanes: SubagentLaneSpec[] = ["a", "b", "c"].map((id) => ({ id, task: `inspect ${id}`, role: "security" }));
const perNode = { subtasks: lanes.map((lane) => ({ id: lane.id, description: lane.task, depends_on: [] })) };
const edgeList = { subtasks: lanes.map((lane) => ({ id: lane.id, description: lane.task })), dependencies: [] };

it.each([
	{ mode: "enforce", form: "depends_on", args: perNode, expected: ["c", "b", "a"] },
	{ mode: "enforce", form: "dependencies", args: edgeList, expected: ["c", "b", "a"] },
	{ mode: "shadow", form: "depends_on", args: perNode, expected: ["a", "b", "c"] },
])("native MCP event reaches lane dispatch in $mode mode ($form)", async ({ mode, args, expected }) => {
	vi.stubEnv("OMK_SUBAGENT_ADAPTORCH", mode);
	const started: string[] = [];
	const harness = await createHarness({
		settings: { resourceGovernor: { mode: "off" }, retry: { enabled: false } },
		extensionFactories: [
			(pi) => {
				pi.registerTool({
					name: "subagent",
					label: "Subagent",
					description: "Dispatch test lanes through the real host authority",
					parameters: Type.Object({}),
					async execute(_id, _params, _signal, _update, ctx) {
						const authority = ctx.getSubagentLaneAuthority?.();
						if (!authority) throw new Error("Missing native authority");
						const result = await authority.dispatchLanes({
							lanes,
							configuredMaxParallelLanes: 1,
							launchLane: async ({ laneId }) => {
								started.push(laneId);
							},
						});
						return { content: [{ type: "text", text: "lanes settled" }], details: result };
					},
				});
			},
		],
	});
	try {
		await harness.session.attachMcpServers({
			servers: [
				{
					name: "adaptorch",
					command: process.execPath,
					args: [fileURLToPath(new URL("../mcp/routing-receipt-server.mjs", import.meta.url))],
					inheritEnv: false,
				},
			],
		});
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("adaptorch__adaptorch_route_topology", args), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("subagent", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("Route then dispatch the independent inspection tasks");
		expect(started).toEqual(expected);
		expect(harness.eventsOfType("tool_execution_end")).toHaveLength(2);
		expect(harness.eventsOfType("prompt_settled")).toHaveLength(1);
		expect(harness.eventsOfType("prompt_settled")[0].outcome).toBe("completed");
	} finally {
		await harness.session.close();
		harness.cleanup();
	}
});
