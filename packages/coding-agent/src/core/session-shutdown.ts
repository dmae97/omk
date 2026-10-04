import { AsyncLocalStorage } from "node:async_hooks";
import type { Agent } from "omk-agent-core";
import type { McpManager } from "./mcp/manager.ts";
import type { SessionControlServer } from "./session-control-server.ts";
import type { SessionPromptLifecycle } from "./session-prompt-lifecycle.ts";
import type { SessionRunBudget } from "./session-run-budget.ts";

function throwShutdownErrors(errors: unknown[]): void {
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, "Session shutdown failed");
}

interface ShutdownProducer {
	active: boolean;
	command: boolean;
	closedByCommand: boolean;
	parent?: ShutdownProducer;
	finish(): void;
}

/** Tracks public producers separately from their tools and logical model streams. */
export class SessionShutdown {
	private readonly context = new AsyncLocalStorage<ShutdownProducer>();
	private readonly producers = new Set<Promise<void>>();
	private closing = false;
	private completion: Promise<void> | undefined;

	get isClosing(): boolean {
		return this.closing;
	}
	get active(): boolean {
		return this.producers.size > 0;
	}

	assertOpen(): void {
		if (this.closing) throw new Error("Session is closing or closed");
	}

	beginCompaction(current: AbortController | undefined): AbortController {
		this.assertOpen();
		if (current) throw new Error("Compaction is already in progress");
		return new AbortController();
	}

	async run<T>(operation: () => Promise<T>): Promise<T> {
		this.assertOpen();
		let release: () => void = () => {};
		const done = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.producers.add(done);
		const owner: ShutdownProducer = {
			active: true,
			command: false,
			closedByCommand: false,
			parent: this.context.getStore(),
			finish: () => {
				owner.active = false;
				owner.parent = undefined;
				this.producers.delete(done);
				release();
			},
		};
		try {
			return await this.context.run(owner, operation);
		} finally {
			owner.finish();
		}
	}

	get closedByCommand(): boolean {
		return this.context.getStore()?.closedByCommand ?? false;
	}

	async runCommand<T>(operation: () => Promise<T>): Promise<T> {
		const owner = this.context.getStore();
		if (!owner?.active) throw new Error("Extension command requires an active session operation");
		const previousCommand = owner.command;
		owner.command = true;
		try {
			return await operation();
		} finally {
			owner.command = previousCommand;
		}
	}

	close(stop: () => void, drain: () => Promise<void>, finalize: () => void): Promise<void> {
		const commands: ShutdownProducer[] = [];
		for (let owner = this.context.getStore(); owner; owner = owner.parent) {
			if (!owner.active) continue;
			if (!owner.command) return Promise.reject(new Error("Cannot close a session from its own active operation"));
			commands.push(owner);
		}
		// A replacement seals its initiating control frame, not unrelated producers or tool ownership.
		for (const owner of commands) {
			owner.closedByCommand = true;
			owner.finish();
		}
		if (this.completion) return this.completion;
		this.closing = true;
		this.completion = Promise.resolve().then(async () => {
			const errors: unknown[] = [];
			try {
				stop();
			} catch (error) {
				errors.push(error);
			}
			await Promise.all([...this.producers]);
			try {
				await drain();
				// Only successful joins authorize final resource/lease release.
				finalize();
			} catch (error) {
				errors.push(error);
			}
			throwShutdownErrors(errors);
		});
		return this.completion;
	}

	closeSession(
		source: {
			agent: Agent;
			abortRetry(): void;
			abortCompaction(): void;
			abortBranchSummary(): void;
			abortBash(): void;
			clearQueue(): unknown;
		},
		owned: {
			budget: SessionRunBudget;
			lifecycle: SessionPromptLifecycle;
			mcp?: McpManager;
			control?: Promise<SessionControlServer>;
		},
		finalize: () => void,
	): Promise<void> {
		let controlClose: Promise<void> | undefined;
		return this.close(
			() => {
				const errors: unknown[] = [];
				for (const stop of [
					() => owned.budget.close(),
					() => source.abortRetry(),
					() => source.abortCompaction(),
					() => source.abortBranchSummary(),
					() => source.abortBash(),
					() => source.agent.abort(),
					() => source.clearQueue(),
					() => owned.mcp?.close(),
				]) {
					try {
						stop();
					} catch (error) {
						errors.push(error);
					}
				}
				controlClose = owned.control?.then((control) => control.close());
				// Observe early rejection now; report the same outcome after every join.
				void controlClose?.catch(() => {});
				throwShutdownErrors(errors);
			},
			async () => {
				const joins = await Promise.allSettled(
					[
						async () => {
							await source.agent.waitForIdle();
							source.clearQueue();
						},
						() => owned.lifecycle.waitForIdle(),
						() => owned.budget.waitForIdle(),
						() => owned.mcp?.closeAndWait(),
						() => controlClose,
					].map((join) => Promise.resolve().then(join)),
				);
				throwShutdownErrors(joins.flatMap((join) => (join.status === "rejected" ? [join.reason] : [])));
			},
			finalize,
		);
	}

	/** Keep the legacy synchronous cleanup boundary when nothing is outstanding. */
	disposeIdle(finalize: () => void): void {
		if (this.closing) return;
		this.closing = true;
		finalize();
		this.completion = Promise.resolve();
	}
}
