/**
 * Shared subagent-lane contract types (OMK v0.97.x roadmap §14, M6/PR10).
 *
 * A leaf module: it imports only `resource-admission`, `workload-permit-pool`,
 * and `loadouts`, none of which reach back into the extensions graph. The lane
 * orchestrator, launcher, and runtime re-export these declarations, so this
 * file stays the single definition site for each name.
 *
 * Why the split exists: `extensions/types.ts` declares the extension-facing
 * lane-authority accessor, so it must be able to name `SubagentLaneAuthority`.
 * With the authority declared beside its runtime it could only be referenced
 * by importing `subagent-lane-authority.ts`, which reaches `loadout-runtime` →
 * `resource-loader` → `extensions/loader` → `extensions/types.ts` and closed an
 * import cycle across 11 modules. Naming the contract here instead keeps the
 * dependency pointing at a leaf and leaves the runtime where it belongs.
 */

import type { LoadoutAuthority } from "./loadouts.ts";
import type { ResourceAdmissionDecision } from "./resource-admission.ts";
import type { WorkloadPermitPool } from "./workload-permit-pool.ts";

export type SubagentOrchestrationRole =
	| "planner"
	| "architect"
	| "executor"
	| "critic"
	| "visual-qa"
	| "rhwp-doc"
	| "security"
	| "package-maintainer";

/** How much of the parent context a child lane inherits. */
export type LaneContextInheritanceMode = "none" | "receipt" | "last-turn" | "bounded" | "full";

export interface LaneOutcome {
	readonly laneId: string;
	readonly status: "completed" | "failed" | "cancelled" | "skipped-abort" | "permit-rejected" | "admission-deferred";
	readonly diagnostic?: string;
}

/** The spawn-plan receipt a caller supplies to justify parallel lane work. */
export interface LaneSpawnReceipt {
	whyParallel: string;
	whyNotLocal: string;
	independence: string;
	expectedReceiptShape: string;
	maxInlineTokens: number;
}

export interface SubagentLaneSpec {
	readonly id: string;
	readonly role: SubagentOrchestrationRole;
	readonly task: string;
	readonly dependsOn?: readonly string[];
	readonly readScope?: readonly string[];
	readonly writeScope?: readonly string[];
	readonly acceptance?: readonly string[];
	readonly evidenceOutput?: string;
	readonly blockedPaths?: readonly string[];
	readonly contextInheritance?: LaneContextInheritanceMode;
	readonly grantAuthority?: LoadoutAuthority;
	readonly loadoutName?: string;
	readonly agentName?: string;
}

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
export interface SubagentLaneAuthorityDispatchInput {
	readonly lanes: readonly SubagentLaneSpec[];
	/** Why this is parallel / why not local / independence / receipt shape — spawn-plan receipt for gating. */
	readonly spawnPlan?: LaneSpawnReceipt;
	/** Caller's configured parallel cap (never widens the parent admission cap). */
	readonly configuredMaxParallelLanes?: number;
	/** Lane ids that run heavy work and must hold a shared §14.3 permit. */
	readonly heavyLaneIds?: ReadonlySet<string>;
	/** Actual child launcher (process spawn / SDK session / test double). Called per admitted lane. */
	readonly launchLane: (context: {
		readonly laneId: string;
		readonly promptRunId: string;
		readonly signal?: AbortSignal;
		readonly decision: ResourceAdmissionDecision;
		readonly effectiveLaneWidth: number;
	}) => Promise<void>;
	readonly signal?: AbortSignal;
	readonly permitWaitTimeoutMs?: number;
}

export interface SubagentLaneAuthorityDispatchResult {
	readonly outcomes: readonly LaneOutcome[];
	readonly effectiveLaneWidth: number;
	readonly maxObservedConcurrency: number;
	readonly blockers: readonly string[];
	readonly warnings: readonly string[];
}

export interface SubagentLaneAuthority {
	/** §14.1 seam — the session's shared heavy-work pool. Never construct a private one. */
	readonly permitPool: WorkloadPermitPool;
	/** §14.4 read-only — the most recent resource admission decision for this prompt, if any. */
	getCurrentResourceAdmission(): ResourceAdmissionDecision | null;
	/** Current active prompt run id for settlement counters, if a run is open. */
	readonly activePromptRunId: string | undefined;
	/**
	 * §16.5 settlement counter — +1 before an admitted child launch, -1 in
	 * terminal cleanup. Returns a release closure; call it exactly once.
	 */
	noteDetachedChild(): () => void;
	/**
	 * Route a caller's lane plan through the shared launcher with the parent's
	 * admission decision and pool injected. `launchLane` is invoked per admitted
	 * lane; the authority wraps it with settlement counters.
	 */
	dispatchLanes(input: SubagentLaneAuthorityDispatchInput): Promise<SubagentLaneAuthorityDispatchResult>;
}
