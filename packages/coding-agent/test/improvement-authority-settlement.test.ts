import { afterEach, describe, expect, it, vi } from "vitest";
import { createSubagentLaneAuthority } from "../src/core/subagent-lane-authority.ts";
import * as launcher from "../src/core/subagent-lane-launcher.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

afterEach(() => vi.restoreAllMocks());

describe("authority callback result ownership", () => {
	it.each([
		{ heavy: false, terminal: "resolve" },
		{ heavy: true, terminal: "resolve" },
		{ heavy: false, terminal: "reject" },
		{ heavy: true, terminal: "reject" },
	])("blocks redispatch until late close (heavy=$heavy, terminal=$terminal)", async ({ heavy, terminal }) => {
		let close = () => {};
		let reject: (error: Error) => void = () => {};
		const settlement = new Promise<void>((resolve, rejectPromise) => {
			close = resolve;
			reject = rejectPromise;
		});
		const release = vi.fn();
		const noteDetachedChild = vi.fn(() => release);
		const pool = new WorkloadPermitPool({ capacity: 2 });
		const authority = createSubagentLaneAuthority({
			runId: "late-close",
			decision: null,
			permitPool: pool,
			inventory: { tools: [], skills: [], mcp: [], hooks: [] },
			noteDetachedChild,
		});
		const lanes = [{ id: "a", role: "executor" as const, task: "a", agentName: "test-agent" }];
		const first = await authority.dispatchLanes({
			lanes,
			heavyLaneIds: new Set(heavy ? ["a"] : []),
			launchLane: async () => ({ status: "unsettled", settlement }),
		});
		expect(first.outcomes[0].status).toBe("unsettled");
		const launchLane = vi.fn(async () => {});
		const blocked = await authority.dispatchLanes({ lanes, launchLane });
		expect(blocked).toMatchObject({
			outcomes: [],
			effectiveLaneWidth: 0,
			maxObservedConcurrency: 0,
			blockers: ["ownership.unsettled"],
		});
		expect(launchLane).not.toHaveBeenCalled();
		expect(noteDetachedChild).toHaveBeenCalledTimes(1);
		expect(release).not.toHaveBeenCalled();
		expect(pool.snapshot().activeWeight).toBe(heavy ? 1 : 0);
		// AgentSession recreates the authority per call over the same shared pool:
		// a fresh instance must inherit the unresolved ownership (spec R02/R04).
		const recreated = createSubagentLaneAuthority({
			runId: "late-close-2",
			decision: null,
			permitPool: pool,
			inventory: { tools: [], skills: [], mcp: [], hooks: [] },
			noteDetachedChild,
		});
		const recreatedBlocked = await recreated.dispatchLanes({ lanes, launchLane });
		expect(recreatedBlocked.blockers).toEqual(["ownership.unsettled"]);
		expect(launchLane).not.toHaveBeenCalled();
		if (terminal === "resolve") close();
		else reject(new Error("close not confirmed"));
		await settlement.catch(() => {});
		expect(release).toHaveBeenCalledTimes(terminal === "resolve" ? 1 : 0);
		const next = await authority.dispatchLanes({ lanes, launchLane });
		if (terminal === "resolve") {
			expect(next.blockers).toEqual([]);
			expect(next.outcomes[0].status).toBe("completed");
			expect(launchLane).toHaveBeenCalledTimes(1);
			expect(release).toHaveBeenCalledTimes(2);
			expect(pool.snapshot().activeWeight).toBe(0);
		} else {
			expect(next.blockers).toEqual(["ownership.unsettled"]);
			expect(launchLane).not.toHaveBeenCalled();
			expect(release).not.toHaveBeenCalled();
		}
	});

	it.each(["failed"] as const)(
		"forwards %s results unchanged and releases normally without settlement",
		async (status) => {
			const release = vi.fn();
			const result = { status };
			let received: unknown;
			vi.spyOn(launcher, "launchSubagentLanes").mockImplementationOnce(async (input) => {
				received = await input.launchLane({
					laneId: "a",
					promptRunId: "r04",
					decision: input.decision,
					effectiveLaneWidth: 1,
				});
				return { outcomes: [], effectiveLaneWidth: 1, maxObservedConcurrency: 1 };
			});
			await createSubagentLaneAuthority({
				runId: "r04",
				decision: null,
				permitPool: new WorkloadPermitPool(),
				inventory: { tools: [], skills: [], mcp: [], hooks: [] },
				noteDetachedChild: () => release,
			}).dispatchLanes({
				lanes: [{ id: "a", role: "executor", task: "a", agentName: "test-agent" }],
				launchLane: async () => result,
			});
			expect(received).toBe(result);
			expect(release).toHaveBeenCalledTimes(1);
		},
	);

	it.each(["resolve", "reject"] as const)("holds detached child until confirmed settlement (%s)", async (terminal) => {
		const release = vi.fn();
		let resolveSettlement = () => {};
		let rejectSettlement: (error: Error) => void = () => {};
		const settlement = new Promise<void>((resolve, reject) => {
			resolveSettlement = resolve;
			rejectSettlement = reject;
		});
		const result = { status: "unsettled" as const, settlement };
		let received: unknown;
		vi.spyOn(launcher, "launchSubagentLanes").mockImplementationOnce(async (input) => {
			received = await input.launchLane({
				laneId: "a",
				promptRunId: "r04",
				decision: input.decision,
				effectiveLaneWidth: 1,
			});
			return { outcomes: [], effectiveLaneWidth: 1, maxObservedConcurrency: 1 };
		});
		await createSubagentLaneAuthority({
			runId: "r04",
			decision: null,
			permitPool: new WorkloadPermitPool(),
			inventory: { tools: [], skills: [], mcp: [], hooks: [] },
			noteDetachedChild: () => release,
		}).dispatchLanes({
			lanes: [{ id: "a", role: "executor", task: "a", agentName: "test-agent" }],
			launchLane: async () => result,
		});
		expect(received).toBe(result);
		expect(release).not.toHaveBeenCalled();
		if (terminal === "resolve") resolveSettlement();
		else rejectSettlement(new Error("termination remains unconfirmed"));
		await settlement.catch(() => {});
		expect(release).toHaveBeenCalledTimes(terminal === "resolve" ? 1 : 0);
	});

	it.each([false, true])("releases once for void completion or thrown failure (throws=%s)", async (throws) => {
		const release = vi.fn();
		await createSubagentLaneAuthority({
			runId: "r04",
			decision: null,
			permitPool: new WorkloadPermitPool(),
			inventory: { tools: [], skills: [], mcp: [], hooks: [] },
			noteDetachedChild: () => release,
		}).dispatchLanes({
			lanes: [{ id: "a", role: "executor", task: "a", agentName: "test-agent" }],
			launchLane: async () => {
				if (throws) throw new Error("failed");
			},
		});
		expect(release).toHaveBeenCalledTimes(1);
	});
});
