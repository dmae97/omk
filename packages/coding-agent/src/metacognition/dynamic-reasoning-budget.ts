import type { ThinkingLevel } from "omk-agent-core";
import { ensure } from "./validation.ts";

export type DynamicReasoningRiskLevel = "low" | "medium" | "high";

export type DynamicReasoningReason =
	| "metacog.low_confidence"
	| "metacog.repeated_failures"
	| "metacog.safety_floor"
	| "metacog.budget_conserve"
	| "metacog.nominal";

export interface DynamicReasoningBudgetInput {
	readonly baseLevel: ThinkingLevel;
	readonly availableLevels: readonly ThinkingLevel[];
	/** Metacognitive confidence in [0, 1]. */
	readonly confidence: number;
	readonly consecutiveFailures: number;
	/** Remaining session/goal budget fraction in [0, 1]. */
	readonly remainingBudgetFraction: number;
	readonly riskLevel: DynamicReasoningRiskLevel;
	readonly verificationStale: boolean;
}

export interface DynamicReasoningBudgetAllocation {
	readonly level: ThinkingLevel;
	readonly escalationDelta: number;
	readonly maxReasoningShare: number;
	readonly reasons: readonly DynamicReasoningReason[];
}

const CANONICAL_ORDER: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function canonicalIndex(level: ThinkingLevel): number {
	const idx = CANONICAL_ORDER.indexOf(level);
	return idx >= 0 ? idx : 0;
}

/**
 * Allocate turn-level reasoning budget dynamically from metacognitive runtime signals.
 * Safety floor: high-risk or stale-verification turns never downgrade below baseLevel.
 * Low confidence or repeated failures escalate within availableLevels; tight budget only
 * conserves effort on high-confidence, low-risk, failure-free turns.
 */
export function allocateDynamicReasoningBudget(input: DynamicReasoningBudgetInput): DynamicReasoningBudgetAllocation {
	ensure(
		Number.isFinite(input.confidence) && input.confidence >= 0 && input.confidence <= 1,
		"confidence must be in [0, 1]",
	);
	ensure(
		Number.isInteger(input.consecutiveFailures) && input.consecutiveFailures >= 0,
		"consecutiveFailures must be a non-negative integer",
	);
	ensure(
		Number.isFinite(input.remainingBudgetFraction) &&
			input.remainingBudgetFraction >= 0 &&
			input.remainingBudgetFraction <= 1,
		"remainingBudgetFraction must be in [0, 1]",
	);
	ensure(input.availableLevels.length > 0, "availableLevels must be non-empty");

	const ordered = [...new Set(input.availableLevels)].sort((a, b) => canonicalIndex(a) - canonicalIndex(b));
	let baseIdx = ordered.indexOf(input.baseLevel);
	if (baseIdx < 0) {
		const targetRank = canonicalIndex(input.baseLevel);
		baseIdx = ordered.findIndex((lvl) => canonicalIndex(lvl) >= targetRank);
		if (baseIdx < 0) baseIdx = ordered.length - 1;
	}

	const reasons: DynamicReasoningReason[] = [];
	const safetyGuarded = input.riskLevel === "high" || input.verificationStale;
	let delta = 0;

	if (safetyGuarded) {
		reasons.push("metacog.safety_floor");
		if (input.verificationStale || input.confidence < 0.6 || input.consecutiveFailures >= 1) {
			delta += 1;
		}
	}

	if (input.confidence < 0.45) {
		reasons.push("metacog.low_confidence");
		delta += 1;
	}
	if (input.consecutiveFailures >= 2) {
		reasons.push("metacog.repeated_failures");
		delta += 1;
	}

	if (
		delta === 0 &&
		!safetyGuarded &&
		input.riskLevel === "low" &&
		input.consecutiveFailures === 0 &&
		input.confidence >= 0.85 &&
		input.remainingBudgetFraction < 0.35
	) {
		reasons.push("metacog.budget_conserve");
		delta = -1;
	}

	if (reasons.length === 0) reasons.push("metacog.nominal");

	const minIdx = safetyGuarded ? baseIdx : ordered[0] === "off" && ordered.length > 1 ? 1 : 0;
	const targetIdx = Math.max(minIdx, Math.min(ordered.length - 1, baseIdx + delta));
	const appliedDelta = targetIdx - baseIdx;
	const share = Number(
		Math.max(0.1, Math.min(0.65, 0.25 + appliedDelta * 0.1 + (safetyGuarded ? 0.1 : 0))).toFixed(2),
	);

	return {
		level: ordered[targetIdx],
		escalationDelta: appliedDelta,
		maxReasoningShare: share,
		reasons,
	};
}
