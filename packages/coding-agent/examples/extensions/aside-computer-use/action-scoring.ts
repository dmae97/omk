/**
 * Deterministic candidate action scoring for Aside planner proposals.
 *
 * Pure module — no I/O, no controller/tool coupling.
 */

import type { ActionScoringConfidence, BrowserAction, PlannedActionCandidate, RiskLevel } from "./types.ts";

const RISK_THRESHOLDS: Readonly<Record<RiskLevel, number>> = {
	R0: 0.5,
	R1: 0.65,
	R2: 0.85,
	R3: 0.95,
};

const AMBIGUOUS_DELTA = 0.1;

export interface ScoredActionCandidate {
	readonly candidate: PlannedActionCandidate;
	readonly total: number;
}

export interface ActionCandidateSelection {
	readonly status: ActionScoringConfidence;
	readonly selected?: ScoredActionCandidate;
	readonly scored: readonly ScoredActionCandidate[];
	readonly reason: string;
}

function clampScore(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

function stableStringify(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null || typeof value !== "object") {
		if (typeof value === "bigint") return value.toString();
		return JSON.stringify(value) ?? String(value);
	}
	if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	const record = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(",")}}`;
}

function actionSortKey(action: BrowserAction): string {
	return [
		action.kind,
		action.url ?? "",
		action.description,
		action.asideTool ?? "",
		stableStringify(action.asideArgs ?? {}),
	].join("\u0000");
}

function compareScoredCandidates(left: ScoredActionCandidate, right: ScoredActionCandidate): number {
	if (left.total !== right.total) return right.total - left.total;
	const leftKey = actionSortKey(left.candidate.action);
	const rightKey = actionSortKey(right.candidate.action);
	if (leftKey < rightKey) return -1;
	if (leftKey > rightKey) return 1;
	return 0;
}

/** Score one planned action candidate using the fixed weighted formula. */
export function scoreActionCandidate(input: PlannedActionCandidate): number {
	const total =
		0.3 * clampScore(input.goalProgress) +
		0.2 * clampScore(input.observationSupport) +
		0.15 * clampScore(input.selectorCertainty) +
		0.1 * clampScore(input.policyFit) +
		0.1 * clampScore(input.reversibility) +
		0.1 * clampScore(input.toolReliability) +
		0.05 * clampScore(input.evidenceGain) -
		clampScore(input.ambiguityPenalty) -
		clampScore(input.repeatPenalty) -
		clampScore(input.riskPenalty);
	return clampScore(total);
}

/** Minimum acceptable score for a risk band. */
export function thresholdForRisk(risk: RiskLevel): number {
	return RISK_THRESHOLDS[risk];
}

/**
 * Select the best safe candidate, or require inspection when evidence is weak
 * or the top candidates are too close to choose deterministically.
 */
export function selectActionCandidate(candidates: readonly PlannedActionCandidate[]): ActionCandidateSelection {
	const scored = candidates
		.map((candidate) => ({ candidate, total: scoreActionCandidate(candidate) }))
		.sort(compareScoredCandidates);

	const top = scored[0];
	if (!top) {
		return { status: "inspection_required", scored, reason: "no action candidates available" };
	}

	const threshold = thresholdForRisk(top.candidate.risk);
	if (top.total < threshold) {
		return {
			status: "inspection_required",
			scored,
			reason: `top action score ${top.total.toFixed(3)} is below ${top.candidate.risk} threshold ${threshold.toFixed(2)}`,
		};
	}

	const runnerUp = scored[1];
	if (runnerUp && top.total - runnerUp.total < AMBIGUOUS_DELTA) {
		return {
			status: "inspection_required",
			scored,
			reason: `ambiguous top candidates: score delta ${(top.total - runnerUp.total).toFixed(3)}`,
		};
	}

	return { status: "selected", selected: top, scored, reason: "top action exceeds risk threshold and ambiguity gap" };
}
