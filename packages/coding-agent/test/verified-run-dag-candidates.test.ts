import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";
import { captureCandidate, loadCandidate, materializeCandidate } from "../src/core/verified-run/candidate.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "dag-materials-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

it("merges only owned changes, preserving deletion, empty directories, modes and exact ancestor input ordering", async () => {
	const f = dagFixture(root);
	mkdirSync(join(f.workspace, "a"), { mode: 0o755 });
	writeFileSync(join(f.workspace, "a", "obsolete"), "remove me");
	writeFileSync(join(f.workspace, "a.old"), "keep me");
	f.contract.writablePaths = ["a", "a.c", "z"];
	f.contract.writer.tasks = [
		{
			id: "tree",
			dependsOn: [],
			writablePaths: ["a"],
			attempts: [["/bin/sh", "-c", "rm a/obsolete; printf one > a/out; chmod 755 a/out; mkdir a/empty"]],
		},
		{ id: "file", dependsOn: [], writablePaths: ["a.c"], attempts: [["/bin/sh", "-c", "printf two > a.c"]] },
		{
			id: "consumer",
			dependsOn: ["tree"],
			writablePaths: ["z"],
			attempts: [["/bin/sh", "-c", "test ! -e a.c && test ! -e a/obsolete && printf ok > z"]],
		},
	];
	f.contract.checks = [
		{
			claimId: "merged",
			argv: ["/bin/sh", "-c", "test -x a/out && test -d a/empty && test ! -e a/obsolete && cat a/out a.c z"],
			stdout: "onetwook",
		},
	];
	f.contract.workspace.baseDigest = planVerifiedRun(f.contract).baseDigest;
	const contractDigest = planVerifiedRun(f.contract).contractDigest;
	const state = await f.coordinator.start(
		f.contract,
		{ ...f.command, contractDigest },
		{ approvedContractDigest: contractDigest },
	);
	expect(state.verification).toBe("verified");
	for (const task of state.tasks) {
		if (task.status !== "succeeded") throw new Error("missing checkpoint");
		const input = loadCandidate(f.runPath, task.inputDigest, f.contract.budget);
		const path = join(root, `roundtrip-${task.taskId}`);
		materializeCandidate(input, path);
		expect(captureCandidate(path, f.contract.budget).digest).toBe(input.digest);
	}
	expect(existsSync(join(f.workspace, "a", "obsolete"))).toBe(true);
});

it("rejects a writer changing a sibling scope even when the run-wide scope permits that path", async () => {
	const f = dagFixture(root);
	f.contract.writer.tasks[0].attempts[0] = ["/bin/sh", "-c", "printf wrong > right"];
	const contractDigest = planVerifiedRun(f.contract).contractDigest;
	const state = await f.coordinator.start(
		f.contract,
		{ ...f.command, contractDigest },
		{ approvedContractDigest: contractDigest },
	);
	expect(state).toMatchObject({
		execution: "paused",
		candidateDigest: null,
		tasks: [{ status: "failed", failure: "scope_changed" }, { status: "succeeded" }, { status: "pending" }],
	});
});
