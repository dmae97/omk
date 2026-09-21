/**
 * In-process admission broker for parallel sessions.
 *
 * Safety property: a grant that may still own a live external effect keeps
 * holding its claims. Expiry, cancellation and authority restart are
 * authorization events; only a trusted supervisor reporting termination frees
 * the claims. Treating a lapsed deadline as "the effect stopped" is exactly how
 * two sessions end up writing the same path.
 *
 * Bounded reference semantics: a single trusted state machine, canonical claim
 * keys, and every shared effect crossing this broker. No IPC, no OS fencing,
 * no persistence — those belong to the supervisor this broker reports to.
 */

import { canonicalClaim, claimSetsConflict, sameClaimSet } from "./resource.ts";
import type { EffectState, GrantToken, ResourceClaim, Sequence } from "./types.ts";
import { nextSequence, SETTLED_EFFECT_STATES, sequence } from "./types.ts";

interface Grant {
	readonly token: GrantToken;
	readonly claims: readonly ResourceClaim[];
	readonly weight: number;
	state: EffectState;
	/** True once an external effect may exist. Never inferred from the clock. */
	effectLive: boolean;
}

export interface AdmissionBrokerOptions {
	/** Total admissible weight of concurrently active grants. */
	readonly capacity: number;
}

export interface AcquireInput {
	readonly sessionId: string;
	readonly incarnation: Sequence | string;
	readonly claims: readonly ResourceClaim[];
	readonly now: number;
	readonly ttl: number;
	readonly weight?: number;
}

export interface StartInput {
	readonly token: GrantToken;
	readonly now: number;
	/** Claims the operation actually resolved to after approval hooks. */
	readonly actualClaims: readonly ResourceClaim[];
}

function assertNonNegativeInteger(value: number, label: string): void {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a nonnegative safe integer`);
	}
}

export class AdmissionBroker {
	private readonly capacity: number;
	private authorityEpoch: Sequence = sequence("1");
	private grantCounter: Sequence = sequence("0");
	private readonly incarnations = new Map<string, Sequence>();
	private readonly grants = new Map<string, Grant>();

	constructor(options: AdmissionBrokerOptions) {
		assertNonNegativeInteger(options.capacity, "capacity");
		this.capacity = options.capacity;
	}

	/**
	 * Announce a session incarnation. Re-registering does not free the previous
	 * incarnation's grants: a restarted session cannot assume its predecessor's
	 * effects stopped.
	 */
	register(sessionId: string): Sequence {
		if (typeof sessionId !== "string" || sessionId.length === 0) {
			throw new TypeError("sessionId must be a non-empty string");
		}
		const next = nextSequence(this.incarnations.get(sessionId) ?? sequence("0"));
		this.incarnations.set(sessionId, next);
		return next;
	}

	/** Grants still holding their claims, including quarantined ones. */
	private activeGrants(): Grant[] {
		return [...this.grants.values()].filter((g) => !SETTLED_EFFECT_STATES.has(g.state));
	}

	acquire(input: AcquireInput): GrantToken | null {
		assertNonNegativeInteger(input.now, "now");
		const weight = input.weight ?? 1;
		assertNonNegativeInteger(weight, "weight");
		if (!Number.isSafeInteger(input.ttl) || input.ttl <= 0) {
			throw new TypeError("ttl must be a positive safe integer");
		}
		const authorizationDeadline = input.now + input.ttl;
		if (!Number.isSafeInteger(authorizationDeadline)) throw new RangeError("authorization deadline overflow");
		const incarnation = sequence(input.incarnation);
		if (this.incarnations.get(input.sessionId) !== incarnation) {
			throw new TypeError("stale session incarnation");
		}
		if (!Array.isArray(input.claims) || input.claims.length === 0) {
			throw new TypeError("an unknown scope must not be admitted as an empty scope");
		}
		// Take owned, validated snapshots before any state mutation.
		const claims = Array.from(input.claims, (claim) => canonicalClaim(claim));

		// Settle lapsed authorizations first; this never evicts a live effect.
		this.expire(input.now);
		const active = this.activeGrants();
		const used = active.reduce((sum, g) => sum + g.weight, 0);
		if (weight > this.capacity - used) return null;
		if (active.some((g) => claimSetsConflict(claims, g.claims))) return null;

		this.grantCounter = nextSequence(this.grantCounter);
		const token: GrantToken = Object.freeze({
			authorityEpoch: this.authorityEpoch,
			grantSequence: this.grantCounter,
			sessionId: input.sessionId,
			sessionIncarnation: incarnation,
			authorizationDeadline,
		});
		this.grants.set(token.grantSequence, {
			token,
			claims: Object.freeze(claims),
			weight,
			state: "reserved",
			effectLive: false,
		});
		return token;
	}

	/** Resolve a token that is still authoritative for new action. */
	private authoritative(token: GrantToken): Grant | undefined {
		const grant = this.grants.get(token.grantSequence);
		if (grant === undefined || !sameToken(grant.token, token)) return undefined;
		if (token.authorityEpoch !== this.authorityEpoch) return undefined;
		if (this.incarnations.get(token.sessionId) !== token.sessionIncarnation) return undefined;
		if (SETTLED_EFFECT_STATES.has(grant.state)) return undefined;
		return grant;
	}

	/** Resolve a token for settlement only; accepts superseded epochs. */
	private settleable(token: GrantToken): Grant | undefined {
		const grant = this.grants.get(token.grantSequence);
		if (grant === undefined || !sameToken(grant.token, token)) return undefined;
		return SETTLED_EFFECT_STATES.has(grant.state) ? undefined : grant;
	}

	/**
	 * Bind an effect to its reservation. The actual claims must equal the
	 * reserved set exactly — an approval hook that widened scope has to be
	 * re-admitted, not silently allowed to run under the old grant.
	 */
	start(input: StartInput): boolean {
		assertNonNegativeInteger(input.now, "now");
		const grant = this.authoritative(input.token);
		if (grant === undefined || grant.state !== "reserved") return false;
		if (input.now >= grant.token.authorizationDeadline) return false;
		if (!Array.isArray(input.actualClaims)) throw new TypeError("actualClaims must be an array");
		const actualClaims = Array.from(input.actualClaims, (claim) => canonicalClaim(claim));
		if (!sameClaimSet(actualClaims, grant.claims)) return false;
		grant.state = "running";
		grant.effectLive = true;
		return true;
	}

	/**
	 * Apply lapsed authorization deadlines. A reservation that never started is
	 * released; a running effect is quarantined and keeps its claims.
	 */
	expire(now: number): void {
		assertNonNegativeInteger(now, "now");
		for (const grant of this.activeGrants()) {
			if (now >= grant.token.authorizationDeadline) {
				grant.state = grant.effectLive ? "quarantined" : "cancelled";
			}
		}
	}

	/** Withdraw authorization. Requested cancellation is not observed termination. */
	cancel(token: GrantToken): boolean {
		const grant = this.settleable(token);
		if (grant === undefined) return false;
		grant.state = grant.effectLive ? "quarantined" : "cancelled";
		return true;
	}

	/**
	 * Trusted supervisor event: this exact effect is gone. Accepted for
	 * superseded epochs so a restarted authority can still settle what the
	 * previous one started, never to authorize new work.
	 */
	confirmTerminated(token: GrantToken): boolean {
		const grant = this.settleable(token);
		if (grant === undefined) return false;
		grant.effectLive = false;
		grant.state = "terminated";
		return true;
	}

	/** Fence the authority. Live effects stay quarantined until confirmed. */
	restart(): void {
		this.authorityEpoch = nextSequence(this.authorityEpoch);
		for (const grant of this.activeGrants()) {
			grant.state = grant.effectLive ? "quarantined" : "cancelled";
		}
	}

	stateOf(token: GrantToken): EffectState | undefined {
		const grant = this.grants.get(token.grantSequence);
		return grant !== undefined && sameToken(grant.token, token) ? grant.state : undefined;
	}

	claimsOf(token: GrantToken): readonly ResourceClaim[] {
		const grant = this.grants.get(token.grantSequence);
		return grant !== undefined && sameToken(grant.token, token) ? grant.claims : [];
	}

	/** Invariant: active grants fit capacity and never pairwise conflict. */
	isSafe(): boolean {
		const active = this.activeGrants();
		if (active.reduce((sum, g) => sum + g.weight, 0) > this.capacity) return false;
		for (const [index, grant] of active.entries()) {
			for (const other of active.slice(index + 1)) {
				if (claimSetsConflict(grant.claims, other.claims)) return false;
			}
		}
		return true;
	}
}

function sameToken(a: GrantToken, b: GrantToken): boolean {
	return (
		a.authorityEpoch === b.authorityEpoch &&
		a.grantSequence === b.grantSequence &&
		a.sessionId === b.sessionId &&
		a.sessionIncarnation === b.sessionIncarnation &&
		a.authorizationDeadline === b.authorizationDeadline
	);
}
