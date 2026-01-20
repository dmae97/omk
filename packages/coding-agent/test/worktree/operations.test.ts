import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { type AsyncTempDir, createTempDir } from "@oh-my-pi/pi-utils";
import { WorktreeError } from "../../src/lib/worktree/errors";
import { git } from "../../src/lib/worktree/git";
import { create, find, list, remove } from "../../src/lib/worktree/operations";

let repoPath: AsyncTempDir;
let originalCwd: string;

async function createTestRepo(): Promise<AsyncTempDir> {
	const tempDir = await createTempDir("@omp-wt-test-");
	await git(["init", "-b", "main"], tempDir.path);
	await git(["config", "user.email", "test@example.com"], tempDir.path);
	await git(["config", "user.name", "Test User"], tempDir.path);
	await Bun.write(path.join(tempDir.path, "README.md"), "init");
	await git(["add", "README.md"], tempDir.path);
	await git(["commit", "-m", "init"], tempDir.path);
	return tempDir;
}

describe("worktree operations", () => {
	beforeEach(async () => {
		originalCwd = process.cwd();
		repoPath = await createTestRepo();
		process.chdir(repoPath.path);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await repoPath.remove();
	});

	test("create worktree with new branch", async () => {
		const wt = await create("feature-test");
		expect(wt.branch).toBe("feature-test");
		expect(existsSync(wt.path)).toBe(true);
	});

	test("create worktree with existing branch", async () => {
		await git(["branch", "existing-branch"], repoPath.path);
		const wt = await create("existing-branch");
		expect(wt.branch).toBe("existing-branch");
	});

	test("list worktrees", async () => {
		await create("feature-1");
		await create("feature-2");
		const worktrees = await list();
		expect(worktrees.length).toBe(3);
	});

	test("find worktree by branch", async () => {
		await create("my-feature");
		const wt = await find("my-feature");
		expect(wt.branch).toBe("my-feature");
	});

	test("find worktree by partial match", async () => {
		await create("feature-authentication");
		const wt = await find("auth");
		expect(wt.branch).toBe("feature-authentication");
	});

	test("remove worktree", async () => {
		const wt = await create("to-remove");
		await remove("to-remove");
		expect(existsSync(wt.path)).toBe(false);
	});

	test("cannot remove main worktree", async () => {
		await expect(remove("main")).rejects.toThrow(WorktreeError);
	});
});
