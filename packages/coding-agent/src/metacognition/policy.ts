/**
 * Algorithm F — bounded metacontrol policy. Spec §9, §14.
 *
 * Feasibility precedes optimization: an action that is unauthorized, missing
 * prerequisites, over budget, or out of scope is absent from the feasible set
 * no matter how much information it promises. The baseline policy is the
 * explicit priority table of §14, not a score-sum that folds safety
 * constraints into a utility number.
 */
import { experimentValue } from "./decision.ts";
import type { MetaState } from "./state.ts";
import { isStagnant, netSwitchValue, progressKey } from "./verifier.ts";

export type MetaActionKind =
	| "inspect_local"
	| "retrieve_reference"
	| "run_discriminating_probe"
	| "strengthen_verifier"
	| "reselect_skills"
	| "revise_implementation"
	| "switch_strategy"
	| "request_required_decision"
	| "continue_object_work"
	| "finish_with_bound_receipt"
	| "stop_inconclusive"
	| "settle_safety"
	| "form_obligations";

export interface MetaAction {
	readonly kind: MetaActionKind;
	readonly obligationId?: string;
	readonly hypothesisId?: string;
	readonly reason: string;
	readonly priority: number;
}

export interface ActionConstraints {
	readonly authorizedActions: readonly MetaActionKind[];
	readonly prerequisites: Partial<Readonly<Record<MetaActionKind, readonly string[]>>>;
	readonly actionCostsMs: Partial<Readonly<Record<MetaActionKind, number>>>;
	readonly actionCostsRequests: Partial<Readonly<Record<MetaActionKind, number>>>;
	readonly inScopeKinds: readonly MetaActionKind[];
}

const ALL_KINDS: readonly MetaActionKind[] = [
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
];

/** §9.2: Authorized ∧ Prerequisites ∧ BudgetFits ∧ ScopeBound. */
export function feasibleActions(state: MetaState, constraints: ActionConstraints): MetaActionKind[] {
	return ALL_KINDS.filter((kind) => {
		if (!constraints.authorizedActions.includes(kind)) return false;
		if (!constraints.inScopeKinds.includes(kind)) return false;
		for (const prereq of constraints.prerequisites[kind] ?? []) {
			const met =
				state.obligations.some((o) => o.id === prereq && o.status === "satisfied") ||
				state.predictions.some((p) => p.predictionId === prereq && p.status === "resolved");
			if (!met) return false;
		}
		const ms = constraints.actionCostsMs[kind] ?? 0;
		const req = constraints.actionCostsRequests[kind] ?? 0;
		return ms <= state.budget.remainingMs && req <= state.budget.remainingRequests;
	});
}

/**
 * §14 priority table — the baseline deterministic policy. Safety first, then
 * required decisions, host-observed obligations, verifier health, prediction
 * mismatches, verifier blind spots, stagnation, optional positive-VOI work,
 * object work, then finish.
 */
export function selectAction(
	state: MetaState,
	constraints: ActionConstraints,
	options?: {
		readonly receipt?: { receiptId: string; candidateHash: string; scope: string } | null;
		readonly maxRepetitions?: number;
		readonly switchCost?: number;
		readonly estimatedSwitchGain?: number;
		readonly voiCandidates?: readonly { kind: MetaActionKind; voi: number }[];
		readonly progress?: {
			goalScope: string;
			candidateFamily: string;
			errorClass: string;
			approach: string;
			checkMethod: string;
			sourceFamily: string;
		};
	},
): MetaAction {
	const feasible = new Set(feasibleActions(state, constraints));
	const pick = (
		kind: MetaActionKind,
		reason: string,
		priority: number,
		extra?: Partial<MetaAction>,
	): MetaAction | null => (feasible.has(kind) ? { kind, reason, priority, ...extra } : null);

	// 0: cancellation, authorization violation, safety constraint, binding mismatch.
	if (
		state.policy.interruptionReason !== null ||
		state.facts.candidateHash === "" ||
		!constraints.authorizedActions.every((a) => state.policy.authorizedActions.includes(a))
	) {
		return (
			pick("settle_safety", "safety-or-binding", 0) ?? {
				kind: "stop_inconclusive",
				reason: "unsafe-feasible-set",
				priority: 0,
			}
		);
	}
	// 1: required user decision or unknown prerequisite.
	const needsDecision = state.obligations.find(
		(o) => o.status === "blocked-high-risk" || (o.status === "required" && o.checkMethodId === null && o.required),
	);
	if (needsDecision) {
		const action = pick("request_required_decision", `required-decision:${needsDecision.id}`, 1, {
			obligationId: needsDecision.id,
		});
		if (action) return action;
	}
	// 2: host-observed new required obligation → refresh obligations, gate the step.
	const newRequired = state.obligations.find((o) => o.status === "required" && o.coverageFraction === 0);
	if (newRequired) {
		const action = pick("form_obligations", `new-required:${newRequired.id}`, 2, { obligationId: newRequired.id });
		if (action) return action;
	}
	// 3: check execution itself invalid → diagnose environment, not code.
	if (state.verifier.runnerHealth !== "healthy") {
		const action = pick("inspect_local", "verifier-health-unverified", 3);
		if (action) return action;
	}
	// 4: prediction mismatch or adoptable evidence conflict → discriminate causes.
	const mismatch = state.predictions.find(
		(p) => p.status === "resolved" && p.mismatch !== undefined && p.mismatch !== "none",
	);
	if (mismatch && state.hypotheses.open.length > 1) {
		const action = pick("run_discriminating_probe", `mismatch:${mismatch.predictionId}`, 4, {
			hypothesisId: state.hypotheses.open[0],
		});
		if (action) return action;
	}
	// 5: verifier blind spot on an important obligation → negative control / new check.
	const blind = state.verifier.evaluations.find((e) => e.detectionRate === "unknown" || e.blindSpots.length > 0);
	if (blind) {
		const action = pick("strengthen_verifier", `blind-spot:${blind.obligationId}`, 5, {
			obligationId: blind.obligationId,
		});
		if (action) return action;
	}
	// 6: same strategy, no valid progress → switch with hysteresis, or stop.
	const maxRep = options?.maxRepetitions ?? 3;
	if (options?.progress && isStagnant(options.progress, state.progressHistory, maxRep)) {
		const switchGain = netSwitchValue(options.estimatedSwitchGain ?? 0, 0, options.switchCost ?? 0);
		if (switchGain > 0) {
			const action = pick("switch_strategy", `stagnant:${progressKey(options.progress)}`, 6);
			if (action) return action;
		}
		const stop = pick("stop_inconclusive", "stagnant-no-progress", 6);
		if (stop) return stop;
	}
	// 7: optional information acquisition with positive VOI.
	const voi = (options?.voiCandidates ?? [])
		.filter((c) => c.voi > 0 && feasible.has(c.kind))
		.sort((a, b) => b.voi - a.voi);
	if (voi.length > 0) {
		return (
			pick(voi[0]!.kind, `positive-voi:${voi[0]!.voi}`, 7) ?? {
				kind: "stop_inconclusive",
				reason: "no-feasible-voi-action",
				priority: 7,
			}
		);
	}
	// 8: premises sufficient, object work remains.
	const openRequired = state.obligations.filter((o) => o.status === "required" || o.status === "violated");
	if (openRequired.length === 0) {
		const action = pick("continue_object_work", "premises-satisfied", 8);
		if (action) return action;
	}
	// 9: object work done → verified bounded completion or inconclusive stop.
	if (options?.receipt && openRequired.length === 0) {
		const action = pick("finish_with_bound_receipt", `receipt:${options.receipt.receiptId}`, 9);
		if (action) return action;
	}
	const blocked =
		pick("revise_implementation", `open-obligations:${openRequired.length}`, 8) ??
		pick("inspect_local", "open-obligations-inspect", 8);
	if (blocked) return blocked;
	return { kind: "stop_inconclusive", reason: "no-feasible-action", priority: 9 };
}

/**
 * §6.2/§6.5 VOI evaluation for one observation action. Returns the finite
 * computation result; the caller supplies real priors and likelihoods and may
 * include approved 2-step bundles whose joint value is computed the same way.
 */
export function valueOfObservation(
	prior: readonly number[],
	losses: readonly (readonly number[])[],
	likelihoodByHypothesis: readonly (readonly number[])[],
	cost: number,
): number {
	return experimentValue(prior, losses, likelihoodByHypothesis, cost).netValue;
}
