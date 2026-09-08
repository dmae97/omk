import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../tb21-audit.mjs", import.meta.url));

export function invoke(args) {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 10_000 });
	assert.ifError(result.error);
	return result;
}

export function run(fixture, extra = []) {
	return invoke([
		"--manifest",
		fixture.manifestPath,
		"--expect-manifest-sha256",
		digest(fixture.manifestPath),
		...extra,
	]);
}

export function rejected(result, code) {
	assert.notEqual(result.status, 0);
	assert.equal(result.stdout, "");
	assert.equal(JSON.parse(result.stderr).code, code);
	assert.doesNotMatch(result.stderr, /DO_NOT_PRINT|\/private\/|at file:|omk-tb21-audit-/u);
}

export const checksum = "a".repeat(64);

export function digest(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function save(path, value) {
	writeFileSync(path, `${JSON.stringify(value)}\n`);
}

export function change(path, update) {
	const value = JSON.parse(readFileSync(path, "utf8"));
	update(value);
	save(path, value);
}

export function evidence(t) {
	const root = mkdtempSync(join(tmpdir(), "omk-tb21-audit-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const manifest = {
		schemaVersion: "omk-tb21-manifest-1",
		runId: "synthetic-run",
		datasetRevision: "b".repeat(40),
		conditionsSha256: "c".repeat(64),
		tasks: [
			{ id: "task-one", checksum },
			{ id: "task-two", checksum },
		],
		arms: {
			A: { job: "arm-a", modelName: "gateway/model-one", harnessSha256: checksum, adapterSha256: checksum },
			B: { job: "arm-b", modelName: "compatible/model-one", harnessSha256: checksum, adapterSha256: checksum },
		},
	};
	for (const arm of ["A", "B"]) {
		for (const task of manifest.tasks) {
			const trial = `${arm}-${task.id}`;
			const dir = join(root, manifest.arms[arm].job, trial);
			mkdirSync(dir, { recursive: true });
			save(join(dir, "result.json"), {
				id: `${trial}-uuid`,
				trial_name: trial,
				started_at: "2026-09-07T10:00:00.123456Z",
				finished_at: "2026-09-07T10:01:00.654321Z",
				task_name: `/private/dataset/tasks/${task.id}`,
				task_checksum: checksum,
				config: { agent: { model_name: manifest.arms[arm].modelName, kwargs: { private: "DO_NOT_PRINT" } } },
				agent_result: { cost_usd: arm === "A" ? 2 : 1 },
				verifier_result: { rewards: { reward: task.id === "task-one" ? 1 : 0 } },
				exception_info: null,
			});
		}
	}
	const manifestPath = join(root, "manifest.json");
	save(manifestPath, manifest);
	return { root, manifest, manifestPath, result: join(root, "arm-a", "A-task-one", "result.json") };
}
