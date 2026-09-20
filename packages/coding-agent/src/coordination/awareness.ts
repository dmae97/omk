/**
 * Change awareness: what a change invalidates, and who may proceed next.
 *
 * Both functions are deliberately conservative. Invalidation treats an
 * unmapped dependent as affected, because "we have no edge for it" is not
 * evidence that it is unaffected. Frontier admission lets an unrelated
 * follower pass a blocked leader, but never lets a later request that
 * conflicts with an older waiting one jump ahead of it.
 */

import { claimSetsConflict } from "./resource.ts";
import type { ResourceClaim } from "./types.ts";

export interface WaitingRequest {
	readonly requestId: string;
	readonly claims: readonly ResourceClaim[];
}

/**
 * Transitive closure over reverse dependencies.
 *
 * `unknownDependents` are nodes whose dependencies could not be resolved; they
 * join the affected set rather than being assumed safe. Reaching a fixpoint
 * terminates on cycles because the set only grows and is bounded by the graph.
 */
export function invalidate(
	dependencies: Readonly<Record<string, readonly string[]>>,
	changed: readonly string[],
	unknownDependents: readonly string[] = [],
): Set<string> {
	const affected = new Set<string>([...changed, ...unknownDependents]);
	for (;;) {
		let grew = false;
		for (const [node, deps] of Object.entries(dependencies)) {
			if (affected.has(node)) continue;
			if (deps.some((dep) => affected.has(dep))) {
				affected.add(node);
				grew = true;
			}
		}
		if (!grew) return affected;
	}
}

/**
 * Requests admissible right now, in queue order.
 *
 * A request is admitted only when it conflicts neither with the active claims
 * nor with any earlier waiting request. Accumulating earlier claims — whether
 * or not they were admitted — is what stops a stream of later readers from
 * starving an older writer. Capacity fairness is not modelled here.
 */
export function admissibleFrontier(waiting: readonly WaitingRequest[], active: readonly ResourceClaim[]): string[] {
	const chosen: string[] = [];
	const reserved: ResourceClaim[] = [...active];
	const earlier: ResourceClaim[] = [];
	for (const request of waiting) {
		if (!claimSetsConflict(request.claims, reserved) && !claimSetsConflict(request.claims, earlier)) {
			chosen.push(request.requestId);
			reserved.push(...request.claims);
		}
		earlier.push(...request.claims);
	}
	return chosen;
}
