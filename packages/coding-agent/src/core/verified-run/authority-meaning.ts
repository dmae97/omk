import { sameClaimSet } from "../../coordination/resource.ts";
import { type GrantToken, type ResourceClaim, SETTLED_EFFECT_STATES, type Sequence } from "../../coordination/types.ts";
import type { AuthorityEvent, AuthorityGrantRecord, AuthorityProjection } from "./authority-events.ts";
import { AuthorityStoreError } from "./authority-store.ts";

export function assertSameCommandMeaning(
	grant: AuthorityGrantRecord,
	request: {
		intentDigest: string;
		sessionId: string;
		incarnation: Sequence;
		claims: readonly ResourceClaim[];
		weight: number;
	},
): void {
	if (
		grant.intentDigest !== request.intentDigest ||
		grant.token.sessionId !== request.sessionId ||
		grant.token.sessionIncarnation !== request.incarnation ||
		!sameClaimSet([...grant.claims], [...request.claims]) ||
		grant.weight !== request.weight
	)
		throw new AuthorityStoreError("command_conflict");
}

export function sameGrantToken(left: GrantToken, right: GrantToken): boolean {
	return (
		left.authorityEpoch === right.authorityEpoch &&
		left.grantSequence === right.grantSequence &&
		left.sessionId === right.sessionId &&
		left.sessionIncarnation === right.sessionIncarnation &&
		left.authorizationDeadline === right.authorizationDeadline
	);
}

export function expiryEvents(state: AuthorityProjection, now: number, epoch: Sequence): AuthorityEvent[] {
	const expired: AuthorityEvent[] = [];
	for (const grant of state.grants.values()) {
		if (SETTLED_EFFECT_STATES.has(grant.state) || grant.state === "quarantined") continue;
		if (now < grant.token.authorizationDeadline) continue;
		expired.push({
			kind: "authorization-expired",
			grantSequence: grant.token.grantSequence,
			authorityEpoch: epoch,
			outcome: grant.effectLive ? "quarantined" : "cancelled",
		});
	}
	return expired;
}

export function authorizationStillOpen(now: number | undefined, deadline: number): boolean {
	if (now === undefined) return true;
	if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0)
		throw new TypeError("now must be a nonnegative safe integer");
	return now < deadline;
}
