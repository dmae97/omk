/**
 * §11/§15 evaluation tests: DR estimator honesty bounds, experience record
 * validation, completion metrics denominators, and observation-mode
 * diagnostics that never alter the completion verdict.
 */
import { describe, expect, it } from "vitest";
import {
	type ActionConstraints,
	attachMetaDiagnostics,
	completionMetrics,
	createCalibrationStore,
	doublyRobustEstimate,
	evaluateVerifier,
	hiddenObligationMetrics,
	type MetaState,
	observeCheckpoint,
	type Prediction,
	registerPrediction,
	resolvePrediction,
	validateExperienceRecord,
} from "../src/metacognition/index.ts";

describe("§11 doubly robust estimation", () => {
	it("computes the single-decision DR value over supported contexts", () => {
		const result = doublyRobustEstimate({
			decisions: [
				{ contextHash: "x1", action: "search", reward: 1, propensity: 0.5 },
				{ contextHash: "x2", action: "inspect", reward: 0, propensity: 0.5 },
			],
			evaluatedActions: ["search", "search"],
			rewardModel: [
				[0.5, 0.5],
				[0.4, 0.4],
			],
		});
		expect(result.n).toBe(2);
		expect(Number.isFinite(result.value)).toBe(true);
	});
	it("excludes contexts where the evaluated action had no logged support", () => {
		const result = doublyRobustEstimate({
			decisions: [
				{ contextHash: "x1", action: "search", reward: 1, propensity: 0 },
				{ contextHash: "x2", action: "inspect", reward: 0, propensity: 0.5 },
			],
			evaluatedActions: ["search", "search"],
			rewardModel: [[0.5], [0.4]],
		});
		expect(result.unsupported).toBe(1);
		expect(result.n).toBe(1);
	});
	it("rejects invented propensities and mismatched shapes", () => {
		expect(() =>
			doublyRobustEstimate({
				decisions: [{ contextHash: "x", action: "a", reward: 1, propensity: Number.NaN }],
				evaluatedActions: ["a"],
				rewardModel: [[0.5]],
			}),
		).toThrow();
		expect(() =>
			doublyRobustEstimate({
				decisions: [{ contextHash: "x", action: "a", reward: 1, propensity: 0.5 }],
				evaluatedActions: [],
				rewardModel: [[0.5]],
			}),
		).toThrow();
	});
	it("experience record schema is validated, not free text", () => {
		expect(() =>
			validateExperienceRecord({
				recordId: "r1",
				conditions: { modelRevision: "m1", toolchain: "tc", environmentHash: "e", taskBand: "ui" },
				failureMechanism: "late async write overwrote newer state",
				firstWrongExpectation: "cancel was enough",
				discriminatingObservation: "controlled out-of-order response",
				appliedFixOrStrategy: "apply-if-latest guard",
				checksBefore: ["unit"],
				checksAfter: ["ordering-regression"],
				knownCounterexamples: [],
				applicabilityConditions: ["unordered results"],
				evidenceRefs: ["receipt:r1"],
				policyVersion: "p1",
				skillHashes: [],
			}),
		).not.toThrow();
	});
});

describe("§15 outcome metrics", () => {
	it("false completion uses both declared and all-task denominators", () => {
		const m = completionMetrics({
			declaredComplete: 10,
			independentFailAmongDeclared: 2,
			allTasks: 20,
			succeeded: 15,
			abstained: 3,
			totalCost: 100,
		});
		expect(m.falseCompletionDeclared).toBeCloseTo(0.2, 12);
		expect(m.falseCompletionAll).toBeCloseTo(0.1, 12);
		expect(m.successRate).toBeCloseTo(0.75, 12);
		expect(m.abstainRate).toBeCloseTo(0.15, 12);
	});
	it("zero denominators are undefined, never silently 0 or 1", () => {
		const m = completionMetrics({
			declaredComplete: 0,
			independentFailAmongDeclared: 0,
			allTasks: 0,
			succeeded: 0,
			abstained: 0,
			totalCost: 0,
		});
		expect(m.falseCompletionDeclared).toBeUndefined();
		expect(m.falseCompletionAll).toBeUndefined();
	});
	it("hidden obligation detection exposes rate and false alarms separately", () => {
		const m = hiddenObligationMetrics(3, 5, 2);
		expect(m.detectionRate).toBeCloseTo(0.6, 12);
		expect(m.falseAlarms).toBe(2);
		expect(hiddenObligationMetrics(0, 0, 0).detectionRate).toBeUndefined();
	});
});

describe("observation mode diagnostics", () => {
	const constraints = (over: Partial<ActionConstraints> = {}): ActionConstraints => ({
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
			"settle_safety",
			"reselect_skills",
			"retrieve_reference",
		],
		prerequisites: {},
		actionCostsMs: {},
		actionCostsRequests: {},
		inScopeKinds: [
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
			"settle_safety",
			"reselect_skills",
			"retrieve_reference",
		],
		...over,
	});
	const state = (over: Partial<MetaState> = {}): MetaState => ({
		goal: { taskId: "t1", stageId: "s1", targetArtifact: "src/x.ts", goalScope: "g" },
		facts: {
			candidateHash: "cand-1",
			environmentHash: "env-1",
			changeScope: ["src/x.ts"],
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
		budget: { remainingMs: 1000, remainingRequests: 10, remainingTokens: 1000, remainingConcurrent: 2 },
		policy: {
			policyVersion: "p1",
			authorizedActions: constraints().authorizedActions,
			requiredApprovals: [],
			interruptionReason: null,
		},
		hostSequence: 0,
		progressHistory: [],
		checkpointCount: 0,
		...over,
	});
	it("diagnostic reports mismatches, blind spots, and proposed action without changing finish", () => {
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
		const blind = evaluateVerifier(
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
		const s = state({ predictions: ledger, verifier: { evaluations: [blind], runnerHealth: "healthy" } });
		const d = attachMetaDiagnostics(s, constraints(), 1000);
		expect(d.schema).toBe("omk.metacognition.diagnostic.v1");
		expect(d.unresolvedMismatches).toBe(1);
		expect(d.verifierBlindSpots).toBeGreaterThan(0);
		// §9.5: mismatches and blind spots trigger action branches, not a
		// different finish state — finish stays "continue" until obligations
		// open or budget dies.
		expect(d.finishKind).toBe("continue");
		expect(d.proposedAction).toBe("strengthen_verifier");
	});
	it("observeCheckpoint returns both kernel result and attachable diagnostic", () => {
		const { result, diagnostic } = observeCheckpoint(state(), constraints(), 1000);
		expect(result.action.kind).toBeDefined();
		expect(diagnostic.taskId).toBe("t1");
		expect(diagnostic.checkpointCount).toBe(1);
	});
});
