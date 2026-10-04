import type { AgentEvent } from "omk-agent-core";

interface EventWaiter {
	readonly promise: Promise<AgentEvent[]>;
	cancel(error: Error): void;
}

/** Owns temporary event subscriptions independently of persistent caller listeners. */
export class RpcEventWaiters {
	private readonly pending = new Set<(error: Error) => void>();
	private readonly subscribe: (listener: (event: AgentEvent) => void) => () => void;
	private readonly stderr: () => string;

	constructor(subscribe: (listener: (event: AgentEvent) => void) => () => void, stderr: () => string) {
		this.subscribe = subscribe;
		this.stderr = stderr;
	}

	create(timeout: number, collect: boolean): EventWaiter {
		let cancel = (_error: Error): void => {};
		const promise = new Promise<AgentEvent[]>((resolve, reject) => {
			const events: AgentEvent[] = [];
			let settled = false;
			const finish = (error?: Error): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				unsubscribe();
				this.pending.delete(cancel);
				if (error) {
					events.length = 0;
					reject(error);
				} else resolve(events);
			};
			cancel = (error) => finish(error);
			const timer = setTimeout(() => {
				const activity = collect ? "collecting events" : "waiting for agent to become idle";
				finish(new Error(`Timeout ${activity}. Stderr: ${this.stderr()}`));
			}, timeout);
			const unsubscribe = this.subscribe((event) => {
				if (collect) events.push(event);
				if (event.type === "agent_end") finish();
			});
			this.pending.add(cancel);
		});
		// The caller may still be awaiting prompt acceptance when the child fails.
		// Preserve the rejection while preventing an unhandled rejection in that gap.
		void promise.catch(() => {});
		return { promise, cancel: (error) => cancel(error) };
	}

	fail(error: Error): void {
		for (const cancel of this.pending) cancel(error);
	}
}
