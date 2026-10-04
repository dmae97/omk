import type { AgentMessage, AgentState, AgentTool } from "omk-agent-core";
import type { Api, Model } from "omk-ai";
import type { CompactionSettings } from "./compaction/compaction-headroom.ts";
import { createTokenCounterForMode, type TokenCounterAdapter } from "./context-budget-token-counter.ts";
import { admissionKey } from "./performance-upgrade/admission-key.ts";
import { serializePromptToolSchemas } from "./prompt-tool-projection.ts";
import { admitSessionInput, sessionInputTokenLimit } from "./session-input-admission.ts";
import {
	describeWithheldToolGroups,
	fitToolSchemas,
	toolSchemaBudgetTokens,
	type WithheldToolGroup,
	withoutGroups,
} from "./tool-schema-budget.ts";

/** Session state read by per-turn admission; every accessor is evaluated at call time. */
export interface SessionTurnAdmissionHost {
	readonly model: () => Model<Api> | undefined;
	readonly state: () => Pick<AgentState, "systemPrompt" | "messages" | "tools">;
	/** Window the provider enforces for this turn; vision routing may shrink it. */
	readonly contextWindow: (pending: readonly AgentMessage[], sessionWindow: number) => number;
	readonly compactionSettings: () => CompactionSettings;
	readonly latestCompactionTimestamp: () => string | undefined;
	/** Group a tool is withheld with (its MCP server); `undefined` keeps it in every request. */
	readonly toolGroup: (toolName: string) => string | undefined;
	/** Compacts retained history once; called only while auto-compaction is enabled. */
	readonly compact: () => Promise<void>;
	readonly notify: (message: string) => void;
}

/**
 * Per-turn input admission. Tool schemas are fitted to the model's input budget first: whole
 * MCP servers are withheld, largest first, only when a compacted session could not fit
 * otherwise. The hard input ceiling is then enforced with one bounded compaction recovery.
 * Admission and the run it admits share one selection, so what was checked is what is sent.
 * The selection is reused only while its content key matches: provider, model id, window,
 * ceiling, settings, full system prompt, serialized schemas, group mapping, counter id and
 * admitted-counter epoch.
 */
export class SessionTurnAdmission {
	private readonly host: SessionTurnAdmissionHost;
	private counter: TokenCounterAdapter = createTokenCounterForMode("fallback");
	private fitted?: { readonly key: string; readonly withheld: ReadonlySet<string> };
	private announced = "";
	private counterEpoch = 0;

	constructor(host: SessionTurnAdmissionHost) {
		this.host = host;
	}

	/** Tools a provider request may carry for the current model; the active tool set is untouched. */
	fitTools(tools: readonly AgentTool[], pending: readonly AgentMessage[]): AgentTool[] {
		const model = this.host.model();
		const sessionWindow = model?.contextWindow ?? 0;
		if (!model || !Number.isSafeInteger(sessionWindow) || sessionWindow <= 0) return [...tools];
		const contextWindow = this.host.contextWindow(pending, sessionWindow);
		const ceiling = sessionInputTokenLimit(model, contextWindow);
		if (ceiling === undefined) return [...tools];
		const settings = this.host.compactionSettings();
		const { systemPrompt } = this.host.state();
		const modelName = `${model.provider}/${model.id}`;
		const toolGroups = tools.map((tool) => [tool.name, this.host.toolGroup(tool.name) ?? null] as const);
		const groupMap = new Map(toolGroups);
		const groupOf = (name: string): string | undefined => groupMap.get(name) ?? undefined;
		const key = admissionKey({
			provider: model.provider,
			modelId: model.id,
			contextWindow,
			ceiling,
			settings,
			systemPrompt,
			counterId: this.counter.id,
			counterEpoch: this.counterEpoch,
			schemas: serializePromptToolSchemas(tools),
			toolGroups,
		});
		if (this.fitted?.key !== key) {
			const countTokens = (text: string): number => this.counter.countText(text, model.id).tokens;
			const budgetTokens = toolSchemaBudgetTokens({
				contextWindow,
				inputCeilingTokens: ceiling,
				settings,
				systemPromptTokens: countTokens(systemPrompt),
			});
			const fit = fitToolSchemas({ tools, groupOf, budgetTokens, countTokens });
			this.fitted = { key, withheld: new Set(fit.withheld.map((group) => group.group)) };
			this.announce(modelName, budgetTokens, fit.withheld);
		}
		return withoutGroups(tools, groupOf, this.fitted.withheld);
	}

	/** Rejects the turn only when neither the tool fit nor one compaction brings it under the ceiling. */
	async admit(pending: AgentMessage[], counter: TokenCounterAdapter): Promise<void> {
		this.counter = counter;
		// Counters are rebuilt per turn and may share an id (every registry mix reports one id),
		// so a newly admitted counter never inherits the previous counter's fit.
		this.counterEpoch++;
		const compact = this.host.compactionSettings().enabled ? this.host.compact : undefined;
		await admitSessionInput(() => {
			const state = this.host.state();
			return {
				model: this.host.model(),
				state: {
					systemPrompt: state.systemPrompt,
					messages: state.messages,
					tools: this.fitTools(state.tools, pending),
				},
				pending,
				effectiveWindow: (window) => this.host.contextWindow(pending, window),
				counter,
				latestCompactionTimestamp: this.host.latestCompactionTimestamp(),
			};
		}, compact);
	}

	private announce(model: string, budgetTokens: number, withheld: readonly WithheldToolGroup[]): void {
		const signature = withheld.map((group) => group.group).join(",");
		if (signature === this.announced) return;
		this.announced = signature;
		this.host.notify(
			withheld.length === 0
				? `All MCP tools fit ${model}'s input budget again.`
				: `MCP tool schemas exceed ${model}'s input budget (~${(budgetTokens / 1000).toFixed(1)}k tokens), so its requests withhold ${describeWithheldToolGroups(withheld)}. Switch to a larger-context model to restore them, or disable unused MCP servers.`,
		);
	}
}
