import { canonicalClaim, claimSetsConflict, type ResourceClaimInput } from "../../coordination/resource.ts";
import {
	type EffectState,
	type GrantToken,
	type ResourceClaim,
	SETTLED_EFFECT_STATES,
	type Sequence,
	sequence,
} from "../../coordination/types.ts";
import type { NamespaceIdentity } from "./namespace-identity.ts";
import { parseNamespaceIdentity } from "./namespace-identity.ts";
import { VerifiedRunError } from "./storage.ts";

/**
 * Durable authority event contract (WP03).
 *
 * Mirrors `schemas/supervisor-event.schema.json` plus the review-required
 * extensions: `authority-epoch-advanced` (S4), `authorization-expired` (S5),
 * `session-registered` (S2), `result-retained` (S3 tombstone), and
 * `authority-snapshot` (GC archive boundary, §7). Quarantine reasons are
 * carried on the transition event that caused them — `cancel-requested` /
 * `authorization-expired` / `authority-epoch-advanced` transitions — so a
 * replay can distinguish cancel from expiry from restart (S5).
 */

export interface AuthorityEpochTransition {
	readonly grantSequence: Sequence;
	readonly outcome: "cancelled" | "quarantined";
}

export interface AuthorityGrantRecord {
	readonly token: GrantToken;
	/** Idempotency key supplied by the caller; unique across grants and tombstones. */
	readonly commandId: string;
	readonly intentDigest: string;
	/** Reserved claims (S6: distinct from `actualClaims` bound at effect-started). */
	readonly claims: readonly ResourceClaim[];
	readonly weight: number;
	readonly state: EffectState;
	readonly effectLive: boolean;
	readonly dispatchId: string | null;
	readonly actualClaims: readonly ResourceClaim[] | null;
	readonly identity: NamespaceIdentity | null;
}

export interface AuthorityTombstone {
	readonly commandId: string;
	readonly grantSequence: Sequence;
	readonly resultDigest: string;
	readonly retainedAtMs: number;
	readonly expiresAtMs: number;
}

export interface AuthoritySnapshotState {
	readonly epoch: Sequence;
	readonly reconciledEpoch: Sequence | null;
	readonly incarnations: readonly { readonly sessionId: string; readonly incarnation: Sequence }[];
	readonly grantCounter: Sequence;
	readonly grants: readonly AuthorityGrantRecord[];
	readonly tombstones: readonly AuthorityTombstone[];
}

export type AuthorityEvent =
	| {
			readonly kind: "authority-epoch-advanced";
			readonly authorityEpoch: Sequence;
			readonly writerId: string;
			readonly transitions: readonly AuthorityEpochTransition[];
	  }
	| { readonly kind: "authority-reconciled"; readonly authorityEpoch: Sequence }
	| { readonly kind: "session-registered"; readonly sessionId: string; readonly incarnation: Sequence }
	| { readonly kind: "grant-reserved"; readonly grant: AuthorityGrantRecord }
	| {
			readonly kind: "dispatch-intent";
			readonly grantSequence: Sequence;
			readonly authorityEpoch: Sequence;
			readonly dispatchId: string;
	  }
	| {
			readonly kind: "effect-started";
			readonly grantSequence: Sequence;
			readonly authorityEpoch: Sequence;
			readonly actualClaims: readonly ResourceClaim[];
			readonly identity?: NamespaceIdentity;
	  }
	| {
			readonly kind: "cancel-requested";
			readonly grantSequence: Sequence;
			readonly authorityEpoch: Sequence;
			readonly outcome: "cancelled" | "quarantined";
	  }
	| {
			readonly kind: "authorization-expired";
			readonly grantSequence: Sequence;
			readonly authorityEpoch: Sequence;
			readonly outcome: "cancelled" | "quarantined";
	  }
	| {
			readonly kind: "quarantined";
			readonly grantSequence: Sequence;
			readonly authorityEpoch: Sequence;
			readonly reason: "restart";
	  }
	| {
			readonly kind: "termination-observed";
			readonly grantSequence: Sequence;
			readonly authorityEpoch: Sequence;
	  }
	| {
			readonly kind: "result-retained";
			readonly commandId: string;
			readonly grantSequence: Sequence;
			readonly resultDigest: string;
			readonly retainedAtMs: number;
			readonly expiresAtMs: number;
	  }
	| {
			readonly kind: "authority-snapshot";
			readonly archivedThroughSequence: number;
			readonly continuesHash: string;
			readonly state: AuthoritySnapshotState;
	  };

export interface AuthorityProjection {
	readonly epoch: Sequence | null;
	readonly reconciledEpoch: Sequence | null;
	readonly incarnations: ReadonlyMap<string, Sequence>;
	readonly grantCounter: Sequence;
	readonly grants: ReadonlyMap<Sequence, AuthorityGrantRecord>;
	readonly tombstones: ReadonlyMap<string, AuthorityTombstone>;
}

interface MutableAuthorityProjection {
	epoch: Sequence | null;
	reconciledEpoch: Sequence | null;
	incarnations: Map<string, Sequence>;
	grantCounter: Sequence;
	grants: Map<Sequence, AuthorityGrantRecord>;
	tombstones: Map<string, AuthorityTombstone>;
}

/** A restart that bumped the epoch but never finished reconciliation stays pending. */
export function authorityPendingReconcile(state: AuthorityProjection): boolean {
	return state.reconciledEpoch !== state.epoch;
}

function text(value: unknown): string {
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new VerifiedRunError("integrity");
	return value;
}

/** bootId:pid style writer labels — looser than `text` but still bounded and printable. */
function writerLabel(value: unknown): string {
	if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw new VerifiedRunError("integrity");
	return value;
}

function digest(value: unknown): string {
	const result = text(value);
	if (!/^[a-f0-9]{64}$/.test(result)) throw new VerifiedRunError("integrity");
	return result;
}

function integer(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new VerifiedRunError("integrity");
	return value;
}

function seq(value: unknown): Sequence {
	try {
		return sequence(value);
	} catch {
		throw new VerifiedRunError("integrity");
	}
}

function nextSeq(value: Sequence): Sequence {
	return sequence(String(BigInt(value) + 1n));
}

function claim(raw: unknown): ResourceClaim {
	if (typeof raw !== "object" || raw === null) throw new VerifiedRunError("integrity");
	const value: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
	try {
		return canonicalClaim(value as unknown as ResourceClaimInput);
	} catch {
		throw new VerifiedRunError("integrity");
	}
}

function claimList(raw: unknown, limit = 256): readonly ResourceClaim[] {
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > limit) throw new VerifiedRunError("integrity");
	return Object.freeze(raw.map(claim));
}

function token(raw: unknown): GrantToken {
	if (typeof raw !== "object" || raw === null) throw new VerifiedRunError("integrity");
	const value: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
	return Object.freeze({
		authorityEpoch: seq(value.authorityEpoch),
		grantSequence: seq(value.grantSequence),
		sessionId: text(value.sessionId),
		sessionIncarnation: seq(value.sessionIncarnation),
		authorizationDeadline: integer(value.authorizationDeadline),
	});
}

const GRANT_STATES: ReadonlySet<string> = new Set([
	"reserved",
	"starting",
	"running",
	"terminating",
	"quarantined",
	"terminated",
	"cancelled",
]);

function grantRecord(raw: unknown): AuthorityGrantRecord {
	if (typeof raw !== "object" || raw === null) throw new VerifiedRunError("integrity");
	const value: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
	if (typeof value.state !== "string" || !GRANT_STATES.has(value.state)) throw new VerifiedRunError("integrity");
	if (typeof value.effectLive !== "boolean") throw new VerifiedRunError("integrity");
	if (SETTLED_EFFECT_STATES.has(value.state as EffectState) && value.effectLive)
		throw new VerifiedRunError("integrity");
	if (value.state === "quarantined" && !value.effectLive) throw new VerifiedRunError("integrity");
	return Object.freeze({
		token: token(value.token),
		commandId: text(value.commandId),
		intentDigest: digest(value.intentDigest),
		claims: claimList(value.claims),
		weight: integer(value.weight),
		state: value.state as EffectState,
		effectLive: value.effectLive,
		dispatchId: value.dispatchId === null ? null : text(value.dispatchId),
		actualClaims: value.actualClaims === null ? null : claimList(value.actualClaims),
		identity: value.identity === null ? null : parseNamespaceIdentity(value.identity),
	});
}

function tombstone(raw: unknown): AuthorityTombstone {
	if (typeof raw !== "object" || raw === null) throw new VerifiedRunError("integrity");
	const value: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
	const retainedAtMs = integer(value.retainedAtMs);
	const expiresAtMs = integer(value.expiresAtMs);
	if (expiresAtMs <= retainedAtMs) throw new VerifiedRunError("integrity");
	return Object.freeze({
		commandId: text(value.commandId),
		grantSequence: seq(value.grantSequence),
		resultDigest: digest(value.resultDigest),
		retainedAtMs,
		expiresAtMs,
	});
}

function snapshotState(raw: unknown): AuthoritySnapshotState {
	if (typeof raw !== "object" || raw === null) throw new VerifiedRunError("integrity");
	const value: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
	if (!Array.isArray(value.incarnations) || !Array.isArray(value.grants) || !Array.isArray(value.tombstones))
		throw new VerifiedRunError("integrity");
	const grants = value.grants.map(grantRecord);
	const tombstones = value.tombstones.map(tombstone);
	const sequences = new Set(grants.map((grant) => grant.token.grantSequence));
	if (sequences.size !== grants.length) throw new VerifiedRunError("integrity");
	// grant commandIds are unique among grants; tombstone commandIds among
	// tombstones; a tombstone always references a retained grant (GC drops the
	// expired tombstone+grant pair together).
	if (new Set(grants.map((grant) => grant.commandId)).size !== grants.length) throw new VerifiedRunError("integrity");
	if (new Set(tombstones.map((stone) => stone.commandId)).size !== tombstones.length)
		throw new VerifiedRunError("integrity");
	for (const stone of tombstones) if (!sequences.has(stone.grantSequence)) throw new VerifiedRunError("integrity");
	return Object.freeze({
		epoch: seq(value.epoch),
		reconciledEpoch: value.reconciledEpoch === null ? null : seq(value.reconciledEpoch),
		incarnations: Object.freeze(
			value.incarnations.map((entry: unknown) => {
				if (typeof entry !== "object" || entry === null) throw new VerifiedRunError("integrity");
				const item: Record<string, unknown> = Object.fromEntries(Object.entries(entry));
				return Object.freeze({ sessionId: text(item.sessionId), incarnation: seq(item.incarnation) });
			}),
		),
		grantCounter: seq(value.grantCounter),
		grants: Object.freeze(grants),
		tombstones: Object.freeze(tombstones),
	});
}

export function parseAuthorityEvent(raw: unknown): AuthorityEvent {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new VerifiedRunError("integrity");
	const value: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
	switch (value.kind) {
		case "authority-epoch-advanced": {
			if (!Array.isArray(value.transitions) || value.transitions.length > 4096)
				throw new VerifiedRunError("integrity");
			const transitions = value.transitions.map((entry: unknown) => {
				if (typeof entry !== "object" || entry === null) throw new VerifiedRunError("integrity");
				const item: Record<string, unknown> = Object.fromEntries(Object.entries(entry));
				if (item.outcome !== "cancelled" && item.outcome !== "quarantined") throw new VerifiedRunError("integrity");
				return Object.freeze({ grantSequence: seq(item.grantSequence), outcome: item.outcome });
			});
			const seen = new Set(transitions.map((entry) => entry.grantSequence));
			if (seen.size !== transitions.length) throw new VerifiedRunError("integrity");
			return {
				kind: value.kind,
				authorityEpoch: seq(value.authorityEpoch),
				writerId: writerLabel(value.writerId),
				transitions: Object.freeze(transitions),
			};
		}
		case "authority-reconciled":
			return { kind: value.kind, authorityEpoch: seq(value.authorityEpoch) };
		case "session-registered":
			return { kind: value.kind, sessionId: text(value.sessionId), incarnation: seq(value.incarnation) };
		case "grant-reserved":
			return { kind: value.kind, grant: grantRecord(value.grant) };
		case "dispatch-intent":
			return {
				kind: value.kind,
				grantSequence: seq(value.grantSequence),
				authorityEpoch: seq(value.authorityEpoch),
				dispatchId: text(value.dispatchId),
			};
		case "effect-started":
			return {
				kind: value.kind,
				grantSequence: seq(value.grantSequence),
				authorityEpoch: seq(value.authorityEpoch),
				actualClaims: claimList(value.actualClaims),
				...(value.identity === undefined ? {} : { identity: parseNamespaceIdentity(value.identity) }),
			};
		case "cancel-requested":
		case "authorization-expired": {
			if (value.outcome !== "cancelled" && value.outcome !== "quarantined") throw new VerifiedRunError("integrity");
			return {
				kind: value.kind,
				grantSequence: seq(value.grantSequence),
				authorityEpoch: seq(value.authorityEpoch),
				outcome: value.outcome,
			};
		}
		case "quarantined":
			if (value.reason !== "restart") throw new VerifiedRunError("integrity");
			return {
				kind: value.kind,
				grantSequence: seq(value.grantSequence),
				authorityEpoch: seq(value.authorityEpoch),
				reason: value.reason,
			};
		case "termination-observed":
			return {
				kind: value.kind,
				grantSequence: seq(value.grantSequence),
				authorityEpoch: seq(value.authorityEpoch),
			};
		case "result-retained":
			return {
				kind: value.kind,
				commandId: text(value.commandId),
				grantSequence: seq(value.grantSequence),
				resultDigest: digest(value.resultDigest),
				retainedAtMs: integer(value.retainedAtMs),
				expiresAtMs: integer(value.expiresAtMs),
			};
		case "authority-snapshot":
			return {
				kind: value.kind,
				archivedThroughSequence: integer(value.archivedThroughSequence),
				continuesHash: digest(value.continuesHash),
				state: snapshotState(value.state),
			};
		default:
			throw new VerifiedRunError("integrity");
	}
}

function reduceAuthorityEvent(state: MutableAuthorityProjection, event: AuthorityEvent): void {
	switch (event.kind) {
		case "authority-epoch-advanced": {
			// An epoch may only advance once the previous epoch reconciled. The
			// transition set must cover every unsettled grant exactly once (S4).
			if (authorityPendingReconcile(state)) throw new VerifiedRunError("integrity");
			const expected = nextSeq(state.epoch ?? sequence("0"));
			if (event.authorityEpoch !== expected) throw new VerifiedRunError("integrity");
			const unsettled = new Set(
				[...state.grants.values()]
					.filter((grant) => !SETTLED_EFFECT_STATES.has(grant.state))
					.map((grant) => grant.token.grantSequence),
			);
			for (const transition of event.transitions) {
				const grant = state.grants.get(transition.grantSequence);
				if (!grant || !unsettled.has(transition.grantSequence)) throw new VerifiedRunError("integrity");
				const outcome = grant.effectLive ? "quarantined" : "cancelled";
				if (transition.outcome !== outcome) throw new VerifiedRunError("integrity");
				state.grants.set(transition.grantSequence, { ...grant, state: transition.outcome });
				unsettled.delete(transition.grantSequence);
			}
			if (unsettled.size !== 0) throw new VerifiedRunError("integrity");
			state.epoch = event.authorityEpoch;
			break;
		}
		case "authority-reconciled": {
			if (state.epoch === null || event.authorityEpoch !== state.epoch) throw new VerifiedRunError("integrity");
			if (!authorityPendingReconcile(state)) throw new VerifiedRunError("integrity");
			for (const grant of state.grants.values())
				if (!SETTLED_EFFECT_STATES.has(grant.state) && grant.state !== "quarantined")
					throw new VerifiedRunError("integrity");
			state.reconciledEpoch = event.authorityEpoch;
			break;
		}
		case "session-registered": {
			const current = state.incarnations.get(event.sessionId);
			const expected = current === undefined ? sequence("1") : nextSeq(current);
			if (event.incarnation !== expected) throw new VerifiedRunError("integrity");
			state.incarnations.set(event.sessionId, event.incarnation);
			break;
		}
		case "grant-reserved": {
			const grant = event.grant;
			if (authorityPendingReconcile(state) || state.epoch === null) throw new VerifiedRunError("integrity");
			if (
				grant.state !== "reserved" ||
				grant.effectLive ||
				grant.dispatchId !== null ||
				grant.actualClaims !== null ||
				grant.identity !== null ||
				grant.token.authorityEpoch !== state.epoch ||
				state.incarnations.get(grant.token.sessionId) !== grant.token.sessionIncarnation ||
				grant.token.grantSequence !== nextSeq(state.grantCounter) ||
				state.grants.has(grant.token.grantSequence) ||
				state.tombstones.has(grant.commandId) ||
				[...state.grants.values()].some((other) => other.commandId === grant.commandId) ||
				[...state.grants.values()].some(
					(other) =>
						!SETTLED_EFFECT_STATES.has(other.state) && claimSetsConflict([...grant.claims], [...other.claims]),
				)
			)
				throw new VerifiedRunError("integrity");
			state.grants.set(grant.token.grantSequence, grant);
			state.grantCounter = grant.token.grantSequence;
			break;
		}
		case "dispatch-intent": {
			const grant = state.grants.get(event.grantSequence);
			if (
				!grant ||
				grant.state !== "reserved" ||
				grant.token.authorityEpoch !== event.authorityEpoch ||
				event.authorityEpoch !== state.epoch ||
				[...state.grants.values()].some((other) => other.dispatchId === event.dispatchId)
			)
				throw new VerifiedRunError("integrity");
			// A committed intent may already have spawned: the effect is possibly
			// live until a termination witness says otherwise (docs/04 uncertainty
			// window), so effectLive is set here, not at effect-started.
			state.grants.set(event.grantSequence, {
				...grant,
				state: "starting",
				effectLive: true,
				dispatchId: event.dispatchId,
			});
			break;
		}
		case "effect-started": {
			const grant = state.grants.get(event.grantSequence);
			if (!grant || (grant.state !== "reserved" && grant.state !== "starting"))
				throw new VerifiedRunError("integrity");
			if (event.authorityEpoch !== state.epoch || grant.token.authorityEpoch !== event.authorityEpoch)
				throw new VerifiedRunError("integrity");
			if (event.identity !== undefined) {
				for (const other of state.grants.values()) {
					if (
						other.token.grantSequence !== event.grantSequence &&
						!SETTLED_EFFECT_STATES.has(other.state) &&
						other.identity &&
						other.identity.namespace === event.identity.namespace &&
						other.identity.pid === event.identity.pid &&
						other.identity.startTicks === event.identity.startTicks &&
						other.identity.bootId === event.identity.bootId
					)
						throw new VerifiedRunError("integrity");
				}
			}
			state.grants.set(event.grantSequence, {
				...grant,
				state: "running",
				effectLive: true,
				actualClaims: event.actualClaims,
				identity: event.identity ?? grant.identity,
			});
			break;
		}
		case "cancel-requested":
		case "authorization-expired":
		case "quarantined": {
			const grant = state.grants.get(event.grantSequence);
			if (!grant || SETTLED_EFFECT_STATES.has(grant.state)) throw new VerifiedRunError("integrity");
			if (event.authorityEpoch !== state.epoch) throw new VerifiedRunError("integrity");
			if (event.kind === "quarantined") {
				if (!grant.effectLive || grant.state === "quarantined") throw new VerifiedRunError("integrity");
				state.grants.set(event.grantSequence, { ...grant, state: "quarantined" });
			} else {
				const outcome = grant.effectLive ? "quarantined" : "cancelled";
				if (event.outcome !== outcome) throw new VerifiedRunError("integrity");
				state.grants.set(event.grantSequence, { ...grant, state: event.outcome });
			}
			break;
		}
		case "termination-observed": {
			const grant = state.grants.get(event.grantSequence);
			if (!grant || SETTLED_EFFECT_STATES.has(grant.state)) throw new VerifiedRunError("integrity");
			state.grants.set(event.grantSequence, { ...grant, effectLive: false, state: "terminated" });
			break;
		}
		case "result-retained": {
			const grant = state.grants.get(event.grantSequence);
			if (!grant || grant.commandId !== event.commandId) throw new VerifiedRunError("integrity");
			if (event.expiresAtMs <= event.retainedAtMs || state.tombstones.has(event.commandId))
				throw new VerifiedRunError("integrity");
			state.tombstones.set(
				event.commandId,
				Object.freeze({
					commandId: event.commandId,
					grantSequence: event.grantSequence,
					resultDigest: event.resultDigest,
					retainedAtMs: event.retainedAtMs,
					expiresAtMs: event.expiresAtMs,
				}),
			);
			break;
		}
		case "authority-snapshot":
			// Snapshots are archive boundaries, not stream events; the loader seeds
			// from them directly and rejects them mid-stream.
			throw new VerifiedRunError("integrity");
		default: {
			const exhaustive: never = event;
			throw new VerifiedRunError(String(exhaustive));
		}
	}
}

/** Deterministic replay over a seeded (post-snapshot) state. */
export function projectAuthority(
	events: readonly AuthorityEvent[],
	seed?: AuthoritySnapshotState,
): AuthorityProjection {
	const state: MutableAuthorityProjection = seed
		? {
				epoch: seed.epoch,
				reconciledEpoch: seed.reconciledEpoch,
				incarnations: new Map(seed.incarnations.map((entry) => [entry.sessionId, entry.incarnation])),
				grantCounter: seed.grantCounter,
				grants: new Map(seed.grants.map((grant) => [grant.token.grantSequence, grant])),
				tombstones: new Map(seed.tombstones.map((stone) => [stone.commandId, stone])),
			}
		: {
				epoch: null,
				reconciledEpoch: null,
				incarnations: new Map(),
				grantCounter: sequence("0"),
				grants: new Map(),
				tombstones: new Map(),
			};
	for (const event of events) reduceAuthorityEvent(state, event);
	return Object.freeze({
		epoch: state.epoch,
		reconciledEpoch: state.reconciledEpoch,
		incarnations: state.incarnations,
		grantCounter: state.grantCounter,
		grants: state.grants,
		tombstones: state.tombstones,
	});
}

/** Grants still holding claims — quarantined included (broker parity). */
export function activeAuthorityGrants(state: AuthorityProjection): readonly AuthorityGrantRecord[] {
	return [...state.grants.values()].filter((grant) => !SETTLED_EFFECT_STATES.has(grant.state));
}

/** Apply additional events to an existing projection (commit-time validation replay). */
export function applyAuthorityEvents(
	base: AuthorityProjection,
	events: readonly AuthorityEvent[],
): AuthorityProjection {
	const state: MutableAuthorityProjection = {
		epoch: base.epoch,
		reconciledEpoch: base.reconciledEpoch,
		incarnations: new Map(base.incarnations),
		grantCounter: base.grantCounter,
		grants: new Map(base.grants),
		tombstones: new Map(base.tombstones),
	};
	for (const event of events) reduceAuthorityEvent(state, event);
	return Object.freeze({
		epoch: state.epoch,
		reconciledEpoch: state.reconciledEpoch,
		incarnations: state.incarnations,
		grantCounter: state.grantCounter,
		grants: state.grants,
		tombstones: state.tombstones,
	});
}

export function snapshotFromProjection(state: AuthorityProjection): AuthoritySnapshotState {
	if (state.epoch === null) throw new VerifiedRunError("integrity");
	return Object.freeze({
		epoch: state.epoch,
		reconciledEpoch: state.reconciledEpoch,
		incarnations: Object.freeze(
			[...state.incarnations.entries()].map(([sessionId, incarnation]) => Object.freeze({ sessionId, incarnation })),
		),
		grantCounter: state.grantCounter,
		grants: Object.freeze([...state.grants.values()]),
		tombstones: Object.freeze([...state.tombstones.values()]),
	});
}
