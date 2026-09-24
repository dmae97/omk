import { describe, expect, it } from "vitest";
import { planEcrafAdmissions } from "../src/tool-dag-ecraf.ts";
import { scheduleDagLevelsMemo } from "../src/tool-dag-memo.ts";
import { finishDagTasks, startDagTask } from "../src/tool-dag-owned-task.ts";
import { assignDagDependencies, type DagSchedulePlan, type ResolvedClaimEntry } from "../src/tool-dag-scheduler.ts";
import { resolutionsConflict, type ToolClaimResolution } from "../src/tool-resource-claims.ts";

describe("OMK 20260924 algorithm integration", () => {
	it("owns execution errors and still joins started peers", async () => {
		let peerFinished = false;
		const running = new Map([
			[
				0,
				startDagTask(0, async () => {
					throw new Error("task failed");
				}),
			],
			[
				1,
				startDagTask(1, async () => {
					peerFinished = true;
					return undefined;
				}),
			],
		]);
		await expect(finishDagTasks(running, async () => {}, [])).rejects.toThrow("task failed");
		expect(peerFinished).toBe(true);
		expect(running.size).toBe(0);
	});

	it("retains both execution errors when in-flight peers fail", async () => {
		const first = new Error("first sink failure");
		const second = new Error("second sink failure");
		const running = new Map([
			[
				0,
				startDagTask(0, async () => {
					throw first;
				}),
			],
			[
				1,
				startDagTask(1, async () => {
					throw second;
				}),
			],
		]);
		const failure: unknown = await finishDagTasks(running, async () => {}, []).then(
			() => null,
			(error: unknown) => error,
		);
		expect(failure).toBeInstanceOf(AggregateError);
		if (failure instanceof AggregateError) expect(failure.errors).toEqual([first, second]);
		expect(running.size).toBe(0);
	});

	it("the actual memo cannot be poisoned through a returned claim", async () => {
		const cache = new Map<string, DagSchedulePlan>();
		const calls = [{ name: "write", arguments: { path: "/audit/file", content: "x" } }];
		const options = { cwd: "/audit" };
		const first = await scheduleDagLevelsMemo(calls, options, undefined, cache);
		expect(first).not.toBeNull();
		if (!first || first.entries[0].resolution.kind !== "claims") throw new Error("Expected path claims");
		const expected = first.entries[0].resolution.claims[0].key;
		(first.entries[0].resolution.claims[0] as { key: string }).key = "/poisoned";
		const next = await scheduleDagLevelsMemo(calls, options, undefined, cache);
		if (!next || next.entries[0].resolution.kind !== "claims") throw new Error("Expected path claims");
		expect(next.entries[0].resolution.claims[0].key).toBe(expected);
	});

	it("real claim predicate matches the all-pairs graph, including exclusive and path aliases", () => {
		const resolutions: ToolClaimResolution[] = [
			{ kind: "claims", claims: [{ kind: "path", key: "/a", realKey: "/r", access: "read" }] },
			{ kind: "claims", claims: [{ kind: "path", key: "/b", realKey: "/r", access: "write" }] },
			{ kind: "claims", claims: [{ kind: "network", key: "api", access: "read" }] },
			{ kind: "exclusive" },
			{ kind: "claims", claims: [{ kind: "path", key: "/b/x", access: "read" }] },
		];
		const entries: ResolvedClaimEntry[] = resolutions.map((resolution, sourceIndex) => ({
			sourceIndex,
			resolution,
			canonicalClaims: resolution.kind === "claims" ? resolution.claims : [],
		}));
		const reference = entries.map((entry, index) =>
			entries
				.slice(0, index)
				.filter((earlier) => resolutionsConflict(earlier.resolution, entry.resolution))
				.map((entry) => entry.sourceIndex),
		);
		expect(assignDagDependencies(entries)).toEqual(reference);
	});

	it.each(["toString", "constructor", "__proto__"])(
		"treats %s as a resource name, not a prototype property",
		(key) => {
			const plan = planEcrafAdmissions({
				candidates: [{ sourceIndex: 0, readySeq: 0, priority: 1, resources: Object.fromEntries([[key, 1]]) }],
				runningUsage: {},
				capacities: {},
				slots: 1,
			});
			expect(plan.admit).toEqual([0]);
		},
	);
});
