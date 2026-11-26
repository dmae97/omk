import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CommandRunner,
	createBranchWorktree,
	createGitBranch,
	openHerdrPlanPane,
	parseBranchCommandArgs,
	parseBranchListPorcelain,
	parseHerdrPaneId,
	parseWorktreePorcelain,
	pruneSafeWorktrees,
	readRepoBranchSnapshot,
	slugifyWorktreeDir,
	switchGitBranch,
	validateBranchName,
} from "../src/core/git-branch-manager.ts";

function cleanGitEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const key of Object.keys(env)) {
		if (key.startsWith("GIT_")) delete env[key];
	}
	return env;
}

function gitSync(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, env: cleanGitEnv(), encoding: "utf8" }).trim();
}

const tempDirs: string[] = [];
function makeTempRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "omk-branch-mgr-"));
	tempDirs.push(dir);
	gitSync(dir, ["init", "-b", "main"]);
	gitSync(dir, ["config", "user.email", "test@example.com"]);
	gitSync(dir, ["config", "user.name", "OMK Test"]);
	writeFileSync(join(dir, "README.md"), "# test\n");
	gitSync(dir, ["add", "README.md"]);
	gitSync(dir, ["commit", "-m", "init"]);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("branch parsers and validators", () => {
	it("validates git branch names safely", () => {
		expect(validateBranchName("feat/pstack-plan")).toBeUndefined();
		expect(validateBranchName("fix_123")).toBeUndefined();
		expect(validateBranchName("")).toBeDefined();
		expect(validateBranchName("-bad")).toBeDefined();
		expect(validateBranchName("a..b")).toBeDefined();
		expect(validateBranchName("bad space")).toBeDefined();
		expect(validateBranchName("bad.lock")).toBeDefined();
		expect(slugifyWorktreeDir("feat/pstack/plan")).toBe("feat-pstack-plan");
	});

	it("parses /branch subcommands", () => {
		expect(parseBranchCommandArgs("")).toEqual({ kind: "menu" });
		expect(parseBranchCommandArgs("status")).toEqual({ kind: "status" });
		expect(parseBranchCommandArgs("ls")).toEqual({ kind: "list" });
		expect(parseBranchCommandArgs("switch feat/a")).toEqual({ kind: "switch", name: "feat/a" });
		expect(parseBranchCommandArgs("new feat/b main")).toEqual({ kind: "create", name: "feat/b", base: "main" });
		expect(parseBranchCommandArgs("wt feat/c --pane")).toEqual({
			kind: "worktree",
			name: "feat/c",
			base: undefined,
			openPane: true,
		});
		expect(parseBranchCommandArgs("prune")).toEqual({ kind: "prune", apply: false });
		expect(parseBranchCommandArgs("prune --apply")).toEqual({ kind: "prune", apply: true });
		expect(parseBranchCommandArgs("help")).toEqual({ kind: "help" });
		expect(parseBranchCommandArgs("switch -bad")).toMatchObject({ kind: "invalid" });
	});

	it("parses porcelain branch, worktree, and Herdr JSON outputs", () => {
		const branches = parseBranchListPorcelain("*\tmain\torigin/main\t[ahead 2, behind 1]\n \tfeat/x\t\t\n");
		expect(branches).toEqual([
			{ name: "main", current: true, upstream: "origin/main", ahead: 2, behind: 1 },
			{ name: "feat/x", current: false, upstream: undefined, ahead: 0, behind: 0 },
		]);

		const worktrees = parseWorktreePorcelain(
			[
				"worktree /repo",
				"HEAD 1111111",
				"branch refs/heads/main",
				"",
				"worktree /repo/.worktrees/wt1",
				"HEAD 2222222",
				"detached",
				"prunable gitdir file points to non-existent location",
				"",
			].join("\n"),
		);
		expect(worktrees).toEqual([
			{ path: "/repo", head: "1111111", branch: "main", bare: false, prunable: false },
			{ path: "/repo/.worktrees/wt1", head: "2222222", branch: null, bare: false, prunable: true },
		]);

		expect(parseHerdrPaneId('{"ok":true,"result":{"pane":{"pane_id":"pane-42"}}}')).toBe("pane-42");
		expect(parseHerdrPaneId("not json")).toBeUndefined();
	});
});

describe("real git repo branch and worktree operations", () => {
	it("creates, switches (blocking dirty tree), creates worktree, and dry-run prunes", async () => {
		const repo = makeTempRepo();
		const created = await createGitBranch(repo, "feat/alpha");
		expect(created.ok).toBe(true);

		const snap1 = await readRepoBranchSnapshot(repo);
		expect(snap1.inRepo).toBe(true);
		expect(snap1.currentBranch).toBe("feat/alpha");
		expect(snap1.dirtyCount).toBe(0);
		expect(snap1.branches.map((b) => b.name)).toContain("main");

		writeFileSync(join(repo, "README.md"), "# dirty\n");
		const blockedSwitch = await switchGitBranch(repo, "main");
		expect(blockedSwitch.ok).toBe(false);
		if (!blockedSwitch.ok) expect(blockedSwitch.error).toContain("dirty");

		writeFileSync(join(repo, "README.md"), "# test\n");
		const okSwitch = await switchGitBranch(repo, "main");
		expect(okSwitch.ok).toBe(true);
		expect((await readRepoBranchSnapshot(repo)).currentBranch).toBe("main");

		const wt = await createBranchWorktree(repo, "feat/wt-test");
		expect(wt.ok).toBe(true);
		if (wt.ok) {
			expect(wt.worktreePath).toBe(join(repo, ".worktrees", "feat-wt-test"));
		}

		const snap2 = await readRepoBranchSnapshot(repo);
		expect(snap2.worktrees.length).toBe(2);

		const pruneDry = await pruneSafeWorktrees(repo, false);
		expect(pruneDry.ok).toBe(true);
	});

	it("opens a Herdr pane when HERDR_ENV is active and falls back gracefully when CLI fails", async () => {
		const calls: Array<{ file: string; args: readonly string[] }> = [];
		const herdrRunner: CommandRunner = async (file, args) => {
			calls.push({ file, args });
			if (file === "git" && args[0] === "rev-parse") return { exitCode: 0, stdout: "/repo\n", stderr: "" };
			if (file === "git" && args[0] === "show-ref") return { exitCode: 1, stdout: "", stderr: "" };
			if (file === "git" && args[0] === "worktree") return { exitCode: 0, stdout: "", stderr: "" };
			if (file === "herdr" && args[0] === "pane" && args[1] === "split") {
				return { exitCode: 0, stdout: '{"result":{"pane":{"pane_id":"pane-9"}}}', stderr: "" };
			}
			if (file === "herdr" && args[0] === "pane" && args[1] === "run") {
				return { exitCode: 0, stdout: '{"ok":true}', stderr: "" };
			}
			return { exitCode: 0, stdout: "", stderr: "" };
		};

		const res = await createBranchWorktree("/repo", "feat/herdr-wt", {
			openPane: true,
			herdrActive: true,
			runner: herdrRunner,
		});
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.backend).toBe("herdr");
			expect(res.paneId).toBe("pane-9");
		}
		expect(calls.some((c) => c.file === "herdr" && c.args[1] === "split")).toBe(true);
		expect(calls.some((c) => c.file === "herdr" && c.args[1] === "run")).toBe(true);

		const outsideHerdr = await openHerdrPlanPane("/repo", "inspect", { herdrActive: false, runner: herdrRunner });
		expect(outsideHerdr.ok).toBe(false);
	});
});
