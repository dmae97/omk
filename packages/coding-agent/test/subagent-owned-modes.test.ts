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
					return child as unknown as ReturnType<NonNullable<RunManagedProcessOptions["spawnProcess"]>>;
				},
			}),
	};
});

afterEach(() => {
	for (const child of children.splice(0)) child.emit("close", null, "SIGKILL");
});

function owner(remainingMs?: () => number | undefined) {
	let active = 0;
	const authority = createSubagentLaneAuthority({
		runId: "owned-mode",
		decision: null,
		permitPool: new WorkloadPermitPool({ capacity: 2 }),
		inventory: {
			tools: ["read", "write", "edit", "bash"].map((name) => ({ name, kind: "tool" as const })),
			skills: [],
			mcp: [],
			hooks: [],
		},
		getRemainingExecutionMs: remainingMs,
		noteDetachedChild: () => {
			active++;
			return () => {
				active--;
			};
		},
	});
	return { authority, active: () => active };
}

it.each(["single", "chain"] as const)("retains %s ownership until actual process termination", async (mode) => {
	const env = await fixture();
	const scope = owner();
	try {
		const params =
			mode === "single"
				? { agent: "fixture", task: "one task" }
				: {
						chain: [
							{ agent: "fixture", task: "one task" },
							{ agent: "fixture", task: "must not start" },
						],
					};
		const result = await env.execute(params, scope.authority);
		expect(result.isError).toBe(true);
		expect(children).toHaveLength(1);
		expect(scope.active()).toBe(1);
		const first = (result.details as ResultDetails).results[0];
		expect(first.process?.terminationObserved).toBe(false);
		expect(first.process).not.toHaveProperty("settlement");
		expect(() => structuredClone(result.details)).not.toThrow();
		const blocked = await env.execute({ agent: "fixture", task: "another task" }, scope.authority);
		expect(blocked.isError).toBe(true);
		expect(children).toHaveLength(1);
		children[0].emit("close", null, "SIGKILL");
		await vi.waitFor(() => expect(scope.active()).toBe(0));
	} finally {
		await env.cleanup();
	}
});

it("rechecks the parent deadline immediately before spawning", async () => {
	const env = await fixture();
	let reads = 0;
	const scope = owner(() => (++reads === 1 ? 120_000 : 29_000));
	try {
		const result = await env.execute({ agent: "fixture", task: "one task" }, scope.authority);
		expect(result.isError).toBe(true);
		expect(reads).toBeGreaterThanOrEqual(2);
		expect(children).toHaveLength(0);
		expect(scope.active()).toBe(0);
		expect(result.content).toEqual(
			expect.arrayContaining([{ type: "text", text: expect.stringContaining("Parent execution budget reserved") }]),
		);
	} finally {
		await env.cleanup();
	}
});

it("rejects an oversized chain before starting any worker", async () => {
	const env = await fixture();
	try {
		const result = await env.execute({
			chain: Array.from({ length: 17 }, () => ({ agent: "fixture", task: "one task" })),
		});
		expect(result.isError).toBe(true);
		expect(children).toHaveLength(0);
	} finally {
		await env.cleanup();
	}
});
