/**
 * Observation mode — §13 "기존 완료 판정 호출부: 메타상태를 진단으로 첨부,
 * 최종 승인·검증 영수증은 기존 권위에 둠."
 *
 * Produces a serializable diagnostic snapshot for the host to attach at a
 * completion/verification boundary. It never mutates the run, never issues a
 * receipt, and never changes `verified` — it only reports what the
 * metacognition state saw at that checkpoint.
 */
import { type CheckpointResult, checkpoint } from "./checkpoint.ts";
import type { ActionConstraints, MetaAction } from "./policy.ts";
import { DEFAULT_ACTION_CONSTRAINTS } from "./policy.ts";
import { mismatchSummary } from "./predictions.ts";
import type { MetaState } from "./state.ts";
import {
	createInitialMetaState,
	type InitialMetaStateInput,
	type MetaBudgetInput,
	type MetaRunBudgetProjection,
	metaBudgetFromRunBudget,
	refreshMetaBudget,
	stateFingerprint,
} from "./state.ts";
import { integer } from "./validation.ts";

export interface MetaDiagnostic {
	readonly schema: "omk.metacognition.diagnostic.v1";
	readonly taskId: string;
	readonly stageId: string;
	readonly stateFingerprint: string;
	readonly finishKind: "continue" | "verified-completion" | "inconclusive";
	readonly finishReason?: string;
	readonly proposedAction: MetaActionKindLabel;
	readonly openRequiredObligations: number;
	readonly violatedObligations: number;
	readonly blockedHighRiskCandidates: number;
	readonly unresolvedMismatches: number;
	readonly verifierBlindSpots: number;
	readonly runnerHealth: MetaState["verifier"]["runnerHealth"];
	readonly calibrationDemoted: number;
	readonly checkpointCount: number;
}
type MetaActionKindLabel = MetaAction["kind"];

/** Observation-mode diagnostic. Read-only over MetaState — no side effects. */
export function attachMetaDiagnostics(state: MetaState, constraints: ActionConstraints, nowMs: number): MetaDiagnostic {
	integer(nowMs, "nowMs");
	const result = checkpoint({ state, nowMs, constraints });
	return toDiagnostic(state, result);
}

/** Project a checkpoint result into the diagnostic record. */
export function toDiagnostic(state: MetaState, result: CheckpointResult): MetaDiagnostic {
	const mismatches = mismatchSummary(state.predictions);
	const blindSpots = state.verifier.evaluations.reduce(
		(n, e) => n + e.blindSpots.length + (e.detectionRate === "unknown" ? 1 : 0),
		0,
	);
	const demoted = Object.values(state.calibration.buckets).filter((b) => b.state === "demoted").length;
	return {
		schema: "omk.metacognition.diagnostic.v1",
		taskId: state.goal.taskId,
		stageId: state.goal.stageId,
		stateFingerprint: stateFingerprint(state),
		finishKind: result.finish.kind,
		finishReason:
			result.finish.kind === "inconclusive"
				? result.finish.reason
				: result.finish.kind === "verified-completion"
					? result.finish.receiptId
					: undefined,
		proposedAction: result.action.kind,
		openRequiredObligations: state.obligations.filter((o) => o.status === "required").length,
		violatedObligations: state.obligations.filter((o) => o.status === "violated").length,
		blockedHighRiskCandidates: state.obligations.filter((o) => o.status === "blocked-high-risk").length,
		unresolvedMismatches:
			mismatches.byKind["unexpected-fail"] +
			mismatches.byKind["unexpected-side-effect"] +
			mismatches.byKind["scope-mismatch"] +
			mismatches.byKind["missing-observation"],
		verifierBlindSpots: blindSpots,
		runnerHealth: state.verifier.runnerHealth,
		calibrationDemoted: demoted,
		checkpointCount: result.state.checkpointCount,
	};
}

export interface MetaRuntimeObservation {
	readonly state: MetaState;
	readonly diagnostic?: MetaDiagnostic;
	readonly failed: boolean;
}

export interface MetaRuntimeView {
	readonly state: MetaState;
	readonly lastDiagnostic: MetaDiagnostic | undefined;
}

export interface MetaRuntimeController extends MetaRuntimeView {
	observe(budget: MetaBudgetInput, nowMs?: number): MetaRuntimeObservation;
	observeRunBudget(snapshot?: MetaRunBudgetProjection, nowMs?: number): MetaRuntimeObservation;
}

export function createMetaRuntime(input: InitialMetaStateInput): MetaRuntimeController {
	let state = createInitialMetaState(input);
	let lastDiagnostic: MetaDiagnostic | undefined;
	const observe = (budget: MetaBudgetInput, nowMs = Date.now()): MetaRuntimeObservation => {
		try {
			state = refreshMetaBudget(state, budget);
			const result = checkpoint({ state, nowMs, constraints: DEFAULT_ACTION_CONSTRAINTS });
			state = result.state;
			lastDiagnostic = toDiagnostic(state, result);
			return { state, diagnostic: lastDiagnostic, failed: false };
		} catch {
			return { state, diagnostic: lastDiagnostic, failed: true };
		}
	};
	return {
		get state() {
			return state;
		},
		get lastDiagnostic() {
			return lastDiagnostic;
		},
		observe,
		observeRunBudget: (snapshot, nowMs) => observe(metaBudgetFromRunBudget(snapshot), nowMs),
	};
}

export function createAgentSessionMetaRuntime(input: {
	readonly taskId: string;
	readonly candidateHash: string;
	readonly environmentHash: string;
}): MetaRuntimeController {
	return createMetaRuntime({
		...input,
		stageId: "agent-session",
		targetArtifact: "agent-session",
		goalScope: "runtime-observation",
		authorizedActions: DEFAULT_ACTION_CONSTRAINTS.authorizedActions,
		budget: metaBudgetFromRunBudget(),
	});
}

/**
 * Run one observation-mode checkpoint through the bridge: returns the kernel
 * report plus the diagnostic to attach. The host keeps its own completion
 * verdict; this only advises.
 */
export function observeCheckpoint(
	state: MetaState,
	constraints: ActionConstraints,
	nowMs: number,
): { readonly result: CheckpointResult; readonly diagnostic: MetaDiagnostic } {
	const result = checkpoint({ state, nowMs, constraints });
	return { result, diagnostic: toDiagnostic(state, result) };
}
