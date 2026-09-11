import { mkdirSync, mkdtempSync, rmSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";
import { readRunJournal } from "../src/core/verified-run/journal.ts";
import * as clock from "../src/core/verified-run/recovery-clock.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "dag-stop-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

it("cancels an actual writer and never starts its successors or exposes recovery as ready", async () => {
	const f = dagFixture(root);
	mkdirSync(f.stateRoot);
	f.contract.writer.tasks[0].attempts[0] = ["/bin/sh", "-c", "cp input left; sleep 30"];
	const contractDigest = planVerifiedRun(f.contract).contractDigest;
	const controller = new AbortController();
	let observed = false;
	const timer = setTimeout(() => controller.abort(), 10000);
	const watcher = watch(f.stateRoot, { recursive: true }, (_event, path) => {
		if (path?.toString().endsWith("left-1-g1/left")) {
			observed = true;
			controller.abort();
		}
	});
	try {
		const state = await f.coordinator.start(
			f.contract,
			{ ...f.command, contractDigest },
			{ approvedContractDigest: contractDigest, signal: controller.signal },
		);
		expect(observed).toBe(true);
		expect(state).toMatchObject({
			execution: "failed",
			failure: "cancelled",
			activeExecutionIds: [],
			candidateDigest: null,
		});
		expect(readRunJournal(f.runPath)?.records.filter(({ event }) => event.kind === "task_started")).toHaveLength(1);
		expect(f.coordinator.inspectTaskRecovery("dag")).toMatchObject({
			readiness: "blocked",
			reason: "resume_terminal",
		});
	} finally {
		clearTimeout(timer);
		watcher.close();
		controller.abort();
	}
});

it("checks the work clock before a DAG dispatch without spending the verification reserve", async () => {
	const f = dagFixture(root);
	const initial = clock.readRunClock();
	vi.spyOn(clock, "readRunClock")
		.mockReturnValueOnce(initial)
		.mockReturnValue({ ...initial, nowMs: initial.nowMs + f.contract.budget.workMs + 1 });
	const state = await f.coordinator.start(f.contract, f.command, f.approval);
	expect(state).toMatchObject({ execution: "failed", failure: "deadline", candidateDigest: null });
	expect(readRunJournal(f.runPath)?.records.some(({ event }) => event.kind === "dispatch")).toBe(false);
});

it("reports expired and missing-key recovery as blocked using only a read-only inspection", async () => {
	const f = dagFixture(root, true);
	const state = await f.coordinator.start(f.contract, f.command, f.approval);
	if (!state.budget) throw new Error("missing budget");
	const spy = vi
		.spyOn(clock, "readRunClock")
		.mockReturnValue({ bootId: state.budget.bootId, nowMs: state.budget.workDeadlineMs + 1 });
	expect(f.coordinator.inspectTaskRecovery("dag")).toMatchObject({ readiness: "blocked", reason: "deadline" });
	spy.mockRestore();
	rmSync(join(f.runPath, "issuer.key"));
	expect(f.coordinator.inspectTaskRecovery("dag")).toMatchObject({ readiness: "blocked", reason: "integrity" });
	expect(f.coordinator.inspect("dag")).toEqual(state);
});
