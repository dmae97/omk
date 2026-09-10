export type ContextBudgetTokenCountMethod = "exact" | "estimated";
export type ContextBudgetTokenConfidence = "high" | "medium" | "low";
export type ContextBudgetTokenizerMode = "auto" | "fallback" | "openai-js" | "openai-wasm";

export interface TokenCountResult {
	readonly tokens: number;
	readonly method: ContextBudgetTokenCountMethod;
	readonly confidence: ContextBudgetTokenConfidence;
	readonly adapterId: string;
	readonly modelId: string;
	readonly notes: readonly string[];
}

export interface TokenCounterAdapter {
	readonly id: string;
	readonly priority: number;
	isAvailable(): boolean;
	supports(modelId: string): boolean;
	countText(input: string, modelId: string): TokenCountResult;
}

export interface OptionalModuleLoader {
	resolve(specifier: string): string | undefined;
	load(specifier: string): unknown;
}

export interface TokenCounterRegistryOptions {
	readonly adapters?: readonly TokenCounterAdapter[];
	readonly fallback?: TokenCounterAdapter;
}
