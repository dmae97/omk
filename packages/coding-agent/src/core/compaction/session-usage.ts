import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { StreamFn } from "omk-agent-core";
import type { AssistantMessage } from "omk-ai";
import {
	type CompactionCostBatch,
	findGoalCostSink,
	settledRunCostUsd,
} from "../extensions/builtin/goal-cost-accounting.ts";
import type { ExtensionRunner } from "../extensions/runner.ts";
import type { Extension } from "../extensions/types.ts";
import { RequestInputAdmissionError } from "../request-admission-policy.ts";
import type { RunBudgetSnapshot } from "../run-budget.ts";
import { RunBudgetExceededError } from "../run-budget-policy.ts";
import type { AgentSettledEvent } from "../session-extension-settlement.ts";
import type { CompactionSummaryInput } from "./session-summary.ts";

export { summarizeObservedCompaction } from "./session-summary-observation.ts";

interface Attempt {
	readonly ordinal: number;
	sealed: boolean;
	excluded?: boolean;
	costUsd?: number;
}
interface UsageHost {
	readonly sessionId: string;
	readonly agent: { readonly streamFn: StreamFn };
	getRunBudgetSnapshot(): RunBudgetSnapshot | undefined;
	readonly extensionRunner: Pick<ExtensionRunner, "createContext" | "emitError">;
	readonly resourceLoader: { getExtensions(): { extensions: readonly Extension[] } };
}
interface Scope {
	active: boolean;
	readonly nativeSource?: StreamFn;
	readonly sessionId: string;
	readonly runner: UsageHost["extensionRunner"];
	readonly createContext: ExtensionRunner["createContext"];
	readonly sink: NonNullable<ReturnType<typeof findGoalCostSink>>;
	id?: string;
	ordinal: number;
	sequence: number;
	readonly attempts: Attempt[];
	batch?: CompactionCostBatch;
	delivery?: Promise<void>;
	held?: boolean;
}

function attemptCost(message: AssistantMessage): number | undefined {
	const cost = settledRunCostUsd([message]);
	const usage = message.usage;
	if (!usage) return undefined;
	const tokens = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens];
	if (tokens.some((value) => !Number.isFinite(value) || value < 0)) return undefined;
	return cost === 0 && !tokens.some((value) => value > 0) ? undefined : cost;
}

/** Session-local observations only; the captured built-in accountant owns all monetary decisions. */
export class SessionCompactionUsage {
	private readonly host: UsageHost;
	private readonly context = new AsyncLocalStorage<Scope>();
	private completion?: Promise<void>;
	private reloading?: Promise<void>;
	private pending?: Scope;
	constructor(host: SessionCompactionUsage["host"]) {
		this.host = host;
	}

	async run(operation: () => Promise<void>, nativeSource?: StreamFn): Promise<void> {
		if (this.reloading) await this.reloading;
		const sink = findGoalCostSink(this.host.resourceLoader.getExtensions().extensions);
		if (!sink) return operation();
		const runner = this.host.extensionRunner;
		const scope: Scope = {
			active: true,
			nativeSource,
			sessionId: this.host.sessionId,
			runner,
			createContext: runner.createContext.bind(runner),
			sink,
			ordinal: 0,
			sequence: 0,
			attempts: [],
		};
		let finish = () => {};
		this.completion = new Promise<void>((resolve) => {
			finish = resolve;
		});
		return this.context.run(scope, async () => {
			let failure: { error: unknown } | undefined;
			try {
				if (this.pending) await this.retryPending();
				await operation();
			} catch (error) {
				failure = { error };
			}
			try {
				if (!scope.held) await this.deliver(scope, true);
			} catch (error) {
				this.pending = scope;
				if (!failure) failure = { error };
				else {
					try {
						scope.runner.emitError({
							extensionPath: "<builtin:goal-controller>",
							event: "compaction_usage",
							error: error instanceof Error ? error.message : String(error),
						});
					} catch {
						/* An error reporter cannot replace the original failure; the batch stays pending. */
					}
				}
			} finally {
				scope.active = false;
				this.completion = undefined;
				finish();
			}
			if (failure) throw failure.error;
		});
	}

	stream(source: StreamFn, reason: CompactionSummaryInput["reason"]): StreamFn {
		const scope = this.context.getStore();
		if (reason === "manual" || !scope?.active) return source;
		return async (model, context, options) => {
			if (!scope.active) throw new Error("Automatic compaction observation scope is closed");
			scope.id ??= randomUUID();
			const attempt: Attempt = { ordinal: ++scope.ordinal, sealed: false };
			scope.attempts.push(attempt);
			const seal = (costUsd?: number) => {
				if (attempt.sealed) return;
				attempt.costUsd = costUsd;
				attempt.sealed = true;
			};
			let noDispatch = false;
			try {
				const started =
					source === scope.nativeSource && source === this.host.agent.streamFn
						? this.host.getRunBudgetSnapshot()?.requestsStarted
						: undefined;
				// The installed outer budget admits synchronously; sample on both sides of invocation, never await.
				const result = source(model, context, options);
				noDispatch =
					started !== undefined &&
					source === this.host.agent.streamFn &&
					this.host.getRunBudgetSnapshot()?.requestsStarted === started;
				const stream = await result;
				stream.result().then(
					(message) => seal(attemptCost(message)),
					() => seal(),
				);
				return stream;
			} catch (error) {
				attempt.excluded =
					noDispatch && (error instanceof RunBudgetExceededError || error instanceof RequestInputAdmissionError);
				seal();
				throw error;
			}
		};
	}

	async flush(): Promise<void> {
		const scope = this.context.getStore();
		if (scope?.active) await this.deliver(scope, false);
	}
	bindSettlement(
		runner: Pick<ExtensionRunner, "emit">,
		after: () => void,
	): (event: AgentSettledEvent) => Promise<void> {
		const scope = this.context.getStore();
		if (scope) scope.held = true;
		return async (event) => {
			if (scope) {
				await this.deliver(scope, false);
				if (event.settlementId)
					await this.charge(
						scope,
						{
							sessionId: scope.sessionId,
							settlementId: event.settlementId,
							costUsd: settledRunCostUsd(event.messages),
						},
						false,
					);
			}
			await runner.emit(event);
			after();
			if (scope) scope.held = false;
		};
	}
	private async charge(scope: Scope, batch: CompactionCostBatch, terminal: boolean): Promise<void> {
		if (this.host.sessionId !== scope.sessionId || this.host.extensionRunner !== scope.runner)
			throw new Error("Stale compaction cost runtime");
		await scope.sink(batch, scope.createContext(), terminal);
	}

	private deliver(scope: Scope, terminal: boolean): Promise<void> {
		scope.delivery ??= this.drain(scope, terminal).finally(() => {
			scope.delivery = undefined;
		});
		return scope.delivery;
	}

	private async drain(scope: Scope, terminal: boolean): Promise<void> {
		do {
			if (!scope.batch) {
				const attempts = scope.attempts.splice(0).filter((attempt) => !attempt.excluded);
				if (attempts.length === 0) return;
				let cost: number | undefined = 0;
				for (const attempt of attempts) {
					cost =
						cost === undefined || !attempt.sealed || attempt.costUsd === undefined
							? undefined
							: cost + attempt.costUsd;
					attempt.sealed = true;
				}
				scope.batch = Object.freeze({
					sessionId: scope.sessionId,
					settlementId: `compaction-usage:${scope.id}#${++scope.sequence}`,
					costUsd: cost !== undefined && Number.isFinite(cost) ? cost : undefined,
				});
			}
			await this.charge(scope, scope.batch, terminal);
			scope.batch = undefined; // A failed delivery keeps the same frozen batch and ID.
		} while (scope.attempts.length > 0);
	}

	private async retryPending(): Promise<void> {
		if (this.pending) await this.deliver(this.pending, true);
		this.pending = undefined;
	}

	async reload(
		operation: () => Promise<void>,
		join: (operation: Promise<void>) => Promise<void> = (operation) => operation,
	): Promise<void> {
		if (this.context.getStore()?.active) throw new Error("Cannot reload from an active compaction accounting scope");
		const previous = this.reloading;
		let finish = () => {};
		const barrier = new Promise<void>((resolve) => {
			finish = resolve;
		});
		this.reloading = barrier;
		try {
			await previous;
			await join(this.completion ?? Promise.resolve());
			await this.retryPending();
			await operation();
		} finally {
			if (this.reloading === barrier) this.reloading = undefined;
			finish();
		}
	}
}
