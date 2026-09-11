import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as durableIo from "../src/core/durable-file-io.ts";
import { planVerifiedRun, type RunProjection } from "../src/core/run-execution-api.ts";
import { canonicalJson } from "../src/core/run-journal.ts";
import { journalPath, readRunJournal } from "../src/core/verified-run/journal.ts";
import * as clock from "../src/core/verified-run/recovery-clock.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "dag-recovery-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});
function retry(f: ReturnType<typeof dagFixture>, state: RunProjection, taskIds: string[]) {
	return {
		...f.command,
		commandId: `retry-${state.generation}`,
		kind: "retry_tasks",
		expectedRevision: state.revision,
		expectedGeneration: state.generation,
		baseDigest: f.contract.workspace.baseDigest,
		taskIds,
	};
}
function prefix(f: ReturnType<typeof dagFixture>, end: number) {
	const journal = readRunJournal(f.runPath);
	if (!journal || end < 2) throw new Error("invalid fixture prefix");
	writeFileSync(
		journalPath(f.runPath),
		`${journal.records
			.slice(0, end + 1)
			.map(canonicalJson)
			.join("\n")}\n`,
	);
	return f.coordinator.inspect("dag");
}

describe("DAG recovery boundaries", () => {
	it.each(["dispatch", "process_ready"])(
		"keeps the process identity requirement at the %s crash boundary",
		async (kind) => {
			const f = dagFixture(root, true);
			await f.coordinator.start(f.contract, f.command, f.approval);
			const records = readRunJournal(f.runPath)?.records ?? [];
			const start = records.findIndex(({ event }) => event.kind === "task_started" && event.taskId === "right");
			const end = records.findIndex(({ event }, index) => index > start && event.kind === kind);
			const state = prefix(f, end);
			if (kind === "dispatch") {
				await expect(f.coordinator.retryTasks(retry(f, state, ["right"]), f.approval)).rejects.toThrow(/unsettled/);
				expect(f.coordinator.inspect("dag")).toEqual(state);
			} else
				expect(await f.coordinator.retryTasks(retry(f, state, ["right"]), f.approval)).toMatchObject({
					generation: 2,
					verification: "verified",
					tasks: [{ attempt: 1 }, { attempt: 2 }, { attempt: 1 }],
				});
		},
	);

	it.each(["input_checkpoint", "task_finished"] as const)(
		"continues pending-only work from %s without borrowing attempts",
		async (kind) => {
			const f = dagFixture(root);
			await f.coordinator.start(f.contract, f.command, f.approval);
			const records = readRunJournal(f.runPath)?.records ?? [];
			const end = records.map(({ event }) => event.kind).lastIndexOf(kind);
			const state = prefix(f, end);
			const result = await f.coordinator.retryTasks(retry(f, state, []), f.approval);
			expect(result).toMatchObject({
				generation: 2,
				verification: "verified",
				tasks: [{ attempt: 1 }, { attempt: 1 }, { attempt: 1 }],
			});
			expect(result.budget).toEqual(state.budget);
			const newWriters = readRunJournal(f.runPath)?.records.filter(
				({ generation, event }) => generation === 2 && event.kind === "dispatch" && event.role === "writer",
			);
			expect(newWriters).toHaveLength(kind === "input_checkpoint" ? 3 : 0);
		},
	);

	it("resumes a fixed DAG candidate with new verifier evidence rather than rerunning any writer", async () => {
		const f = dagFixture(root);
		await f.coordinator.start(f.contract, f.command, f.approval);
		const original = f.coordinator.evidence("dag");
		const records = readRunJournal(f.runPath)?.records ?? [];
		const state = prefix(f, records.length - 2);
		const result = await f.coordinator.resume(
			{
				...f.command,
				commandId: "resume",
				kind: "resume",
				expectedRevision: state.revision,
				expectedGeneration: 1,
				candidateDigest: state.candidateDigest,
			},
			f.approval,
		);
		expect(result).toMatchObject({ generation: 2, verification: "verified", candidateDigest: state.candidateDigest });
		expect(f.coordinator.evidence("dag").checks[0].executionId).not.toBe(original.checks[0].executionId);
		expect(readRunJournal(f.runPath)?.records.filter(({ event }) => event.kind === "task_started")).toHaveLength(3);
	});

	it("does not refund the per-task attempt cap across generations", async () => {
		const f = dagFixture(root, true);
		f.contract.writer.tasks[1].attempts[1] = ["/bin/false"];
		const contractDigest = planVerifiedRun(f.contract).contractDigest;
		const approval = { approvedContractDigest: contractDigest };
		const state = await f.coordinator.start(f.contract, { ...f.command, contractDigest }, approval);
		const result = await f.coordinator.retryTasks({ ...retry(f, state, ["right"]), contractDigest }, approval);
		expect(result).toMatchObject({
			generation: 2,
			execution: "paused",
			tasks: [{ attempt: 1 }, { attempt: 2 }, { attempt: 0 }],
		});
		await expect(
			f.coordinator.retryTasks({ ...retry(f, result, ["right"]), contractDigest }, approval),
		).rejects.toThrow(/task_attempt_limit/);
	});

	it("caps acquisitions even when a crash leaves no dispatched task", async () => {
		const f = dagFixture(root);
		await f.coordinator.start(f.contract, f.command, f.approval);
		let state = prefix(f, 2);
		for (let generation = 1; generation <= 2; generation++) {
			await f.coordinator.retryTasks(retry(f, state, []), f.approval);
			const records = readRunJournal(f.runPath)?.records ?? [];
			state = prefix(f, records.map(({ event }) => event.kind).lastIndexOf("tasks_retried"));
		}
		await expect(f.coordinator.retryTasks(retry(f, state, []), f.approval)).rejects.toThrow(/recovery_limit/);
		expect(state.generation).toBe(3);
	});

	it.each([false, true])("never dispatches after retry persistence fails (visible: %s)", async (visible) => {
		const f = dagFixture(root, true);
		const state = await f.coordinator.start(f.contract, f.command, f.approval);
		const before = readFileSync(journalPath(f.runPath));
		const persist = durableIo.appendFileDurablySync;
		vi.spyOn(durableIo, "appendFileDurablySync").mockImplementation((path, bytes) => {
			if (Buffer.from(bytes).toString().includes('"kind":"tasks_retried"')) {
				if (visible) persist(path, bytes);
				throw new Error("retry fsync failure");
			}
			persist(path, bytes);
		});
		const command = retry(f, state, ["right"]);
		await expect(f.coordinator.retryTasks(command, f.approval)).rejects.toThrow(/fsync/);
		expect(existsSync(join(f.runPath, "tasks", "right-2-g2"))).toBe(false);
		if (visible)
			expect(await f.coordinator.retryTasks(command, f.approval)).toMatchObject({
				generation: 2,
				verification: "not_requested",
			});
		else expect(readFileSync(journalPath(f.runPath))).toEqual(before);
	});

	it("blocks rebooted clocks and missing issuer keys without repairing stored state", async () => {
		const f = dagFixture(root, true);
		const state = await f.coordinator.start(f.contract, f.command, f.approval);
		const spy = vi
			.spyOn(clock, "readRunClock")
			.mockReturnValue({ bootId: "00000000-0000-0000-0000-000000000000", nowMs: 0 });
		await expect(f.coordinator.retryTasks(retry(f, state, ["right"]), f.approval)).rejects.toThrow(/clock_changed/);
		spy.mockRestore();
		rmSync(join(f.runPath, "issuer.key"));
		await expect(f.coordinator.retryTasks(retry(f, state, ["right"]), f.approval)).rejects.toThrow();
		expect(f.coordinator.inspect("dag")).toEqual(state);
	});
});
