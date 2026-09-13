import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../tb-mini-suite.mjs", import.meta.url));

function tasks(t, rows) {
	const root = mkdtempSync(join(tmpdir(), "omk-tb-ranking-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const row of rows) {
		const dir = join(root, row.name);
		mkdirSync(dir);
		writeFileSync(
			join(dir, "task.toml"),
			`[metadata]\ndifficulty = "${row.difficulty ?? "medium"}"\n${row.estimate === undefined ? "" : `expert_time_estimate_min = ${row.estimate}\n`}`,
		);
	}
	return root;
}

function select(root, size, seed = 1) {
	const result = spawnSync(
		process.execPath,
		[SCRIPT, "--tasks", root, "--size", String(size), "--seed", String(seed), "--json"],
		{ encoding: "utf8", timeout: 10_000 },
	);
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

for (const estimate of [undefined, '"unknown"', "nan", "inf", "-5", '""']) {
	test(`does not rank unknown or invalid estimate ${String(estimate)} ahead of known work`, (t) => {
		const root = tasks(t, [
			{ name: "unknown", estimate },
			{ name: "known", estimate: "5" },
		]);
		const report = select(root, 1);
		assert.deepEqual(
			report.tasks.map((task) => task.name),
			["known"],
		);
	});
}

test("reports unknown estimates explicitly instead of inventing a complete zero-minute total", (t) => {
	const root = tasks(t, [{ name: "unknown" }, { name: "known", estimate: "5" }]);
	const report = select(root, 2);
	assert.equal(report.selectionVersion, 2);
	assert.equal(report.tasks.find((task) => task.name === "unknown").expertMinutes, null);
	assert.equal(report.unknownExpertEstimates, 1);
	assert.equal(report.knownExpertMinutes, 5);
	assert.equal(report.totalExpertMinutes, null);
});

test("preserves genuine zero and fractional estimates", (t) => {
	const root = tasks(t, [
		{ name: "zero", estimate: "0" },
		{ name: "fraction", estimate: "2.5" },
	]);
	const report = select(root, 2);
	assert.equal(report.tasks.find((task) => task.name === "zero").expertMinutes, 0);
	assert.equal(report.totalExpertMinutes, 2.5);
	assert.equal(report.knownExpertMinutes, 2.5);
	assert.equal(report.unknownExpertEstimates, 0);
});

for (const size of [1, 2]) {
	test(`allocates ${size} scarce slots by difficulty weight rather than task name`, (t) => {
		const root = tasks(t, [
			{ name: "a-hard", difficulty: "hard", estimate: "100" },
			{ name: "b-easy", difficulty: "easy", estimate: "1" },
			{ name: "z-medium", difficulty: "medium", estimate: "10" },
		]);
		const selected = select(root, size)
			.tasks.map((task) => task.difficulty)
			.sort();
		assert.deepEqual(selected, size === 1 ? ["medium"] : ["hard", "medium"]);
	});
}

test("refills an unavailable high-weight band from known remaining work", (t) => {
	const root = tasks(t, [
		{ name: "unknown", difficulty: "hard" },
		{ name: "known", difficulty: "easy", estimate: "5" },
	]);
	assert.equal(select(root, 1).tasks[0].name, "known");
});

test("fills every feasible size deterministically even when every estimate is unknown", (t) => {
	const root = tasks(t, [{ name: "one" }, { name: "two" }, { name: "three" }]);
	for (const size of [1, 2, 3]) {
		for (const seed of [0, 1, 7, 4294967295]) {
			const report = select(root, size, seed);
			assert.equal(report.tasks.length, size);
			assert.equal(new Set(report.tasks.map((task) => task.name)).size, size);
			assert.equal(report.unknownExpertEstimates, size);
			assert.equal(report.totalExpertMinutes, null);
			assert.deepEqual(report, select(root, size, seed));
		}
	}
});

for (const difficulty of ["__proto__", "constructor", "toString"]) {
	test(`counts prototype-like difficulty ${difficulty} as ordinary metadata`, (t) => {
		const root = tasks(t, [{ name: "task", difficulty, estimate: "1" }]);
		const result = spawnSync(process.execPath, [SCRIPT, "--tasks", root, "--size", "1"], {
			encoding: "utf8",
			timeout: 10_000,
		});
		assert.equal(result.status, 0, result.stderr);
		assert.ok(result.stdout.includes(`mix: 1 ${difficulty} ·`));
	});
}

test("rejects a nonfinite sum rather than serializing overflow as a missing JSON total", (t) => {
	const root = tasks(t, [
		{ name: "one", estimate: "1e308" },
		{ name: "two", estimate: "1e308" },
	]);
	const result = spawnSync(process.execPath, [SCRIPT, "--tasks", root, "--size", "2", "--json"], {
		encoding: "utf8",
		timeout: 10_000,
	});
	assert.equal(result.status, 1);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /expert.*total|total.*expert/iu);
});
