/**
 * Shared wall-clock budget for a coding run (spec 036).
 *
 * Harnesses pass `OMK_TIME_BUDGET_SEC`. `startRunBudgetClock()` binds one
 * monotonic clock per process, anchored at the process time origin, and every
 * consumer (bash clamp, finish-check via `readRunBudget()`, spec 033's response
 * cap) reads that clock. Nothing binds it lazily, so all consumers share one origin.
 */

/** Keep this fraction of the total budget free for save + verify (matches finish-check skip at 0.9). */
export const REMAINING_BUDGET_SAVE_RESERVE_FRACTION = 0.1;
/** At or below this remaining fraction the run is in its save reserve ("hard" policy). */
export const REMAINING_BUDGET_HARD_KILL_FRACTION = 0.1;
/** Inside the reserve a command may still run this long, so saving outputs is not killed at once. */
export const BASH_SAVE_FLOOR_SEC = 30;
/** The save floor never runs closer than this to the real end of the budget. */
export const BASH_DEADLINE_GRACE_SEC = 5;

export type BashTimeoutPolicy = "soft" | "hard";

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
	/** Whole seconds still on the run clock when the clamp was computed. */
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
		// Monotonic: NTP or VM clock steps must not move the budget.
		this.now = options.now ?? (() => performance.now());
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
	 * Ceiling: `max(1, remaining − reserve, min(30, remaining − 5))` seconds, so a
	 * save command inside the reserve still gets up to 30 s. `requestedSec`
	 * undefined (no model timeout) gets the ceiling itself.
	 */
	clampBashTimeoutSec(requestedSec: number | undefined): ClampBashTimeoutResult {
		const remainingSec = Math.floor(this.remainingMs() / 1000);
		const availableSec = Math.floor((this.remainingMs() - this.reserveMs()) / 1000);
		const saveFloorSec = Math.min(BASH_SAVE_FLOOR_SEC, remainingSec - BASH_DEADLINE_GRACE_SEC);
		const ceilingSec = Math.max(1, availableSec, saveFloorSec);
		const policy = this.bashTimeoutPolicy();
		if (requestedSec === undefined || !Number.isFinite(requestedSec) || requestedSec <= 0) {
			return { timeoutSec: ceilingSec, clamped: true, policy, remainingSec };
		}
		const safeRequested = Math.max(1, Math.floor(requestedSec));
		const timeoutSec = Math.min(safeRequested, ceilingSec);
		return { timeoutSec, clamped: timeoutSec < safeRequested, policy, remainingSec };
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
 * Start the run clock once per process, at run start (`runPrintMode`). The origin is
 * the process time origin (`performance.now() === 0`), so startup and the first model
 * turns count no matter when a consumer first reads it. Returns the bound clock, or
 * `undefined` when `OMK_TIME_BUDGET_SEC` is not set.
 */
export function startRunBudgetClock(options?: {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	readonly startedAt?: number;
}): RemainingBudget | undefined {
	if (activeBudget) return activeBudget;
	const budget = createRemainingBudgetFromEnv({
		env: options?.env,
		now: options?.now,
		startedAt: options?.startedAt ?? 0,
	});
	if (budget) bindActiveRemainingBudget(budget);
	return budget;
}

export interface RunBudgetSnapshot {
	readonly budgetMs: number;
	readonly elapsedMs: number;
	readonly remainingMs: number;
	readonly elapsedFraction: number;
	readonly remainingFraction: number;
}

/** The one accessor consumers (finish-check, spec 033) use. `undefined` when the run has no budget. */
export function readRunBudget(): RunBudgetSnapshot | undefined {
	const budget = activeBudget;
	if (!budget) return undefined;
	return {
		budgetMs: budget.budgetMs,
		elapsedMs: budget.elapsedMs(),
		remainingMs: budget.remainingMs(),
		elapsedFraction: budget.elapsedFraction(),
		remainingFraction: budget.remainingFraction(),
	};
}

/** Take a harness wait (for example a pre-check snapshot) out of the shared budget. */
export function excludeRunBudgetWaitMs(ms: number): void {
	activeBudget?.addExcludedWaitMs(ms);
}

/** Hint appended when a bash command is cut short by the budget clamp. */
export function bashBudgetTimeoutMessage(result: ClampBashTimeoutResult): string {
	if (result.policy === "hard") {
		return `Command timed out after ${result.timeoutSec} seconds (time budget nearly exhausted; save outputs and finish).`;
	}
	return `Command timed out after ${result.timeoutSec} seconds (${result.remainingSec}s left on the run budget; narrow the work or continue in the background).`;
}

/**
 * Resolve the seconds bash should wait. Without a budget the model's timeout passes
 * through unchanged (including `undefined`), exactly as on main, so the outer
 * `agent.toolTimeouts.bash` still governs. With a budget it is clamped.
 */
export function resolveBashTimeoutForBudget(
	requestedTimeoutSec: number | undefined,
	budget: RemainingBudget | undefined,
): { readonly effectiveTimeoutSec: number | undefined; readonly clamp: ClampBashTimeoutResult | undefined } {
	if (!budget) return { effectiveTimeoutSec: requestedTimeoutSec, clamp: undefined };
	const clamp = budget.clampBashTimeoutSec(requestedTimeoutSec);
	return { effectiveTimeoutSec: clamp.timeoutSec, clamp };
}
