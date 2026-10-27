/**
 * Lane plan observation (run log only, no flag): `<OMK_RUN_LOG_DIR>/lane-plan.jsonl`.
 * One line per launched plan, written whatever OMK_LANE_FAILURE_SCOPE / OMK_LANE_READY_QUEUE
 * say, so a flag-off run can count tasks whose plan has two or more independent branches.
 * Numbers and booleans only (plus session ids): no lane ids, names or task text.
 * Never changes scheduling; a no-op when the run log is off; errors are swallowed.
 */
import { appendRunLog, RUN_LOG_DIR_ENV } from "./run-log.ts";
import { laneFailureScopeEnabled } from "./subagent-lane-failure-scope.ts";
import type { LaunchSubagentLanesInput } from "./subagent-lane-input.ts";
import { laneReadyFrontierEnabled } from "./subagent-lane-ready-frontier.ts";
import type { SubagentOrchestrationPlan } from "./subagent-orchestration.ts";
import { editParentSessionId } from "./tools/edit-match-observe.ts";

export const LANE_PLAN_RUN_LOG = "lane-plan";
/** Max sessions whose seq counter is kept; least recently used is evicted beyond this. */
export const LANE_PLAN_SEQ_SESSION_CAP = 1000;

const seqBySession = new Map<string | null, number>();

function nextSeq(sessionId: string | null): number {
	const seq = (seqBySession.get(sessionId) ?? 0) + 1;
	seqBySession.delete(sessionId);
	seqBySession.set(sessionId, seq);
	while (seqBySession.size > LANE_PLAN_SEQ_SESSION_CAP) {
		seqBySession.delete(seqBySession.keys().next().value as string | null);
	}
	return seq;
}

/** Test hook: number of sessions currently tracked. */
export function lanePlanSeqSessionCount(): number {
	return seqBySession.size;
}

/** Plan shape: lane count, widest batch, and lanes with no in-plan dependency. */
export function lanePlanShape(plan: SubagentOrchestrationPlan): {
	lanes: number;
	maxBatchLanes: number;
	dependencyRoots: number;
} {
	const ids = new Set(plan.batches.flatMap((batch) => batch.laneIds));
	const deps = new Map(plan.laneGrants.map((grant) => [grant.laneId, grant.dependsOn ?? []]));
	let dependencyRoots = 0;
	for (const id of ids) if (!(deps.get(id) ?? []).some((dep) => ids.has(dep) && dep !== id)) dependencyRoots += 1;
	const maxBatchLanes = plan.batches.reduce((width, batch) => Math.max(width, batch.laneIds.length), 0);
	return { lanes: ids.size, maxBatchLanes, dependencyRoots };
}

/** Append the `lane-plan` line and return `input` unchanged. */
export function observeLanePlan<T extends LaunchSubagentLanesInput>(input: T, env: NodeJS.ProcessEnv = process.env): T {
	if (!env[RUN_LOG_DIR_ENV]?.trim()) return input;
	try {
		const sessionId = typeof input.sessionId === "string" && input.sessionId ? input.sessionId : null;
		appendRunLog(
			LANE_PLAN_RUN_LOG,
			{
				event: "lane-plan",
				seq: nextSeq(sessionId),
				sessionId,
				parentSessionId: editParentSessionId(env),
				...lanePlanShape(input.plan),
				flags: { failureScope: laneFailureScopeEnabled(env), readyQueue: laneReadyFrontierEnabled(env) },
			},
			{ env },
		);
	} catch {
		// Observation must never change lane scheduling.
	}
	return input;
}
