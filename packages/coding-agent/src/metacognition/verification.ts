/**
 * Time-aware independent verification (Jev audit algorithm A7, finding F07).
 *
 * F07 is the confusion between "each condition was satisfied at some point"
 * and "they hold together now". Keeping `CompleteCurrent` and `CompleteEver`
 * apart resolves it without throwing away valid history.
 *
 * `unknown` is a third value, not a synonym for `false`. A missing field or an
 * incomplete collection scope means the evidence is absent; any binary rule
 * that negates it into `true` manufactures a verification that never happened.
 *
 * Evidence strength is ordered but deliberately not a universal trust score:
 * a backend response still has to be matched to the right account and request.
 * The point is to hold a verification signal that does not share the executing
 * model's uncertainty.
 */

import { ensure } from "./validation.ts";

export type ConditionValue = "true" | "false" | "unknown";

export interface ConditionObservation {
	readonly snapshotId: string;
	/** Target generation this snapshot belongs to. */
	readonly generation: number;
	readonly values: Readonly<Record<string, ConditionValue>>;
}

export interface UnsatisfiedCondition {
	readonly condition: string;
	readonly value: ConditionValue;
}

export type CompletionResult =
	| { readonly complete: true }
	| { readonly complete: false; readonly unsatisfied: readonly UnsatisfiedCondition[] };

/**
 * Every current condition must hold in the *same* snapshot.
 *
 * Evaluating them across snapshots would let a condition that has since
 * flipped keep satisfying the gate.
 */
export function completeCurrent(conditions: readonly string[], snapshot: ConditionObservation): CompletionResult {
	ensure(Array.isArray(conditions) && conditions.length > 0, "current conditions must be non-empty");
	const unsatisfied: UnsatisfiedCondition[] = [];
	for (const condition of conditions) {
		// An absent field is unknown, never false.
		const value = snapshot.values[condition] ?? "unknown";
		if (value !== "true") unsatisfied.push({ condition, value });
	}
	return unsatisfied.length === 0 ? { complete: true } : { complete: false, unsatisfied };
}

/**
 * Each historical condition must have been observed true at least once in the
 * supplied evidence set, which the caller scopes to the current task.
 */
export function completeEver(
	conditions: readonly string[],
	history: readonly ConditionObservation[],
): CompletionResult {
	ensure(Array.isArray(conditions) && conditions.length > 0, "ever conditions must be non-empty");
	ensure(Array.isArray(history) && history.length > 0, "history must be non-empty to judge an ever condition");
	const unsatisfied: UnsatisfiedCondition[] = [];
	for (const condition of conditions) {
		const seenTrue = history.some((snapshot) => snapshot.values[condition] === "true");
		if (seenTrue) continue;
		const anyKnown = history.some((snapshot) => snapshot.values[condition] === "false");
		unsatisfied.push({ condition, value: anyKnown ? "false" : "unknown" });
	}
	return unsatisfied.length === 0 ? { complete: true } : { complete: false, unsatisfied };
}

export type EvidenceKind =
	| "authoritative-query"
	| "structured-remote-linked"
	| "independent-ui"
	| "page-success-text"
	| "model-completion-claim";

const EVIDENCE_RANK: Readonly<Record<EvidenceKind, number>> = {
	"authoritative-query": 4,
	"structured-remote-linked": 3,
	"independent-ui": 2,
	"page-success-text": 1,
	"model-completion-claim": 0,
};

export function evidenceStrength(kind: EvidenceKind): number {
	const rank = EVIDENCE_RANK[kind];
	ensure(rank !== undefined, `unknown evidence kind: ${String(kind)}`);
	return rank;
}

export type VerificationLevel = "REMOTE_EFFECT_VERIFIED" | "UI_VERIFIED" | "CLAIMED_ONLY";

/**
 * Label a result by the strongest evidence actually held.
 *
 * A UI observation is reported as `UI_VERIFIED`, never as
 * `REMOTE_EFFECT_VERIFIED`: if the target system offers no authoritative
 * query, the honest move is to lower the claimed level, not to borrow one.
 */
export function strongestEvidence(kinds: readonly EvidenceKind[]): VerificationLevel {
	ensure(Array.isArray(kinds) && kinds.length > 0, "evidence set must be non-empty");
	let best = -1;
	for (const kind of kinds) best = Math.max(best, evidenceStrength(kind));
	if (best >= EVIDENCE_RANK["structured-remote-linked"]) return "REMOTE_EFFECT_VERIFIED";
	if (best >= EVIDENCE_RANK["independent-ui"]) return "UI_VERIFIED";
	return "CLAIMED_ONLY";
}

export interface EvidenceItem {
	readonly id: string;
	/** Common-cause group, e.g. one DOM snapshot that many readings derive from. */
	readonly sourceGroup: string;
}

export interface EvidenceGrouping {
	readonly independentCount: number;
	readonly byGroup: Readonly<Record<string, number>>;
}

/**
 * Collapse correlated readings into their source groups.
 *
 * Fifty screenshots of one screen are one witness. Text, accessibility names
 * and rendered copy from the same DOM share a common cause, so counting them
 * separately inflates apparent independent confirmation.
 */
export function independentEvidenceGroups(items: readonly EvidenceItem[]): EvidenceGrouping {
	ensure(Array.isArray(items) && items.length > 0, "evidence items must be non-empty");
	const byGroup: Record<string, number> = {};
	for (const item of items) {
		ensure(
			typeof item.sourceGroup === "string" && item.sourceGroup.length > 0,
			"each evidence item needs a declared sourceGroup",
		);
		byGroup[item.sourceGroup] = (byGroup[item.sourceGroup] ?? 0) + 1;
	}
	return { independentCount: Object.keys(byGroup).length, byGroup };
}

export interface VerifierSample {
	readonly verdict: ConditionValue;
	/** Externally established truth, not another model's opinion. */
	readonly truth: "true" | "false";
}

export interface VerifierQuality {
	/** Undefined when no negative case was sampled; that is absent evidence. */
	readonly falsePositiveRate: number | undefined;
	readonly falseNegativeRate: number | undefined;
	readonly unknownRate: number;
	readonly samples: number;
}

/**
 * Measure the verifier before reporting any success rate.
 *
 * A mislabelling verifier contaminates every downstream selector and bandit
 * trained on its labels, so its error rates are the prior question.
 */
export function verifierQuality(samples: readonly VerifierSample[]): VerifierQuality {
	ensure(Array.isArray(samples) && samples.length > 0, "verifier samples must be non-empty");
	let positives = 0;
	let negatives = 0;
	let falsePositives = 0;
	let falseNegatives = 0;
	let unknowns = 0;
	for (const sample of samples) {
		if (sample.verdict === "unknown") unknowns += 1;
		if (sample.truth === "true") {
			positives += 1;
			if (sample.verdict === "false") falseNegatives += 1;
		} else {
			negatives += 1;
			if (sample.verdict === "true") falsePositives += 1;
		}
	}
	return {
		falsePositiveRate: negatives > 0 ? falsePositives / negatives : undefined,
		falseNegativeRate: positives > 0 ? falseNegatives / positives : undefined,
		unknownRate: unknowns / samples.length,
		samples: samples.length,
	};
}
