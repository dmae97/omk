/**
 * Default wall-clock remaining-budget fraction from `OMK_TIME_BUDGET_SEC` and a
 * start timestamp. A shared RemainingBudget clock can replace this later by
 * injecting {@link RemainingBudgetFraction} into the stall extension.
 */
export type RemainingBudgetFraction = () => number | undefined;

export function resolveTimeBudgetMs(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const seconds = Number(value);
	if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
	return Math.round(seconds * 1000);
}

export function createEnvRemainingBudgetFraction(options?: {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	readonly startedAt?: number;
}): RemainingBudgetFraction {
	const env = options?.env ?? process.env;
	const now = options?.now ?? Date.now;
	const budgetMs = resolveTimeBudgetMs(env.OMK_TIME_BUDGET_SEC);
	const startedAt = options?.startedAt ?? now();
	return () => {
		if (budgetMs === undefined) return undefined;
		const remaining = 1 - (now() - startedAt) / budgetMs;
		if (!Number.isFinite(remaining)) return undefined;
		return remaining;
	};
}
