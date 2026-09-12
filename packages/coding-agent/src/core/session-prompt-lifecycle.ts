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
	private readonly canSettle: () => boolean;
	private readonly auditsLateSettlement: () => boolean;

	constructor(options: { canSettle?: () => boolean; auditsLateSettlement?: () => boolean } = {}) {
		this.canSettle = options.canSettle ?? (() => true);
		this.auditsLateSettlement = options.auditsLateSettlement ?? (() => true);
	}

	assertIdle(): void {
		if (this.owner !== undefined || this.disposed) throw new PromptExecutionBusyError();
	}

	begin(promptRunId: string): {
		finish: (outcome: PromptSettlementOutcome, notify: (event: PromptSettledEvent) => void) => void;
	} {
		this.assertIdle();
		const owner: PromptOwner = { promptRunId, startedAt: performance.now(), executions: new Set() };
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
		if (!owner?.terminal || owner.executions.size > 0 || this.disposed || !this.canSettle()) return;
		const state = reducePromptSettlement(createPromptSettlementState(owner.promptRunId, owner.startedAt), {
			kind: "terminal",
			outcome: owner.terminal.outcome,
		});
		const { event } = settlePromptIfReady(state, performance.now());
		this.owner = undefined;
		if (event !== null) owner.terminal.notify(event);
	}

	dispose(): void {
		this.disposed = true;
		this.owner = undefined;
	}
}
