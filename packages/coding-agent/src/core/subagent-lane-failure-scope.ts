import { isDefaultOnEnvFlag } from "./env-flag.ts";
import type { LaneOutcome } from "./subagent-lane-contract.ts";
import type { SubagentOrchestrationPlan } from "./subagent-orchestration.ts";

/**
 * Spec 106 C1 — settled-failure scope for subagent lanes.
 *
 * Default on (`OMK_LANE_FAILURE_SCOPE=0`/`false`/`off` opts out). Off ⇒ the legacy rule:
 * any non-completed outcome blocks every later batch.
 *
 * On ⇒ a settled `failed` outcome of a non-writing, parallelizable lane blocks
 * only lanes that (transitively) depend on it via the plan's effective
 * dependencies (`laneGrants[].dependsOn`, which already includes receipt
 * consumer edges). "Non-writing" = declared writeSet empty AND no
 * write-capable tool (edit, write, bash) in the grant; a missing/unknown
 * writeSet counts as a writer. All builtin loadouts currently grant write
 * tools, so today this rarely changes real behavior. Every other non-completed status (unsettled, cancelled,
 * permit-rejected, admission-deferred, skipped-abort) and any failure of a
 * writer keeps the legacy global block: a failed writer may leave partial
 * workspace changes, so "no edge" is not proof of independence.
 */
export function laneFailureScopeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return isDefaultOnEnvFlag(env.OMK_LANE_FAILURE_SCOPE);
}

/** Tools that can mutate the workspace; a lane granted any of them is a writer. */
const WRITE_CAPABLE_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "bash"]);

export interface LaneFailureScope {
	/** True when `laneId` must not start given the outcomes recorded so far. */
	readonly isBlocked: (laneId: string, outcomes: readonly LaneOutcome[]) => boolean;
}

export function createLaneFailureScope(plan: SubagentOrchestrationPlan, isolate: boolean): LaneFailureScope {
	const grants = new Map(plan.laneGrants.map((grant) => [grant.laneId, grant]));
	const isolable = (laneId: string): boolean => {
		const grant = grants.get(laneId);
		if (grant === undefined || !grant.scheduler.parallelizable) return false;
		// Unknown/missing writeSet ⇒ writer.
		if (!Array.isArray(grant.scheduler.writeSet) || grant.scheduler.writeSet.length > 0) return false;
		return !grant.tools.some((tool) => WRITE_CAPABLE_TOOLS.has(tool));
	};
	const ancestors = (laneId: string): Set<string> => {
		const seen = new Set<string>();
		const stack = [...(grants.get(laneId)?.dependsOn ?? [])];
		while (stack.length > 0) {
			const id = stack.pop()!;
			if (seen.has(id)) continue;
			seen.add(id);
			stack.push(...(grants.get(id)?.dependsOn ?? []));
		}
		return seen;
	};
	return {
		isBlocked(laneId, outcomes) {
			const bad = outcomes.filter((outcome) => outcome.status !== "completed");
			if (bad.length === 0) return false;
			if (!isolate) return true;
			if (bad.some((outcome) => outcome.status !== "failed" || !isolable(outcome.laneId))) return true;
			const upstream = ancestors(laneId);
			return bad.some((outcome) => upstream.has(outcome.laneId));
		},
	};
}

/** Overall result: complete only when every lane completed (no false completion). */
export function allLanesCompleted(outcomes: readonly LaneOutcome[]): boolean {
	return outcomes.length > 0 && outcomes.every((outcome) => outcome.status === "completed");
}
