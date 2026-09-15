import type { CapabilityInventory } from "./loadouts.ts";
import { RESOURCE_ADMISSION_VERSION, type ResourceAdmissionDecision } from "./resource-admission.ts";
import type { SubagentLaneAuthority } from "./subagent-lane-contract.ts";
import { launchSubagentLanes } from "./subagent-lane-launcher.ts";
import { buildSubagentOrchestrationPlan } from "./subagent-orchestration.ts";

/**
 * Spec 020 Req1 — extension-facing subagent lane authority.
 *
 * A bound implementation is created by AgentSession and exposed to extension
 * tool contexts. It routes a caller's lane plan through the shared core
 * primitives (`buildSubagentOrchestrationPlan` → `launchSubagentLanes`) while
 * injecting the parent's admission decision, the shared `WorkloadPermitPool`,
 * and prompt-settlement child counters. Extensions must never raise parent
 * caps; `launchSubagentLanes` enforces the effective width as a floor of the
 * caller's configured cap and the parent's admission.
 */
export type {
	SubagentLaneAuthority,
	SubagentLaneAuthorityDispatchInput,
	SubagentLaneAuthorityDispatchResult,
} from "./subagent-lane-contract.ts";

/** Internal host binding the session supplies when constructing the authority. */
export interface SubagentLaneAuthorityHostBinding {
	readonly runId: string;
	readonly promptRunId?: string;
	readonly decision: ResourceAdmissionDecision | null;
	readonly permitPool: import("./workload-permit-pool.ts").WorkloadPermitPool;
	readonly inventory: CapabilityInventory;
	readonly signal?: AbortSignal;
	readonly spawnThreshold?: number;
	readonly noteDetachedChild: () => () => void;
}

/**
 * Bind a SubagentLaneAuthority to a session's admission decision, shared permit
 * pool, and prompt-settlement lifecycle. The returned authority's
 * dispatchLanes() enforces spec 020: the caller supplies lanes and a launcher;
 * the authority injects plan admission, the shared pool, and per-lane
 * settlement counters, and never lets the caller widen the parent's caps.
 */
export function createSubagentLaneAuthority(binding: SubagentLaneAuthorityHostBinding): SubagentLaneAuthority {
	const { runId, promptRunId, decision, permitPool, inventory, signal, spawnThreshold, noteDetachedChild } = binding;

	return {
		permitPool,
		activePromptRunId: promptRunId,
		getCurrentResourceAdmission: () => decision,
		noteDetachedChild,
		dispatchLanes: async (input) => {
			const plan = buildSubagentOrchestrationPlan({
				runId,
				lanes: input.lanes,
				inventory,
				spawnPlan: input.spawnPlan,
				spawnThreshold,
				maxParallelLanes: input.configuredMaxParallelLanes,
			});
			if (plan.blockers.length > 0) {
				return {
					outcomes: [],
					effectiveLaneWidth: 0,
					maxObservedConcurrency: 0,
					blockers: plan.blockers,
					warnings: plan.warnings,
				};
			}
			// §14.1: the caller's admission decision, if present, is authoritative.
			// Without one the launcher sees an unbounded parent (observe mode).
			const resolvedDecision =
				decision ??
				({
					schemaVersion: RESOURCE_ADMISSION_VERSION,
					decisionId: `admission-${runId}`,
					snapshotDigest: "none",
					pressure: "normal",
					action: "allow",
					maxToolConcurrency: Number.POSITIVE_INFINITY,
					maxParallelLanes: Number.POSITIVE_INFINITY,
					maxHeavyProcesses: Number.POSITIVE_INFINITY,
					reasons: [],
					decidedAt: new Date(0).toISOString(),
				} satisfies ResourceAdmissionDecision);

			const result = await launchSubagentLanes({
				plan,
				promptRunId: promptRunId ?? runId,
				decision: resolvedDecision,
				permitPool,
				configuredMaxParallelLanes: input.configuredMaxParallelLanes,
				signal: input.signal ?? signal,
				heavyLaneIds: input.heavyLaneIds,
				permitWaitTimeoutMs: input.permitWaitTimeoutMs,
				launchLane: async (context) => {
					// Spec 020 Req3.1/3.2 — child counter +1 immediately before the
					// admitted launch, -1 exactly once in terminal cleanup.
					const release = noteDetachedChild();
					try {
						await input.launchLane(context);
					} finally {
						release();
					}
				},
			});
			return {
				outcomes: result.outcomes,
				effectiveLaneWidth: result.effectiveLaneWidth,
				maxObservedConcurrency: result.maxObservedConcurrency,
				blockers: plan.blockers,
				warnings: plan.warnings,
			};
		},
	};
}
