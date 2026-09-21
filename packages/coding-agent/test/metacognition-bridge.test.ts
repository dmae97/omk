/**
 * Runtime bridge tests: ClaimNode/ObservationNode projection into kernel
 * inputs, checkpoint wiring, and the honesty boundary — model narrative and
 * inadmissible sources never close a required obligation.
 *
 * WP05: the bridge returns mapped|partial|rejected; these tests use fully
 * provenanced host observations so the happy paths stay `mapped`.
 */

import type { ClaimNode } from "omk-protocol";
import { describe, expect, it } from "vitest";
import {
	type BridgeObservation,
	checkpoint,
	inspectKnowledge,
	mapClaim,
	mapObservation,
	type ObservationMapContext,
	type RuntimeBridgeInput,
	type RuntimeBridgeOutput,
	sourceIdentities,
	toMetaState,
} from "../src/metacognition/index.ts";

const claim = (over: Partial<ClaimNode> = {}): ClaimNode => ({
	claimId: "c1",
	kind: "requirement",
	statement: "late async results must not overwrite newer state",
	severity: "required",
	satisfaction: { rule: "all", inputs: [] },
	trustFloor: "deterministic_validator",
	invalidationKeys: ["ordering-check"],
	...over,
});
const obs = (over: Partial<BridgeObservation> = {}): BridgeObservation => ({
	observationId: "o1",
	claimIds: ["c1"],
	polarity: "supports",
	source: "deterministic_validator",
	sourceRoot: "src",
	environmentDigest: "env-1",
	receiptId: "r1",
	checkId: "ordering-check",
	sequence: 1,
	observedAtMs: 900,
	validUntil: "1970-01-01T00:00:01.500Z",
	binding: "cand-1@env-1",
	...over,
});
const bridgeInput = (over: Partial<RuntimeBridgeInput> = {}): RuntimeBridgeInput => ({
	taskId: "t1",
	stageId: "s1",
	goalScope: "ui-search",
	targetArtifact: "src/search.ts",
	candidateHash: "cand-1",
	environmentHash: "env-1",
	claims: [claim()],
	observations: [],
	trustedRunnerIds: ["deterministic_validator", "workspace_witness"],
	decisionActorIds: ["owner"],
	authorizedActions: [
		"inspect_local",
		"run_discriminating_probe",
		"strengthen_verifier",
		"revise_implementation",
		"switch_strategy",
		"request_required_decision",
		"continue_object_work",
		"finish_with_bound_receipt",
		"stop_inconclusive",
		"form_obligations",
		"reselect_skills",
		"retrieve_reference",
		"settle_safety",
	],
	budget: { remainingMs: 60_000, remainingRequests: 50, remainingTokens: 100_000, remainingConcurrent: 4 },
	policyVersion: "p1",
	modelRevision: "m1",
	stage: "after-change",
	nowMs: 1000,
	...over,
});

const mapCtx = (
	floors: ReadonlyMap<string, ClaimNode["trustFloor"]> = new Map([["c1", "deterministic_validator"]]),
): ObservationMapContext => {
	const m = mapClaim(claim(), "after-change", "cand-1@env-1");
	if (m.status === "rejected") throw new Error("claim fixture rejected");
	return {
		binding: "cand-1@env-1",
		nowMs: 1000,
		claimById: new Map([["c1", m.claim]]),
		claimFloors: floors,
		sources: sourceIdentities(),
	};
};

const bridged = (input: RuntimeBridgeInput): RuntimeBridgeOutput => {
	const out = toMetaState(input);
	if (out.status === "rejected") throw new Error(`bridge rejected: ${out.reason}`);
	return out.value;
};

describe("runtime bridge", () => {
	it("projects a leaf claim into a kernel claim bound to the scope fingerprint", () => {
		const m = mapClaim(claim(), "after-change", "cand-1@env-1");
		expect(m.status).toBe("mapped");
		if (m.status === "rejected") return;
		expect(m.claim.id).toBe("c1");
		expect(m.claim.required).toBe(true);
		expect(m.claim.requiredCheckIds).toEqual(["ordering-check"]);
	});
	it("projects a receipt-backed witness into a check observation", () => {
		const r = mapObservation(obs(), mapCtx());
		expect(r.status).toBe("mapped");
		if (r.status !== "mapped") return;
		const o = r.observations[0]!;
		expect(o.kind).toBe("check");
		if (o.kind === "check") expect(o.verdict).toBe("pass");
	});
	it("model narrative becomes a decision observation, never runner truth", () => {
		const r = mapObservation(
			obs({ receiptId: undefined, checkId: undefined, sequence: undefined, source: "model_narrative" }),
			mapCtx(new Map([["c1", "model_narrative"]])),
		);
		expect(r.status).toBe("mapped");
		if (r.status !== "mapped") return;
		expect(r.observations[0]!.kind).toBe("decision");
	});
	it("compound claims are excluded from kernel claims and declared unmapped", () => {
		const out = toMetaState(
			bridgeInput({
				claims: [claim(), claim({ claimId: "parent", satisfaction: { rule: "all", inputs: ["c1"] } })],
			}),
		);
		expect(out.status).toBe("partial");
		if (out.status !== "partial") return;
		expect(out.value.claims.map((c) => c.id)).toEqual(["c1"]);
		expect(out.loss.unmappedClaims).toContain("claim:parent");
	});
	it("a passing host check closes the required predicate", () => {
		const out = toMetaState(bridgeInput({ observations: [obs()] }));
		expect(out.status).toBe("mapped");
		if (out.status !== "mapped") return;
		const report = inspectKnowledge({
			stage: "after-change",
			requiresAssessment: true,
			nowMs: 1000,
			claims: out.value.claims,
			observations: out.value.observations,
			sources: sourceIdentities(),
			trustedRunnerIds: ["deterministic_validator"],
			decisionActorIds: ["owner"],
		});
		expect(report.state).toBe("supported");
	});
	it("a model narrative alone cannot close the same predicate", () => {
		const out = toMetaState(
			bridgeInput({
				observations: [
					obs({ source: "model_narrative", receiptId: undefined, checkId: undefined, sequence: undefined }),
				],
			}),
		);
		// The witness is below the claim's trust floor: the bridge declares the
		// loss and emits nothing for it.
		expect(out.status).toBe("partial");
		if (out.status !== "partial") return;
		const report = inspectKnowledge({
			stage: "after-change",
			requiresAssessment: true,
			nowMs: 1000,
			claims: out.value.claims,
			observations: out.value.observations,
			sources: sourceIdentities(),
			trustedRunnerIds: ["deterministic_validator"],
			decisionActorIds: ["owner"],
		});
		expect(report.state).toBe("gaps");
	});
	it("checkpoint on a bridged state returns an action and honest finish", () => {
		const { state } = bridged(bridgeInput());
		const result = checkpoint({
			state,
			nowMs: 1000,
			constraints: {
				authorizedActions: bridgeInput().authorizedActions as never,
				prerequisites: {},
				actionCostsMs: {},
				actionCostsRequests: {},
				inScopeKinds: bridgeInput().authorizedActions as never,
			},
		});
		expect(result.action.kind).toBeDefined();
		expect(["continue", "inconclusive", "verified-completion"]).toContain(result.finish.kind);
	});
	it("interrupt reason forces the safety branch", () => {
		const { state } = bridged(bridgeInput({ interruptionReason: "cancelled" }));
		const result = checkpoint({
			state,
			nowMs: 1000,
			constraints: {
				authorizedActions: ["settle_safety", "stop_inconclusive"] as never,
				prerequisites: {},
				actionCostsMs: {},
				actionCostsRequests: {},
				inScopeKinds: ["settle_safety", "stop_inconclusive"] as never,
			},
		});
		expect(result.action.kind).toBe("settle_safety");
	});
});
