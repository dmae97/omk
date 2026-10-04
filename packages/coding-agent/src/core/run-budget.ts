import {
	RunBudgetExceededError,
	type RunBudgetLimits,
	type RunBudgetStopCode,
	snapshotRunBudgetLimits,
} from "./run-budget-policy.ts";

export interface RunBudgetSnapshot {
	readonly limits: RunBudgetLimits;
	readonly requestsStarted: number;
	readonly activeRequests: number;
	readonly remainingMs?: number;
	readonly closed: boolean;
	readonly exhaustedBy?: RunBudgetStopCode;
}

/** One in-memory, monotonic budget shared by every dispatch in a prompt. */
export class RunBudget {
	readonly limits: RunBudgetLimits;
	private readonly controller = new AbortController();
	private readonly deadline: number | undefined;
	private readonly onExhausted: (error: RunBudgetExceededError) => void;
	private readonly active = new Set<symbol>();
	private readonly idleWaiters = new Set<() => void>();

	waitForIdle(): Promise<void> {
		if (this.active.size === 0) return Promise.resolve();
		return new Promise<void>((resolve) => this.idleWaiters.add(resolve));
	}
	private timer: ReturnType<typeof setTimeout> | undefined;
	private issued = 0;
	private closed = false;
	private exhausted: RunBudgetExceededError | undefined;

	constructor(limits: RunBudgetLimits | undefined, onExhausted: (error: RunBudgetExceededError) => void) {
		// Undefined owns an unbounded scope; an explicitly empty policy is still invalid.
		this.limits = limits === undefined ? Object.freeze({}) : snapshotRunBudgetLimits(limits);
		this.onExhausted = onExhausted;
		this.deadline = this.limits.timeoutMs === undefined ? undefined : performance.now() + this.limits.timeoutMs;
		if (this.deadline !== undefined) this.armDeadline();
	}

	get signal(): AbortSignal {
		return this.controller.signal;
	}
	get failure(): RunBudgetExceededError | undefined {
		return this.exhausted;
	}
	get remainingMs(): number | undefined {
		return this.deadline === undefined ? undefined : Math.max(0, Math.ceil(this.deadline - performance.now()));
	}

	assertActive(): void {
		if (this.closed) throw new RunBudgetExceededError("closed");
		if (this.exhausted) throw this.exhausted;
		if (this.deadline !== undefined && performance.now() >= this.deadline) throw this.exhaust("deadline");
	}

	assertAdmission(): void {
		this.assertActive();
		if (this.issued >= (this.limits.maxRequests ?? Infinity)) throw this.exhaust("requests");
		if (this.active.size >= (this.limits.maxConcurrentRequests ?? Infinity)) throw this.exhaust("concurrency");
	}

	admit(): () => void {
		this.assertAdmission();
		const request = Symbol();
		this.issued += 1;
		this.active.add(request);
		return () => {
			this.active.delete(request);
			if (this.active.size === 0) {
				for (const resolve of this.idleWaiters) resolve();
				this.idleWaiters.clear();
			}
		};
	}

	snapshot(): RunBudgetSnapshot {
		return Object.freeze({
			limits: this.limits,
			requestsStarted: this.issued,
			activeRequests: this.active.size,
			remainingMs: this.remainingMs,
			closed: this.closed,
			...(this.exhausted ? { exhaustedBy: this.exhausted.code } : {}),
		});
	}

	close(): void {
		this.closed = true;
		clearTimeout(this.timer);
		this.controller.abort(new RunBudgetExceededError("closed"));
	}

	private exhaust(code: RunBudgetStopCode): RunBudgetExceededError {
		if (this.exhausted) return this.exhausted;
		const error = new RunBudgetExceededError(code);
		this.exhausted = error;
		clearTimeout(this.timer);
		this.controller.abort(error);
		this.onExhausted(error);
		return error;
	}

	private armDeadline(): void {
		this.timer = setTimeout(() => {
			if (this.closed) return;
			if (this.remainingMs === 0) this.exhaust("deadline");
			else this.armDeadline();
		}, this.remainingMs);
	}
}
