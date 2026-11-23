import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ancestorPids, findConflicts, leaseLive } from "../check-scope-lease.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "check-scope-lease.mjs");
const lease = (over) => ({
	session: "aaaaaaaa-1",
	pid: 10,
	host: "h",
	worktree: "/w",
	branch: "main",
	patterns: ["web/**"],
	heartbeat: 0,
	...over,
});

describe("findConflicts", () => {
	const base = { now: 1000, host: "h", ancestors: new Set([1, 2]), alive: () => true };
	it("reports staged paths held by another live session", () => {
		const out = findConflicts({ ...base, leases: [lease()], staged: ["web/a.ts", "api/b.ts"] });
		assert.deepEqual(
			out.map((c) => c.path),
			["web/a.ts"],
		);
	});
	it("skips the committer's own session, OMK_LEASE_AS prefixes and dead leases", () => {
		const staged = ["web/a.ts"];
		assert.equal(findConflicts({ ...base, leases: [lease({ pid: 2 })], staged }).length, 0);
		assert.equal(findConflicts({ ...base, leases: [lease()], staged, as: ["aaaa"] }).length, 0);
		assert.equal(findConflicts({ ...base, leases: [lease()], staged, alive: () => false }).length, 0);
		assert.equal(findConflicts({ ...base, leases: [lease()], staged, as: [""] }).length, 1);
	});
	it("follows heartbeat for other hosts", () => {
		assert.ok(leaseLive(lease({ host: "x" }), 1000, "h"));
		assert.ok(!leaseLive(lease({ host: "x" }), 3 * 3600e3, "h"));
	});
	it("walks up to the test runner's parent", () => {
		assert.ok(ancestorPids().has(process.ppid));
	});
});

describe("pre-commit run in a real repository", () => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "check-scope-lease-")));
	const holder = spawn("sleep", ["60"]);
	after(() => {
		holder.kill();
		rmSync(dir, { recursive: true, force: true });
	});
	// The pre-commit hook exports GIT_DIR/GIT_INDEX_FILE; inheriting them would write to the outer repository.
	const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
	const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: cleanEnv });
	git("init", "-q", "-b", "main");
	mkdirSync(join(dir, "web"));
	writeFileSync(join(dir, "web", "a.ts"), "x");
	writeFileSync(join(dir, "b.ts"), "y");
	const leases = join(git("rev-parse", "--path-format=absolute", "--git-common-dir").trim(), "omk-leases");
	mkdirSync(leases);
	const run = (env = {}) => spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8", env: { ...cleanEnv, ...env } });
	const write = (over) => writeFileSync(join(leases, "a.json"), JSON.stringify(lease({ host: hostname(), heartbeat: Date.now(), ...over })));

	it("blocks a terminal commit of a path another live session holds", () => {
		write({ pid: holder.pid });
		git("add", "web/a.ts", "b.ts");
		const out = run();
		assert.equal(out.status, 1);
		assert.match(out.stderr, /web\/a\.ts: session aaaaaaaa/);
		assert.doesNotMatch(out.stderr, /b\.ts: session/);
	});
	it("passes for unleased paths, the holder named in OMK_LEASE_AS, and the committer's own session", () => {
		git("rm", "-q", "--cached", "web/a.ts");
		assert.equal(run().status, 0);
		git("add", "web/a.ts");
		assert.equal(run({ OMK_LEASE_AS: "aaaaaaaa" }).status, 0);
		write({ pid: process.pid });
		assert.equal(run().status, 0);
	});
});
