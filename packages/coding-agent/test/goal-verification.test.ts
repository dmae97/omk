import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureGoalWorkspace, GoalVerifier, goalKeyOf, goalStateDirectory } from "../src/core/goal-verification.ts";
import { detectSandboxBackend } from "../src/core/sandbox/backend.ts";
import { createWorkspaceSandboxPolicy } from "../src/core/sandbox/default-policy.ts";

const roots: string[] = [];
const noSandbox = () => undefined;

function tempDir(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function gitRepo(): string {
	const root = tempDir("omk-goal-verify-");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
	git("init", "-q");
	git("config", "user.email", "goal@test.invalid");
	git("config", "user.name", "goal");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(root, "tracked.txt"), "v1\n");
	git("add", ".");
	git("commit", "-qm", "init");
	return root;
}

function receiptsDirectory(root: string, goalKey: string): string {
	return join(goalStateDirectory(root), "evidence", goalKey, "receipts");
}

function receiptsOf(root: string, goalKey: string): string[] {
	const directory = receiptsDirectory(root, goalKey);
	return existsSync(directory)
		? readdirSync(directory).filter((id) => existsSync(join(directory, id, "receipt.json")))
		: [];
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("goal acceptance verification", () => {
	it("binds a passing command to a strict receipt and the workspace after the check", async () => {
		const root = gitRepo();
		const verifier = new GoalVerifier({ cwd: root, goalKey: "k-pass", sandboxPreflight: noSandbox });

		const result = await verifier.run("printf ok");

		expect(result).toMatchObject({ status: "passed", exitCode: 0, passed: true, outputTail: "ok" });
		expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
		expect(Number.isNaN(Date.parse(result.capturedAt))).toBe(false);
		expect(result.workspace).toEqual(captureGoalWorkspace(root));
		expect(result.workspace.completeness).toBe("complete");
		expect(verifier.receiptMatches(result.receiptId, result.digest)).toBe(true);
		expect(receiptsOf(root, "k-pass")).toHaveLength(1);
	});

	it("keeps passing later checks while earlier receipts and the ledger sit untracked in goal state", async () => {
		const root = gitRepo();
		const verifier = new GoalVerifier({ cwd: root, goalKey: "k-again", sandboxPreflight: noSandbox });

		const first = await verifier.run("printf ok");
		const second = await verifier.run("printf ok");

		expect(first.passed).toBe(true);
		expect(second).toMatchObject({ status: "passed", passed: true });
		expect(second.workspace).toEqual(first.workspace);
	});

	it("records a failing command without passing it", async () => {
		const root = gitRepo();
		const verifier = new GoalVerifier({ cwd: root, goalKey: "k-fail", sandboxPreflight: noSandbox });

		const result = await verifier.run("printf broken; exit 3");

		expect(result).toMatchObject({ status: "failed", exitCode: 3, passed: false });
		expect(result.outputTail).toBe("broken");
		expect(result.gateReason).not.toBe("");
		expect(receiptsOf(root, "k-fail")).toHaveLength(1);
	});

	it("stops a hanging command at the timeout without passing it", async () => {
		const root = gitRepo();
		const verifier = new GoalVerifier({ cwd: root, goalKey: "k-slow", timeoutMs: 300, sandboxPreflight: noSandbox });

		const result = await verifier.run("sleep 5");

		expect(result).toMatchObject({ status: "timeout", exitCode: null, passed: false });
	});

	it("changes the workspace state for tracked edits and new files, not for goal state", () => {
		const root = gitRepo();
		const initial = captureGoalWorkspace(root);

		mkdirSync(join(goalStateDirectory(root), "evidence", "k"), { recursive: true });
		writeFileSync(join(goalStateDirectory(root), "current.json"), "{}\n");
		writeFileSync(join(goalStateDirectory(root), "evidence", "k", "receipt.json"), "{}\n");
		expect(captureGoalWorkspace(root)).toEqual(initial);

		writeFileSync(join(root, "tracked.txt"), "v2\n");
		const edited = captureGoalWorkspace(root);
		expect(edited.sha256).not.toBe(initial.sha256);

		writeFileSync(join(root, "new.txt"), "late\n");
		expect(captureGoalWorkspace(root).sha256).not.toBe(edited.sha256);
	});

	it("rejects a receipt whose stored bytes no longer match its digest", async () => {
		const root = gitRepo();
		const verifier = new GoalVerifier({ cwd: root, goalKey: "k-tamper", sandboxPreflight: noSandbox });
		const result = await verifier.run("printf ok");
		const path = join(receiptsDirectory(root, "k-tamper"), result.receiptId, "receipt.json");

		writeFileSync(path, readFileSync(path, "utf8").replace('"durationMs":', '"durationMs":1'));

		expect(verifier.receiptMatches(result.receiptId, result.digest)).toBe(false);
		expect(verifier.receiptMatches(result.receiptId, "0".repeat(64))).toBe(false);
	});

	it("fails closed before spawning when enforce mode has no sandbox backend", async () => {
		const root = gitRepo();
		const verifier = new GoalVerifier({
			cwd: root,
			goalKey: "k-sandbox",
			sandboxPreflight: () => ({
				policy: createWorkspaceSandboxPolicy(root, "enforce"),
				backend: { platform: "linux", backendAvailable: false },
			}),
		});

		await expect(verifier.run("printf ran > proof.txt")).rejects.toThrow(/sandbox\.backend_missing/);
		expect(existsSync(join(root, "proof.txt"))).toBe(false);
	});

	it.skipIf(!detectSandboxBackend().backendAvailable)(
		"runs the check inside the default enforce sandbox, without the host network",
		async () => {
			const root = gitRepo();
			const verifier = new GoalVerifier({ cwd: root, goalKey: "k-enforce" });
			// Receipts accept only static command lines, so the substitution lives in a script.
			writeFileSync(join(root, "only-loopback.sh"), 'test "$(grep -c : /proc/net/dev)" -eq 1\n');

			const result = await verifier.run("sh only-loopback.sh");

			expect(result).toMatchObject({ status: "passed", passed: true });
		},
	);

	it("redacts credentials from the operator output tail", async () => {
		const root = gitRepo();
		const verifier = new GoalVerifier({ cwd: root, goalKey: "k-secret", sandboxPreflight: noSandbox });
		const secret = "sk-abcdefghijklmnopqrstuvwxyz012345";

		const result = await verifier.run(`printf 'key=${secret}'`);

		expect(result.outputTail).not.toContain(secret);
		expect(
			readFileSync(join(receiptsDirectory(root, "k-secret"), result.receiptId, "receipt.json"), "utf8"),
		).not.toContain(secret);
	});

	it("reports an unavailable workspace binding outside git", () => {
		expect(captureGoalWorkspace(tempDir("omk-goal-nogit-")).completeness).toBe("unavailable");
	});

	it("derives one goal key per goal instance, independent of revisions", () => {
		const goal = { ref: { id: "session", revision: 1 }, createdAt: "2026-09-30T00:00:00.000Z" };
		const key = goalKeyOf(goal);

		expect(key).toMatch(/^[0-9a-f]{16}$/);
		expect(goalKeyOf({ ...goal, ref: { id: "session", revision: 9 } })).toBe(key);
		expect(goalKeyOf({ ...goal, createdAt: "2026-09-30T00:00:01.000Z" })).not.toBe(key);
	});
});
