import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runVerifiedRunCli } from "../src/commands/verified-run-cli.ts";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "run-explanation-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

async function start(fail = false, expected?: string) {
	const f = dagFixture(root, fail);
	if (expected !== undefined) f.contract.checks[0].stdout = expected;
	const digest = planVerifiedRun(f.contract).contractDigest;
	await f.coordinator.start(f.contract, { ...f.command, contractDigest: digest }, { approvedContractDigest: digest });
	return f;
}

describe("journal-bound DAG and evidence explanation", () => {
	it("explains blocked join ancestry without dispatching, repairing or rewriting state", async () => {
		const f = await start(true);
		const before = readFileSync(journalPath(f.runPath));
		const report = f.coordinator.explain("dag");
		expect(report).toMatchObject({ runId: "dag", revision: f.coordinator.inspect("dag").revision, generation: 1 });
		expect(report.status.cleanSuccess).toBe(false);
		expect(report.executionRequested).toBe(false);
		expect(report.tasks.find((task) => task.taskId === "join")).toMatchObject({
			status: "pending",
			ready: false,
			blockedBy: [{ taskId: "right", status: "failed", reason: "execution_failed" }],
		});
		expect(report.proof.verdict).toBe("inconclusive");
		expect(report.proof.blockingClaimIds).toEqual(["joined"]);
		expect(report.proof.claimEvaluations[0].observationIds).toEqual([]);
		expect(readFileSync(journalPath(f.runPath))).toEqual(before);
	});

	it("carries authenticated check identity, candidate and closure rather than counting task success as proof", async () => {
		const f = await start(false, "not-the-candidate-output");
		const report = f.coordinator.explain("dag");
		expect(report.tasks.every((task) => task.status === "succeeded")).toBe(true);
		expect(report.proof.verdict).toBe("violated");
		expect(report.proof.blockingClaimIds).toEqual(["joined"]);
		expect(report.status.cleanSuccess).toBe(false);
		expect(report.binding.candidateDigest).toBe(f.coordinator.inspect("dag").candidateDigest);
		expect(report.binding.receiptDigest).toBe(f.coordinator.evidence("dag").receiptDigest);
		expect(report.proof.claimEvaluations[0].observationIds).toEqual([
			f.coordinator.evidence("dag").checks[0].executionId,
		]);
	});

	it("reports verified closure through the CLI using the same read-only SDK projection", async () => {
		const f = await start();
		const before = readFileSync(journalPath(f.runPath));
		const chunks: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			chunks.push(String(chunk));
			return true;
		});
		const result = await runVerifiedRunCli(["run", "explain", "dag", "--state-dir", f.stateRoot, "--json"]);
		expect(result).toEqual({ handled: true, exitCode: 0 });
		const report = JSON.parse(chunks.join(""));
		expect(report).toEqual(f.coordinator.explain("dag"));
		expect(report).toMatchObject({ executionRequested: false, proof: { verdict: "verified" } });
		expect(report.binding.journalDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(report.tasks.find((task: { taskId: string }) => task.taskId === "join").dependsOn).toEqual([
			"left",
			"right",
		]);
		expect(readFileSync(journalPath(f.runPath))).toEqual(before);
	});

	it("fails closed on damaged native evidence instead of explaining it as a pass", async () => {
		const f = await start();
		const evidence = f.coordinator.evidence("dag");
		const digest = evidence.checks[0].receiptCoreDigest;
		writeFileSync(join(f.runPath, "receipts", `${digest}.json`), '{"verified":true}');
		expect(() => f.coordinator.explain("dag")).toThrow();
	});

	it("does not create state for a missing run", () => {
		const state = join(root, "missing-state");
		expect(() => new RunCoordinator(state).explain("missing")).toThrow(/missing_run/);
	});

	it("refuses a valid journal stored under a different requested run identity", async () => {
		const f = await start();
		renameSync(f.runPath, join(f.stateRoot, "other-run"));
		expect(() => f.coordinator.explain("other-run")).toThrow(/missing_run/);
	});
});
