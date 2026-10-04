/**
 * Metacognitive state tuple and checkpoint evaluation.
 * Spec §3: X_t = (G, F, O, E, Z, H, M, V, B, P).
 *
 * The tuple is host-owned structured state; the model receives only the
 * hypotheses, evidence, and questions it needs right now. Recommended
 * computation unit is a decision checkpoint — before a new external symbol,
 * after an important change, after a check failure, after verification, after
 * a source conflict, or when strategy repetition is detected.
 */
import { type CalibrationStore, createCalibrationStore } from "./calibration.ts";
import type { KnowledgeReport } from "./knowledge.ts";
import type { Obligation } from "./obligations.ts";
import type { Prediction } from "./predictions.ts";
import { canonical, ensure, integer, member, text } from "./validation.ts";
import type { VerifierEvaluation } from "./verifier.ts";

/** G_t: current goal, stage, target artifact. */
export interface GoalState {
	readonly taskId: string;
	readonly stageId: string;
	readonly targetArtifact: string;
	readonly goalScope: string;
}
/** F_t: observed facts about repository, environment, pinned versions, change scope. */
export interface FactState {
	readonly candidateHash: string;
	readonly environmentHash: string;
	readonly changeScope: readonly string[];
	readonly analyzerCoverage: "covered" | "partial" | "unsupported" | "unknown";
}
/** E_t: evidence candidates, adopted evidence, checks bound to the current artifact. */
export interface EvidenceState {
	readonly report: KnowledgeReport | null;
	readonly adoptedSourceIds: readonly string[];
}
/** H_t: competing cause/design hypotheses and unresolved classification. */
export interface HypothesisState {
	readonly open: readonly string[];
	readonly discriminatorCandidates: readonly string[];
	readonly modelMismatch: boolean;
}
/** V_t: verifier detection coverage, known blind spots, runner health. */
export interface VerifierState {
	readonly evaluations: readonly VerifierEvaluation[];
	readonly runnerHealth: "healthy" | "degraded" | "unverified";
}
/** B_t: remaining time, requests, tokens, concurrency budget. */
export interface BudgetState {
	readonly remainingMs: number;
	readonly remainingRequests: number;
	readonly remainingTokens: number;
	readonly remainingConcurrent: number;
}
/** P_t: host-owned authorization, verification, interruption policy. */
export interface PolicyState {
	readonly policyVersion: string;
	readonly authorizedActions: readonly string[];
	readonly requiredApprovals: readonly string[];
	readonly interruptionReason: string | null;
}
/** Z_t: predictions registered before execution and post-execution mismatches. */
export type PredictionState = readonly Prediction[];
/** O_t: premises and completion obligations, plus unverified candidate duties. */
export type ObligationState = readonly Obligation[];
/** M_t: conditional performance and calibration records. */
export type CalibrationState = CalibrationStore;

export interface MetaState {
	readonly goal: GoalState;
	readonly facts: FactState;
	readonly obligations: ObligationState;
	readonly evidence: EvidenceState;
	readonly predictions: PredictionState;
	readonly hypotheses: HypothesisState;
	readonly calibration: CalibrationState;
	readonly verifier: VerifierState;
	readonly budget: BudgetState;
	readonly policy: PolicyState;
	readonly hostSequence: number;
	readonly progressHistory: readonly {
		key: string;
		newEvidence: boolean;
		resolvedObligations: number;
		newValidChecks: number;
	}[];
	readonly checkpointCount: number;
}

export interface MetaBudgetInput {
	readonly remainingMs: number;
	readonly remainingRequests: number;
	readonly remainingTokens: number;
	readonly remainingConcurrent: number;
}

export interface MetaRunBudgetProjection {
	readonly limits: { readonly maxRequests?: number; readonly maxConcurrentRequests?: number };
	readonly requestsStarted: number;
	readonly activeRequests: number;
	readonly remainingMs?: number;
}

export function metaBudgetFromRunBudget(snapshot?: MetaRunBudgetProjection): MetaBudgetInput {
	const remaining = (limit: number | undefined, used: number): number =>
		limit === undefined ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);
	return {
		remainingMs: snapshot?.remainingMs ?? Number.MAX_SAFE_INTEGER,
		remainingRequests: remaining(snapshot?.limits.maxRequests, snapshot?.requestsStarted ?? 0),
		remainingTokens: Number.MAX_SAFE_INTEGER,
		remainingConcurrent: remaining(snapshot?.limits.maxConcurrentRequests, snapshot?.activeRequests ?? 0),
	};
}

export interface InitialMetaStateInput {
	readonly taskId: string;
	readonly stageId: string;
	readonly targetArtifact: string;
	readonly goalScope: string;
	readonly candidateHash: string;
	readonly environmentHash: string;
	readonly changeScope?: readonly string[];
	readonly budget: MetaBudgetInput;
	readonly authorizedActions: readonly string[];
}

export function createInitialMetaState(input: InitialMetaStateInput): MetaState {
	const state: MetaState = {
		goal: {
			taskId: input.taskId,
			stageId: input.stageId,
			targetArtifact: input.targetArtifact,
			goalScope: input.goalScope,
		},
		facts: {
			candidateHash: input.candidateHash,
			environmentHash: input.environmentHash,
			changeScope: [...(input.changeScope ?? [])],
			analyzerCoverage: "unknown",
		},
		obligations: [],
		evidence: { report: null, adoptedSourceIds: [] },
		predictions: [],
		hypotheses: { open: [], discriminatorCandidates: [], modelMismatch: false },
		calibration: createCalibrationStore({
			minSamples: 10,
			priorAlpha: 1,
			priorBeta: 1,
			referenceMean: 0.2,
			slack: 0.1,
			threshold: 2,
		}),
		verifier: { evaluations: [], runnerHealth: "unverified" },
		budget: { ...input.budget },
		policy: {
			policyVersion: "runtime-v1",
			authorizedActions: [...input.authorizedActions],
			requiredApprovals: [],
			interruptionReason: null,
		},
		hostSequence: 0,
		progressHistory: [],
		checkpointCount: 0,
	};
	validateMetaState(state);
	return state;
}

export function refreshMetaBudget(state: MetaState, budget: MetaBudgetInput): MetaState {
	for (const [key, value] of Object.entries(budget)) integer(value, key, Number.MAX_SAFE_INTEGER);
	return { ...state, budget: { ...budget } };
}

export function validateMetaState(state: MetaState): void {
	text(state.goal.taskId, "taskId", 128);
	text(state.goal.stageId, "stageId", 128);
	text(state.goal.targetArtifact, "targetArtifact", 512);
	text(state.goal.goalScope, "goalScope", 256);
	text(state.facts.candidateHash, "candidateHash", 128);
	text(state.facts.environmentHash, "environmentHash", 128);
	member(state.facts.analyzerCoverage, ["covered", "partial", "unsupported", "unknown"], "analyzerCoverage");
	member(state.verifier.runnerHealth, ["healthy", "degraded", "unverified"], "runnerHealth");
	text(state.policy.policyVersion, "policyVersion", 64);
	integer(state.budget.remainingMs, "remainingMs");
	integer(state.budget.remainingRequests, "remainingRequests");
	integer(state.budget.remainingTokens, "remainingTokens");
	integer(state.budget.remainingConcurrent, "remainingConcurrent");
	integer(state.hostSequence, "hostSequence");
	integer(state.checkpointCount, "checkpointCount");
}

/** Finish states per §9.5: continue, verified-bounded completion, inconclusive stop. */
export type FinishState =
	| { readonly kind: "continue" }
	| { readonly kind: "verified-completion"; readonly receiptId: string; readonly scope: string }
	| { readonly kind: "inconclusive"; readonly reason: string };

/**
 * §9.5: a VOI of zero never implies verified completion. Completion requires
 * required obligations satisfied AND an approved completion receipt bound to
 * the current candidate.
 */
export function finishState(
	state: MetaState,
	receipt: { receiptId: string; candidateHash: string; scope: string } | null,
): FinishState {
	const openRequired = state.obligations.filter((o) => o.status === "required" || o.status === "violated");
	if (receipt !== null) {
		ensure(receipt.candidateHash === state.facts.candidateHash, "receipt candidate binding mismatch");
		if (openRequired.length === 0) {
			return { kind: "verified-completion", receiptId: receipt.receiptId, scope: receipt.scope };
		}
	}
	if (openRequired.length > 0) {
		return { kind: "inconclusive", reason: `unresolved-obligations:${openRequired.length}` };
	}
	if (state.budget.remainingMs === 0 || state.budget.remainingRequests === 0) {
		return { kind: "inconclusive", reason: "budget-exhausted" };
	}
	return { kind: "continue" };
}

/** Fingerprint of the full state for checkpoint diffs and receipts. */
export function stateFingerprint(state: MetaState): string {
	return canonical([
		state.goal.taskId,
		state.goal.stageId,
		state.facts.candidateHash,
		state.facts.environmentHash,
		state.policy.policyVersion,
		state.obligations.map((o) => [o.id, o.status]),
		state.predictions.map((p) => [p.predictionId, p.status]),
	]);
}
