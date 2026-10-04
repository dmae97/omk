import { expect, it } from "vitest";
import { createSubagentLaneAuthority } from "../src/core/subagent-lane-authority.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

it("serializes distinct authority dispatches over the same shared pool", async () => {
	const permitPool = new WorkloadPermitPool({ capacity: 4 });
	const binding = {
		runId: "phase3",
		decision: null,
		permitPool,
		inventory: {
			tools: ["read", "write", "edit", "bash"].map((name) => ({ name, kind: "tool" as const })),
			skills: [],
			mcp: [],
			hooks: [],
		},
		noteDetachedChild: () => () => {},
	};
	let finish: (() => void) | undefined;
	const pending = new Promise<void>((resolve) => {
		finish = resolve;
	});
	let started = 0;
	const input = {
		lanes: [{ id: "writer", role: "executor" as const, task: "modify assigned file", writeScope: ["src/a.ts"] }],
		heavyLaneIds: new Set<string>(),
		launchLane: async () => {
			started++;
			await pending;
		},
	};
	const first = createSubagentLaneAuthority(binding).dispatchLanes(input);
	try {
		const second = await createSubagentLaneAuthority(binding).dispatchLanes(input);
		expect(second.blockers).toEqual(["ownership.dispatch_active"]);
		expect(started).toBe(1);
	} finally {
		finish?.();
		await first;
	}
});
