import type { AgentTool } from "omk-agent-core";
import {
	createPromptSettlementState,
	type PromptSettledEvent,
	type PromptSettlementOutcome,
	reducePromptSettlement,
	settlePromptIfReady,
} from "./prompt-settlement.ts";

interface PromptOwner {
	readonly promptRunId: string;
	readonly startedAt: number;
	readonly executions: Set<symbol>;
	/** Spec 020 Req3 — detach된 자식/샤드의 live 카운터 (심볼 executions와 별도). */
	detachedChildren: number;
	detachedShards: number;
	terminal?: { readonly outcome: PromptSettlementOutcome; readonly notify: (event: PromptSettledEvent) => void };
}

export class PromptExecutionBusyError extends Error {
	constructor() {
		super("Agent is already processing or has unsettled tool execution. Wait for actual termination.");
		this.name = "PromptExecutionBusyError";
	}
}

/** Session-local ownership, not a durable journal or a detached-process sandbox. */
export class SessionPromptLifecycle {
	private owner: PromptOwner | undefined;
	private disposed = false;
	private readonly idleWaiters = new Set<() => void>();

	get active(): boolean {
		return this.owner !== undefined;
	}

	waitForIdle(): Promise<void> {
		if (!this.owner) return Promise.resolve();
		return new Promise<void>((resolve) => this.idleWaiters.add(resolve));
	}
	private readonly canSettle: () => boolean;
	private readonly auditsLateSettlement: () => boolean;

	constructor(options: { canSettle?: () => boolean; auditsLateSettlement?: () => boolean } = {}) {
		this.canSettle = options.canSettle ?? (() => true);
		this.auditsLateSettlement = options.auditsLateSettlement ?? (() => true);
	}

	assertIdle(): void {
		if (this.owner !== undefined || this.disposed) throw new PromptExecutionBusyError();
	}

	/** §16.2 — currently open prompt run id, if any. */
	get activePromptRunId(): string | undefined {
		return this.owner?.promptRunId;
	}

	begin(promptRunId: string): {
		finish: (outcome: PromptSettlementOutcome, notify: (event: PromptSettledEvent) => void) => void;
	} {
		this.assertIdle();
		const owner: PromptOwner = {
			promptRunId,
			startedAt: performance.now(),
			executions: new Set(),
			detachedChildren: 0,
			detachedShards: 0,
		};
		this.owner = owner;
		return {
			finish: (outcome, notify) => {
				if (owner.terminal !== undefined) return;
				owner.terminal = { outcome, notify };
				this.flush();
			},
		};
	}

	wrapTool(tool: AgentTool): AgentTool {
		return {
			name: tool.name,
			label: tool.label,
			description: tool.description,
			parameters: tool.parameters,
			prepareArguments: tool.prepareArguments,
			executionMode: tool.executionMode,
			resourceClaims: tool.resourceClaims,
			// A spread would evaluate and freeze the context-sensitive timeout too early.
			get timeoutMs() {
				return tool.timeoutMs;
			},
			execute: async (...args) => {
				const owner = this.owner;
				if (this.disposed || owner?.terminal !== undefined) throw new PromptExecutionBusyError();
				// Runtime-owned identities cannot collide with reused model toolCallIds.
				const execution = Symbol();
				const requiresAudit = this.auditsLateSettlement();
				owner?.executions.add(execution);
				try {
					return await tool.execute(...args);
				} finally {
					owner?.executions.delete(execution);
					// Audit mode flushes only after the late event has been delivered.
					if (!requiresAudit) this.flush();
				}
			},
		};
	}

	/** Called after the root producer drains, or after late-settlement event delivery. */
	flush(): void {
		const owner = this.owner;
		if (
			!owner?.terminal ||
			owner.executions.size > 0 ||
			owner.detachedChildren > 0 ||
			owner.detachedShards > 0 ||
			this.disposed ||
			!this.canSettle()
		)
			return;
		const state = reducePromptSettlement(createPromptSettlementState(owner.promptRunId, owner.startedAt), {
			kind: "terminal",
			outcome: owner.terminal.outcome,
		});
		const { event } = settlePromptIfReady(state, performance.now());
		this.owner = undefined;
		try {
			if (event !== null) owner.terminal.notify(event);
		} finally {
			for (const resolve of this.idleWaiters) resolve();
			this.idleWaiters.clear();
		}
	}

	/** Spec 020 Req3.1 — child가 승인된 spawn 직전 +1. 반환된 release()를 정확히 한 번 호출. */
	noteDetachedChild(): () => void {
		const owner = this.owner;
		if (!owner) return () => {};
		owner.detachedChildren += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			owner.detachedChildren = Math.max(0, owner.detachedChildren - 1);
			this.flush();
		};
	}

	/** Spec 020 Req3.1 — shard가 승인된 spawn 직전 +1. */
	noteDetachedShard(): () => void {
		const owner = this.owner;
		if (!owner) return () => {};
		owner.detachedShards += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			owner.detachedShards = Math.max(0, owner.detachedShards - 1);
			this.flush();
		};
	}

	dispose(): void {
		this.disposed = true;
		this.owner = undefined;
	}
}
