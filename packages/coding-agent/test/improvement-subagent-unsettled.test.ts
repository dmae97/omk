import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import type { RunManagedProcessOptions } from "../examples/extensions/subagent/managed-process.ts";
import { createSubagentLaneAuthority } from "../src/core/subagent-lane-authority.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";
import { fixture, type ResultDetails } from "./improvement-subagent-fixture.ts";

const children: EventEmitter[] = [];
vi.mock("../examples/extensions/subagent/managed-process.ts", async (original) => {
	const actual = await original<typeof import("../examples/extensions/subagent/managed-process.ts")>();
	return {
		...actual,
		runManagedProcess: (options: RunManagedProcessOptions) =>
			actual.runManagedProcess({
				...options,
				cutoffMs: 5,
				terminationGraceMs: 1,
				forceSettleMs: 1,
				spawnProcess: () => {
					const child = Object.assign(new EventEmitter(), {
						stdout: new PassThrough(),
						stderr: new PassThrough(),
						kill: () => true,
					});
					children.push(child);
					setImmediate(() =>
						child.stdout.write(
							`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "partial checkpoint" }] } })}\n`,
						),
					);
					return child as unknown as ReturnType<NonNullable<RunManagedProcessOptions["spawnProcess"]>>;
				},
			}),
	};
});
afterEach(() => {
	for (const child of children.splice(0)) child.emit("close", null, "SIGKILL");
});
it.each([false, true])("preserves unsettled graph ownership without retry (bounded=%s)", async (bounded) => {
	const env = await fixture();
	let owned = 0;
	const authority = createSubagentLaneAuthority({
		runId: "unsettled",
		decision: null,
		permitPool: new WorkloadPermitPool({ capacity: 2 }),
		inventory: {
			tools: ["read", "write", "edit", "bash"].map((name) => ({ name, kind: "tool" as const })),
			skills: [],
			mcp: [],
			hooks: [],
		},
		noteDetachedChild: () => {
			owned++;
			return () => {
				owned--;
			};
		},
	});
	try {
		const result = await env.execute(
			{
				graph: [
					{ id: "A", agent: "fixture", task: "one task" },
					{ id: "B", agent: "fixture", task: "downstream", dependsOn: ["A"] },
				],
				...(bounded ? { executionBudgetMs: 120000 } : {}),
			},
			authority,
		);
		expect(result.isError).toBe(true);
		expect(children).toHaveLength(1);
		const first = (result.details as ResultDetails).results[0];
		expect(first.process?.terminationObserved).toBe(false);
		expect(owned).toBe(1);
		children[0].emit("close", null, "SIGKILL");
		await first.process?.settlement;
		await Promise.resolve();
		expect(owned).toBe(0);
	} finally {
		await env.cleanup();
	}
});
