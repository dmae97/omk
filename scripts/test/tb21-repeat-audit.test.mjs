import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { change, digest, evidence, rejected, save } from "./fixtures/tb21-evidence.mjs";

function fixture(t) {
	const f = evidence(t);
	const repeats = [];
	for (let i = 0; i < 3; i++) {
		const dir = join(f.root, `repeat-${i}`);
		for (const arm of ["A", "B"]) {
			cpSync(join(f.root, f.manifest.arms[arm].job), join(dir, f.manifest.arms[arm].job), { recursive: true });
			for (const task of f.manifest.tasks) {
				change(join(dir, f.manifest.arms[arm].job, `${arm}-${task.id}`, "result.json"), (r) => {
					r.id += `-${i}`;
					r.verifier_result.rewards.reward = arm === "A" ? Number(task.id === "task-one" && i < 2) : 1;
				});
			}
		}
		const path = join(dir, "manifest.json");
		save(path, { ...f.manifest, runId: `run-${i}` });
		repeats.push({ directory: `repeat-${i}`, manifestSha256: digest(path) });
	}
	const set = { schemaVersion: "omk-tb21-repeat-set-1", k: 2, repeats };
	const path = join(f.root, "repeats.json");
	save(path, set);
	const run = (args = []) => spawnSync(process.execPath, ["scripts/tb21-repeat-audit.mjs", "--manifest", path, "--expect-manifest-sha256", digest(path), ...args], { encoding: "utf8", timeout: 10000 });
	const refresh = (index = 0) => {
		set.repeats[index].manifestSha256 = digest(join(f.root, `repeat-${index}/manifest.json`));
		save(path, set);
	};
	return { ...f, set, path, run, refresh, result: join(f.root, "repeat-0/arm-a/A-task-one/result.json") };
}

test("reports finite-sample at-least-one versus all-k success without changing single-run audits", (t) => {
	const f = fixture(t);
	const before = digest(f.result);
	const r = f.run();
	assert.equal(r.status, 0, r.stderr);
	const report = JSON.parse(r.stdout);
	assert.equal(report.schemaVersion, "omk-tb21-repeat-report-1");
	assert.equal(report.trialsPerTask, 3);
	assert.equal(report.arms.A.passAt1, 1 / 3);
	assert.equal(report.arms.A.passAtK, 0.5);
	assert.equal(report.arms.A.passAllK, 1 / 6);
	assert.equal(report.arms.B.passAllK, 1);
	assert.equal(report.arms.A.costUsd, 12);
	assert.equal(report.arms.A.costPerSuccessfulTrial, 6);
	assert.equal(report.evidence.length, 3);
	assert.equal(report.independenceVerification, "not-verified");
	assert.equal(digest(f.result), before);
	assert.doesNotMatch(r.stdout, /DO_NOT_PRINT|\/private\/|uuid/);
	assert.equal(r.stdout, f.run().stdout);
});

for (const k of [1, 3]) test(`handles k=${k} boundaries`, (t) => {
	const f = fixture(t); f.set.k = k; save(f.path, f.set);
	const r = f.run(); assert.equal(r.status, 0, r.stderr);
	const a = JSON.parse(r.stdout).arms.A;
	assert.equal(a.passAtK, k === 1 ? 1 / 3 : 0.5);
	assert.equal(a.passAllK, k === 1 ? 1 / 3 : 0);
});

for (const [name, mutate, code] of [
	["k too large", f => { f.set.k = 4; save(f.path, f.set); }, "invalid_manifest"],
	["fractional k", f => { f.set.k = 1.5; save(f.path, f.set); }, "invalid_manifest"],
	["unknown key", f => { f.set.secret = "DO_NOT_PRINT"; save(f.path, f.set); }, "invalid_manifest"],
	["duplicate manifest", f => { f.set.repeats[1] = f.set.repeats[0]; save(f.path, f.set); }, "duplicate_repeat"],
	["traversal", f => { f.set.repeats[0].directory = "../private"; save(f.path, f.set); }, "invalid_manifest"],
	["missing trial", f => rmSync(f.result), "invalid_result_file"],
	["missing cost", f => change(f.result, r => { delete r.agent_result.cost_usd; }), "missing_cost"],
	["unfinished trial", f => change(f.result, r => { r.finished_at = null; }), "unfinished_trial"],
	["reused trial id", f => change(f.result, r => { r.id = "A-task-one-uuid-1"; }), "duplicate_trial_id"],
	["changed conditions", f => { change(join(f.root, "repeat-0/manifest.json"), m => { m.conditionsSha256 = "d".repeat(64); }); f.refresh(); }, "repeat_conditions_mismatch"],
	["changed harness", f => { change(join(f.root, "repeat-0/manifest.json"), m => { m.arms.A.harnessSha256 = "d".repeat(64); }); f.refresh(); }, "repeat_conditions_mismatch"],
	["stale digest", f => change(join(f.root, "repeat-0/manifest.json"), m => { m.runId = "changed"; }), "manifest_digest_mismatch"],
	["reused run id", f => { change(join(f.root, "repeat-0/manifest.json"), m => { m.runId = "run-1"; }); f.refresh(); }, "duplicate_repeat"],
]) test(`rejects ${name} without a partial-success report`, (t) => {
	const f = fixture(t); mutate(f); rejected(f.run(), code);
});

test("all-failure costs remain visible and zero successes have no cost ratio", (t) => {
	const f = fixture(t);
	for (let i = 0; i < 3; i++) change(join(f.root, `repeat-${i}/arm-a/A-task-one/result.json`), r => { r.verifier_result.rewards.reward = 0; });
	const r = f.run(); assert.equal(r.status, 0, r.stderr);
	const a = JSON.parse(r.stdout).arms.A;
	assert.equal(a.passAt1, 0); assert.equal(a.passAtK, 0); assert.equal(a.passAllK, 0);
	assert.equal(a.costUsd, 12); assert.equal(a.costPerSuccessfulTrial, null);
});

test("task-order differences do not create a false condition mismatch", (t) => {
	const f = fixture(t);
	change(join(f.root, "repeat-0/manifest.json"), m => m.tasks.reverse()); f.refresh();
	const r = f.run(); assert.equal(r.status, 0, r.stderr);
	assert.equal(JSON.parse(r.stdout).arms.A.passAllK, 1 / 6);
});

test("refuses a symlinked repeat directory", (t) => {
	const f = fixture(t); symlinkSync(join(f.root, "repeat-0"), join(f.root, "alias"), "dir");
	f.set.repeats[0].directory = "alias"; save(f.path, f.set);
	rejected(f.run(), "unsafe_job_path");
});

test("keeps a timeout and its cost in the denominator", (t) => {
	const f = fixture(t);
	change(f.result, r => { r.verifier_result = null; r.exception_info = { exception_type: "AgentTimeoutError" }; });
	const r = f.run(); assert.equal(r.status, 0, r.stderr);
	const a = JSON.parse(r.stdout).arms.A;
	assert.equal(a.passAt1, 1 / 6); assert.equal(a.passAllK, 0); assert.equal(a.exceptions, 1); assert.equal(a.costUsd, 12);
});

test("rejects cost overflow across individually valid repetitions", (t) => {
	const f = fixture(t);
	for (let i = 0; i < 3; i++) change(join(f.root, `repeat-${i}/arm-a/A-task-one/result.json`), r => { r.agent_result.cost_usd = 8e307; });
	rejected(f.run(), "cost_overflow");
});

test("invalid options do not expose input paths or content", (t) => {
	const f = fixture(t);
	for (const args of [["--unexpected"], ["--manifest", "DO_NOT_PRINT"], ["extra"]]) rejected(f.run(args), "invalid_options");
});
