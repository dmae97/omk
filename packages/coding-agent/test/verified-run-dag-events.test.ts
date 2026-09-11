import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunTaskRetryCommand } from "omk-protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunTaskCheckpoint } from "../src/core/verified-run/dag-types.ts";
import { projectRun, type RunEvent } from "../src/core/verified-run/events.ts";
import { readRunJournal } from "../src/core/verified-run/journal.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
let events: readonly RunEvent[] = [];
let retry: Extract<RunEvent, { kind: "tasks_retried" }>;
beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "dag-events-"));
	const f = dagFixture(root, true);
	const state = await f.coordinator.start(f.contract, f.command, f.approval);
	events = readRunJournal(f.runPath)?.records.map(({ event }) => event) ?? [];
	retry = {
		kind: "tasks_retried",
		observedMs: state.lastClockMs ?? 0,
		reconciledExecutionIds: [],
		command: parseRunTaskRetryCommand({
			...f.command,
			kind: "retry_tasks",
			commandId: "retry",
			expectedRevision: state.revision,
			expectedGeneration: state.generation,
			baseDigest: f.contract.workspace.baseDigest,
			taskIds: ["right"],
		}),
		adopted: state.tasks.filter((task): task is RunTaskCheckpoint => task.status === "succeeded"),
	};
});
afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("DAG replay fences", () => {
	it("rejects an unknown task, unmet dependency or skipped attempt before dispatch", () => {
		const initial = events.slice(0, 3);
		const state = projectRun(initial);
		const started = {
			kind: "task_started" as const,
			taskId: "left",
			attempt: 1,
			inputDigest: state.inputDigest ?? "",
			observedMs: state.lastClockMs ?? 0,
		};
		expect(() => projectRun([...initial, { ...started, taskId: "unknown" }])).toThrow(/integrity/);
		expect(() => projectRun([...initial, { ...started, taskId: "join" }])).toThrow(/task_not_ready/);
		expect(() => projectRun([...initial, { ...started, attempt: 2 }])).toThrow(/task_not_ready/);
	});
	it("rejects task checkpoints after the original work deadline", () => {
		const initial = events.slice(0, 3);
		const { budget, inputDigest } = projectRun(initial);
		if (!budget || !inputDigest) throw new Error("missing budget");
		expect(() =>
			projectRun([
				...initial,
				{ kind: "task_started", taskId: "left", attempt: 1, inputDigest, observedMs: budget.workDeadlineMs + 1 },
			]),
		).toThrow(/deadline/);
	});
	it.each(["inputDigest", "outputDigest", "generation"] as const)(
		"rejects changed %s on an adopted checkpoint",
		(field) => {
			const changed = retry.adopted.map((task) =>
				field === "generation" ? { ...task, generation: 9 } : { ...task, [field]: "f".repeat(64) },
			);
			expect(() => projectRun([...events, { ...retry, adopted: changed }])).toThrow(/task_checkpoint_mismatch/);
		},
	);
	it("rejects missing adoption and success dressed up as a retry target", () => {
		expect(() => projectRun([...events, { ...retry, adopted: [] }])).toThrow(/checkpoint/);
		expect(() => projectRun([...events, { ...retry, command: { ...retry.command, taskIds: ["left"] } }])).toThrow(
			/task/,
		);
	});
	it.each(["task_finished", "process_ready", "exited"] as const)(
		"refuses a late old %s event after generation acquisition",
		(kind) => {
			const stale = events.filter((event) => event.kind === kind).at(-1);
			if (!stale) throw new Error("missing fixture event");
			expect(() => projectRun([...events, retry, stale])).toThrow();
		},
	);
	it("does not authorize a writer dispatch or candidate without a ready task and complete dependencies", () => {
		expect(() =>
			projectRun([...events, retry, { kind: "dispatch", executionId: "forged", role: "writer", claimId: null }]),
		).toThrow(/task_not_ready/);
		expect(() =>
			projectRun([
				...events,
				retry,
				{
					kind: "candidate",
					digest: "f".repeat(64),
					observedMs: retry.observedMs,
					verificationDeadlineMs: retry.observedMs + 1000,
				},
			]),
		).toThrow(/integrity/);
	});
});
