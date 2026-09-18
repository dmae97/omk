import type { ResourceAdmissionDecision } from "./resource-admission.ts";
import type { LaneOutcome, SubagentLaneExecutionResult } from "./subagent-lane-contract.ts";
import type { SubagentOrchestrationPlan } from "./subagent-orchestration.ts";
import { WorkloadPermitError, type WorkloadPermitPool } from "./workload-permit-pool.ts";

/**
 * Subagent lane launch authority (OMK v0.97.x roadmap §14, M6/PR10).
 *
 * Turns `buildSubagentOrchestrationPlan()` output into enforced execution:
 * the §14.2 effective width is a hard cap on concurrently active children,
 * batches run in order (writer serialization / path conflicts are encoded in
 * the plan's batches, which supplies the `pathConflictFreeWidth` term), and
 * heavy lanes draw permits from the PARENT's shared pool (§14.1 — a child
 * never constructs its own pool here; it receives this launcher's budget).
 *
 * §14.3 guarantees: child failure releases its permit (leak 0), parent
 * abort aborts queued permit waits and never launches unstarted lanes, and
 * the child context carries the parent decision with a width the child
 * cannot raise (§14.4: no API exists to widen — the context is read-only).
 */

export interface EffectiveLaneWidthInput {
	readonly planWidth: number;
	readonly configuredMaxParallelLanes?: number;
	readonly admissionMaxParallelLanes: number;
	readonly availableHeavyPermits: number;
	/** Widest conflict-free batch; the plan's batching already serializes writers. */
	readonly pathConflictFreeWidth: number;
}

/** Zero authority defers execution; configured zero retains its legacy unlimited meaning. */
export function computeEffectiveLaneWidth(input: EffectiveLaneWidthInput): number {
	const configured =
		input.configuredMaxParallelLanes !== undefined && input.configuredMaxParallelLanes > 0
			? input.configuredMaxParallelLanes
			: Number.POSITIVE_INFINITY;
	const width = Math.min(
		input.planWidth,
		configured,
		input.admissionMaxParallelLanes,
		input.availableHeavyPermits,
		input.pathConflictFreeWidth,
	);
	return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}

/** Read-only budget handed to every child (§14.1). Nothing here can raise a cap. */
export interface SubagentLaneContext {
	readonly laneId: string;
	readonly promptRunId: string;
	readonly signal?: AbortSignal;
	readonly decision: ResourceAdmissionDecision;
	readonly effectiveLaneWidth: number;
}

export type { LaneOutcome };

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

export interface LaunchSubagentLanesResult {
	readonly outcomes: readonly LaneOutcome[];
	readonly effectiveLaneWidth: number;
	readonly maxObservedConcurrency: number;
}

/**
 * Heavy admission gate for the effective lane width. Omitted `heavyLaneIds`
 * preserves the legacy contract: remaining pool capacity gates the whole width.
 * An explicitly declared set narrows the gate to heavy work only (spec F06): a
 * light-only declaration or a mixed plan must not let the heavy pool stall light
 * lanes; mixed plans defer heavy lanes individually at permit acquisition.
 */
function computeHeavyAdmissionGate(
	poolSnapshot: { readonly capacity: number; readonly activeWeight: number },
	heavyLaneIds: ReadonlySet<string> | undefined,
	plan: SubagentOrchestrationPlan,
	maxHeavyProcesses: number,
): number {
	if (heavyLaneIds === undefined) return Math.max(0, poolSnapshot.capacity - poolSnapshot.activeWeight);
	if (heavyLaneIds.size === 0) return Number.POSITIVE_INFINITY;
	const allHeavy = plan.batches.every((batch) => batch.laneIds.every((id) => heavyLaneIds.has(id)));
	if (!allHeavy) return Number.POSITIVE_INFINITY;
	return Math.min(Math.max(0, poolSnapshot.capacity - poolSnapshot.activeWeight), maxHeavyProcesses);
}

/**
 * Execute a plan's batches with the §14.2 width as launcher authority.
 * Never throws for lane failures; the caller reads per-lane outcomes.
 */
export async function launchSubagentLanes(input: LaunchSubagentLanesInput): Promise<LaunchSubagentLanesResult> {
	const poolSnapshot = input.permitPool.snapshot();
	const heavyAdmission = computeHeavyAdmissionGate(
		poolSnapshot,
		input.heavyLaneIds,
		input.plan,
		input.decision.maxHeavyProcesses,
	);
	const effectiveLaneWidth = computeEffectiveLaneWidth({
		planWidth: input.plan.route.width,
		configuredMaxParallelLanes: input.configuredMaxParallelLanes,
		admissionMaxParallelLanes: input.decision.maxParallelLanes,
		availableHeavyPermits: heavyAdmission,
		pathConflictFreeWidth: Math.max(0, ...input.plan.batches.map((batch) => batch.laneIds.length)),
	});

	const outcomes: LaneOutcome[] = [];
	let active = 0;
	let maxObservedConcurrency = 0;

	for (const batch of input.plan.batches) {
		const blocked = outcomes.some((outcome) => outcome.status !== "completed");
		if (input.signal?.aborted || effectiveLaneWidth === 0 || blocked) {
			for (const laneId of batch.laneIds) {
				outcomes.push({
					laneId,
					status: input.signal?.aborted
						? "skipped-abort"
						: effectiveLaneWidth === 0
							? "admission-deferred"
							: "blocked-dependency",
				});
			}
			continue;
		}
		// Batches execute sequentially (dependency + writer serialization);
		// inside one batch, the effective width bounds the running children.
		let cursor = 0;
		const runners: Promise<void>[] = [];
		const runNext = async (): Promise<void> => {
			while (cursor < batch.laneIds.length) {
				const laneId = batch.laneIds[cursor];
				cursor += 1;
				if (input.signal?.aborted || outcomes.some((outcome) => outcome.status === "unsettled")) {
					outcomes.push({ laneId, status: input.signal?.aborted ? "skipped-abort" : "blocked-dependency" });
					continue;
				}
				outcomes.push(
					await runLane(input, laneId, effectiveLaneWidth, {
						blocked: () => outcomes.some((outcome) => outcome.status === "unsettled"),
						enter: () => {
							active += 1;
							maxObservedConcurrency = Math.max(maxObservedConcurrency, active);
						},
						exit: () => {
							active -= 1;
						},
					}),
				);
			}
		};
		const workers = Math.min(effectiveLaneWidth, batch.laneIds.length);
		for (let i = 0; i < workers; i++) {
			runners.push(runNext());
		}
		await Promise.all(runners);
	}
	return { outcomes, effectiveLaneWidth, maxObservedConcurrency };
}

async function runLane(
	input: LaunchSubagentLanesInput,
	laneId: string,
	effectiveLaneWidth: number,
	gauge: { readonly enter: () => void; readonly exit: () => void; readonly blocked: () => boolean },
): Promise<LaneOutcome> {
	let releasePermit: (() => void) | undefined;
	let retained = false;
	if (input.heavyLaneIds?.has(laneId)) {
		if (
			input.decision.action === "defer-heavy" ||
			input.permitPool.snapshot().capacity === 0 ||
			input.permitPool.snapshot().activeWeight >= input.decision.maxHeavyProcesses
		) {
			return { laneId, status: "admission-deferred" };
		}
		try {
			const permit = await input.permitPool.acquire({
				requestId: `lane-${laneId}`,
				promptRunId: input.promptRunId,
				workloadClass: "heavy",
				weight: 1,
				signal: input.signal,
				timeoutMs: input.permitWaitTimeoutMs ?? 60_000,
			});
			releasePermit = () => permit.release();
		} catch (error) {
			const code = error instanceof WorkloadPermitError ? error.code : "unknown";
			return {
				laneId,
				status: code === "aborted" ? "skipped-abort" : "permit-rejected",
				diagnostic: `permit.${code}`,
			};
		}
	}
	if (input.signal?.aborted || gauge.blocked()) {
		releasePermit?.();
		return { laneId, status: input.signal?.aborted ? "skipped-abort" : "blocked-dependency" };
	}
	gauge.enter();
	try {
		const result = await input.launchLane({
			laneId,
			promptRunId: input.promptRunId,
			signal: input.signal,
			decision: input.decision,
			effectiveLaneWidth,
		});
		if (result?.status === "unsettled") {
			retained = true;
			// A rejected settlement cannot prove termination; retain the reservation.
			void result.settlement.then(
				() => {
					gauge.exit();
					releasePermit?.();
				},
				() => {},
			);
			return { laneId, status: "unsettled" };
		}
		return { laneId, status: input.signal?.aborted ? "cancelled" : (result?.status ?? "completed") };
	} catch {
		// Child error text is untrusted and may contain credentials.
		return {
			laneId,
			status: input.signal?.aborted ? "cancelled" : "failed",
			diagnostic: "lane.execution_failed",
		};
	} finally {
		if (!retained) {
			gauge.exit();
			releasePermit?.();
		}
	}
}
