import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../tb-mini-suite.mjs", import.meta.url));

function fixture(t, counts) {
	const dir = mkdtempSync(join(tmpdir(), "omk-tb-mini-suite-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	for (const [difficulty, count] of Object.entries(counts)) {
		for (let index = 0; index < count; index++) {
			const taskDir = join(dir, `${difficulty}-${String(index).padStart(3, "0")}`);
			mkdirSync(taskDir);
			writeFileSync(
				join(taskDir, "task.toml"),
				`[metadata]\ndifficulty = "${difficulty}"\ncategory = "test"\nexpert_time_estimate_min = ${index + 1}\n`,
			);
		}
	}
	return dir;
}

function run(args) {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 10_000 });
	assert.ifError(result.error);
	return result;
}

test("selects every task when the requested size is the full 89-task population", (t) => {
	const dir = fixture(t, { easy: 4, medium: 55, hard: 30 });
	const result = run(["--tasks", dir, "--size", "89", "--json"]);
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.tasks.length, 89);
	assert.equal(new Set(report.tasks.map((task) => task.name)).size, 89);
});

test("fills missing difficulty quotas from remaining tasks", (t) => {
	const dir = fixture(t, { easy: 1, hard: 5 });
	const result = run(["--tasks", dir, "--size", "6", "--json"]);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(result.stdout).tasks.length, 6);
});

test("preserves the existing default size and difficulty allocation", (t) => {
	const dir = fixture(t, { easy: 4, medium: 55, hard: 30 });
	const result = run(["--tasks", dir, "--json"]);
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	const counts = { easy: 0, medium: 0, hard: 0 };
	for (const task of report.tasks) counts[task.difficulty]++;
	assert.equal(report.seed, 1);
	assert.equal(report.size, 15);
	assert.deepEqual(counts, { easy: 2, medium: 9, hard: 4 });
});

test("produces byte-identical output for repeated valid inputs", (t) => {
	const dir = fixture(t, { easy: 2, medium: 5, hard: 3 });
	const args = ["--tasks", dir, "--size", "8", "--seed", "7", "--json"];
	const first = run(args);
	const second = run(args);
	assert.equal(first.status, 0, first.stderr);
	assert.equal(second.status, 0, second.stderr);
	assert.equal(first.stdout, second.stdout);
});

test("returns exactly the requested number without duplicates for every feasible small size", (t) => {
	const dir = fixture(t, { medium: 7 });
	for (let size = 1; size <= 7; size++) {
		const result = run(["--tasks", dir, "--size", String(size), "--json"]);
		assert.equal(result.status, 0, result.stderr);
		const tasks = JSON.parse(result.stdout).tasks;
		assert.equal(tasks.length, size, `size=${size}`);
		assert.equal(new Set(tasks.map((task) => task.name)).size, size);
	}
});

test("rejects requests larger than the population instead of silently underfilling", (t) => {
	const dir = fixture(t, { easy: 1, medium: 1, hard: 1 });
	const result = run(["--tasks", dir, "--size", "4", "--json"]);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /available|population/u);
	assert.equal(result.stdout, "");
});

test("rejects an empty task directory", (t) => {
	const dir = fixture(t, {});
	const result = run(["--tasks", dir, "--json"]);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /No tasks/u);
});

for (const seed of ["NaN", "Infinity", "1.5", "-1", "4294967296", ""]) {
	test(`rejects invalid seed ${JSON.stringify(seed)}`, (t) => {
		const dir = fixture(t, { easy: 1, medium: 1, hard: 1 });
		const result = run(["--tasks", dir, "--size", "3", "--seed", seed, "--json"]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /--seed/u);
		assert.equal(result.stdout, "");
	});
}

for (const size of ["0", "-1", "1.5", "Infinity", "9007199254740992"]) {
	test(`rejects invalid size ${size}`, (t) => {
		const dir = fixture(t, { easy: 1 });
		const result = run(["--tasks", dir, "--size", size, "--json"]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /--size/u);
	});
}

for (const option of ["--tasks", "--size", "--seed"]) {
	test(`reports missing ${option} values without a stack trace`, () => {
		const result = run([option]);
		assert.equal(result.status, 2);
		assert.ok(result.stderr.includes(option));
		assert.doesNotMatch(result.stderr, /TypeError|at file:/u);
	});
}

test("does not consume the next flag as a tasks path", () => {
	const result = run(["--tasks", "--json"]);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /--tasks/u);
});

test("reports a non-directory tasks path without a stack trace", (t) => {
	const dir = fixture(t, { easy: 1 });
	const result = run(["--tasks", join(dir, "easy-000", "task.toml"), "--json"]);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /directory/u);
	assert.doesNotMatch(result.stderr, /at file:/u);
});

test("accepts both unsigned 32-bit seed boundaries", (t) => {
	const dir = fixture(t, { easy: 1, medium: 1, hard: 1 });
	for (const seed of ["0", "4294967295"]) {
		const result = run(["--tasks", dir, "--size", "3", "--seed", seed, "--json"]);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(JSON.parse(result.stdout).seed, Number(seed));
	}
});
