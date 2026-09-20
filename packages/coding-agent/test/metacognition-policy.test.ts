/**
 * Integration tests for MetaState, the §14 priority-table policy, and the
 * §9.4 checkpoint ordering. Feasibility gates precede optimization; an
 * unobserved or unverifiable obligation never becomes a completion receipt.
 */
import { describe, expect, it } from "vitest";
import {
	type ActionConstraints,
	type ChangeAtom,
	checkpoint,
	createCalibrationStore,
	evaluateVerifier,
	feasibleActions,
	finishState,
	type MetaState,
	type MutantRecord,
	type ObligationRule,
	type Prediction,
	progressKey,
	registerPrediction,
	resolvePrediction,
	selectAction,
} from "../src/metacognition/index.ts";

const baseState = (over: Partial<MetaState> = {}): MetaState => ({
	goal: { taskId: "t1", stageId: "s1", targetArtifact: "src/search.ts", goalScope: "ui-search" },
	facts: {
		candidateHash: "cand-1",
		environmentHash: "env-1",
		changeScope: ["src/search.ts"],
		analyzerCoverage: "covered",
	},
	obligations: [],
	evidence: { report: null, adoptedSourceIds: [] },
	predictions: [],
	hypotheses: { open: [], discriminatorCandidates: [], modelMismatch: false },
	calibration: createCalibrationStore({
		minSamples: 3,
		priorAlpha: 1,
		priorBeta: 1,
		referenceMean: 0.2,
		slack: 0.1,
		threshold: 2,
	}),
	verifier: { evaluations: [], runnerHealth: "healthy" },
	budget: { remainingMs: 60_000, remainingRequests: 50, remainingTokens: 100_000, remainingConcurrent: 4 },
	policy: {
		policyVersion: "p1",
		authorizedActions: [
			"inspect_local",
			"retrieve_reference",
			"run_discriminating_probe",
			"strengthen_verifier",
			"reselect_skills",
			"revise_implementation",
			"switch_strategy",
			"request_required_decision",
			"continue_object_work",
			"finish_with_bound_receipt",
			"stop_inconclusive",
			"settle_safety",
			"form_obligations",
		],
		requiredApprovals: [],
		interruptionReason: null,
	},
	hostSequence: 0,
	progressHistory: [],
	checkpointCount: 0,
	...over,
});

const constraints = (over: Partial<ActionConstraints> = {}): ActionConstraints => ({
	authorizedActions: [
		"inspect_local",
		"retrieve_reference",
		"run_discriminating_probe",
		"strengthen_verifier",
		"reselect_skills",
		"revise_implementation",
		"switch_strategy",
		"request_required_decision",
		"continue_object_work",
		"finish_with_bound_receipt",
		"stop_inconclusive",
		"settle_safety",
		"form_obligations",
	],
	prerequisites: {},
	actionCostsMs: {},
	actionCostsRequests: {},
	inScopeKinds: [
		"inspect_local",
		"retrieve_reference",
		"run_discriminating_probe",
		"strengthen_verifier",
		"reselect_skills",
		"revise_implementation",
		"switch_strategy",
		"request_required_decision",
		"continue_object_work",
		"finish_with_bound_receipt",
		"stop_inconclusive",
		"settle_safety",
		"form_obligations",
	],
	...over,
});

describe("§9.4 / §14 priority-table policy", () => {
	it("interruption or unsafe feasible set wins over everything", () => {
		const state = baseState({ policy: { ...baseState().policy, interruptionReason: "cancelled" } });
		expect(selectAction(state, constraints()).kind).toBe("settle_safety");
	});
	it("required decision outranks ordinary inspection", () => {
		const state = baseState({
			obligations: [
				{
					id: "o1",
					atomId: "a1",
					ruleId: "r1",
					ruleVersion: "1",
					statement: "s",
					kind: "postcondition",
					checkMethodId: null,
					scope: "x",
					triggerObservationIds: [],
					required: true,
					impact: 9,
					novelty: 0,
					normalizedCost: 1,
					coverageFraction: 0,
					status: "blocked-high-risk",
				},
			],
		});
		expect(selectAction(state, constraints()).kind).toBe("request_required_decision");
	});
	it("new host-observed required obligation triggers obligation formation", () => {
		const state = baseState({
			obligations: [
				{
					id: "o1",
					atomId: "a1",
					ruleId: "r1",
					ruleVersion: "1",
					statement: "s",
					kind: "postcondition",
					checkMethodId: "c1",
					scope: "x",
					triggerObservationIds: [],
					required: true,
					impact: 9,
					novelty: 0,
					normalizedCost: 1,
					coverageFraction: 0,
					status: "required",
				},
			],
		});
		expect(selectAction(state, constraints()).kind).toBe("form_obligations");
	});
	it("unhealthy verifier routes to local inspection before discrimination", () => {
		const state = baseState({ verifier: { evaluations: [], runnerHealth: "degraded" } });
		expect(selectAction(state, constraints()).kind).toBe("inspect_local");
	});
	it("prediction mismatch with open hypotheses selects discriminating probe", () => {
		const pred: Omit<Prediction, "status"> = {
			predictionId: "p1",
			operationId: "op1",
			taskId: "t1",
			stageId: "s1",
			kind: "check-outcome",
			candidateHash: "cand-1",
			environmentHash: "env-1",
			checkDefinitionHash: "check-1",
			policyVersion: "p1",
			modelRevision: "m1",
			skillHashes: [],
			expectedOutcome: "pass",
			expectedBinary: true,
			estimator: "uncalibrated-model-estimate",
			counterevidenceCondition: "fail",
			hostSequence: 1,
			registeredAtMs: 1,
		};
		const ledger = resolvePrediction(registerPrediction([], pred), "p1", {
			candidateHash: "cand-1",
			environmentHash: "env-1",
			checkDefinitionHash: "check-1",
			outcome: "fail",
			binaryOutcome: false,
			observedAtMs: 2,
		}).ledger;
		const state = baseState({
			predictions: ledger,
			hypotheses: { open: ["h1", "h2"], discriminatorCandidates: [], modelMismatch: false },
		});
		expect(selectAction(state, constraints()).kind).toBe("run_discriminating_probe");
	});
	it("verifier blind spot strengthens the verifier before strategy switching", () => {
		const evaluation = evaluateVerifier(
			"o1",
			[
				{
					mutantId: "m1",
					obligationId: "o1",
					classification: "survived",
					intendedViolation: true,
				},
			],
			true,
		);
		const state = baseState({ verifier: { evaluations: [evaluation], runnerHealth: "healthy" } });
		expect(selectAction(state, constraints()).kind).toBe("strengthen_verifier");
	});
	it("stagnant strategy switches when net switch value is positive", () => {
		const key = {
			goalScope: "g",
			candidateFamily: "c",
			errorClass: "e",
			approach: "a",
			checkMethod: "t",
			sourceFamily: "s",
		};
		const history = Array.from({ length: 3 }, () => ({
			key: progressKey(key),
			newEvidence: false,
			resolvedObligations: 0,
			newValidChecks: 0,
		}));
		const state = baseState({ progressHistory: history });
		const action = selectAction(state, constraints(), {
			progress: key,
			maxRepetitions: 3,
			estimatedSwitchGain: 1,
			switchCost: 0.1,
		});
		expect(action.kind).toBe("switch_strategy");
	});
	it("stagnant strategy stops inconclusively when switching is not worth it", () => {
		const key = {
			goalScope: "g",
			candidateFamily: "c",
			errorClass: "e",
			approach: "a",
			checkMethod: "t",
			sourceFamily: "s",
		};
		const history = Array.from({ length: 3 }, () => ({
			key: progressKey(key),
			newEvidence: false,
			resolvedObligations: 0,
			newValidChecks: 0,
		}));
		const state = baseState({ progressHistory: history });
		const action = selectAction(state, constraints(), {
			progress: key,
			maxRepetitions: 3,
			estimatedSwitchGain: 0,
			switchCost: 0.1,
		});
		expect(action.kind).toBe("stop_inconclusive");
	});
	it("feasible set excludes unauthorized, over-budget and out-of-scope actions", () => {
		const state = baseState({
			budget: { remainingMs: 10, remainingRequests: 0, remainingTokens: 100, remainingConcurrent: 1 },
		});
		const c = constraints({ actionCostsMs: { inspect_local: 60_000 } });
		const set = feasibleActions(state, c);
		expect(set).not.toContain("inspect_local");
		expect(set).toContain("stop_inconclusive");
	});
});

describe("finish states (§9.5)", () => {
	it("verified completion requires receipt bound to the current candidate", () => {
		const state = baseState();
		expect(finishState(state, { receiptId: "r1", candidateHash: "cand-1", scope: "s" }).kind).toBe(
			"verified-completion",
		);
		expect(() => finishState(state, { receiptId: "r1", candidateHash: "other", scope: "s" })).toThrow();
	});
	it("open required obligations force inconclusive, never completion", () => {
		const state = baseState({
			obligations: [
				{
					id: "o1",
					atomId: "a1",
					ruleId: "r1",
					ruleVersion: "1",
					statement: "s",
					kind: "postcondition",
					checkMethodId: "c1",
					scope: "x",
					triggerObservationIds: [],
					required: true,
					impact: 9,
					novelty: 0,
					normalizedCost: 1,
					coverageFraction: 0,
					status: "required",
				},
			],
		});
		expect(finishState(state, { receiptId: "r1", candidateHash: "cand-1", scope: "s" }).kind).toBe("inconclusive");
		expect(finishState(state, null).kind).toBe("inconclusive");
	});
});

describe("checkpoint integration (§9.4)", () => {
	const atoms: ChangeAtom[] = [
		{
			id: "a1",
			targetId: "src/search.ts",
			operation: "mutate",
			trustBoundary: "ui-state",
			temporal: "async",
			externalEffect: "write",
			source: "host-observed",
			analyzerCoverage: "covered",
		},
	];
	const rules: ObligationRule[] = [
		{
			ruleId: "async-boundary",
			ruleVersion: "1",
			description: "late async results must not overwrite newer state",
			match: { temporal: ["async", "concurrent"] },
			produce: [
				{
					obligationId: "ordering",
					statement: "ordering",
					kind: "postcondition",
					checkMethodId: "ordering-check",
					required: true,
					impact: 9,
				},
			],
		},
	];
	it("checkpoint refreshes obligations, selects action, and never fabricates completion", () => {
		const result = checkpoint({
			state: baseState(),
			atoms,
			rules,
			nowMs: 1000,
			constraints: constraints(),
		});
		expect(result.newObligations).toBe(1);
		expect(result.action.kind).toBe("form_obligations");
		expect(result.finish.kind).toBe("inconclusive");
	});
	it("mutant evaluation inside checkpoint surfaces blind spots", () => {
		const mutants: MutantRecord[] = [
			{
				mutantId: "m1",
				obligationId: "async-boundary:a1:ordering",
				classification: "survived",
				intendedViolation: true,
			},
		];
		const result = checkpoint({ state: baseState(), atoms, rules, nowMs: 1000, constraints: constraints(), mutants });
		expect(result.verifierEvaluations.length).toBeGreaterThan(0);
		expect(result.verifierEvaluations[0]!.detectionRate).toBe(0);
	});
	it("receipt bound to current candidate yields verified completion when obligations are met", () => {
		const state = baseState();
		const result = checkpoint({
			state,
			nowMs: 1000,
			constraints: constraints(),
			receipt: { receiptId: "r1", candidateHash: "cand-1", scope: "ui-search" },
		});
		expect(result.finish.kind).toBe("verified-completion");
	});
});
