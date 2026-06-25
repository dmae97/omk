/**
 * Session binding store + per-browser-profile mutation mutex.
 *
 * A single browser profile (cookies, tabs, form state) must not receive two
 * mutating actions concurrently, or tabs/navigation/forms can corrupt each
 * other. Read-only observation on a separate tab may run in parallel.
 *
 * The mutex is keyed on `accountId:browserProfileId` and provides FIFO grants
 * within this process. Pending waiters can be aborted, timed out, or rejected
 * by clear() during shutdown.
 */

export interface OMKSessionBinding {
	readonly omkSessionId: string;
	asideProcessId?: number;
	asideSessionId?: string;
	accountId: string;
	browserProfileId: string;
	activeTabIds: string[];
	permissionMode: string;
	allowedOrigins: readonly string[];
	evidenceDirectory: string;
	readonly createdAt: number;
	lastActivityAt: number;
}

export interface MutationLockOptions {
	readonly waitTimeoutMs?: number;
	readonly signal?: AbortSignal;
}

type Release = () => void;

interface LockWaiter {
	readonly resolve: (release: Release) => void;
	readonly reject: (error: Error) => void;
	readonly signal?: AbortSignal;
	timer: NodeJS.Timeout | undefined;
	onAbort: (() => void) | undefined;
	settled: boolean;
}

interface LockState {
	active: boolean;
	readonly queue: LockWaiter[];
}

export class SessionBindingStore {
	private readonly bindings = new Map<string, OMKSessionBinding>();
	private readonly locks = new Map<string, LockState>();

	bind(binding: OMKSessionBinding): void {
		this.bindings.set(binding.omkSessionId, binding);
	}

	get(omkSessionId: string): OMKSessionBinding | undefined {
		return this.bindings.get(omkSessionId);
	}

	update(omkSessionId: string, patch: Partial<OMKSessionBinding>): OMKSessionBinding | undefined {
		const current = this.bindings.get(omkSessionId);
		if (!current) return undefined;
		const next: OMKSessionBinding = { ...current, ...patch, createdAt: current.createdAt };
		this.bindings.set(omkSessionId, next);
		return next;
	}

	/** Acquire the mutation lock for a profile; resolves the release function. */
	async acquireMutationLock(
		accountId: string,
		profileId: string,
		options: MutationLockOptions = {},
	): Promise<Release> {
		const key = `${accountId}:${profileId}`;
		if (options.signal?.aborted) return Promise.reject(new Error(`mutation lock wait aborted: ${key}`));
		const state = this.getLockState(key);
		if (!state.active) {
			state.active = true;
			return this.createRelease(key, state);
		}
		return new Promise<Release>((resolve, reject) => {
			const waiter: LockWaiter = {
				resolve,
				reject,
				signal: options.signal,
				timer: undefined,
				onAbort: undefined,
				settled: false,
			};
			waiter.onAbort = () => this.rejectWaiter(key, state, waiter, new Error(`mutation lock wait aborted: ${key}`));
			options.signal?.addEventListener("abort", waiter.onAbort, { once: true });
			if (options.waitTimeoutMs !== undefined) {
				waiter.timer = setTimeout(() => {
					this.rejectWaiter(key, state, waiter, new Error(`mutation lock wait timed out: ${key}`));
				}, options.waitTimeoutMs);
				waiter.timer.unref?.();
			}
			state.queue.push(waiter);
		});
	}

	/** Release all bindings + reject pending lock waiters (shutdown). */
	clear(): void {
		this.bindings.clear();
		for (const [key, state] of this.locks) {
			for (const waiter of state.queue.splice(0)) {
				this.rejectWaiter(key, state, waiter, new Error(`mutation lock queue cleared: ${key}`));
			}
		}
		this.locks.clear();
	}

	private getLockState(key: string): LockState {
		const existing = this.locks.get(key);
		if (existing) return existing;
		const state: LockState = { active: false, queue: [] };
		this.locks.set(key, state);
		return state;
	}

	private createRelease(key: string, state: LockState): Release {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			if (this.locks.get(key) !== state) return;
			this.grantNext(key, state);
		};
	}

	private grantNext(key: string, state: LockState): void {
		while (state.queue.length > 0) {
			const waiter = state.queue.shift();
			if (!waiter || waiter.settled) continue;
			waiter.settled = true;
			this.cleanupWaiter(waiter);
			state.active = true;
			waiter.resolve(this.createRelease(key, state));
			return;
		}
		state.active = false;
		this.locks.delete(key);
	}

	private rejectWaiter(key: string, state: LockState, waiter: LockWaiter, error: Error): void {
		if (waiter.settled) return;
		waiter.settled = true;
		this.cleanupWaiter(waiter);
		const index = state.queue.indexOf(waiter);
		if (index !== -1) state.queue.splice(index, 1);
		waiter.reject(error);
		if (!state.active && state.queue.length === 0 && this.locks.get(key) === state) this.locks.delete(key);
	}

	private cleanupWaiter(waiter: LockWaiter): void {
		if (waiter.timer) clearTimeout(waiter.timer);
		if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
		waiter.timer = undefined;
		waiter.onAbort = undefined;
	}
}
