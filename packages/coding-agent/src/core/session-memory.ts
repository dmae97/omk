import type { Agent, AgentMessage } from "omk-agent-core";
import { estimateProjectedContextTokens } from "./compaction/index.ts";
import type { SystemPromptContextBudgetOptions } from "./context-budget-system-prompt.ts";
import { createTokenCounterForMode } from "./context-budget-token-counter.ts";
import { memoryContextTransform } from "./memory-context-transform.ts";
import { memoryTokenCounter } from "./memory-token-counter.ts";
import {
	assertContextInputWithinCapacity,
	computeHardPromptInputLimit,
	estimateContextInputTokens,
	PromptInputCapacityError,
} from "./prompt-budget.ts";
import { serializePromptToolSchemas } from "./prompt-tool-projection.ts";
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
	private readonly latestCompactionTimestamp: () => string | undefined;
	private readonly transform: ReturnType<typeof memoryContextTransform>;
	private closed = false;
	private currentStatus: SessionMemoryStatus = { state: "disabled", eligible: 0, omitted: 0 };

	constructor(
		agent: Agent,
		cwd: string,
		options: () => SystemPromptContextBudgetOptions | undefined,
		effectiveWindow: (messages: AgentMessage[], window: number) => number,
		latestCompactionTimestamp: () => string | undefined = () => undefined,
	) {
		this.effectiveWindow = effectiveWindow;
		this.latestCompactionTimestamp = latestCompactionTimestamp;
		this.agent = agent;
		this.cwd = cwd;
		this.options = options;
		this.transform = memoryContextTransform(agent.transformContext, (messages) => this.enrich(messages));
		agent.transformContext = this.transform.transform;
	}

	get status(): SessionMemoryStatus {
		return Object.freeze({ ...this.currentStatus });
	}
	private getStore(): VerifiedMemoryStore {
		if (this.closed) throw new Error("Session memory is closed");
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
		if (this.closed) return;
		this.closed = true;
		const previous = this.transform.close();
		if (this.agent.transformContext === this.transform.transform) this.agent.transformContext = previous;
		this.store = undefined;
		this.currentStatus = { state: "disabled", eligible: 0, omitted: 0 };
	}

	private enrich(messages: AgentMessage[]): AgentMessage[] {
		this.currentStatus = { state: "disabled", eligible: 0, omitted: 0 };
		if (process.env.OMK_VERIFIED_MEMORY !== "1") return messages;
		const options = this.options();
		const model = this.agent.state.model;
		if (!options || !model || !Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0) return messages;
		const counter = memoryTokenCounter(
			options.tokenCounter ?? createTokenCounterForMode(options.tokenizerMode ?? "fallback"),
			model.id,
			this.agent.state.systemPrompt,
			serializePromptToolSchemas(this.agent.state.tools),
		);
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
			projectedUsageTokens: estimateProjectedContextTokens(messages, [], this.latestCompactionTimestamp()).tokens,
		};
		const before = assertContextInputWithinCapacity({ ...input, maxInputTokens: limit.maxInputTokens });
		try {
			const { records, omitted } = this.getStore().retrieve();
			this.currentStatus = { state: "empty", eligible: records.length, omitted };
			if (records.length === 0) return messages;
			const mode = process.env.OMK_MEMORY_SELECTION ?? "legacy";
			if (mode !== "legacy" && mode !== "v2") throw new RangeError("memory.invalid_selection_mode");
			const budgetTokens = Math.max(
				0,
				Math.min(2048, limit.maxInputTokens - before.totalTokens - (mode === "legacy" ? 512 : 0)),
			);
			const projection = memoryContextPair(records, budgetTokens, options.queryContext ?? "", counter, model.id, {
				mode,
				fits: (candidate) =>
					estimateContextInputTokens({ ...input, messages: [...messages, ...candidate] }).totalTokens <=
					limit.maxInputTokens,
			});
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
