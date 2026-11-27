import { ensure } from "./validation.ts";

export type MetacogAuthorityAction = "approve" | "verify" | "complete";

export interface HeuristicConfidenceSignal {
	readonly kind: "uncalibrated_heuristic";
	readonly source: string;
	readonly heuristicScore: number;
	readonly isCalibratedProbability: false;
	readonly grantsApprovalAuthority: false;
	readonly grantsVerificationAuthority: false;
	readonly displayLabel: string;
}

export class MetacogAuthorityViolationError extends Error {
	readonly action: MetacogAuthorityAction;
	readonly source: string;

	constructor(action: MetacogAuthorityAction, source: string) {
		super(
			`metacognition heuristic from "${source}" cannot grant ${action} authority; only host checks and operator approval may authorize "${action}"`,
		);
		this.name = "MetacogAuthorityViolationError";
		this.action = action;
		this.source = source;
	}
}

/**
 * Wrap any heuristic confidence/score so callers and UIs never display it as a
 * calibrated correctness probability or treat it as approval/verification authority.
 */
export function createHeuristicSignal(rawScore: number, source: string): HeuristicConfidenceSignal {
	ensure(Number.isFinite(rawScore), "rawScore must be finite");
	ensure(source.trim().length > 0, "source must be non-empty");
	const heuristicScore = Number(Math.max(0, Math.min(1, rawScore)).toFixed(4));
	return Object.freeze({
		kind: "uncalibrated_heuristic" as const,
		source: source.trim(),
		heuristicScore,
		isCalibratedProbability: false as const,
		grantsApprovalAuthority: false as const,
		grantsVerificationAuthority: false as const,
		displayLabel: `heuristic (uncalibrated, ${source.trim()}): ${heuristicScore.toFixed(2)}`,
	});
}

/** Hard runtime boundary preventing heuristic scores from authorizing approve/verify/complete. */
export function assertMetacogNoAuthority(action: MetacogAuthorityAction, signal: HeuristicConfidenceSignal): never {
	throw new MetacogAuthorityViolationError(action, signal.source);
}
