import type { ContextSourceRefV2 } from "./context-budget-headroom.ts";
import type {
	PromptContextBudgetObservabilityV2,
	QualityDiagnosticV2,
	SelectedRepresentationV2,
	TokenOptimizerRuntimeStatus,
} from "./context-budget-v2-types.ts";

const TOKEN_OPTIMIZER_RUNTIME_STATUS: TokenOptimizerRuntimeStatus = {
	optimizerId: "legacy-token-optimizer",
	status: "quarantined_compatibility",
	active: false,
	activeContextBudgetOptimizer: "context-budget-v2",
	compatibilityOnly: true,
};

export function buildObservability(input: {
	readonly available: number;
	readonly diagnostics: readonly QualityDiagnosticV2[];
	readonly omittedItemIds: readonly string[];
	readonly omittedTokens: number;
	readonly planHash: string;
	readonly rawTokens: number;
	readonly retrievalFallbacks: readonly ContextSourceRefV2[];
	readonly selection: ReadonlyMap<string, SelectedRepresentationV2>;
	readonly usedTokens: number;
	readonly cacheTelemetry: PromptContextBudgetObservabilityV2["cache"];
}): PromptContextBudgetObservabilityV2 {
	const selected = [...input.selection.values()];
	return {
		counts: {
			selected: selected.length,
			omitted: input.omittedItemIds.length,
			pointer: selected.filter((representation) => representation.kind === "pointer").length,
			compressed: selected.filter((representation) => representation.kind === "headroom-compressed").length,
			full: selected.filter((representation) => representation.kind === "full").length,
			retrievalFallback: countUniqueRetrievalFallbacks(input.retrievalFallbacks),
		},
		diagnosticReasons: [...new Set(input.diagnostics.map((diagnostic) => diagnostic.reason))].sort(),
		tokens: {
			available: input.available,
			used: input.usedTokens,
			raw: input.rawTokens,
			omitted: input.omittedTokens,
			tokenSavings: Math.max(0, input.rawTokens - input.usedTokens),
		},
		planHash: input.planHash,
		cache: input.cacheTelemetry,
		tokenOptimizer: TOKEN_OPTIMIZER_RUNTIME_STATUS,
	};
}

function countUniqueRetrievalFallbacks(retrievalFallbacks: readonly ContextSourceRefV2[]): number {
	return new Set(
		retrievalFallbacks.map((ref) =>
			[ref.uri, ref.contentHash, ref.symbol ?? "", ref.range?.startLine ?? "", ref.range?.endLine ?? ""].join("\0"),
		),
	).size;
}
