import { AsyncLocalStorage } from "node:async_hooks";
import type { Agent } from "omk-agent-core";
import type { McpManager } from "./mcp/manager.ts";
import type { SessionControlServer } from "./session-control-server.ts";
import type { SessionPromptLifecycle } from "./session-prompt-lifecycle.ts";
import type { SessionRunBudget } from "./session-run-budget.ts";

/** Tracks public producers separately from their tools and logical model streams. */
export class SessionShutdown {
	private readonly context = new AsyncLocalStorage<{ active: boolean }>();
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
		const owner = { active: true };
		try {
			return await this.context.run(owner, operation);
		} finally {
			owner.active = false;
			this.producers.delete(done);
			release();
		}
	}

	close(stop: () => void, drain: () => Promise<void>, finalize: () => void): Promise<void> {
		if (this.context.getStore()?.active)
			return Promise.reject(new Error("Cannot close a session from its own active operation"));
		if (this.completion) return this.completion;
		this.closing = true;
		this.completion = Promise.resolve().then(async () => {
			stop();
			await Promise.all([...this.producers]);
			await drain();
			finalize();
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
		return this.close(
			() => {
				owned.budget.close();
				source.abortRetry();
				source.abortCompaction();
				source.abortBranchSummary();
				source.abortBash();
				source.agent.abort();
				source.clearQueue();
				owned.mcp?.close();
				void owned.control?.then((control) => control.close()).catch(() => {});
			},
			async () => {
				await source.agent.waitForIdle();
				source.clearQueue();
				await Promise.all([
					owned.lifecycle.waitForIdle(),
					owned.budget.waitForIdle(),
					owned.mcp?.closeAndWait(),
					owned.control?.then((control) => control.close()),
				]);
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
