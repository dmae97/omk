import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findGitPaths } from "../src/core/footer-git-paths.ts";

describe("findGitPaths", () => {
	let root: string;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "omk-footer-git-paths-")));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** Create `<repo>/.git/` as a directory, optionally with a HEAD file. */
	function makeGitDir(repo: string, withHead = true): string {
		const gitDir = join(repo, ".git");
		mkdirSync(gitDir, { recursive: true });
		if (withHead) writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
		return gitDir;
	}

	/** Create a linked-worktree layout: `<main>/.git/worktrees/wt` plus a `.git` file in `<worktree>`. */
	function makeLinkedWorktree(options: { head?: boolean; commondir?: boolean } = {}) {
		const mainGitDir = makeGitDir(join(root, "main"));
		const worktreeGitDir = join(mainGitDir, "worktrees", "wt");
		mkdirSync(worktreeGitDir, { recursive: true });
		if (options.head !== false) writeFileSync(join(worktreeGitDir, "HEAD"), "ref: refs/heads/feature\n");
		if (options.commondir !== false) writeFileSync(join(worktreeGitDir, "commondir"), "../..\n");
		const worktree = join(root, "wt");
		mkdirSync(worktree, { recursive: true });
		writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`);
		return { mainGitDir, worktreeGitDir, worktree };
	}

	it("returns the repo, git dir and HEAD path for a regular checkout", () => {
		const repo = join(root, "repo");
		const gitDir = makeGitDir(repo);

		expect(findGitPaths(repo)).toEqual({
			repoDir: repo,
			commonGitDir: gitDir,
			headPath: join(gitDir, "HEAD"),
		});
	});

	it("walks up from a nested subdirectory to the repo root", () => {
		const repo = join(root, "repo");
		const gitDir = makeGitDir(repo);
		const nested = join(repo, "packages", "app", "src");
		mkdirSync(nested, { recursive: true });

		expect(findGitPaths(nested)).toEqual({
			repoDir: repo,
			commonGitDir: gitDir,
			headPath: join(gitDir, "HEAD"),
		});
	});

	it("returns null when the .git directory has no HEAD", () => {
		const repo = join(root, "repo");
		makeGitDir(repo, false);

		expect(findGitPaths(repo)).toBeNull();
	});

	it("resolves commonGitDir from commondir for a linked worktree", () => {
		const { mainGitDir, worktreeGitDir, worktree } = makeLinkedWorktree();

		expect(findGitPaths(worktree)).toEqual({
			repoDir: worktree,
			commonGitDir: mainGitDir,
			headPath: join(worktreeGitDir, "HEAD"),
		});
	});

	it("uses the gitdir as commonGitDir when a linked worktree has no commondir", () => {
		const { worktreeGitDir, worktree } = makeLinkedWorktree({ commondir: false });

		expect(findGitPaths(worktree)).toEqual({
			repoDir: worktree,
			commonGitDir: worktreeGitDir,
			headPath: join(worktreeGitDir, "HEAD"),
		});
	});

	it("resolves a relative gitdir against the directory that holds the .git file", () => {
		const { worktreeGitDir, worktree } = makeLinkedWorktree({ commondir: false });
		writeFileSync(join(worktree, ".git"), "gitdir: ../main/.git/worktrees/wt\n");

		expect(findGitPaths(worktree)).toEqual({
			repoDir: worktree,
			commonGitDir: worktreeGitDir,
			headPath: join(worktreeGitDir, "HEAD"),
		});
	});

	it("returns null when the gitdir of a linked worktree does not exist", () => {
		const worktree = join(root, "missing-wt");
		mkdirSync(worktree, { recursive: true });
		writeFileSync(join(worktree, ".git"), `gitdir: ${join(root, "does-not-exist")}\n`);

		expect(findGitPaths(worktree)).toBeNull();
	});

	it("returns null when the gitdir of a linked worktree has no HEAD", () => {
		const { worktree } = makeLinkedWorktree({ head: false });

		expect(findGitPaths(worktree)).toBeNull();
	});

	it("keeps walking up past a .git file that is not a gitdir pointer", () => {
		const repo = join(root, "repo");
		const gitDir = makeGitDir(repo);
		const inner = join(repo, "inner");
		mkdirSync(inner, { recursive: true });
		writeFileSync(join(inner, ".git"), "not a gitdir pointer\n");

		expect(findGitPaths(inner)).toEqual({
			repoDir: repo,
			commonGitDir: gitDir,
			headPath: join(gitDir, "HEAD"),
		});
	});

	it("returns null when directory is outside any git repository", () => {
		const plainDir = join(root, "not-a-repo");
		mkdirSync(plainDir, { recursive: true });

		expect(findGitPaths(plainDir)).toBeNull();
	});
});
