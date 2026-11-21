import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Git subcommands that create or change repository state when run against an inherited GIT_DIR.
const WRITES = /["'`](?:init|commit|worktree|add|update-ref|config|tag|branch|checkout|switch|reset)["'`]|git (?:init|commit|worktree)\b/;
const SPAWNS_GIT = /(?:execFileSync|spawnSync|execFile|spawn)\(\s*["'`]git["'`]|["'`]git ["'`]?(?:-C|init|commit|worktree)/;

/**
 * The pre-commit hook runs these tests with GIT_DIR/GIT_INDEX_FILE exported. A test that writes to a
 * fixture repository without dropping GIT_* writes to the outer repository instead: fixture commits on the
 * current branch, registered worktrees, or core.bare=true in the shared config.
 */
test("script tests that write to git repositories drop inherited GIT_* variables", () => {
	const offenders = readdirSync(here)
		.filter((name) => /\.test\.mjs$/.test(name))
		.filter((name) => {
			const source = readFileSync(join(here, name), "utf8");
			return SPAWNS_GIT.test(source) && WRITES.test(source) && !/GIT_/.test(source);
		});
	assert.deepEqual(offenders, []);
});

test("an inherited worktree GIT_DIR is what turns git init into a shared-config write", () => {
	const root = mkdtempSync(join(tmpdir(), "omk-git-env-"));
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
	const git = (args, extra = {}) => execFileSync("git", args, { env: { ...env, ...extra }, stdio: "pipe" });
	try {
		git(["init", "-q", join(root, "repo")]);
		git(["-C", join(root, "repo"), "-c", "user.name=f", "-c", "user.email=f@example.invalid", "commit", "-q", "--allow-empty", "-m", "f"]);
		git(["-C", join(root, "repo"), "worktree", "add", "-q", "--detach", join(root, "linked")]);
		const bare = () => git(["config", "-f", join(root, "repo", ".git", "config"), "--get", "core.bare"]).toString().trim();
		const hookEnv = { GIT_DIR: join(root, "repo", ".git", "worktrees", "linked") };
		git(["init", "-q", join(root, "isolated")]);
		assert.equal(bare(), "false");
		git(["init", "-q", join(root, "leaked")], hookEnv);
		assert.equal(bare(), "true");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
