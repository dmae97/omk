import { createRequire } from "node:module";
import { compareContextIds } from "./context-budget-order.ts";
import type {
	ContextBudgetTokenizerMode,
	OptionalModuleLoader,
	TokenCounterAdapter,
	TokenCounterRegistryOptions,
	TokenCountResult,
} from "./context-budget-token-counter-types.ts";
import { countTextParts, estimateTextTokens, estimateTextTokensFromParts } from "./text-token-estimate.ts";
import { countFromTokenizerPackages, validateTokenCountResult } from "./tokenizer-module-adapter.ts";

export type * from "./context-budget-token-counter-types.ts";
export { countTextParts, estimateTextTokens, estimateTextTokensFromParts };

const requireModule = createRequire(import.meta.url);

export function createNodeOptionalModuleLoader(): OptionalModuleLoader {
	return {
		resolve(specifier) {
			try {
				return requireModule.resolve(specifier);
			} catch {
				return undefined;
			}
		},
		load(specifier) {
			return requireModule(specifier) as unknown;
		},
	};
}

export function createFallbackTokenCounter(): TokenCounterAdapter {
	return {
		id: "fallback-estimator",
		priority: 0,
		isAvailable: () => true,
		supports: () => true,
		countText(input, modelId) {
			return estimateTextTokens(input, modelId);
		},
		countTextParts(parts, modelId) {
			return estimateTextTokensFromParts(parts, modelId);
		},
	};
}

export function createOpenAiJsTokenCounter(
	loader: OptionalModuleLoader = createNodeOptionalModuleLoader(),
): TokenCounterAdapter {
	const packageNames = ["js-tiktoken", "gpt-tokenizer", "tiktoken"] as const;
	return {
		id: "openai-bpe-js",
		priority: 80,
		isAvailable() {
			return packageNames.some((specifier) => loader.resolve(specifier) !== undefined);
		},
		supports(modelId) {
			return isOpenAiStyleModel(modelId);
		},
		countText(input, modelId) {
			return countFromTokenizerPackages(loader, packageNames, input, modelId, selectOpenAiEncoding(modelId));
		},
	};
}

export function createOpenAiWasmTokenCounter(
	loader: OptionalModuleLoader = createNodeOptionalModuleLoader(),
): TokenCounterAdapter {
	const packageNames = ["@dqbd/tiktoken", "tiktoken"] as const;
	return {
		id: "openai-bpe-wasm",
		priority: 90,
		isAvailable() {
			return packageNames.some((specifier) => loader.resolve(specifier) !== undefined);
		},
		supports(modelId) {
			return isOpenAiStyleModel(modelId);
		},
		countText(input, modelId) {
			return countFromTokenizerPackages(loader, packageNames, input, modelId, selectOpenAiEncoding(modelId));
		},
	};
}

export function createTokenCounterForMode(
	mode: ContextBudgetTokenizerMode,
	loader: OptionalModuleLoader = createNodeOptionalModuleLoader(),
): TokenCounterAdapter {
	const fallback = createFallbackTokenCounter();
	if (mode === "fallback") {
		return fallback;
	}
	const adapters =
		mode === "openai-wasm" ? [createOpenAiWasmTokenCounter(loader)] : [createOpenAiJsTokenCounter(loader)];
	if (mode === "auto") {
		adapters.push(createOpenAiWasmTokenCounter(loader));
	}
	return createTokenCounterRegistry({ adapters, fallback });
}

export function createTokenCounterRegistry(options: TokenCounterRegistryOptions = {}): TokenCounterAdapter {
	const fallback = options.fallback ?? createFallbackTokenCounter();
	const adapters = [...(options.adapters ?? [])].sort(
		(a, b) => b.priority - a.priority || compareContextIds(a.id, b.id),
	);
	const count = (modelId: string, run: (adapter: TokenCounterAdapter) => TokenCountResult): TokenCountResult => {
		const notes: string[] = [];
		for (const adapter of adapters) {
			try {
				if (!adapter.supports(modelId)) continue;
				if (!adapter.isAvailable()) {
					notes.push(`${adapter.id}:unavailable`);
					continue;
				}
				return validateTokenCountResult(run(adapter), modelId);
			} catch {
				// Plugin errors can contain credentials; keep only the stable adapter identifier.
				notes.push(`${adapter.id}:failed`);
			}
		}
		const result = validateTokenCountResult(run(fallback), modelId);
		return { ...result, notes: [...notes, ...result.notes] };
	};
	return {
		id: "token-counter-registry-shape-v2",
		priority: 100,
		isAvailable: () => true,
		supports: () => true,
		countText: (input, modelId) => count(modelId, (adapter) => adapter.countText(input, modelId)),
		countTextParts: (parts, modelId) => count(modelId, (adapter) => countTextParts(adapter, parts, modelId)),
	};
}

function isOpenAiStyleModel(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return (
		normalized.includes("openai") ||
		normalized.startsWith("gpt-") ||
		normalized.startsWith("o1") ||
		normalized.startsWith("o3") ||
		normalized.startsWith("o4") ||
		normalized.includes("chatgpt")
	);
}

function selectOpenAiEncoding(modelId: string): string {
	const normalized = modelId.toLowerCase();
	if (normalized.includes("gpt-4o") || normalized.includes("gpt-5") || normalized.startsWith("o")) {
		return "o200k_base";
	}
	return "cl100k_base";
}
