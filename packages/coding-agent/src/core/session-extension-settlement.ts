import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentMessage } from "omk-agent-core";

export type AgentSettledEvent = {
	type: "agent_settled";
	messages: AgentMessage[];
	aborted: boolean;
	settlementId?: string;
};

interface PendingSettlement {
	event: AgentSettledEvent;
	runOwned: (operation: () => Promise<void>) => Promise<void>;
	emit: (event: AgentSettledEvent) => Promise<unknown>;
	idle: () => void;
	failed: (error: unknown) => void;
	acknowledged: Promise<void>;
	acknowledge(): void;
	failure?: { error: unknown };
}

/** Owns final extension handlers and defers actions until their session context is idle. */
export class SessionExtensionSettlement {
	private readonly context = new AsyncLocalStorage<{ active: boolean; recovering: boolean }>();
	private readonly failures = new Set<(error: unknown) => void>();
	private completion: Promise<void> | undefined;
	private controller: AbortController | undefined;
	private readonly actions: Array<() => Promise<void>> = [];
	private runId: string | undefined;
	private sequence = 0;
	private readonly messages = new Set<AgentMessage>();
	private event?: AgentSettledEvent;
	private held?: PendingSettlement;
	private finishing = false;

	begin(runId: string): void {
		if (this.unsettled) throw new Error("Previous extension settlement is unacknowledged");
		this.runId = runId;
		this.sequence = 0;
		this.finishing = false;
		this.messages.clear();
	}

	record(message: AgentMessage): void {
		if (this.runId) this.messages.add(message);
	}

	/** Retains the original attempts and identity until delivery is acknowledged. */
	snapshot(aborted: boolean): AgentSettledEvent {
		if (this.event) return this.event;
		const messages = [...this.messages];
		const settlementId = this.runId ? `${this.runId}#${++this.sequence}` : undefined;
		this.event = { type: "agent_settled", messages, aborted, ...(settlementId ? { settlementId } : {}) };
		return this.event;
	}

	finish(): void {
		this.finishing = true;
		if (this.unsettled) return;
		this.runId = undefined;
		this.messages.clear();
	}
	get unsettled(): boolean {
		return this.event !== undefined;
	}
	get blocked(): boolean {
		return this.unsettled && !this.completion;
	}
	async recover(join?: () => Promise<void>): Promise<void> {
		if (this.context.getStore()?.active === true) return;
		const unsettled = this.unsettled;
		if (!this.completion && this.held) this.deliver(this.held, true);
		await this.completion;
		if (join && unsettled) await this.observe(join());
	}
	before<T>(operation: () => Promise<T>, recover = true): Promise<T> {
		if (this.context.getStore()?.active === true)
			return Promise.reject(new Error("Cannot replace a session from its active extension settlement"));
		return recover && this.unsettled ? this.recover().then(operation) : operation();
	}
	beforeProducer<T>(operation: () => Promise<T>): Promise<T> {
		const context = this.context.getStore();
		if (!context?.active) return this.before(operation);
		if (context.recovering) return Promise.reject(new Error("Cannot start provider work during settlement recovery"));
		return operation();
	}
	async observe<T>(operation: Promise<T>): Promise<T> {
		let listener = (_error: unknown) => {};
		const failure = new Promise<never>((_resolve, reject) => {
			listener = reject;
			this.failures.add(listener);
		});
		try {
			if (this.held?.failure && !this.completion) listener(this.held.failure.error);
			return await Promise.race([failure, operation]);
		} finally {
			this.failures.delete(listener);
		}
	}

	get busy(): boolean {
		return this.completion !== undefined;
	}
	get signal(): AbortSignal | undefined {
		return this.controller?.signal;
	}
	abort(): boolean {
		if (!this.controller) return false;
		this.controller.abort();
		return true;
	}
	get pending(): boolean {
		return this.actions.length > 0;
	}
	defer(action: () => Promise<void>): boolean {
		if (this.context.getStore()?.active !== true) return false;
		this.actions.push(action);
		return true;
	}
	take(): (() => Promise<void>) | undefined {
		return this.actions.shift();
	}
	wait(): Promise<void> | undefined {
		// A handler may queue a follow-up, but must not wait for its own completion.
		return this.context.getStore()?.active === true ? undefined : this.completion;
	}
	async after(operation: Promise<void>, busy: () => boolean): Promise<void> {
		await (this.blocked ? operation : this.observe(operation));
		if (busy() || this.unsettled) return;
		for (let action = this.take(); action; action = this.take()) await action();
	}
	start(
		event: AgentSettledEvent,
		runOwned: (operation: () => Promise<void>) => Promise<void>,
		emit: (event: AgentSettledEvent) => Promise<unknown>,
		idle: () => void,
		failed: (error: unknown) => void,
	): Promise<void> {
		if (this.held || this.completion) throw new Error("Extension settlement is already pending");
		this.event = event;
		let acknowledge = () => {};
		const acknowledged = new Promise<void>((resolve) => {
			acknowledge = resolve;
		});
		this.held = { event, runOwned, emit, idle, failed, acknowledged, acknowledge };
		return this.deliver(this.held);
	}
	/** Keep the native loop/budget alive after its public caller observes a persistence failure. */
	async settle(...args: Parameters<SessionExtensionSettlement["start"]>): Promise<void> {
		const attempt = this.start(...args);
		const acknowledged = this.held?.acknowledged;
		try {
			await attempt;
		} catch {
			await acknowledged;
		}
	}
	private deliver(pending: PendingSettlement, recovering = false): Promise<void> {
		const state = { active: true, recovering };
		pending.failure = undefined;
		this.controller ??= new AbortController();
		const completion = pending.runOwned(() =>
			this.context.run(state, async () => {
				try {
					await pending.emit(pending.event);
				} finally {
					state.active = false;
				}
			}),
		);
		this.completion = completion;
		void completion
			.then(
				() => {
					if (this.completion === completion) {
						this.completion = undefined;
						this.controller = undefined;
						this.held = undefined;
						this.event = undefined;
						for (const message of pending.event.messages) this.messages.delete(message);
						if (this.finishing) this.finish();
					}
					pending.acknowledge();
					pending.idle();
				},
				(error) => {
					if (this.completion === completion) {
						this.completion = undefined;
					}
					pending.failure = { error };
					for (const listener of this.failures) listener(error);
					pending.failed(error);
				},
			)
			.catch(() => {}); // Notification failure cannot replace the owned operation's original result.
		return completion;
	}
}
