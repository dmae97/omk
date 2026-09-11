import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunProjection } from "../src/core/run-execution-api.ts";
import { acquireSessionOwnerLeaseSync } from "../src/core/session-owner-lease.ts";
import { journalPath, readRunJournal } from "../src/core/verified-run/journal.ts";
import * as clock from "../src/core/verified-run/recovery-clock.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "dag-retry-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

function request(fixture: ReturnType<typeof dagFixture>, state: RunProjection, taskIds = ["right"]) {
	return {
		...fixture.command,
		kind: "retry_tasks",
		commandId: "retry",
		expectedRevision: state.revision,
		expectedGeneration: state.generation,
		baseDigest: fixture.contract.workspace.baseDigest,
		taskIds,
	};
}

describe("generation-fenced selective DAG retry", () => {
	it("reuses only pinned successful material and reruns only the failed branch before new integration verification", async () => {
		const f = dagFixture(root, true);
		const before = await f.coordinator.start(f.contract, f.command, f.approval);
		writeFileSync(join(f.workspace, "input"), "changed original");
		writeFileSync(join(f.runPath, "tasks", "left-1-g1", "left"), "changed forensic output");
		const command = request(f, before);
		const result = await f.coordinator.retryTasks(command, f.approval);
		expect(result).toMatchObject({
			generation: 2,
			verification: "verified",
			tasks: [
				{ taskId: "left", attempt: 1, generation: 2, status: "succeeded" },
				{ taskId: "right", attempt: 2, generation: 2, status: "succeeded" },
				{ taskId: "join", attempt: 1, generation: 2, status: "succeeded" },
			],
		});
		expect(result.budget).toEqual(before.budget);
		expect(f.coordinator.artifact("dag", result.candidateDigest ?? "", "joined").toString()).toBe("originalORIGINAL");
		const records = readRunJournal(f.runPath)?.records ?? [];
		expect(records.filter(({ event }) => event.kind === "task_started" && event.taskId === "left")).toHaveLength(1);
		expect(
			records
				.filter(({ event }) => event.kind === "dispatch" && event.role === "verifier")
				.map((record) => record.generation),
		).toEqual([2]);
		const bytes = readFileSync(journalPath(f.runPath));
		expect(await f.coordinator.retryTasks(command, f.approval)).toEqual(result);
		expect(readFileSync(journalPath(f.runPath))).toEqual(bytes);
	});

	it("rejects stale references, changed approval and attempts to rerun a successful task before dispatch", async () => {
		const f = dagFixture(root, true);
		const before = await f.coordinator.start(f.contract, f.command, f.approval);
		const command = request(f, before);
		await expect(f.coordinator.retryTasks(command, { approvedContractDigest: "0".repeat(64) })).rejects.toThrow(
			/approval/,
		);
		await expect(
			f.coordinator.retryTasks({ ...command, expectedRevision: before.revision - 1 }, f.approval),
		).rejects.toThrow(/stale/);
		await expect(f.coordinator.retryTasks({ ...command, baseDigest: "f".repeat(64) }, f.approval)).rejects.toThrow(
			/input/,
		);
		await expect(f.coordinator.retryTasks({ ...command, taskIds: ["left"] }, f.approval)).rejects.toThrow(/task/);
		expect(f.coordinator.inspect("dag")).toEqual(before);
	});

	it("rejects a changed successful checkpoint instead of recapturing its writable directory", async () => {
		const f = dagFixture(root, true);
		const before = await f.coordinator.start(f.contract, f.command, f.approval);
		const completed = before.tasks.find((task) => task.taskId === "left");
		if (completed?.status !== "succeeded") throw new Error("missing successful fixture");
		writeFileSync(join(f.runPath, "candidates", `${completed.outputDigest}.json`), "{}");
		await expect(f.coordinator.retryTasks(request(f, before), f.approval)).rejects.toThrow(/integrity/);
		expect(f.coordinator.inspect("dag")).toEqual(before);
		expect(existsSync(join(f.runPath, "tasks", "right-2-g2"))).toBe(false);
	});

	it("preserves owner and deadline fences instead of replenishing work time", async () => {
		const f = dagFixture(root, true);
		const before = await f.coordinator.start(f.contract, f.command, f.approval);
		const command = request(f, before);
		const owner = acquireSessionOwnerLeaseSync(journalPath(f.runPath));
		try {
			await expect(f.coordinator.retryTasks(command, f.approval)).rejects.toThrow(/owner/);
		} finally {
			owner.release();
		}
		if (!before.budget) throw new Error("missing budget");
		vi.spyOn(clock, "readRunClock").mockReturnValue({
			bootId: before.budget.bootId,
			nowMs: before.budget.workDeadlineMs + 1,
		});
		await expect(f.coordinator.retryTasks(command, f.approval)).rejects.toThrow(/deadline/);
		expect(f.coordinator.inspect("dag")).toEqual(before);
	});
});
