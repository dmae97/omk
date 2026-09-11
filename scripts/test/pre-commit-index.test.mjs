import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const hook = resolve(dirname(fileURLToPath(import.meta.url)), "../../.husky/pre-commit");

function fixture(run) {
	const cwd = mkdtempSync(join(tmpdir(), "omk-pre-commit-"));
	const bin = join(cwd, "bin");
	mkdirSync(bin);
	const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: cwd, GIT_CONFIG_NOSYSTEM: "1" };
	const git = (...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
	const fake = (name, body) => {
		const path = join(bin, name);
		writeFileSync(path, `#!/bin/sh\n${body}\n`);
		chmodSync(path, 0o700);
	};
	fake("node", "exit 0");
	fake("npm", "exit 0");
	git("init", "--quiet");
	const execute = () => spawnSync("sh", [hook], { cwd, env, encoding: "utf8" });
	try { run({ cwd, git, fake, execute }); }
	finally { rmSync(cwd, { recursive: true, force: true }); }
}

it("preserves the selected index and unstaged edits in the same file", () => fixture(({ cwd, git, execute }) => {
	writeFileSync(join(cwd, "change.txt"), "selected\n");
	git("add", "--", "change.txt");
	const before = git("write-tree");
	writeFileSync(join(cwd, "change.txt"), "selected\nunselected\n");
	const result = execute();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(git("write-tree"), before, "the hook changed the selected index");
	assert.equal(readFileSync(join(cwd, "change.txt"), "utf8"), "selected\nunselected\n");
}));

it("does not re-stage files rewritten by a checker", () => fixture(({ cwd, git, fake, execute }) => {
	writeFileSync(join(cwd, "change.txt"), "selected\n");
	git("add", "--", "change.txt");
	const before = git("write-tree");
	fake("npm", "printf 'checker edit\\n' > change.txt");
	const result = execute();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(git("write-tree"), before);
}));

it("rejects a checker that changes the index without concealing that change", () => fixture(({ cwd, git, fake, execute }) => {
	writeFileSync(join(cwd, "change.txt"), "selected\n");
	git("add", "--", "change.txt");
	fake("npm", "printf 'changed\\n' > change.txt; git add -- change.txt");
	const result = execute();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /index|stag/i);
	assert.equal(git("show", ":change.txt"), "changed");
}));

it("keeps index bytes unchanged when a required checker fails", () => fixture(({ cwd, git, fake, execute }) => {
	writeFileSync(join(cwd, "change.txt"), "selected\n");
	git("add", "--", "change.txt");
	const before = git("write-tree");
	fake("npm", "exit 7");
	assert.notEqual(execute().status, 0);
	assert.equal(git("write-tree"), before);
}));

it("detects staged browser paths containing spaces without splitting names", () => fixture(({ cwd, git, fake, execute }) => {
	mkdirSync(join(cwd, "packages/ai"), { recursive: true });
	writeFileSync(join(cwd, "packages/ai/two words.txt"), "selected\n");
	git("add", "--", "packages/ai/two words.txt");
	fake("npm", "printf '%s\\n' \"$*\" >> invocations");
	const result = execute();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(readFileSync(join(cwd, "invocations"), "utf8"), "run check\nrun check:browser-smoke\n");
}));
