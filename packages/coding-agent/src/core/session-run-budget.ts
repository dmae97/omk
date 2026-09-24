import type { Agent, StreamFn } from "omk-agent-core";
import { RunBudget, type RunBudgetSnapshot } from "./run-budget.ts";
import { RunBudgetExceededError, type RunBudgetLimits, RunBudgetPolicyError } from "./run-budget-policy.ts";
import { PromptExecutionBusyError } from "./session-prompt-lifecycle.ts";

interface RunBudgetLifecycle {
	readonly assertIdle: () => void;
	readonly stop: (error: RunBudgetExceededError) => void;
	readonly reject: (error: RunBudgetExceededError | RunBudgetPolicyError) => void;
}

/** Installs one scoped stream boundary; restores it without overwriting a later owner. */
export class SessionRunBudget {
	private readonly agent: Agent;
	private readonly lifecycle: RunBudgetLifecycle;
	private current: RunBudget | undefined;
	private previous: RunBudget | undefined;
	private executing = false;
	private disposed = false;

	constructor(agent: Agent, lifecycle: RunBudgetLifecycle) {
		this.agent = agent;
		this.lifecycle = lifecycle;
	}

	get failure(): RunBudgetExceededError | undefined {
		return this.current?.failure;
	}
	get remainingMs(): number | undefined {
		return this.current?.remainingMs;
	}
	snapshot(): RunBudgetSnapshot | undefined {
		return (this.current ?? this.previous)?.snapshot();
	}
	assertActive(): void {
		this.current?.assertActive();
	}
	assertAdmission(): void {
		this.current?.assertAdmission();
	}
	close(): void {
		this.disposed = true;
		this.current?.close();
	}

	async execute(
		limits: RunBudgetLimits | undefined,
		operation: () => Promise<void>,
		preflightResult?: (accepted: boolean) => void,
	): Promise<void> {
		let ownsScope = false;
		let entered = false;
		let budget: RunBudget | undefined;
		const source = this.agent.streamFn;
		const sourceAuth = this.agent.getApiKey;
		let wrapped: StreamFn | undefined;
		let wrappedAuth: Agent["getApiKey"];
		try {
			if (this.executing || this.disposed || (this.previous?.snapshot().activeRequests ?? 0) > 0) {
				throw new PromptExecutionBusyError();
			}
			this.executing = true;
			ownsScope = true;
			if (limits !== undefined) {
				if (this.agent.state.isStreaming) throw new PromptExecutionBusyError();
				this.lifecycle.assertIdle();
			}
			// Ownership applies to every scope; only limit enforcement is opt-in.
			const scopedBudget = new RunBudget(limits, this.lifecycle.stop);
			budget = scopedBudget;
			this.current = scopedBudget;
			wrapped = wrapBudgetStream(source, scopedBudget);
			if (sourceAuth !== undefined) {
				wrappedAuth = async (provider) => {
					scopedBudget.assertAdmission();
					const key = await sourceAuth(provider);
					scopedBudget.assertActive();
					return key;
				};
				this.agent.getApiKey = wrappedAuth;
			}
			this.agent.streamFn = wrapped;
			scopedBudget.assertAdmission();
			entered = true;
			await operation();
			budget?.assertActive();
		} catch (error) {
			if (!entered) {
				preflightResult?.(false);
				if (error instanceof RunBudgetExceededError || error instanceof RunBudgetPolicyError)
					this.lifecycle.reject(error);
			}
			throw budget?.failure ?? error;
		} finally {
			if (budget) {
				budget.close();
				this.previous = budget;
				if (this.current === budget) this.current = undefined;
			}
			if (wrapped !== undefined && this.agent.streamFn === wrapped) this.agent.streamFn = source;
			if (wrappedAuth !== undefined && this.agent.getApiKey === wrappedAuth) this.agent.getApiKey = sourceAuth;
			if (ownsScope) this.executing = false;
		}
	}
}

export function wrapBudgetStream(source: StreamFn, budget: RunBudget): StreamFn {
	const wrapped: StreamFn = async (model, context, options) => {
		options?.signal?.throwIfAborted();
		const release = budget.admit();
		const remainingMs = budget.remainingMs;
		let returnedStream = false;
		try {
			const stream = await source(model, context, {
				...options,
				signal: options?.signal ? AbortSignal.any([options.signal, budget.signal]) : budget.signal,
				...(Object.keys(budget.limits).length > 0 ? { maxRetries: 0 } : {}),
				...(remainingMs === undefined
					? {}
					: { timeoutMs: Math.min(options?.timeoutMs ?? remainingMs, remainingMs) }),
			});
			returnedStream = true;
			// A returned stream is not yet a completed request. Missing terminal metadata
			// retains the reservation; abort alone never refunds it.
			void stream.result().then(release, release);
			return stream;
		} catch (error) {
			// A broken result() contract leaves termination unknown, not refunded.
			if (!returnedStream) release();
			throw error;
		}
	};
	// Preserve source-owned identity brands used by mandatory credential checks.
	for (const key of Object.getOwnPropertySymbols(source)) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (descriptor) Object.defineProperty(wrapped, key, descriptor);
	}
	return wrapped;
}
