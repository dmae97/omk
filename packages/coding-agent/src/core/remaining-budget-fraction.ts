/**
 * Injected remaining-budget fraction for the progress-stall detector.
 *
 * Prefers the shared {@link RemainingBudget} clock when one is bound; otherwise
 * falls back to `OMK_TIME_BUDGET_SEC` plus a start timestamp (temporary until
 * every caller binds the shared clock).
 */
import {
	createRemainingBudgetFromEnv,
	getActiveRemainingBudget,
	type RemainingBudget,
	resolveTimeBudgetMs,
} from "./remaining-budget.ts";

export type RemainingBudgetFraction = () => number | undefined;

export { resolveTimeBudgetMs };

export function remainingFractionFromBudget(budget: RemainingBudget | undefined): RemainingBudgetFraction {
	return () => (budget ? budget.remainingFraction() : undefined);
}

export function createEnvRemainingBudgetFraction(options?: {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	readonly startedAt?: number;
}): RemainingBudgetFraction {
	const active = getActiveRemainingBudget();
	if (active && options?.env === undefined && options?.startedAt === undefined) {
		return () => active.remainingFraction();
	}
	const budget = createRemainingBudgetFromEnv(options);
	return remainingFractionFromBudget(budget);
}
