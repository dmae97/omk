/**
 * §11 causal strategy evaluation + §15 outcome metrics.
 *
 * Doubly Robust estimation is a second-stage offline tool over logged
 * single-checkpoint decisions: it needs real logged propensities, action
 * support, and rewards — never probabilities invented after the fact.
 * Completion metrics report false-completion alongside success/abstain rates,
 * because a policy that never completes can trivially zero false completions.
 */
import { ensure, finite, integer, probability, text } from "./validation.ts";

/** One logged decision for DR evaluation. Single checkpoint, not a trajectory. */
export interface LoggedDecision {
	readonly contextHash: string;
	readonly action: string;
	readonly reward: number;
	/** Logged selection probability under the recording policy. Required, never imputed. */
	readonly propensity: number;
}
export interface DRInput {
	readonly decisions: readonly LoggedDecision[];
	/** π(a|x): the evaluated policy's action for each logged context. */
	readonly evaluatedActions: readonly string[];
	/** r̂(x,a): reward model per context-action pair. */
	readonly rewardModel: readonly (readonly number[])[];
}
export interface DREstimate {
	readonly value: number;
	readonly n: number;
	readonly clipped: number;
	/** Contexts where the evaluated action had zero logged support — excluded, never imputed. */
	readonly unsupported: number;
}

/**
 * Single-decision Doubly Robust estimate:
 * V̂_DR(π) = 1/n Σ [ Σ_a π(a|x_i)r̂(x_i,a) + (π(a_i|x_i)/μ(a_i|x_i))(r_i - r̂(x_i,a_i)) ].
 * Deterministic logging policies that never tried an action cannot evaluate
 * that action post-hoc — those rows are excluded and counted.
 */
export function doublyRobustEstimate(input: DRInput, maxWeight = 50): DREstimate {
	const { decisions, evaluatedActions, rewardModel } = input;
	integer(decisions.length, "decisions", 1_000_000);
	ensure(decisions.length > 0, "no logged decisions");
	ensure(evaluatedActions.length === decisions.length, "evaluated action count mismatch");
	ensure(rewardModel.length === decisions.length, "reward model row mismatch");
	finite(maxWeight, "maxWeight", 1e9);
	let sum = 0,
		clipped = 0,
		unsupported = 0,
		usable = 0;
	for (let i = 0; i < decisions.length; i++) {
		const d = decisions[i]!;
		text(d.contextHash, "contextHash", 256);
		text(d.action, "action", 128);
		finite(d.reward, "reward");
		probability(d.propensity, "propensity");
		text(evaluatedActions[i]!, "evaluated action", 128);
		const rewards = rewardModel[i]!;
		ensure(rewards.length > 0, "reward model row empty");
		for (const r of rewards) finite(r, "reward model value");
		// Contexts may carry several logged actions; μ is per recorded decision.
		const modelMean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
		if (d.propensity === 0 && d.action === evaluatedActions[i]) {
			unsupported++;
			continue;
		}
		usable++;
		const weight = d.action === evaluatedActions[i] ? Math.min(maxWeight, 1 / d.propensity) : 0;
		if (weight === maxWeight) clipped++;
		sum += modelMean + weight * (d.reward - modelMean);
	}
	ensure(usable > 0, "no decisions with logged support for the evaluated policy");
	return { value: sum / usable, n: usable, clipped, unsupported };
}

/** §11.3 experience memory — failure mechanism and discrimination, not essays. */
export interface ExperienceRecord {
	readonly recordId: string;
	readonly conditions: {
		readonly modelRevision: string;
		readonly toolchain: string;
		readonly environmentHash: string;
		readonly taskBand: string;
	};
	readonly failureMechanism: string;
	readonly firstWrongExpectation: string;
	readonly discriminatingObservation: string;
	readonly appliedFixOrStrategy: string;
	readonly checksBefore: readonly string[];
	readonly checksAfter: readonly string[];
	readonly knownCounterexamples: readonly string[];
	readonly applicabilityConditions: readonly string[];
	readonly evidenceRefs: readonly string[];
	readonly policyVersion: string;
	readonly skillHashes: readonly string[];
}
export function validateExperienceRecord(r: ExperienceRecord): void {
	text(r.recordId, "recordId", 128);
	text(r.failureMechanism, "failureMechanism", 2048);
	text(r.firstWrongExpectation, "firstWrongExpectation", 2048);
	text(r.discriminatingObservation, "discriminatingObservation", 2048);
	text(r.appliedFixOrStrategy, "appliedFixOrStrategy", 2048);
	text(r.policyVersion, "policyVersion", 64);
	for (const list of [
		r.checksBefore,
		r.checksAfter,
		r.knownCounterexamples,
		r.applicabilityConditions,
		r.evidenceRefs,
		r.skillHashes,
	]) {
		ensure(Array.isArray(list) && list.length <= 128, "experience record list bound");
	}
}

/** §15.3 completion metrics. Zero denominators are `undefined`, never 0 or 1. */
export interface OutcomeCounts {
	readonly declaredComplete: number;
	readonly independentFailAmongDeclared: number;
	readonly allTasks: number;
	readonly succeeded: number;
	readonly abstained: number;
	readonly totalCost: number;
}
export function completionMetrics(c: OutcomeCounts): {
	readonly falseCompletionDeclared?: number;
	readonly falseCompletionAll?: number;
	readonly successRate?: number;
	readonly abstainRate?: number;
	readonly meanCost?: number;
} {
	integer(c.declaredComplete, "declaredComplete");
	integer(c.independentFailAmongDeclared, "independentFail");
	integer(c.allTasks, "allTasks");
	integer(c.succeeded, "succeeded");
	integer(c.abstained, "abstained");
	finite(c.totalCost, "totalCost");
	ensure(c.independentFailAmongDeclared <= c.declaredComplete, "fail count exceeds declared");
	ensure(
		c.declaredComplete <= c.allTasks && c.succeeded <= c.allTasks && c.abstained <= c.allTasks,
		"counts exceed task total",
	);
	return {
		falseCompletionDeclared: c.declaredComplete > 0 ? c.independentFailAmongDeclared / c.declaredComplete : undefined,
		falseCompletionAll: c.allTasks > 0 ? c.independentFailAmongDeclared / c.allTasks : undefined,
		successRate: c.allTasks > 0 ? c.succeeded / c.allTasks : undefined,
		abstainRate: c.allTasks > 0 ? c.abstained / c.allTasks : undefined,
		meanCost: c.allTasks > 0 ? c.totalCost / c.allTasks : undefined,
	};
}

/** §15.3 hidden-obligation detection with false alarms, for held-out requirements. */
export function hiddenObligationMetrics(
	detected: number,
	totalHidden: number,
	falseAlarms: number,
): {
	readonly detectionRate?: number;
	readonly falseAlarms: number;
} {
	integer(detected, "detected");
	integer(totalHidden, "totalHidden");
	integer(falseAlarms, "falseAlarms");
	ensure(detected <= totalHidden, "detected exceeds hidden total");
	return {
		detectionRate: totalHidden > 0 ? detected / totalHidden : undefined,
		falseAlarms,
	};
}
