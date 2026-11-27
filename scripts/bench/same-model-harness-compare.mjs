#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROVENANCE_KEYS = ["modelId", "reasoningEffort", "taskSetDigest", "timeoutMs", "budgetCapUsd"];

function assertFiniteNonNegative(value, label) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new RangeError(`${label} must be a finite non-negative number`);
	}
}

function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[index];
}

function validateProvenance(base, candidate, harness) {
	for (const key of PROVENANCE_KEYS) {
		if (candidate?.[key] !== base?.[key]) {
			throw new Error(`provenance mismatch for harness "${harness}" on field "${key}"`);
		}
	}
}

function summarizeHarnessRun(run) {
	if (!run || typeof run.harness !== "string" || !run.harness.trim()) {
		throw new RangeError("run.harness must be a non-empty string");
	}
	if (!Array.isArray(run.trials) || run.trials.length === 0) {
		throw new RangeError(`run "${run.harness}" must contain at least one trial`);
	}

	const byTask = new Map();
	const seenKeys = new Set();
	const solvedTokens = [];
	const wallTimes = [];
	let totalCostUsd = 0;
	let failedCostUsd = 0;
	let passedCostUsd = 0;
	let failedTrialCount = 0;

	for (const trial of run.trials) {
		if (typeof trial.taskId !== "string" || !trial.taskId.trim()) throw new RangeError("invalid taskId");
		if (!Number.isInteger(trial.attempt) || trial.attempt < 1) throw new RangeError("invalid attempt");
		if (typeof trial.passed !== "boolean") throw new RangeError("invalid passed flag");
		assertFiniteNonNegative(trial.tokens, "trial.tokens");
		assertFiniteNonNegative(trial.wallTimeMs, "trial.wallTimeMs");
		assertFiniteNonNegative(trial.costUsd, "trial.costUsd");

		const key = `${trial.taskId}\0${trial.attempt}`;
		if (seenKeys.has(key)) throw new Error(`duplicate trial ${trial.taskId}#${trial.attempt} in ${run.harness}`);
		seenKeys.add(key);

		const list = byTask.get(trial.taskId) ?? [];
		list.push(trial);
		byTask.set(trial.taskId, list);

		wallTimes.push(trial.wallTimeMs);
		totalCostUsd += trial.costUsd;
		if (trial.passed) {
			solvedTokens.push(trial.tokens);
			passedCostUsd += trial.costUsd;
		} else {
			failedTrialCount += 1;
			failedCostUsd += trial.costUsd;
		}
	}

	const taskIds = [...byTask.keys()].sort();
	let passAt1Count = 0;
	let passAtKCount = 0;
	let allKSuccessCount = 0;
	let solvedTrialCount = 0;

	for (const taskId of taskIds) {
		const trials = byTask.get(taskId).sort((a, b) => a.attempt - b.attempt);
		if (trials[0].passed) passAt1Count += 1;
		if (trials.some((t) => t.passed)) passAtKCount += 1;
		if (trials.every((t) => t.passed)) allKSuccessCount += 1;
		solvedTrialCount += trials.filter((t) => t.passed).length;
	}

	const taskCount = taskIds.length;
	return {
		taskIds,
		summary: {
			...(typeof run.harnessVersion === "string" && run.harnessVersion.trim()
				? { harnessVersion: run.harnessVersion.trim() }
				: {}),
			taskCount,
			trialCount: run.trials.length,
			failedTrialCount,
			passAt1: passAt1Count / taskCount,
			passAtK: passAtKCount / taskCount,
			allKSuccess: allKSuccessCount / taskCount,
			medianTokensPerSolvedTask: median(solvedTokens),
			p95WallTimeMs: percentile(wallTimes, 95),
			totalCostUsd: Number(totalCostUsd.toFixed(6)),
			passedCostUsd: Number(passedCostUsd.toFixed(6)),
			failedCostUsd: Number(failedCostUsd.toFixed(6)),
			costPerSolvedTaskUsd: solvedTrialCount > 0 ? Number((totalCostUsd / solvedTrialCount).toFixed(6)) : null,
		},
	};
}

function percentDelta(current, baseline) {
	if (current === null || baseline === null || baseline === 0) return null;
	return Number((((current - baseline) / baseline) * 100).toFixed(2));
}

export function compareSameModelHarnesses(input) {
	if (!input || !Array.isArray(input.runs) || input.runs.length < 2) {
		throw new RangeError("compareSameModelHarnesses requires at least 2 harness runs");
	}
	const baselineRun = input.runs.find((r) => r.harness === input.baselineHarness);
	if (!baselineRun) {
		throw new RangeError(`baselineHarness "${input.baselineHarness}" not found in runs`);
	}

	const baseProvenance = baselineRun.provenance;
	const harnesses = {};
	let referenceTaskSignature = null;

	for (const run of input.runs) {
		validateProvenance(baseProvenance, run.provenance, run.harness);
		if (input.grader !== undefined) {
			if (input.grader?.independent !== true || !input.grader?.graderId) {
				throw new Error("independent grader metadata required (independent: true, graderId)");
			}
		}
		if (harnesses[run.harness]) throw new Error(`duplicate harness "${run.harness}"`);
		const { taskIds, summary } = summarizeHarnessRun(run);
		const signature = JSON.stringify(taskIds);
		if (referenceTaskSignature === null) {
			referenceTaskSignature = signature;
		} else if (signature !== referenceTaskSignature) {
			throw new Error(`task set mismatch for harness "${run.harness}"`);
		}
		harnesses[run.harness] = summary;
	}

	const baseSummary = harnesses[input.baselineHarness];
	const deltas = {};
	for (const [name, summary] of Object.entries(harnesses)) {
		if (name === input.baselineHarness) continue;
		deltas[name] = {
			deltaPassAt1Pp: Number(((summary.passAt1 - baseSummary.passAt1) * 100).toFixed(2)),
			deltaPassAtKPp: Number(((summary.passAtK - baseSummary.passAtK) * 100).toFixed(2)),
			deltaAllKSuccessPp: Number(((summary.allKSuccess - baseSummary.allKSuccess) * 100).toFixed(2)),
			deltaMedianTokensPct: percentDelta(summary.medianTokensPerSolvedTask, baseSummary.medianTokensPerSolvedTask),
			deltaCostPerSolvedPct: percentDelta(summary.costPerSolvedTaskUsd, baseSummary.costPerSolvedTaskUsd),
		};
	}

	return {
		schemaVersion: "omk.same-model-harness-compare.v1",
		ok: true,
		baselineHarness: input.baselineHarness,
		provenance: baseProvenance,
		harnesses,
		deltas,
		claimBoundary: "self-measured paired manifest comparison; not an independent leaderboard ranking",
	};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
	const manifestPath = process.argv[2];
	if (!manifestPath) {
		console.error("Usage: node scripts/bench/same-model-harness-compare.mjs <manifest.json>");
		process.exit(2);
	}
	const payload = JSON.parse(readFileSync(manifestPath, "utf8"));
	console.log(JSON.stringify(compareSameModelHarnesses(payload), null, 2));
}
