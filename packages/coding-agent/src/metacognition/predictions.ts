/**
 * Algorithm B — pre-execution prediction ledger and mismatch scoring.
 * Spec: OMK_metacognitive_control_algorithms_2026-09-19.md §5.
 *
 * Predictions are registered by the host BEFORE outcomes exist and bound to
 * candidate/environment/check/policy fingerprints. Later edits append a new
 * prediction — existing records are never overwritten. Unobserved, cancelled,
 * or environment-failed outcomes stay unobserved; they are never silently
 * scored as code success or failure.
 */
import { brier, surprise } from "./decision.ts";
import { canonical, ensure, integer, lexical, member, text, unique } from "./validation.ts";

export type PredictionKind = "check-outcome" | "scope" | "side-effect" | "resource" | "hypothesis-outcome";
export type EstimatorKind = "uncalibrated-model-estimate" | "validated-estimator" | "none";
export type PredictionStatus = "registered" | "resolved" | "superseded" | "unobserved";
export type MismatchKind =
	| "unexpected-pass"
	| "unexpected-fail"
	| "unexpected-side-effect"
	| "missing-observation"
	| "scope-mismatch"
	| "none";

export interface Prediction {
	readonly predictionId: string;
	readonly operationId: string;
	readonly taskId: string;
	readonly stageId: string;
	readonly kind: PredictionKind;
	readonly candidateHash: string;
	readonly environmentHash: string;
	readonly checkDefinitionHash: string;
	readonly policyVersion: string;
	readonly modelRevision: string;
	readonly skillHashes: readonly string[];
	readonly expectedOutcome: string;
	/** Binary expectation for scored predictions; undefined for categorical. */
	readonly expectedBinary?: boolean;
	readonly probability?: number;
	readonly estimator: EstimatorKind;
	readonly counterevidenceCondition: string;
	readonly hostSequence: number;
	readonly registeredAtMs: number;
	status: PredictionStatus;
	readonly resolvedAtMs?: number;
	readonly observedOutcome?: string;
	readonly observedBinary?: boolean;
	readonly mismatch?: MismatchKind;
}
export interface ScoredPrediction {
	readonly predictionId: string;
	readonly mismatch: MismatchKind;
	readonly brier?: number;
	readonly surprise?: number;
}

const LEDGER_BOUND = 4096;

function validatePrediction(p: Prediction): void {
	text(p.predictionId, "predictionId", 128);
	text(p.operationId, "operationId", 128);
	text(p.taskId, "taskId", 128);
	text(p.stageId, "stageId", 128);
	member(p.kind, ["check-outcome", "scope", "side-effect", "resource", "hypothesis-outcome"], "kind");
	text(p.candidateHash, "candidateHash", 128);
	text(p.environmentHash, "environmentHash", 128);
	text(p.checkDefinitionHash, "checkDefinitionHash", 128);
	text(p.policyVersion, "policyVersion", 64);
	text(p.modelRevision, "modelRevision", 128);
	unique(p.skillHashes, "skillHashes", 64);
	text(p.expectedOutcome, "expectedOutcome", 2048);
	text(p.counterevidenceCondition, "counterevidenceCondition", 2048);
	member(p.estimator, ["uncalibrated-model-estimate", "validated-estimator", "none"], "estimator");
	integer(p.hostSequence, "hostSequence");
	integer(p.registeredAtMs, "registeredAtMs");
	if (p.probability !== undefined) {
		ensure(p.probability >= 0 && p.probability <= 1, "probability out of range");
		ensure(p.estimator !== "none", "probability requires a declared estimator");
	}
	if (p.expectedBinary !== undefined) ensure(typeof p.expectedBinary === "boolean", "expectedBinary");
}

/**
 * Register a prediction. The host calls this BEFORE the operation runs.
 * hostSequence is a host-owned monotone counter; predictions are immutable
 * once registered — corrections append a new record.
 */
export function registerPrediction(
	ledger: readonly Prediction[],
	prediction: Omit<Prediction, "status">,
): readonly Prediction[] {
	ensure(ledger.length < LEDGER_BOUND, "prediction ledger bound exceeded");
	validatePrediction({ ...prediction, status: "registered" });
	ensure(!ledger.some((p) => p.predictionId === prediction.predictionId), "duplicate predictionId");
	return [...ledger, { ...prediction, status: "registered" }];
}

/**
 * Resolve a registered prediction against a host observation bound to the
 * same candidate/check/environment fingerprints. Mismatched bindings reject —
 * a prediction for one candidate cannot be scored against another.
 */
export function resolvePrediction(
	ledger: readonly Prediction[],
	predictionId: string,
	observation: {
		readonly candidateHash: string;
		readonly environmentHash: string;
		readonly checkDefinitionHash: string;
		readonly outcome: string;
		readonly binaryOutcome?: boolean;
		readonly sideEffect?: boolean;
		readonly observedAtMs: number;
	},
): { ledger: readonly Prediction[]; scored: ScoredPrediction } {
	text(predictionId, "predictionId", 128);
	const index = ledger.findIndex((p) => p.predictionId === predictionId);
	ensure(index >= 0, "unknown predictionId");
	const p = ledger[index]!;
	ensure(p.status === "registered", `prediction ${predictionId} is ${p.status}`);
	ensure(observation.candidateHash === p.candidateHash, "candidate binding mismatch");
	ensure(observation.environmentHash === p.environmentHash, "environment binding mismatch");
	ensure(observation.checkDefinitionHash === p.checkDefinitionHash, "check binding mismatch");
	integer(observation.observedAtMs, "observedAtMs");
	ensure(observation.observedAtMs >= p.registeredAtMs, "observation predates registration");
	let mismatch: MismatchKind = "none";
	let score: number | undefined;
	let surpriseScore: number | undefined;
	if (observation.binaryOutcome !== undefined && p.expectedBinary !== undefined) {
		const outcome: 0 | 1 = observation.binaryOutcome ? 1 : 0;
		const expected: 0 | 1 = p.expectedBinary ? 1 : 0;
		if (outcome !== expected) mismatch = p.kind === "check-outcome" ? "unexpected-fail" : "unexpected-side-effect";
		if (p.probability !== undefined) {
			score = brier(p.probability, outcome);
			surpriseScore = surprise(p.probability, outcome);
		}
	} else if (observation.outcome !== p.expectedOutcome) {
		mismatch = p.kind === "scope" ? "scope-mismatch" : "unexpected-fail";
	}
	if (observation.sideEffect === true && p.kind !== "side-effect" && mismatch === "none") {
		mismatch = "unexpected-side-effect";
	}
	const resolved: Prediction = {
		...p,
		status: "resolved",
		resolvedAtMs: observation.observedAtMs,
		observedOutcome: observation.outcome,
		observedBinary: observation.binaryOutcome,
		mismatch,
	};
	const next = ledger.slice();
	next[index] = resolved;
	return { ledger: next, scored: { predictionId, mismatch, brier: score, surprise: surpriseScore } };
}

/**
 * Mark a prediction superseded (policy/budget/target changed before outcome)
 * or unobserved (cancelled, environment failure, late result). Neither is
 * ever scored as a code result.
 */
export function retirePrediction(
	ledger: readonly Prediction[],
	predictionId: string,
	outcome: "superseded" | "unobserved",
): readonly Prediction[] {
	const index = ledger.findIndex((p) => p.predictionId === predictionId);
	ensure(index >= 0, "unknown predictionId");
	const p = ledger[index]!;
	ensure(p.status === "registered", `prediction ${predictionId} is ${p.status}`);
	const next = ledger.slice();
	next[index] = { ...p, status: outcome };
	return next;
}

/** Categorical mismatch summary plus scored aggregates. */
export function mismatchSummary(ledger: readonly Prediction[]): {
	readonly total: number;
	readonly resolved: number;
	readonly byKind: Readonly<Record<MismatchKind, number>>;
	readonly meanBrier?: number;
	readonly meanSurprise?: number;
	readonly surprising: readonly ScoredPrediction[];
} {
	const byKind: Record<MismatchKind, number> = {
		"unexpected-pass": 0,
		"unexpected-fail": 0,
		"unexpected-side-effect": 0,
		"missing-observation": 0,
		"scope-mismatch": 0,
		none: 0,
	};
	const surprising: ScoredPrediction[] = [];
	let brierSum = 0,
		surpriseSum = 0,
		scored = 0;
	for (const p of ledger) {
		if (p.status !== "resolved") continue;
		const kind = p.mismatch ?? "none";
		byKind[kind] += 1;
		if (p.observedBinary !== undefined && p.probability !== undefined) {
			const outcome: 0 | 1 = p.observedBinary ? 1 : 0;
			brierSum += brier(p.probability, outcome);
			surpriseSum += surprise(p.probability, outcome);
			scored += 1;
			if (kind !== "none") {
				surprising.push({
					predictionId: p.predictionId,
					mismatch: kind,
					brier: brier(p.probability, outcome),
					surprise: surprise(p.probability, outcome),
				});
			}
		}
	}
	surprising.sort((a, b) => (b.surprise ?? 0) - (a.surprise ?? 0) || lexical(a.predictionId, b.predictionId));
	return {
		total: ledger.length,
		resolved: scored,
		byKind,
		meanBrier: scored > 0 ? brierSum / scored : undefined,
		meanSurprise: scored > 0 ? surpriseSum / scored : undefined,
		surprising,
	};
}

/** §5.5: map a mismatch kind to the short control branch it triggers. */
export function mismatchBranch(kind: MismatchKind): string {
	switch (kind) {
		case "scope-mismatch":
			return "impact-analysis-and-obligation-refresh";
		case "unexpected-fail":
			return "cause-hypothesis-discrimination";
		case "unexpected-pass":
			return "verifier-evaluation";
		case "unexpected-side-effect":
			return "boundary-and-permission-review";
		case "missing-observation":
			return "coverage-gap-registration";
		case "none":
			return "continue";
	}
}

export function predictionFingerprint(p: Prediction): string {
	return canonical([
		p.operationId,
		p.taskId,
		p.stageId,
		p.candidateHash,
		p.environmentHash,
		p.checkDefinitionHash,
		p.policyVersion,
		p.modelRevision,
	]);
}
