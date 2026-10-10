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
	const explicitClock = options?.env !== undefined || options?.startedAt !== undefined;
	const fallback = remainingFractionFromBudget(createRemainingBudgetFromEnv(options));
	if (explicitClock) return fallback;
	// Look up the shared clock on every call so whoever binds it later (finish-check, bash) still wins
	// and creation order never splits one run into two clocks.
	return () => {
		const active = getActiveRemainingBudget();
		return active ? active.remainingFraction() : fallback();
	};
}
