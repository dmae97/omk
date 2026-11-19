import { SETTLED_EFFECT_STATES, type Sequence } from "../../coordination/types.ts";
import { type AuthorityGrantRecord, type AuthorityProjection, snapshotFromProjection } from "./authority-events.ts";

/** Retaining evidence never changes a grant token or a result's original expiry. */
export function compactedAuthority(
	state: AuthorityProjection,
	now: number,
	retainGrant?: (grant: AuthorityGrantRecord) => boolean,
) {
	const keep = new Set<Sequence>();
	for (const grant of state.grants.values())
		if (!SETTLED_EFFECT_STATES.has(grant.state) || retainGrant?.(grant)) keep.add(grant.token.grantSequence);
	const tombstones = [...state.tombstones.values()].filter(
		(stone) => stone.expiresAtMs > now || keep.has(stone.grantSequence),
	);
	for (const stone of tombstones) keep.add(stone.grantSequence);
	const grants = [...state.grants.values()].filter((grant) => keep.has(grant.token.grantSequence));
	return {
		dropped: state.grants.size - grants.length + state.tombstones.size - tombstones.length,
		snapshot: snapshotFromProjection({
			...state,
			grants: new Map(grants.map((grant) => [grant.token.grantSequence, grant])),
			tombstones: new Map(tombstones.map((stone) => [stone.commandId, stone])),
		}),
	};
}
