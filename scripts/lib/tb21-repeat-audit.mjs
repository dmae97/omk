import { dirname, join, resolve } from "node:path";
import { auditBenchmarkTrials } from "./tb21-audit.mjs";
import { AuditError, jobDirectory, readJson, record, text } from "./tb21-input.mjs";

/** @param {Record<string, unknown>} value @param {string[]} keys */
function exact(value, keys) {
	if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new AuditError("invalid_manifest");
}

/** Probability all k draws without replacement succeed; bounded small integer inputs.
 * @param {number} n @param {number} c @param {number} k
 */
function allSuccess(n, c, k) {
	if (c < k) return 0;
	let probability = 1;
	for (let i = 0; i < k; i++) probability *= (c - i) / (n - i);
	return probability;
}

/** Read-only composition of existing audited trials. No agent/model calls or automatic input discovery.
 * @param {string} manifestPath @param {string} expectedSha256
 */
export function auditRepeatedBenchmark(manifestPath, expectedSha256) {
	text(expectedSha256, /^[a-f0-9]{64}$/u, "invalid_options");
	const file = readJson(manifestPath, "manifest");
	if (file.sha256 !== expectedSha256) throw new AuditError("manifest_digest_mismatch");
	const set = record(file.value, "invalid_manifest");
	exact(set, ["schemaVersion", "k", "repeats"]);
	if (set.schemaVersion !== "omk-tb21-repeat-set-1" || !Array.isArray(set.repeats) || set.repeats.length < 2 || set.repeats.length > 100) throw new AuditError("invalid_manifest");
	const n = set.repeats.length;
	if (typeof set.k !== "number" || !Number.isInteger(set.k) || set.k < 1 || set.k > n) throw new AuditError("invalid_manifest");
	const k = set.k;
	const root = dirname(resolve(manifestPath));
	const directories = new Set();
	const digests = new Set();
	const runIds = new Set();
	/** @type {Set<string>} */
	const trialIds = new Set();
	const audits = set.repeats.map(value => {
		const repeat = record(value, "invalid_manifest");
		exact(repeat, ["directory", "manifestSha256"]);
		const directory = text(repeat.directory, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u, "invalid_manifest");
		if (directory.split("/").some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(part))) throw new AuditError("invalid_manifest");
		const digest = text(repeat.manifestSha256, /^[a-f0-9]{64}$/u, "invalid_manifest");
		if (directories.has(directory) || digests.has(digest)) throw new AuditError("duplicate_repeat");
		directories.add(directory); digests.add(digest);
		const audit = auditBenchmarkTrials(join(jobDirectory(root, directory), "manifest.json"), digest, trialIds);
		if (runIds.has(audit.manifest.runId)) throw new AuditError("duplicate_repeat");
		runIds.add(audit.manifest.runId);
		return audit;
	});
	const first = audits[0];
	/** @param {typeof first} audit */
	const conditions = ({ manifest }) => JSON.stringify({
		datasetRevision: manifest.datasetRevision, conditionsSha256: manifest.conditionsSha256,
		tasks: [...manifest.tasks].sort((a, b) => {
			if (a.id === b.id) return 0;
			return a.id < b.id ? -1 : 1;
		}),
		arms: [manifest.arms.A, manifest.arms.B].map(({ modelName, harnessSha256, adapterSha256 }) => ({ modelName, harnessSha256, adapterSha256 })),
	});
	if (audits.some(audit => conditions(audit) !== conditions(first))) throw new AuditError("repeat_conditions_mismatch");
	/** @param {"A" | "B"} arm */
	const aggregate = arm => {
		let costUsd = 0, exceptions = 0, successfulTrials = 0;
		const tasks = first.manifest.tasks.map(({ id }) => {
			let successes = 0;
			for (const audit of audits) {
				const trial = audit.trials[arm].get(id);
				if (!trial) throw new AuditError("missing_task");
				successes += Number(trial.solved); exceptions += Number(trial.exception); costUsd += trial.costUsd;
			}
			successfulTrials += successes;
			return { taskId: id, trials: n, successes, passAt1: successes / n,
				passAtK: k === 1 ? successes / n : 1 - allSuccess(n, n - successes, k), passAllK: allSuccess(n, successes, k) };
		});
		if (!Number.isFinite(costUsd)) throw new AuditError("cost_overflow");
		/** @param {"passAt1" | "passAtK" | "passAllK"} key */
		const mean = key => tasks.reduce((sum, task) => sum + task[key], 0) / tasks.length;
		return { tasks, passAt1: mean("passAt1"), passAtK: mean("passAtK"), passAllK: mean("passAllK"), exceptions,
			costUsd, successfulTrials, costPerSuccessfulTrial: successfulTrials ? costUsd / successfulTrials : null };
	};
	return {
		schemaVersion: "omk-tb21-repeat-report-1", status: "complete", manifestSha256: file.sha256, trialsPerTask: n, k,
		estimator: "finite-sample-without-replacement", averaging: "task-macro",
		independenceVerification: "not-verified", modelVerification: "configuration-only",
		completionVerification: "recorded-timestamps", costSource: "harbor-agent-result", superiorityClaim: false,
		arms: { A: aggregate("A"), B: aggregate("B") },
		evidence: audits.map(({ report }) => ({ manifestSha256: report.manifestSha256, results: report.evidence })),
	};
}
