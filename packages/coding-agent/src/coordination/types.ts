/**
 * Wire contracts for parallel-session coordination.
 *
 * Ported from the proposed `contracts.ts` of the 2026-09-20 coordination
 * design. These are new contracts, not pre-existing OMK exports.
 *
 * The central distinction the types encode: an authorization deadline is not a
 * termination proof. A grant whose deadline passed while an external effect was
 * live becomes `quarantined` — still holding its claims — rather than free.
 */

/** Canonical nonnegative decimal string. Ordering is numeric, not lexical. */
export type Sequence = string & { readonly __sequence: unique symbol };

const SEQUENCE_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_SEQUENCE_LENGTH = 40;

export function sequence(value: unknown): Sequence {
	if (typeof value !== "string" || !SEQUENCE_PATTERN.test(value)) {
		throw new TypeError("sequence must be a canonical nonnegative decimal string");
	}
	if (value.length > MAX_SEQUENCE_LENGTH) throw new RangeError("sequence too long");
	return value as Sequence;
}

export function nextSequence(value: Sequence): Sequence {
	return sequence(String(BigInt(sequence(value)) + 1n));
}

/**
 * Lifecycle of an authorized effect.
 *
 * The in-process broker currently mints `reserved`, `running`, `quarantined`,
 * `terminated` and `cancelled`. `starting` and `terminating` are reserved for
 * the out-of-process supervisor that reports those transitions over the wire;
 * nothing emits them yet, and the broker must not infer them.
 */
export type EffectState =
	| "reserved"
	| "starting"
	| "running"
	| "terminating"
	| "quarantined"
	| "terminated"
	| "cancelled";

/** States in which a grant no longer holds its claims. */
export const SETTLED_EFFECT_STATES: ReadonlySet<EffectState> = new Set<EffectState>(["terminated", "cancelled"]);

export type ClaimNamespace = "filesystem" | "git-ref" | "contract" | "socket" | "database" | "host-budget";
export type ClaimAccess = "read" | "write";

/**
 * One declared resource claim.
 *
 * `canonicalKey` must already be normalized by the caller: the broker rejects
 * rather than guesses, because silently normalizing `a/../b` would let two
 * sessions believe they hold disjoint keys.
 */
export interface ResourceClaim {
	readonly namespace: ClaimNamespace;
	readonly instanceId: string;
	readonly canonicalKey: string;
	readonly access: ClaimAccess;
	readonly generation: Sequence;
}

/**
 * Proof of admission for exactly one operation of one session incarnation.
 *
 * `authorizationDeadline` bounds the authorization only. Termination is a
 * separate, supervisor-reported fact.
 */
export interface GrantToken {
	readonly authorityEpoch: Sequence;
	readonly grantSequence: Sequence;
	readonly sessionId: string;
	readonly sessionIncarnation: Sequence;
	readonly authorizationDeadline: number;
}

export type AdmissionOutcome =
	| { readonly status: "granted"; readonly token: GrantToken }
	| { readonly status: "blocked"; readonly blockers: readonly Sequence[] }
	| { readonly status: "over-capacity"; readonly requestedWeight: number; readonly availableWeight: number };
