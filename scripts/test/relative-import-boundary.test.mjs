import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("../check-ts-relative-imports.mjs", import.meta.url));
// A pre-commit hook exports GIT_DIR/GIT_INDEX_FILE; inheriting them would commit fixtures into the outer repo.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
for (const [file, expected] of [
	[".omk/external/rea/vendor.ts", 0],
	[".omk/extensions/owned.ts", 1],
	["src/owned.ts", 1],
	["src/.omk/external/owned.ts", 1],
]) {
	test(`relative import boundary: ${file}`, () => {
		const root = mkdtempSync(join(tmpdir(), "omk-import-boundary-"));
		try {
			const target = join(root, file);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, 'import "./module.js";\n');
			const result = spawnSync(process.execPath, [checker, root], { env, encoding: "utf8", timeout: 15000 });
			assert.equal(result.status, expected, result.stderr);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

for (const directory of [".worktrees", "custom-checkouts"]) {
	test(`relative import boundary: registered nested worktree in ${directory}`, () => {
		const root = mkdtempSync(join(tmpdir(), "omk-import-worktree-"));
		const git = (...args) => execFileSync("git", ["-C", root, ...args], { env, stdio: "pipe", timeout: 10000 });
		try {
			git("init", "-q");
			git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture");
			const worktree = join(root, directory, "linked");
			git("worktree", "add", "--detach", worktree);
			writeFileSync(join(worktree, "foreign.ts"), 'import "./foreign.js";\n');
			const run = () => spawnSync(process.execPath, [checker, root], { env, encoding: "utf8", timeout: 15000 });
			let result = run();
			assert.equal(result.status, 0, result.stderr);
			const own = join(root, directory, "not-a-worktree");
			mkdirSync(own);
			writeFileSync(join(own, "owned.ts"), 'import "./owned.js";\n');
			result = run();
			assert.equal(result.status, 1, result.stderr);
			assert.match(result.stderr, /owned\.ts/);
			assert.doesNotMatch(result.stderr, /foreign\.ts/);
			result = spawnSync(process.execPath, [checker, worktree], { env, encoding: "utf8", timeout: 15000 });
			assert.equal(result.status, 1, result.stderr);
			assert.match(result.stderr, /foreign\.ts/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}
