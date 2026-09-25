import type { Agent, AgentMessage } from "omk-agent-core";
import { estimateProjectedContextTokens } from "./compaction/index.ts";
import type { SystemPromptContextBudgetOptions } from "./context-budget-system-prompt.ts";
import { createTokenCounterForMode } from "./context-budget-token-counter.ts";
import {
	assertContextInputWithinCapacity,
	computeHardPromptInputLimit,
	estimateContextInputTokens,
	PromptInputCapacityError,
} from "./prompt-budget.ts";
import { memoryContextPair } from "./verified-memory-context.ts";
import type { MemoryAdmission } from "./verified-memory-record.ts";
import { VerifiedMemoryStore } from "./verified-memory-store.ts";

export interface SessionMemoryStatus {
	readonly state: "disabled" | "empty" | "ready" | "unavailable" | "budget-omitted";
	readonly eligible: number;
	readonly omitted: number;
	readonly budgetTokens?: number;
	readonly projectedTokens?: number;
}

/** Transient provider-input transform; no memory enters the durable transcript or compaction. */
export class SessionMemory {
	private store: VerifiedMemoryStore | undefined;
	private readonly agent: Agent;
	private readonly cwd: string;
	private readonly options: () => SystemPromptContextBudgetOptions | undefined;
	private readonly effectiveWindow: (messages: AgentMessage[], window: number) => number;
	private readonly original: Agent["transformContext"];
	private readonly wrapped: NonNullable<Agent["transformContext"]>;
	private currentStatus: SessionMemoryStatus = { state: "disabled", eligible: 0, omitted: 0 };

	constructor(
		agent: Agent,
		cwd: string,
		options: () => SystemPromptContextBudgetOptions | undefined,
		effectiveWindow: (messages: AgentMessage[], window: number) => number,
	) {
		this.effectiveWindow = effectiveWindow;
		this.agent = agent;
		this.cwd = cwd;
		this.options = options;
		this.original = agent.transformContext;
		this.wrapped = async (messages, signal) => {
			const transformed = this.original ? await this.original(messages, signal) : messages;
			signal?.throwIfAborted();
			return this.enrich(transformed);
		};
		agent.transformContext = this.wrapped;
	}

	get status(): SessionMemoryStatus {
		return Object.freeze({ ...this.currentStatus });
	}
	private getStore(): VerifiedMemoryStore {
		this.store ??= new VerifiedMemoryStore(this.cwd);
		return this.store;
	}
	remember(input: unknown): MemoryAdmission {
		return this.getStore().remember(input);
	}
	forget(id: string): void {
		this.getStore().forget(id);
	}
	close(): void {
		if (this.agent.transformContext === this.wrapped) this.agent.transformContext = this.original;
	}

	private enrich(messages: AgentMessage[]): AgentMessage[] {
		this.currentStatus = { state: "disabled", eligible: 0, omitted: 0 };
		if (process.env.OMK_VERIFIED_MEMORY !== "1") return messages;
		const options = this.options();
		const model = this.agent.state.model;
		if (!options || !model || !Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0) return messages;
		const counter = options.tokenCounter ?? createTokenCounterForMode(options.tokenizerMode ?? "fallback");
		const limit = computeHardPromptInputLimit({
			contextWindow: this.effectiveWindow(messages, model.contextWindow),
			configuredMaxPromptTokens: options.maxPromptTokens,
			modelMaxTokens: model.maxTokens,
		});
		const input = {
			systemPrompt: this.agent.state.systemPrompt,
			messages,
			tools: this.agent.state.tools,
			modelId: model.id,
			tokenCounter: counter,
			projectedUsageTokens: estimateProjectedContextTokens(messages, []).tokens,
		};
		const before = assertContextInputWithinCapacity({ ...input, maxInputTokens: limit.maxInputTokens });
		try {
			const { records, omitted } = this.getStore().retrieve();
			this.currentStatus = { state: "empty", eligible: records.length, omitted };
			if (records.length === 0) return messages;
			const budgetTokens = Math.max(0, Math.min(2048, limit.maxInputTokens - before.totalTokens - 512));
			const projection = memoryContextPair(records, budgetTokens, options.queryContext ?? "", counter, model.id);
			const pair = projection.messages;
			const enriched = [...messages, ...pair];
			// Price the host tool-pair envelope too; optional evidence never evicts the real prompt.
			const after = estimateContextInputTokens({ ...input, messages: enriched });
			if (pair.length === 0 || after.totalTokens > limit.maxInputTokens) {
				this.currentStatus = {
					state: "budget-omitted",
					eligible: records.length,
					omitted: records.length + omitted,
					budgetTokens,
					projectedTokens: after.totalTokens,
				};
				return messages;
			}
			this.currentStatus = {
				state: "ready",
				eligible: records.length,
				omitted: omitted + records.length - projection.selected,
				budgetTokens,
				projectedTokens: after.totalTokens,
			};
			return enriched;
		} catch (error) {
			if (error instanceof PromptInputCapacityError) throw error;
			this.currentStatus = { state: "unavailable", eligible: 0, omitted: 0 };
			return messages;
		}
	}
}
