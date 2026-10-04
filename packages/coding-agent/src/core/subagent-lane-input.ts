import type { ResourceAdmissionDecision } from "./resource-admission.ts";
import type { LaneOutcome, SubagentLaneExecutionResult } from "./subagent-lane-contract.ts";
import type { SubagentOrchestrationPlan } from "./subagent-orchestration.ts";
import type { WorkloadPermitPool } from "./workload-permit-pool.ts";

/**
 * Lane launch input contract.
 *
 * These types live in a leaf module because `lane-input-snapshot.ts` validates the
 * launcher's input: keeping them in `subagent-lane-launcher.ts` made the snapshot
 * import the launcher while the launcher imports the snapshot, which is an import
 * cycle (`scripts/check-import-cycles.mjs`). The launcher re-exports both types so
 * existing importers keep working.
 */

/** Read-only budget handed to every child (§14.1). Nothing here can raise a cap. */
export interface SubagentLaneContext {
	readonly laneId: string;
	readonly promptRunId: string;
	readonly signal?: AbortSignal;
	readonly decision: ResourceAdmissionDecision;
	readonly effectiveLaneWidth: number;
}

export interface LaunchSubagentLanesInput {
	readonly plan: SubagentOrchestrationPlan;
	readonly promptRunId: string;
	readonly decision: ResourceAdmissionDecision;
	readonly permitPool: WorkloadPermitPool;
	readonly configuredMaxParallelLanes?: number;
	readonly signal?: AbortSignal;
	/** Lane ids that run heavy work and must hold a shared permit (§14.3). */
	readonly heavyLaneIds?: ReadonlySet<string>;
	/** The actual child launcher (process spawn, SDK session, or test double). */
	readonly launchLane: (context: SubagentLaneContext) => Promise<SubagentLaneExecutionResult>;
	readonly permitWaitTimeoutMs?: number;
}

export type { LaneOutcome };
