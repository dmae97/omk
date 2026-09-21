/**
 * Runtime bridge — §13 "기존 완료 판정 호출부": projects host-owned OMK
 * runtime artifacts (protocol ClaimGraph claims, ObservationNodes, waiver
 * records, workspace/session facts) onto the metacognition kernel's input
 * types.
 *
 * WP05 (docs/06_METACOGNITION_BRIDGE.md): every translation is loss-aware.
 * Each claim and observation maps to `mapped`, `partial`, or `rejected`.
 * What the previous mapper silently did — collapse claimIds to the first,
 * force sequence 0, substitute checkId with receiptId/invalidation keys,
 * stamp observedAtMs with bridge time, fabricate expiry as now+1, rebind any
 * evidence to the current candidate, coerce unknown polarity to a boolean —
 * is now either preserved verbatim or declared in `loss`, never repeated.
 *
 * It only translates; it never relaxes trust floors, never admits a model's
 * JSON as runner truth, and never fabricates completion.
 */
import { type ClaimNode, OBSERVATION_TRUST_RANK, type ObservationSource } from "omk-protocol";
import {
	type BridgeLoss,
	type BridgeObservation,
	type BridgePolarity,
	type ClaimMapResult,
	lossOf,
	mergeBridgeLoss,
	type ObservationMapResult,
	type RuntimeBridgeOutput,
	type RuntimeBridgeResult,
} from "./bridge-result.ts";
import { createCalibrationStore } from "./calibration.ts";
import type { CheckObservation, Claim, Observation, SourceIdentity, Stage } from "./knowledge.ts";
import type { MetaState } from "./state.ts";
import { canonical, ensure, integer, lexical, member, text } from "./validation.ts";

const ISO_MS = (iso: string): number => {
	const ms = Date.parse(iso);
	ensure(Number.isFinite(ms), `invalid ISO timestamp: ${iso}`);
	return ms;
};

const UNKNOWN_POLARITY: readonly BridgePolarity[] = ["unknown", "neutral", "inconclusive"];
const isUnknownPolarity = (p: BridgePolarity): boolean => UNKNOWN_POLARITY.includes(p);

/** ClaimNode → kernel Claim. Severity maps to impact; leaves keep their check demands. */
export function mapClaim(node: ClaimNode, stage: Stage, binding: string): ClaimMapResult {
	text(node.claimId, "claimId", 256);
	text(node.statement, "statement", 2048);
	member(stage, ["before-change", "after-change"], "stage");
	let impact = 100;
	if (node.kind === "safety") impact = 1_000;
	else if (node.severity === "required") impact = 500;
	const needsUserDecision = node.trustFloor === "model_narrative";
	// A leaf needs at least one kernel evidence predicate. Checks come from
	// invalidationKeys; multi-witness demands and keyless leaves need
	// reference families; model-narrative floors need a decision.
	const needsReference =
		node.invalidationKeys.length === 0 && !needsUserDecision ? true : (node.requiredWitnesses ?? 1) > 1;
	const claim: Claim = {
		id: node.claimId,
		binding,
		phase: node.kind === "requirement" || node.kind === "safety" ? "precondition" : "postcondition",
		statement: node.statement,
		required: node.severity === "required",
		impact,
		needsReference,
		requiresVersion: false,
		version: null,
		minSourceFamilies: Math.max(node.requiredWitnesses ?? 1, 1),
		requiredCheckIds: node.invalidationKeys,
		needsUserDecision,
		publicQuery: null,
	};
	if (node.scopeSensitive === true) {
		return {
			status: "partial",
			claim,
			loss: lossOf({ lostFields: [`claim:${node.claimId}.scopeSensitive`] }),
		};
	}
	return { status: "mapped", claim };
}

/** Context every observation edge is translated against. */
export interface ObservationMapContext {
	/** `candidateHash@environmentHash` of the *current* candidate — never assigned to foreign evidence. */
	readonly binding: string;
	readonly nowMs: number;
	readonly generation?: number;
	/** Leaf claims already mapped, id → kernel claim. Unresolvable ids are declared loss. */
	readonly claimById: ReadonlyMap<string, Claim>;
	/** Per-claim trust floor; a missing floor defaults to `deterministic_validator`. */
	readonly claimFloors: ReadonlyMap<string, ObservationSource>;
	readonly sources: readonly SourceIdentity[];
}

const floorRank = (floors: ReadonlyMap<string, ObservationSource>, claimId: string): number =>
	OBSERVATION_TRUST_RANK[floors.get(claimId) ?? "deterministic_validator"];

const findSource = (sources: readonly SourceIdentity[], id: string): SourceIdentity | undefined =>
	sources.find((s) => s.id === id);

/**
 * ObservationNode → kernel observations.
 *
 * The result carries every emitted edge (one per resolvable claim — the
 * explicit relation table docs/06 asks for) or the declared reason none
 * could be emitted. No edge is ever emitted with fabricated provenance.
 */
export function mapObservation(node: BridgeObservation, ctx: ObservationMapContext): ObservationMapResult {
	text(node.observationId, "observationId", 256);
	text(node.sourceRoot, "sourceRoot", 512);
	text(node.environmentDigest, "environmentDigest", 256);
	member(node.source, Object.keys(OBSERVATION_TRUST_RANK), "observation source");
	integer(ctx.nowMs, "nowMs");
	if (node.claimIds.length === 0) {
		return { status: "rejected", reason: `${node.observationId}: no claim ids` };
	}
	// Clock and generation conflicts reject outright — docs/06 lists
	// generation moves, future timestamps and expiry as invalid on arrival.
	if (node.generation !== undefined && ctx.generation !== undefined && node.generation !== ctx.generation) {
		return { status: "rejected", reason: `${node.observationId}: generation-mismatch` };
	}
	if (node.observedAtMs !== undefined && node.observedAtMs > ctx.nowMs) {
		return { status: "rejected", reason: `${node.observationId}: future-observation` };
	}
	const expiresAtMs = node.validUntil !== undefined ? ISO_MS(node.validUntil) : undefined;
	if (expiresAtMs !== undefined && expiresAtMs <= ctx.nowMs) {
		return { status: "rejected", reason: `${node.observationId}: expired-observation` };
	}
	if (expiresAtMs !== undefined && node.observedAtMs !== undefined && expiresAtMs < node.observedAtMs) {
		return { status: "rejected", reason: `${node.observationId}: invalid-validity-interval` };
	}
	// Binding: equal ⇒ kept, different ⇒ rejected, absent ⇒ unknownBindings.
	// The one thing that never happens is reattaching foreign or unbound
	// evidence to ctx.binding.
	if (node.binding !== undefined && node.binding !== ctx.binding) {
		return { status: "rejected", reason: `${node.observationId}: binding-mismatch` };
	}
	// Polarity must be expressible by the kind this observation maps to.
	const checkIds = [...new Set([...(node.checkId ? [node.checkId] : []), ...(node.checkIds ?? [])])];
	const isCheck = node.receiptId !== undefined || checkIds.length > 0;
	const isDecision = !isCheck && (node.source === "model_narrative" || node.actorId !== undefined);
	if (isUnknownPolarity(node.polarity) && !isCheck) {
		return { status: "rejected", reason: `${node.observationId}: unexpressible-polarity` };
	}
	// Fields required to emit an edge without fabrication. Absent provenance
	// is declared loss; the edge is not emitted.
	const missing: string[] = [];
	if (node.observedAtMs === undefined) missing.push("observedAtMs");
	if (expiresAtMs === undefined) missing.push("validUntil");
	if (isCheck) {
		if (checkIds.length === 0) missing.push("checkId");
		if (node.sequence === undefined) missing.push("sequence");
	}
	const lostFields: string[] = missing.map((f) => `${node.observationId}.${f}`);
	const unknownBindings: string[] = [];
	if (node.binding === undefined) unknownBindings.push(node.observationId);
	const blockedByMissing = missing.length > 0 || node.binding === undefined;

	const observations: Observation[] = [];
	const usedSources = new Map<string, SourceIdentity>();
	const unmappedClaims: string[] = [];
	const family =
		node.sourceFamily ?? node.independenceGroup ?? findSource(ctx.sources, node.source)?.family ?? node.source;
	// Edge ids stay unique when one observation emits several edges.
	const edgeCount = node.claimIds.filter((c) => ctx.claimById.has(c)).length * Math.max(checkIds.length, 1);
	const multi = edgeCount > 1;
	for (const claimId of node.claimIds) {
		const claim = ctx.claimById.get(claimId);
		if (!claim) {
			unmappedClaims.push(`${node.observationId}->${claimId}`);
			continue;
		}
		if (OBSERVATION_TRUST_RANK[node.source] < floorRank(ctx.claimFloors, claimId)) {
			unmappedClaims.push(`${node.observationId}->${claimId}`);
			continue;
		}
		if (blockedByMissing) continue; // declared above; emitted only with full provenance
		// Guaranteed present by the missing-fields computation above. `ensure`
		// narrows for the compiler and fails loudly instead of defaulting.
		ensure(node.observedAtMs !== undefined, `${node.observationId}: observedAtMs required`);
		ensure(expiresAtMs !== undefined, `${node.observationId}: validUntil required`);
		ensure(node.binding !== undefined, `${node.observationId}: binding required`);
		const base = {
			id: node.observationId,
			claimId,
			binding: node.binding,
			observedAtMs: node.observedAtMs,
			expiresAtMs,
		};
		if (isCheck) {
			ensure(node.sequence !== undefined, `${node.observationId}: sequence required`);
			const verdict: CheckObservation["verdict"] =
				node.polarity === "supports" ? "pass" : node.polarity === "violates" ? "fail" : "pending";
			for (const checkId of checkIds) {
				observations.push({
					...base,
					id: multi ? `${node.observationId}#${claimId}#${checkId}` : node.observationId,
					kind: "check",
					runnerId: node.source,
					checkId,
					sequence: node.sequence,
					verdict,
				});
			}
		} else if (isDecision) {
			observations.push({
				...base,
				id: multi ? `${node.observationId}#${claimId}` : node.observationId,
				kind: "decision",
				actorId: node.actorId ?? "model",
				accepted: node.polarity === "supports",
			});
		} else {
			// Synthesized identity carries the witness's independence group so
			// the kernel counts families, not citation count.
			const sourceId = `${node.source}@${family}`;
			if (!usedSources.has(sourceId)) {
				const registered = findSource(ctx.sources, node.source);
				usedSources.set(sourceId, {
					id: sourceId,
					family,
					kind: registered?.kind === "model" || registered === undefined ? "community" : registered.kind,
				});
			}
			observations.push({
				...base,
				id: multi ? `${node.observationId}#${claimId}` : node.observationId,
				kind: "reference",
				sourceId,
				version: null,
				stance: node.polarity === "supports" ? "support" : "refute",
				documentDigest: node.environmentDigest,
				locator: node.sourceRoot,
			});
		}
	}
	const sources = [...usedSources.values()];
	if (lostFields.length === 0 && unknownBindings.length === 0 && unmappedClaims.length === 0) {
		return { status: "mapped", observations, sources };
	}
	return {
		status: "partial",
		observations,
		sources,
		loss: lossOf({ lostFields, unmappedClaims, unknownBindings }),
	};
}

export interface RuntimeBridgeInput {
	readonly taskId: string;
	readonly stageId: string;
	readonly goalScope: string;
	readonly targetArtifact: string;
	readonly candidateHash: string;
	readonly environmentHash: string;
	/** Current ledger generation; compared with each observation's own when present. */
	readonly generation?: number;
	readonly claims: readonly ClaimNode[];
	readonly observations: readonly BridgeObservation[];
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
	/** Extra admissible source identities beyond the built-in registry. */
	readonly sources?: readonly SourceIdentity[];
}

/** Witness pairs that conflict on independence or polarity. */
function familyConflicts(
	edges: readonly Observation[],
	rejected: readonly { id: string; reason: string }[],
	inputs: readonly BridgeObservation[],
	claimById: ReadonlyMap<string, Claim>,
): string[] {
	const conflicts: string[] = [];
	const byClaim = new Map<string, Observation[]>();
	for (const e of edges) byClaim.set(e.claimId, [...(byClaim.get(e.claimId) ?? []), e]);
	for (const [claimId, list] of byClaim) {
		// Opposing witnesses (support vs refute / pass vs fail) from the same
		// source family on one claim.
		const signs = new Map<string, Set<string>>();
		for (const e of list) {
			const fam = e.kind === "reference" ? e.sourceId : e.kind === "check" ? e.runnerId : e.actorId;
			const sign =
				e.kind === "reference"
					? e.stance
					: e.kind === "check"
						? e.verdict === "pending"
							? "pending"
							: e.verdict === "pass"
								? "support"
								: "refute"
						: e.accepted
							? "support"
							: "refute";
			signs.set(fam, new Set([...(signs.get(fam) ?? []), sign]));
		}
		for (const [fam, s] of signs) {
			if (s.has("support") && s.has("refute")) conflicts.push(`conflicting-witness:${claimId}:${fam}`);
		}
	}
	// Same (claim, family) cited by several distinct observations duplicates
	// one independence group — counted once by the kernel, declared here.
	const cited = new Map<string, Set<string>>();
	for (const o of inputs) {
		if (rejected.some((r) => r.id === o.observationId)) continue;
		for (const claimId of o.claimIds) {
			if (!claimById.has(claimId)) continue;
			const key = `${claimId}|${o.sourceFamily ?? o.independenceGroup ?? o.source}`;
			cited.set(key, new Set([...(cited.get(key) ?? []), o.observationId]));
		}
	}
	for (const [key, ids] of cited) {
		if (ids.size > 1) conflicts.push(`duplicate-citation:${key}`);
	}
	return conflicts.sort(lexical);
}

/**
 * Check edges sharing (claimId, binding, checkId, sequence) must agree
 * verbatim — the kernel `ensure`s that and would throw. Conflicting slots
 * are ledger corruption: suppress *all* edges in the slot (admit neither)
 * and leave the conflict declared in sourceFamilyConflicts.
 */
function suppressConflictingSequences(edges: readonly Observation[]): Observation[] {
	const slots = new Map<string, Observation[]>();
	for (const e of edges) {
		if (e.kind !== "check") continue;
		const key = canonical([e.claimId, e.binding, e.checkId, e.sequence]);
		slots.set(key, [...(slots.get(key) ?? []), e]);
	}
	const drop = new Set<string>();
	for (const list of slots.values()) {
		if (new Set(list.map((e) => canonical(e))).size > 1) {
			for (const e of list) drop.add(e.id);
		}
	}
	return edges.filter((e) => !drop.has(e.id));
}

/** Build kernel inputs plus a MetaState for one safe checkpoint. Host-owned inputs only. */
export function toMetaState(input: RuntimeBridgeInput): RuntimeBridgeResult {
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
	const binding = `${input.candidateHash}@${input.environmentHash}`;
	// Only leaf claims map to kernel claims — compound satisfaction is the
	// protocol layer's job, and is now declared instead of dropped silently.
	const compoundIds = input.claims.filter((c) => c.satisfaction.inputs.length > 0).map((c) => c.claimId);
	const leafClaims = input.claims.filter((c) => c.satisfaction.inputs.length === 0);
	const claimById = new Map<string, Claim>();
	const claimLosses: BridgeLoss[] = [];
	for (const c of leafClaims) {
		const m = mapClaim(c, input.stage, binding);
		if (m.status === "rejected") {
			claimLosses.push(lossOf({ unmappedClaims: [`claim:${c.claimId}`], rejectedObservations: [] }));
			continue;
		}
		claimById.set(c.claimId, m.claim);
		if (m.status === "partial") claimLosses.push(m.loss);
	}
	const kernelClaims = [...claimById.values()].sort((a, b) => lexical(a.id, b.id));
	const claimFloors = new Map(leafClaims.map((c) => [c.claimId, c.trustFloor] as const));
	const baseSources = sourceIdentities(input.sources ?? []);
	const ctx: ObservationMapContext = {
		binding,
		nowMs: input.nowMs,
		generation: input.generation,
		claimById,
		claimFloors,
		sources: baseSources,
	};
	const emitted: Observation[] = [];
	const usedSources = new Map<string, SourceIdentity>();
	const obsLosses: BridgeLoss[] = [];
	const rejectedObs: { id: string; reason: string }[] = [];
	for (const o of input.observations) {
		const r = mapObservation(o, ctx);
		if (r.status === "rejected") {
			rejectedObs.push({ id: o.observationId, reason: r.reason });
			continue;
		}
		emitted.push(...r.observations);
		for (const s of r.sources) usedSources.set(s.id, s);
		if (r.status === "partial") obsLosses.push(r.loss);
	}
	const kernelObservations = suppressConflictingSequences(emitted);
	const bridgeLoss = mergeBridgeLoss([...claimLosses, ...obsLosses]);
	const conflicts = familyConflicts(emitted, rejectedObs, input.observations, claimById);
	const loss: BridgeLoss = {
		...bridgeLoss,
		unmappedClaims: [...bridgeLoss.unmappedClaims, ...compoundIds.map((id) => `claim:${id}`)].sort(lexical),
		sourceFamilyConflicts: [...bridgeLoss.sourceFamilyConflicts, ...conflicts].sort(lexical),
		rejectedObservations: [...bridgeLoss.rejectedObservations, ...rejectedObs].sort((a, b) => lexical(a.id, b.id)),
	};
	const requiredIds = new Set(input.claims.filter((c) => c.severity === "required").map((c) => c.claimId));
	const touched = new Set<string>();
	for (const u of loss.unmappedClaims) {
		for (const id of requiredIds) {
			if (u === `claim:${id}` || u.endsWith(`->${id}`)) touched.add(id);
		}
	}
	for (const obsId of loss.unknownBindings) {
		const src = input.observations.find((o) => o.observationId === obsId);
		for (const c of src?.claimIds ?? []) if (requiredIds.has(c)) touched.add(c);
	}
	for (const r of loss.rejectedObservations) {
		const src = input.observations.find((o) => o.observationId === r.id);
		for (const c of src?.claimIds ?? []) if (requiredIds.has(c)) touched.add(c);
	}
	for (const f of loss.lostFields) {
		if (f.startsWith("claim:")) {
			const id = f.slice("claim:".length).split(".")[0] ?? "";
			if (requiredIds.has(id)) touched.add(id);
			continue;
		}
		const obsId = f.split(".")[0] ?? "";
		const src = input.observations.find((o) => o.observationId === obsId);
		for (const c of src?.claimIds ?? []) if (requiredIds.has(c)) touched.add(c);
	}
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
	const sources = [...new Map([...baseSources, ...usedSources.values()].map((s) => [s.id, s])).values()];
	const value: RuntimeBridgeOutput = { state, claims: kernelClaims, observations: kernelObservations, sources };
	const empty =
		loss.lostFields.length === 0 &&
		loss.unmappedClaims.length === 0 &&
		loss.unknownBindings.length === 0 &&
		loss.sourceFamilyConflicts.length === 0 &&
		loss.rejectedObservations.length === 0;
	if (empty) return { status: "mapped", value };
	return {
		status: "partial",
		value,
		loss,
		touchesRequiredClaims: [...touched].sort(lexical),
	};
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
