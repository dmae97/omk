/**
 * Algorithm D — meta-verification: checking that a check detects the defect
 * it claims to cover. Spec §7.
 *
 * Obligation-scoped negative controls are evaluated over VALID, non-equivalent
 * mutants only. Environment failures, compile-broken mutants, and timeouts are
 * never counted as semantic detections. An empty denominator is `unknown`,
 * never a score. This is an empirical detection rate for this mutant set,
 * not the probability the code is correct.
 */
import { ensure, finite, integer, lexical, member, text, unique } from "./validation.ts";

export type MutantClass =
	| "killed-intended"
	| "survived"
	| "equivalent"
	| "invalid-compile"
	| "environment-failure"
	| "timeout"
	| "killed-unintended";
export interface MutantRecord {
	readonly mutantId: string;
	readonly obligationId: string;
	/** The host classifies the outcome; this module never guesses. */
	readonly classification: MutantClass;
	/** Whether the intended obligation violation was what the check caught. */
	readonly intendedViolation: boolean;
}
export interface VerifierEvaluation {
	readonly obligationId: string;
	/** D_v over valid non-equivalent mutants; "unknown" when empty. */
	readonly detectionRate: number | "unknown";
	readonly evaluated: number;
	readonly excluded: Readonly<Record<Exclude<MutantClass, "killed-intended" | "survived">, number>>;
	readonly survivingMutantIds: readonly string[];
	readonly blindSpots: readonly string[];
}

const MUTANT_BOUND = 1024;

export function evaluateVerifier(
	obligationId: string,
	mutants: readonly MutantRecord[],
	checksValidOnHealthy: boolean,
): VerifierEvaluation {
	text(obligationId, "obligationId", 256);
	ensure(mutants.length <= MUTANT_BOUND, "too many mutants");
	unique(
		mutants.map((m) => m.mutantId),
		"mutant ids",
	);
	const scoped = mutants.filter((m) => m.obligationId === obligationId);
	const excluded: Record<Exclude<MutantClass, "killed-intended" | "survived">, number> = {
		equivalent: 0,
		"invalid-compile": 0,
		"environment-failure": 0,
		timeout: 0,
		"killed-unintended": 0,
	};
	let detected = 0;
	const survivors: string[] = [];
	const blindSpots: string[] = [];
	for (const m of scoped) {
		member(
			m.classification,
			[
				"killed-intended",
				"survived",
				"equivalent",
				"invalid-compile",
				"environment-failure",
				"timeout",
				"killed-unintended",
			],
			"mutant classification",
		);
		if (m.classification === "killed-intended" && m.intendedViolation) {
			detected += 1;
		} else if (m.classification === "survived") {
			survivors.push(m.mutantId);
			blindSpots.push(`undetected-violation:${m.mutantId}`);
		} else {
			excluded[m.classification as keyof typeof excluded] += 1;
			if (m.classification === "invalid-compile" || m.classification === "environment-failure") {
				blindSpots.push(`uninformative-mutant:${m.mutantId}`);
			}
		}
	}
	if (!checksValidOnHealthy) blindSpots.push("check-invalid-on-healthy-candidate");
	const denominator = detected + survivors.length;
	return {
		obligationId,
		detectionRate: denominator === 0 ? "unknown" : detected / denominator,
		evaluated: denominator,
		excluded,
		survivingMutantIds: survivors.sort(lexical),
		blindSpots: blindSpots.sort(lexical),
	};
}

/**
 * §7.4 metamorphic relation: Pre(x,T) ⟹ R(f(x), f(T(x))). The relation must
 * be a declared required property of this program — never a universal rule.
 */
export interface MetamorphicRelation {
	readonly relationId: string;
	readonly description: string;
	readonly precondition: string;
	readonly requiredProperty: boolean;
}
export function relationApplicable(rel: MetamorphicRelation): boolean {
	return rel.requiredProperty;
}

/** §10.1 progress key: same key + no new adopted evidence = repetition. */
export interface ProgressKey {
	readonly goalScope: string;
	readonly candidateFamily: string;
	readonly errorClass: string;
	readonly approach: string;
	readonly checkMethod: string;
	readonly sourceFamily: string;
}
export function progressKey(k: ProgressKey): string {
	return [k.goalScope, k.candidateFamily, k.errorClass, k.approach, k.checkMethod, k.sourceFamily].join("\u001f");
}
export function isStagnant(
	current: ProgressKey,
	history: readonly { key: string; newEvidence: boolean; resolvedObligations: number; newValidChecks: number }[],
	maxRepetitions: number,
): boolean {
	integer(maxRepetitions, "maxRepetitions", 64);
	const key = progressKey(current);
	let repeats = 0;
	for (const entry of history) {
		if (entry.key === key && !entry.newEvidence && entry.resolvedObligations === 0 && entry.newValidChecks === 0) {
			repeats += 1;
		}
	}
	return repeats >= maxRepetitions;
}

/** §10.2 net strategy-switch score with hysteresis margin. */
export function netSwitchValue(estimatedLossDelta: number, cost: number, switchCost: number): number {
	finite(estimatedLossDelta, "estimatedLossDelta");
	finite(cost, "cost");
	finite(switchCost, "switchCost");
	return estimatedLossDelta - cost - switchCost;
}
