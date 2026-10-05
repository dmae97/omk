/**
 * Shared wall-clock budget for a coding run.
 *
 * Harnesses pass `OMK_TIME_BUDGET_SEC`. Finish-check (75% save / 90% skip),
 * bash timeout clamps, and the progress-stall detector all read the same clock
 * so a long command cannot hold the turn past the reserve kept for save+verify.
 */

/** Keep this fraction of the total budget free for save + verify (matches finish-check skip at 0.9). */
export const REMAINING_BUDGET_SAVE_RESERVE_FRACTION = 0.1;
/** At or below this remaining fraction, bash clamps to a hard 1s deadline. */
export const REMAINING_BUDGET_HARD_KILL_FRACTION = 0.1;

export type BashTimeoutPolicy = "unbounded" | "soft" | "hard";

export interface RemainingBudgetOptions {
	readonly budgetMs: number;
	readonly now?: () => number;
	readonly startedAt?: number;
}

export interface ClampBashTimeoutResult {
	/** Seconds passed to the bash executor. */
	readonly timeoutSec: number;
	/** Whether the requested timeout was reduced. */
	readonly clamped: boolean;
	readonly policy: BashTimeoutPolicy;
	/** Whole seconds still on the clock after the clamp (0 when hard). */
	readonly remainingSec: number;
}

export class RemainingBudget {
	readonly budgetMs: number;
	private readonly now: () => number;
	private startedAt: number;
	/** Wall time excluded from the budget (for example harness snapshot waits). */
	private excludedMs = 0;

	constructor(options: RemainingBudgetOptions) {
		if (!Number.isFinite(options.budgetMs) || options.budgetMs <= 0) {
			throw new Error("RemainingBudget requires a positive budgetMs");
		}
		this.budgetMs = Math.round(options.budgetMs);
		this.now = options.now ?? Date.now;
		this.startedAt = options.startedAt ?? this.now();
	}

	/** Move the start forward so a wait does not consume the run budget. */
	addExcludedWaitMs(ms: number): void {
		if (!Number.isFinite(ms) || ms <= 0) return;
		this.excludedMs += ms;
	}

	elapsedMs(): number {
		return Math.max(0, this.now() - this.startedAt - this.excludedMs);
	}

	remainingMs(): number {
		return Math.max(0, this.budgetMs - this.elapsedMs());
	}

	/** 1 at start, 0 when the budget is exhausted. Undefined never — this clock always has a budget. */
	remainingFraction(): number {
		return this.remainingMs() / this.budgetMs;
	}

	elapsedFraction(): number {
		return this.elapsedMs() / this.budgetMs;
	}

	reserveMs(): number {
		return Math.round(this.budgetMs * REMAINING_BUDGET_SAVE_RESERVE_FRACTION);
	}

	bashTimeoutPolicy(): BashTimeoutPolicy {
		const remaining = this.remainingFraction();
		if (remaining <= REMAINING_BUDGET_HARD_KILL_FRACTION) return "hard";
		return "soft";
	}

	/**
	 * Cap a bash timeout so one command cannot eat the save+verify reserve.
	 * `requestedSec` is the model-supplied or default timeout in seconds.
	 */
	clampBashTimeoutSec(requestedSec: number): ClampBashTimeoutResult {
		const safeRequested = Number.isFinite(requestedSec) && requestedSec > 0 ? Math.floor(requestedSec) : 1;
		const remainingSec = Math.floor(this.remainingMs() / 1000);
		const policy = this.bashTimeoutPolicy();
		if (policy === "hard") {
			return {
				timeoutSec: 1,
				clamped: safeRequested > 1,
				policy,
				remainingSec,
			};
		}
		const availableMs = this.remainingMs() - this.reserveMs();
		const availableSec = Math.max(1, Math.floor(availableMs / 1000));
		const timeoutSec = Math.min(safeRequested, availableSec);
		return {
			timeoutSec,
			clamped: timeoutSec < safeRequested,
			policy,
			remainingSec,
		};
	}
}

/** `OMK_TIME_BUDGET_SEC`: wall-clock seconds the caller allows for the whole run. */
export function resolveTimeBudgetMs(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const seconds = Number(value);
	if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
	return Math.round(seconds * 1000);
}

export function createRemainingBudgetFromEnv(options?: {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	readonly startedAt?: number;
}): RemainingBudget | undefined {
	const env = options?.env ?? process.env;
	const budgetMs = resolveTimeBudgetMs(env.OMK_TIME_BUDGET_SEC);
	if (budgetMs === undefined) return undefined;
	return new RemainingBudget({
		budgetMs,
		now: options?.now,
		startedAt: options?.startedAt,
	});
}

let activeBudget: RemainingBudget | undefined;

/** Session / process binding used by bash and by injectors that prefer the shared clock. */
export function bindActiveRemainingBudget(budget: RemainingBudget | undefined): void {
	activeBudget = budget;
}

export function getActiveRemainingBudget(): RemainingBudget | undefined {
	return activeBudget;
}

/**
 * Return the active clock, or lazily bind one from `OMK_TIME_BUDGET_SEC` on first use.
 * Call sites that must not start a clock (pure tests) should pass `{ bind: false }`.
 */
export function ensureActiveRemainingBudget(options?: {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	readonly bind?: boolean;
}): RemainingBudget | undefined {
	if (activeBudget) return activeBudget;
	const budget = createRemainingBudgetFromEnv(options);
	if (budget && options?.bind !== false) bindActiveRemainingBudget(budget);
	return budget;
}

/** Hint appended when a bash command is cut short by the budget clamp. */
export function bashBudgetTimeoutMessage(result: ClampBashTimeoutResult): string {
	if (result.policy === "hard") {
		return `Command timed out after ${result.timeoutSec} seconds (time budget nearly exhausted; save outputs and finish).`;
	}
	return `Command timed out after ${result.timeoutSec} seconds (${result.remainingSec}s left on the run budget; narrow the work or continue in the background).`;
}

/** Resolve the seconds bash should wait, honoring an optional RemainingBudget clamp. */
export function resolveBashTimeoutForBudget(
	requestedTimeoutSec: number | undefined,
	defaultTimeoutSec: number,
	budget: RemainingBudget | undefined,
): { readonly effectiveTimeoutSec: number; readonly clamp: ClampBashTimeoutResult | undefined } {
	const requested =
		requestedTimeoutSec !== undefined && Number.isFinite(requestedTimeoutSec) && requestedTimeoutSec > 0
			? requestedTimeoutSec
			: defaultTimeoutSec;
	if (!budget) {
		return { effectiveTimeoutSec: requested, clamp: undefined };
	}
	const clamp = budget.clampBashTimeoutSec(requested);
	return { effectiveTimeoutSec: clamp.timeoutSec, clamp };
}
