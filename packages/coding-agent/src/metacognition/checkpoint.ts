/**
 * §9.4 checkpoint ordering: refresh obligations from host observations,
 * evaluate knowledge gaps, classify prediction mismatches, evaluate verifier
 * blind spots and runner health, then select one bounded action.
 *
 * The host calls this at a safe decision boundary — never mid-stream, and
 * never as a path for model reasoning to remove a `required` obligation.
 */
import type { ChangeAtom, ObligationRule } from "./obligations.ts";
import { instantiateObligations } from "./obligations.ts";
import { type ActionConstraints, type MetaAction, type MetaActionKind, selectAction } from "./policy.ts";
import type { MetaState } from "./state.ts";
import { type FinishState, finishState, validateMetaState } from "./state.ts";
import { integer } from "./validation.ts";
import { evaluateVerifier, type MutantRecord, type VerifierEvaluation } from "./verifier.ts";

export interface CheckpointInput {
	readonly state: MetaState;
	readonly atoms?: readonly ChangeAtom[];
	readonly rules?: readonly ObligationRule[];
	readonly nowMs: number;
	readonly constraints: ActionConstraints;
	readonly mutants?: readonly MutantRecord[];
	readonly receipt?: { receiptId: string; candidateHash: string; scope: string } | null;
	readonly options?: {
		readonly maxRepetitions?: number;
		readonly switchCost?: number;
		readonly estimatedSwitchGain?: number;
		readonly voiCandidates?: readonly { kind: MetaActionKind; voi: number }[];
		readonly progress?: {
			readonly goalScope: string;
			readonly candidateFamily: string;
			readonly errorClass: string;
			readonly approach: string;
			readonly checkMethod: string;
			readonly sourceFamily: string;
		};
	};
}
export interface CheckpointResult {
	readonly state: MetaState;
	readonly action: MetaAction;
	readonly finish: FinishState;
	readonly newObligations: number;
	readonly newPredictions: number;
	readonly mismatches: number;
	readonly verifierEvaluations: readonly VerifierEvaluation[];
}

/**
 * One checkpoint evaluation. Refreshes obligations from observed atoms when
 * provided, resolves registered predictions against fresh observations when
 * provided, evaluates verifier mutants when provided, then selects the next
 * action under the §14 priority table.
 */
export function checkpoint(input: CheckpointInput): CheckpointResult {
	integer(input.nowMs, "nowMs");
	validateMetaState(input.state);
	let state = input.state;
	let newObligations = 0;
	if (input.atoms && input.rules) {
		const report = instantiateObligations(input.atoms, input.rules, input.nowMs);
		const merged = [...state.obligations, ...report.required, ...report.candidates];
		newObligations = report.required.length + report.candidates.length;
		state = { ...state, obligations: merged };
	}
	let mismatches = 0;
	for (const p of state.predictions) {
		if (p.status === "resolved" && p.mismatch !== undefined && p.mismatch !== "none") mismatches += 1;
	}
	const verifierEvaluations: VerifierEvaluation[] = [...state.verifier.evaluations];
	if (input.mutants) {
		for (const obligation of state.obligations) {
			const scoped = input.mutants.filter((m) => m.obligationId === obligation.id);
			if (scoped.length === 0) continue;
			verifierEvaluations.push(
				evaluateVerifier(obligation.id, input.mutants, state.verifier.runnerHealth === "healthy"),
			);
		}
		state = { ...state, verifier: { ...state.verifier, evaluations: verifierEvaluations } };
	}
	const action = selectAction(state, input.constraints, {
		receipt: input.receipt ?? null,
		maxRepetitions: input.options?.maxRepetitions,
		switchCost: input.options?.switchCost,
		estimatedSwitchGain: input.options?.estimatedSwitchGain,
		voiCandidates: input.options?.voiCandidates,
		progress: input.options?.progress,
	});
	const finish = finishState(state, input.receipt ?? null);
	return {
		state: { ...state, checkpointCount: state.checkpointCount + 1 },
		action,
		finish,
		newObligations,
		newPredictions: 0,
		mismatches,
		verifierEvaluations,
	};
}
