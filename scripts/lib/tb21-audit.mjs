import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AuditError, jobDirectory, parseManifest, readJson, record, text } from "./tb21-input.mjs";

/** @typedef {import('./tb21-input.mjs').Arm} Arm */
/** @typedef {import('./tb21-input.mjs').Task} Task */
/** @typedef {{ taskId: string, sha256: string, solved: boolean, exception: boolean, costUsd: number }} Trial */

/** @param {Record<string, unknown>} raw */
function outcome(raw) {
	if (raw.exception_info === undefined) throw new AuditError("invalid_exception");
	const exception = raw.exception_info !== null;
	if (exception) {
		const info = record(raw.exception_info, "invalid_exception");
		text(info.exception_type, /^[A-Za-z][A-Za-z0-9_.]{0,127}$/u, "invalid_exception");
	}
	let reward;
	if (raw.verifier_result !== null && raw.verifier_result !== undefined) {
		const verifier = record(raw.verifier_result, "invalid_reward");
		if (verifier.rewards !== null && verifier.rewards !== undefined) {
			reward = record(verifier.rewards, "invalid_reward").reward;
		}
	}
	if (reward === undefined || reward === null) {
		if (!exception) throw new AuditError("missing_reward");
	} else if (reward !== 0 && reward !== 1) {
		throw new AuditError("invalid_reward");
	}
	if (reward === 1 && exception) throw new AuditError("contradictory_success");
	const agent = record(raw.agent_result, "missing_cost");
	const costUsd = agent.cost_usd;
	if (costUsd === null || costUsd === undefined) throw new AuditError("missing_cost");
	if (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) throw new AuditError("invalid_cost");
	return { solved: reward === 1, exception, costUsd };
}

/** @param {{ directory: string, arm: Arm, tasks: Task[], trialIds: Set<string> }} input */
function readArm(input) {
	const expected = new Map(input.tasks.map((task) => [task.id, task.checksum]));
	let entries;
	try {
		entries = readdirSync(input.directory, { withFileTypes: true });
	} catch {
		throw new AuditError("unsafe_job_path");
	}
	if (entries.some((entry) => entry.isSymbolicLink())) throw new AuditError("unsafe_job_path");
	const directories = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	if (directories.length !== expected.size) throw new AuditError("trial_count_mismatch");
	/** @type {Map<string, Trial>} */
	const trials = new Map();
	for (const directory of directories) {
		const file = readJson(join(input.directory, directory, "result.json"), "result");
		const raw = record(file.value, "invalid_result");
		if (raw.trial_name !== directory) throw new AuditError("trial_name_mismatch");
		const trialId = text(raw.id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "invalid_trial_id");
		if (input.trialIds.has(trialId)) throw new AuditError("duplicate_trial_id");
		input.trialIds.add(trialId);
		if (typeof raw.task_name !== "string") throw new AuditError("unexpected_task");
		// Harbor installed adapters may record an absolute task path; compare only the manifest-bound leaf.
		const taskId = raw.task_name.split(/[\\/]/u).pop();
		if (taskId === undefined || !expected.has(taskId)) throw new AuditError("unexpected_task");
		if (trials.has(taskId)) throw new AuditError("duplicate_task");
		if (raw.task_checksum !== expected.get(taskId)) throw new AuditError("task_checksum_mismatch");
		const config = record(raw.config, "model_mismatch");
		if (record(config.agent, "model_mismatch").model_name !== input.arm.modelName) {
			throw new AuditError("model_mismatch");
		}
		trials.set(taskId, { taskId, sha256: file.sha256, ...outcome(raw) });
	}
	return trials;
}

/** @param {Map<string, Trial>} trials */
function totals(trials) {
	let solved = 0;
	let exceptions = 0;
	let costUsd = 0;
	for (const trial of trials.values()) {
		solved += Number(trial.solved);
		exceptions += Number(trial.exception);
		costUsd += trial.costUsd;
	}
	if (!Number.isFinite(costUsd)) throw new AuditError("cost_overflow");
	return { tasks: trials.size, solved, exceptions, costUsd, costPerSolved: solved === 0 ? null : costUsd / solved };
}

/** Audit recorded outcomes, not live model execution. No provider calls or artifact writes.
 * @param {string} manifestPath @param {string} expectedSha256
 */
export function auditBenchmark(manifestPath, expectedSha256) {
	text(expectedSha256, /^[a-f0-9]{64}$/u, "invalid_options");
	const file = readJson(manifestPath, "manifest");
	if (file.sha256 !== expectedSha256) throw new AuditError("manifest_digest_mismatch");
	const manifest = parseManifest(file.value);
	const root = dirname(resolve(manifestPath));
	/** @type {Set<string>} */
	const trialIds = new Set();
	const A = readArm({
		directory: jobDirectory(root, manifest.arms.A.job),
		arm: manifest.arms.A,
		tasks: manifest.tasks,
		trialIds,
	});
	const B = readArm({
		directory: jobDirectory(root, manifest.arms.B.job),
		arm: manifest.arms.B,
		tasks: manifest.tasks,
		trialIds,
	});
	const paired = { n11: 0, n00: 0, n10: 0, n01: 0, deltaPp: 0 };
	for (const task of manifest.tasks) {
		const a = A.get(task.id);
		const b = B.get(task.id);
		if (!a || !b) throw new AuditError("missing_task");
		if (a.solved && b.solved) paired.n11++;
		else if (a.solved) paired.n10++;
		else if (b.solved) paired.n01++;
		else paired.n00++;
	}
	paired.deltaPp = (100 * (paired.n10 - paired.n01)) / manifest.tasks.length;
	return {
		schemaVersion: "omk-tb21-audit-report-1",
		status: "complete",
		runId: manifest.runId,
		manifestSha256: file.sha256,
		modelVerification: "configuration-only",
		costSource: "harbor-agent-result",
		arms: { A: totals(A), B: totals(B) },
		paired,
		evidence: [
			...[...A.values()].map(({ taskId, sha256 }) => ({ arm: "A", taskId, sha256 })),
			...[...B.values()].map(({ taskId, sha256 }) => ({ arm: "B", taskId, sha256 })),
		],
	};
}
