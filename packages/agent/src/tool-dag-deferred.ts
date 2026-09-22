/**
 * Deferred-call bookkeeping for the dag-v2 ready frontier.
 *
 * A call yields its turn when its post-hook claims conflict with an unsettled or
 * running call. The stored resolution is only used to prove that conflict — a
 * deferral decision is "wait", so a stale answer executes nothing — while
 * admission always re-resolves, because dynamic resource identities may change
 * across the wait.
 */

import { conflictsWithUnsettledClaim } from "./tool-dag-scheduler.ts";
import type { ToolClaimResolution } from "./tool-resource-claims.ts";

export interface DeferredCall<Preparation> {
	readonly preparation: Preparation;
	readonly resolution: ToolClaimResolution;
}

/** The frontier's ready queue is already ordered, so a drift check exempts no peer. */
const NO_READY_PEERS: ReadonlySet<number> = new Set<number>();

/** True when the resolution still conflicts with an earlier unsettled or later running call. */
export function deferredStillConflicts(
	sourceIndex: number,
	resolution: ToolClaimResolution,
	settled: ReadonlySet<number>,
	running: ReadonlySet<number>,
	resolutions: ReadonlyMap<number, ToolClaimResolution>,
): boolean {
	return conflictsWithUnsettledClaim(sourceIndex, resolution, NO_READY_PEERS, settled, running, resolutions);
}
