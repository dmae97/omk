import { isDefaultOnEnvFlag } from "./env-flag.ts";
import { appendRunLog } from "./run-log.ts";
import type { LaneOutcome } from "./subagent-lane-contract.ts";
import type { LaneFailureScope } from "./subagent-lane-failure-scope.ts";
import { laneGrantsConflict, type SubagentOrchestrationPlan } from "./subagent-orchestration.ts";

/**
 * Spec 106 DG2 — ready frontier for subagent lanes.
 *
 * Default on (`OMK_LANE_READY_QUEUE=0`/`false`/`off` opts out; name from spec 106 §1). Off ⇒
 * the launcher keeps its batch loop and `Promise.all` barrier unchanged.
 *
 * On ⇒ a lane starts as soon as (in plan source order, at most `width` lanes
 * in flight):
 * - every effective dependency (`laneGrants[].dependsOn`, incl. receipt
 *   consumer edges) settled `completed`;
 * - the failure scope (C1, flag-aware) does not block it given ALL settled
 *   outcomes so far (flag off ⇒ any non-completed outcome blocks new starts);
 * - no earlier-ordered lane that it conflicts with is still unsettled.
 *   Conflict = read/write path intersection, or either lane is not
 *   parallelizable (serialized writer). This keeps the plan's writer
 *   serialization and its order between conflicting lanes;
 * - no lane is retained `unsettled` (its reservation still holds).
 * Abort ⇒ unstarted lanes are `skipped-abort`. Lanes never made ready are
 * `blocked-dependency`.
 */
export function laneReadyFrontierEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return isDefaultOnEnvFlag(env.OMK_LANE_READY_QUEUE);
}

export interface ReadyFrontierInput {
	readonly plan: SubagentOrchestrationPlan;
	readonly width: number;
	readonly failureScope: LaneFailureScope;
	readonly signal?: AbortSignal;
	/** Appended in settlement order; the launcher sorts by source order. */
	readonly outcomes: LaneOutcome[];
	readonly runLane: (laneId: string) => Promise<LaneOutcome>;
	readonly hasUnsettled: () => boolean;
}

export interface ReadyFrontierStats {
	/**
	 * Lanes never started because of a failure (C1 scope block, or left
	 * unreachable after a non-completed outcome). Count only; A/B covariate.
	 */
	readonly notStartedDueToFailure: number;
}

const NOT_FAILURE: ReadonlySet<LaneOutcome["status"]> = new Set([
	"completed",
	"cancelled",
	"skipped-abort",
	"unsettled",
]);

export function runReadyFrontier(input: ReadyFrontierInput): Promise<ReadyFrontierStats> {
	const order = input.plan.batches.flatMap((batch) => batch.laneIds);
	const grants = new Map(input.plan.laneGrants.map((grant) => [grant.laneId, grant]));
	const settled = new Map<string, LaneOutcome["status"]>();
	const inFlight = new Set<string>();
	const pending = [...order];
	// Outcomes of lanes that actually ran. Frontier-generated `blocked-dependency`
	// outcomes are excluded so a C1-isolated block does not escalate to a
	// global one (the batch loop never fed same-batch blocks back either).
	const ran: LaneOutcome[] = [];
	let notStartedDueToFailure = 0;

	const conflicts = (left: string, right: string): boolean => {
		const a = grants.get(left);
		const b = grants.get(right);
		// Unknown grant ⇒ treat as conflicting (conservative).
		if (a === undefined || b === undefined) return true;
		if (!a.scheduler.parallelizable || !b.scheduler.parallelizable) return true;
		return laneGrantsConflict(a, b);
	};

	return new Promise<ReadyFrontierStats>((resolve) => {
		const finish = (laneId: string, outcome: LaneOutcome) => {
			settled.set(laneId, outcome.status);
			input.outcomes.push(outcome);
		};
		const pump = (): void => {
			let index = 0;
			while (index < pending.length) {
				const laneId = pending[index];
				if (input.signal?.aborted) {
					pending.splice(index, 1);
					finish(laneId, { laneId, status: "skipped-abort" });
					continue;
				}
				const unsettledBlock = input.hasUnsettled();
				if (unsettledBlock || input.failureScope.isBlocked(laneId, ran)) {
					if (!unsettledBlock) notStartedDueToFailure += 1;
					pending.splice(index, 1);
					finish(laneId, { laneId, status: "blocked-dependency" });
					continue;
				}
				const deps = grants.get(laneId)?.dependsOn ?? [];
				const depsDone = deps.every((dep) => settled.get(dep) === "completed");
				const position = order.indexOf(laneId);
				const conflictWaiting = order
					.slice(0, position)
					.some((earlier) => !settled.has(earlier) && conflicts(earlier, laneId));
				if (!depsDone || conflictWaiting || inFlight.size >= input.width) {
					index += 1;
					continue;
				}
				pending.splice(index, 1);
				inFlight.add(laneId);
				void input
					.runLane(laneId)
					.then(
						(outcome) => outcome,
						(): LaneOutcome => ({ laneId, status: "failed", diagnostic: "lane.execution_failed" }),
					)
					.then((outcome) => {
						inFlight.delete(laneId);
						ran.push(outcome);
						finish(laneId, outcome);
						pump();
					});
			}
			if (inFlight.size === 0) {
				// Nothing running and nothing startable: remaining lanes can never become ready.
				// Same rule as the batch arm: abort- and unsettled-held lanes are not failures.
				const failureSeen = !input.signal?.aborted && ran.some((outcome) => !NOT_FAILURE.has(outcome.status));
				for (const laneId of pending.splice(0)) {
					if (failureSeen && !input.hasUnsettled()) notStartedDueToFailure += 1;
					finish(laneId, { laneId, status: "blocked-dependency" });
				}
				resolve({ notStartedDueToFailure });
			}
		};
		pump();
	});
}

/** Run-log file name (`<OMK_RUN_LOG_DIR>/subagent-lane-frontier.jsonl`) for the DG2 A/B covariate. */
export const LANE_FRONTIER_RUN_LOG = "subagent-lane-frontier";

/**
 * Spec 106 §2a: counts only (A/B covariate); no lane ids or text. Written by
 * the frontier (`frontier: true`) and, with C1 on, by the batch loop.
 */
export function logReadyFrontier(
	notStartedDueToFailure: number,
	lanes: number,
	failureScope: boolean,
	frontier: boolean,
): void {
	appendRunLog(LANE_FRONTIER_RUN_LOG, { lanes, notStartedDueToFailure, failureScope, frontier });
}
