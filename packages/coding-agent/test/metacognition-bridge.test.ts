/**
 * Runtime bridge tests: ClaimNode/ObservationNode projection into kernel
 * inputs, checkpoint wiring, and the honesty boundary — model narrative and
 * inadmissible sources never close a required obligation.
 */

import type { ClaimNode, ObservationNode } from "omk-protocol";
import { describe, expect, it } from "vitest";
import {
	checkpoint,
	inspectKnowledge,
	type RuntimeBridgeInput,
	sourceIdentities,
	toKernelClaim,
	toKernelObservation,
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
const obs = (over: Partial<ObservationNode> = {}): ObservationNode => ({
	observationId: "o1",
	claimIds: ["c1"],
	polarity: "supports",
	source: "deterministic_validator",
	sourceRoot: "src",
	environmentDigest: "env-1",
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

describe("runtime bridge", () => {
	it("projects a leaf claim into a kernel claim bound to the scope fingerprint", () => {
		const k = toKernelClaim(claim(), "after-change", "cand-1@env-1");
		expect(k.id).toBe("c1");
		expect(k.required).toBe(true);
		expect(k.requiredCheckIds).toEqual(["ordering-check"]);
	});
	it("projects a receipt-backed witness into a check observation", () => {
		const o = toKernelObservation(obs({ receiptId: "r1" }), "cand-1@env-1", 1000);
		expect(o.kind).toBe("check");
		if (o.kind === "check") expect(o.verdict).toBe("pass");
	});
	it("model narrative becomes a decision observation, never runner truth", () => {
		const o = toKernelObservation(obs({ source: "model_narrative" }), "cand-1@env-1", 1000);
		expect(o.kind).toBe("decision");
	});
	it("compound claims are excluded from kernel claims", () => {
		const { claims } = toMetaState(
			bridgeInput({
				claims: [claim(), claim({ claimId: "parent", satisfaction: { rule: "all", inputs: ["c1"] } })],
			}),
		);
		expect(claims.map((c) => c.id)).toEqual(["c1"]);
	});
	it("a passing host check closes the required predicate", () => {
		const { claims, observations } = toMetaState(bridgeInput({ observations: [obs({ receiptId: "r1" })] }));
		const report = inspectKnowledge({
			stage: "after-change",
			requiresAssessment: true,
			nowMs: 1000,
			claims,
			observations,
			sources: sourceIdentities(),
			trustedRunnerIds: ["deterministic_validator"],
			decisionActorIds: ["owner"],
		});
		expect(report.state).toBe("supported");
	});
	it("a model narrative alone cannot close the same predicate", () => {
		const { claims, observations } = toMetaState(
			bridgeInput({
				observations: [obs({ source: "model_narrative" })],
			}),
		);
		const report = inspectKnowledge({
			stage: "after-change",
			requiresAssessment: true,
			nowMs: 1000,
			claims,
			observations,
			sources: sourceIdentities(),
			trustedRunnerIds: ["deterministic_validator"],
			decisionActorIds: ["owner"],
		});
		expect(report.state).toBe("gaps");
	});
	it("checkpoint on a bridged state returns an action and honest finish", () => {
		const { state } = toMetaState(bridgeInput());
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
		const { state } = toMetaState(bridgeInput({ interruptionReason: "cancelled" }));
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
