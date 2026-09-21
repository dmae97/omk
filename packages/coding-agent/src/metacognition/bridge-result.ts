/**
 * WP05 loss-aware bridge result types (docs/06_METACOGNITION_BRIDGE.md).
 *
 * Every host→kernel translation returns exactly one of:
 *
 * - `mapped`   — every attribute the kernel contract requires was preserved.
 * - `partial`  — the mappable part was emitted AND the loss was declared in
 *   `loss`; a partial result touching a required claim must never be
 *   promoted to completion.
 * - `rejected` — the input conflicts with the current binding/clock/contract
 *   and nothing was emitted; `reason` says what was lost.
 *
 * The old mapper's failure modes — first-claim collapse, sequence 0,
 * checkId taken from receiptId/invalidation keys, observedAt stamped with
 * bridge time, expiry fabricated as now+1, and free rebinding to the current
 * candidate — are all representable here as declared loss instead of silent
 * corruption.
 */
import type { ObservationSource } from "omk-protocol";
import type { Claim, Observation, SourceIdentity } from "./knowledge.ts";
import type { MetaState } from "./state.ts";

/** Polarity the host may report. The kernel cannot express the last three for every kind. */
export type BridgePolarity = "supports" | "violates" | "unknown" | "neutral" | "inconclusive";

/**
 * Host observation accepted by the bridge. Structurally a superset of the
 * protocol's ObservationNode: every field the kernel needs but the node does
 * not carry is optional here, and its absence is declared loss — never
 * fabricated.
 */
export interface BridgeObservation {
	readonly observationId: string;
	readonly claimIds: readonly string[];
	readonly polarity: BridgePolarity;
	readonly source: ObservationSource;
	readonly sourceRoot: string;
	readonly environmentDigest: string;
	readonly receiptId?: string;
	readonly validUntil?: string;
	readonly invalidationKeys?: readonly string[];
	readonly independenceGroup?: string;
	/** Host-allocated ordering from the strict evidence ledger. Absent ⇒ partial, never 0. */
	readonly sequence?: number;
	/** When the host observed it. Absent ⇒ partial, never the bridge call time. */
	readonly observedAtMs?: number;
	/** Candidate@environment the witness was bound to. Absent ⇒ unknownBindings. */
	readonly binding?: string;
	/** Ledger generation at observation time. Mismatch with the current one ⇒ rejected. */
	readonly generation?: number;
	/** The check predicate this witness attests to. Never derived from receiptId. */
	readonly checkId?: string;
	/** Additional predicates when one witness attests to several checks. */
	readonly checkIds?: readonly string[];
	/** Decision actor for model/user decision observations. */
	readonly actorId?: string;
	/** Source family override; defaults to the registered family's own name. */
	readonly sourceFamily?: string;
}

/** Declared loss carried by every `partial` result. */
export interface BridgeLoss {
	/** Fields that could not be preserved, labelled `observationId.field` or `claimId.field`. */
	readonly lostFields: readonly string[];
	/** `observationId->claimId` edges that were not emitted, or `claim:id` for unmapped claims. */
	readonly unmappedClaims: readonly string[];
	/** Observation ids whose binding could not be established; they are never re-bound. */
	readonly unknownBindings: readonly string[];
	/** Same-family independence violations and opposing witnesses, labelled by observation id. */
	readonly sourceFamilyConflicts: readonly string[];
	/** Observations rejected whole, with their loss reason. */
	readonly rejectedObservations: readonly { id: string; reason: string }[];
}

export const EMPTY_BRIDGE_LOSS: BridgeLoss = {
	lostFields: [],
	unmappedClaims: [],
	unknownBindings: [],
	sourceFamilyConflicts: [],
	rejectedObservations: [],
};

export type BridgeResult<T> =
	| { readonly status: "mapped"; readonly value: T }
	| { readonly status: "partial"; readonly value: T; readonly loss: BridgeLoss }
	| { readonly status: "rejected"; readonly reason: string };

/** One observation's mapping payload: the emitted kernel edges plus sources they reference. */
export interface ObservationMapping {
	readonly observations: readonly Observation[];
	readonly sources: readonly SourceIdentity[];
}
export type ObservationMapResult =
	| {
			readonly status: "mapped";
			readonly observations: readonly Observation[];
			readonly sources: readonly SourceIdentity[];
	  }
	| {
			readonly status: "partial";
			readonly observations: readonly Observation[];
			readonly sources: readonly SourceIdentity[];
			readonly loss: BridgeLoss;
	  }
	| { readonly status: "rejected"; readonly reason: string };

export type ClaimMapResult =
	| { readonly status: "mapped"; readonly claim: Claim }
	| { readonly status: "partial"; readonly claim: Claim; readonly loss: BridgeLoss }
	| { readonly status: "rejected"; readonly reason: string };

/** toMetaState payload — the kernel inputs plus the source identities the emitted edges cite. */
export interface RuntimeBridgeOutput {
	readonly state: MetaState;
	readonly claims: readonly Claim[];
	readonly observations: readonly Observation[];
	readonly sources: readonly SourceIdentity[];
}

/**
 * Whole-bridge result. `partial` additionally reports which required leaf or
 * compound claims the declared loss touches — the completion gate consults
 * exactly this field.
 */
export type RuntimeBridgeResult =
	| { readonly status: "mapped"; readonly value: RuntimeBridgeOutput }
	| {
			readonly status: "partial";
			readonly value: RuntimeBridgeOutput;
			readonly loss: BridgeLoss;
			readonly touchesRequiredClaims: readonly string[];
	  }
	| { readonly status: "rejected"; readonly reason: string };

/**
 * The completion rule from docs/06: a `partial` whose declared loss touches a
 * required claim stays `unknown` at the gate — it must never promote
 * completion. `rejected` never admits anything.
 */
export function bridgeBlocksCompletion(result: RuntimeBridgeResult): boolean {
	if (result.status === "rejected") return true;
	if (result.status === "partial") return result.touchesRequiredClaims.length > 0;
	return false;
}

/** Merge loss records; every list stays sorted-unique for deterministic output. */
export function mergeBridgeLoss(parts: readonly BridgeLoss[]): BridgeLoss {
	const uniq = (xs: readonly string[]): string[] => [...new Set(xs)].sort();
	const rejected = new Map<string, string>();
	for (const p of parts) for (const r of p.rejectedObservations) rejected.set(r.id, r.reason);
	return {
		lostFields: uniq(parts.flatMap((p) => p.lostFields)),
		unmappedClaims: uniq(parts.flatMap((p) => p.unmappedClaims)),
		unknownBindings: uniq(parts.flatMap((p) => p.unknownBindings)),
		sourceFamilyConflicts: uniq(parts.flatMap((p) => p.sourceFamilyConflicts)),
		rejectedObservations: [...rejected.entries()]
			.map(([id, reason]) => ({ id, reason }))
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
	};
}

export function lossOf(partial: Partial<BridgeLoss>): BridgeLoss {
	return {
		lostFields: partial.lostFields ?? [],
		unmappedClaims: partial.unmappedClaims ?? [],
		unknownBindings: partial.unknownBindings ?? [],
		sourceFamilyConflicts: partial.sourceFamilyConflicts ?? [],
		rejectedObservations: partial.rejectedObservations ?? [],
	};
}
