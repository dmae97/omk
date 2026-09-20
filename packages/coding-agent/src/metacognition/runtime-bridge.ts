/**
 * Runtime bridge — §13 "기존 완료 판정 호출부": projects host-owned OMK
 * runtime artifacts (protocol ClaimGraph claims, ObservationNodes, waiver
 * records, workspace/session facts) onto the metacognition kernel's input
 * types. It only translates; it never relaxes trust floors, never admits a
 * model's JSON as runner truth, and never fabricates completion.
 */
import type { ClaimNode, ObservationNode } from "omk-protocol";
import { createCalibrationStore } from "./calibration.ts";
import type {
	CheckObservation,
	Claim,
	DecisionObservation,
	ReferenceObservation,
	SourceIdentity,
	Stage,
} from "./knowledge.ts";
import type { MetaState } from "./state.ts";
import { ensure, integer, lexical, member, text } from "./validation.ts";

const ISO_MS = (iso: string): number => {
	const ms = Date.parse(iso);
	ensure(Number.isFinite(ms), `invalid ISO timestamp: ${iso}`);
	return ms;
};

/** ClaimNode → kernel Claim. Severity maps to impact; leaves keep their check demands. */
export function toKernelClaim(node: ClaimNode, stage: Stage, binding: string): Claim {
	text(node.claimId, "claimId", 256);
	text(node.statement, "statement", 2048);
	member(stage, ["before-change", "after-change"], "stage");
	let impact = 100;
	if (node.kind === "safety") impact = 1_000;
	else if (node.severity === "required") impact = 500;
	return {
		id: node.claimId,
		binding,
		phase: node.kind === "requirement" || node.kind === "safety" ? "precondition" : "postcondition",
		statement: node.statement,
		required: node.severity === "required",
		impact,
		needsReference: false,
		requiresVersion: false,
		version: null,
		minSourceFamilies: node.requiredWitnesses ?? 1,
		requiredCheckIds: node.invalidationKeys,
		needsUserDecision: node.trustFloor === "model_narrative",
		publicQuery: null,
	};
}

/** ObservationNode → kernel observation. Trust floor rank maps to source admissibility. */
export function toKernelObservation(
	node: ObservationNode,
	binding: string,
	nowMs: number,
	claimById?: ReadonlyMap<string, Claim>,
): CheckObservation | ReferenceObservation | DecisionObservation {
	text(node.observationId, "observationId", 256);
	text(binding, "binding", 512);
	integer(nowMs, "nowMs");
	const observedAtMs = nowMs;
	const expiresAtMs = node.validUntil !== undefined ? ISO_MS(node.validUntil) : nowMs + 1;
	const claimId = node.claimIds[0] ?? "";
	const base = { id: node.observationId, claimId, binding, observedAtMs, expiresAtMs };
	if (node.receiptId !== undefined) {
		// checkId is the claim's required check predicate (its invalidation key),
		// not the receipt id — receipts are evidence artifacts, checkIds are obligations.
		const checkId = claimById?.get(claimId)?.requiredCheckIds[0] ?? node.receiptId;
		return {
			...base,
			kind: "check",
			runnerId: node.source,
			checkId,
			sequence: 0,
			verdict: node.polarity === "supports" ? "pass" : "fail",
		};
	}
	if (node.source === "model_narrative") {
		return { ...base, kind: "decision", actorId: "model", accepted: node.polarity === "supports" };
	}
	return {
		...base,
		kind: "reference",
		sourceId: node.source,
		version: null,
		stance: node.polarity === "supports" ? "support" : "refute",
		documentDigest: node.environmentDigest,
		locator: node.sourceRoot,
	};
}

export interface RuntimeBridgeOutput {
	readonly state: MetaState;
	readonly claims: readonly Claim[];
	readonly observations: readonly (CheckObservation | ReferenceObservation | DecisionObservation)[];
}
export interface RuntimeBridgeInput {
	readonly taskId: string;
	readonly stageId: string;
	readonly goalScope: string;
	readonly targetArtifact: string;
	readonly candidateHash: string;
	readonly environmentHash: string;
	readonly claims: readonly ClaimNode[];
	readonly observations: readonly ObservationNode[];
	readonly trustedRunnerIds: readonly string[];
	readonly decisionActorIds: readonly string[];
	readonly authorizedActions: readonly string[];
	readonly budget: {
		remainingMs: number;
		remainingRequests: number;
		remainingTokens: number;
		remainingConcurrent: number;
	};
	readonly policyVersion: string;
	readonly modelRevision: string;
	readonly interruptionReason?: string | null;
	readonly stage: Stage;
	readonly nowMs: number;
	readonly progressHistory?: readonly {
		key: string;
		newEvidence: boolean;
		resolvedObligations: number;
		newValidChecks: number;
	}[];
}

/** Build kernel inputs plus a MetaState for one safe checkpoint. Host-owned inputs only. */
export function toMetaState(input: RuntimeBridgeInput): RuntimeBridgeOutput {
	text(input.taskId, "taskId", 128);
	text(input.stageId, "stageId", 128);
	text(input.goalScope, "goalScope", 256);
	text(input.targetArtifact, "targetArtifact", 512);
	text(input.candidateHash, "candidateHash", 128);
	text(input.environmentHash, "environmentHash", 128);
	text(input.policyVersion, "policyVersion", 64);
	text(input.modelRevision, "modelRevision", 128);
	integer(input.nowMs, "nowMs");
	ensure(input.claims.length <= 128 && input.observations.length <= 4096, "runtime bridge input too large");
	// Only leaf claims map to kernel claims — compound satisfaction is the
	// protocol layer's job, not a kernel evidence predicate.
	const binding = `${input.candidateHash}@${input.environmentHash}`;
	const leafClaims = input.claims.filter((c) => c.satisfaction.inputs.length === 0);
	const claimById = new Map(leafClaims.map((c) => [c.claimId, toKernelClaim(c, input.stage, binding)]));
	const kernelClaims = [...claimById.values()].sort((a, b) => lexical(a.id, b.id));
	const kernelObservations = input.observations.map((o) => toKernelObservation(o, binding, input.nowMs, claimById));
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
			changeScope: [input.targetArtifact],
			analyzerCoverage: "unknown",
		},
		obligations: [],
		evidence: { report: null, adoptedSourceIds: [] },
		predictions: [],
		hypotheses: { open: [], discriminatorCandidates: [], modelMismatch: false },
		calibration: createCalibrationStore({
			minSamples: 5,
			priorAlpha: 1,
			priorBeta: 1,
			referenceMean: 0.3,
			slack: 0.15,
			threshold: 3,
		}),
		verifier: { evaluations: [], runnerHealth: "unverified" },
		budget: input.budget,
		policy: {
			policyVersion: input.policyVersion,
			authorizedActions: input.authorizedActions,
			requiredApprovals: [],
			interruptionReason: input.interruptionReason ?? null,
		},
		hostSequence: 0,
		progressHistory: input.progressHistory ?? [],
		checkpointCount: 0,
	};
	return { state, claims: kernelClaims, observations: kernelObservations };
}

/** Sources admitted for reference evidence: only repository/official qualify. */
export function sourceIdentities(overrides: readonly SourceIdentity[] = []): readonly SourceIdentity[] {
	return [
		{ id: "deterministic_validator", family: "host", kind: "repository" },
		{ id: "workspace_witness", family: "host", kind: "repository" },
		{ id: "trusted_attestation", family: "attestation", kind: "official" },
		{ id: "effect_reconciliation", family: "host", kind: "repository" },
		{ id: "independent_review", family: "review", kind: "official" },
		{ id: "self_review", family: "model", kind: "model" },
		{ id: "model_narrative", family: "model", kind: "model" },
		...overrides,
	];
}
