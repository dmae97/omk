import { createRequire } from "node:module";

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

interface EncodeCapable {
	encode(input: string): readonly unknown[];
}

interface JsTiktokenModule {
	encodingForModel?: (modelId: string) => EncodeCapable;
	getEncoding?: (encoding: string) => EncodeCapable;
}

interface GenericEncodeModule {
	encode?: (input: string) => readonly unknown[];
}

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
	};
}

export function estimateTextTokens(input: string, modelId = "unknown"): TokenCountResult {
	if (input.length === 0) {
		return createTokenResult(0, "estimated", "medium", "fallback-estimator", modelId, ["empty-input"]);
	}

	let asciiWord = 0;
	let whitespace = 0;
	let cjk = 0;
	let hangul = 0;
	let emojiOrWide = 0;
	let punctuation = 0;
	let other = 0;

	for (const char of input) {
		const codePoint = char.codePointAt(0) ?? 0;
		if (/\s/u.test(char)) {
			whitespace += 1;
		} else if (isHangul(codePoint)) {
			hangul += 1;
		} else if (isCjk(codePoint)) {
			cjk += 1;
		} else if (isAsciiAlphaNumeric(codePoint) || char === "_") {
			asciiWord += 1;
		} else if (isEmojiOrWideSymbol(codePoint)) {
			emojiOrWide += 1;
		} else if (isAsciiPunctuation(codePoint)) {
			punctuation += 1;
		} else {
			other += 1;
		}
	}

	const codeLike = looksCodeLike(input, punctuation, whitespace);
	const jsonLike = looksJsonLike(input);
	const base =
		asciiWord / (codeLike ? 3.2 : 4) +
		whitespace / 12 +
		punctuation / 2.1 +
		hangul / 1.35 +
		cjk / 1.2 +
		emojiOrWide * 1.8 +
		other / 2;
	const adjusted = base * (jsonLike ? 1.12 : 1) * (codeLike ? 1.08 : 1);
	const tokens = Math.max(1, Math.ceil(adjusted));
	const notes = [
		codeLike ? "code-like" : "prose-like",
		jsonLike ? "json-like" : "not-json-like",
		hangul + cjk > 0 ? "cjk-or-hangul" : "latin-heavy",
	];
	const confidence: ContextBudgetTokenConfidence = hangul + cjk + emojiOrWide > input.length / 4 ? "low" : "medium";
	return createTokenResult(tokens, "estimated", confidence, "fallback-estimator", modelId, notes);
}

export function createOpenAiJsTokenCounter(
	loader: OptionalModuleLoader = createNodeOptionalModuleLoader(),
): TokenCounterAdapter {
	const packageNames = ["js-tiktoken", "gpt-tokenizer"] as const;
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
			for (const specifier of packageNames) {
				if (loader.resolve(specifier) === undefined) {
					continue;
				}
				const result = countWithOptionalTokenizerModule(loader.load(specifier), specifier, input, modelId);
				if (result !== undefined) {
					return result;
				}
			}
			throw new Error("no supported OpenAI JS tokenizer module shape found");
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
			for (const specifier of packageNames) {
				if (loader.resolve(specifier) === undefined) {
					continue;
				}
				const result = countWithOptionalTokenizerModule(loader.load(specifier), specifier, input, modelId);
				if (result !== undefined) {
					return result;
				}
			}
			throw new Error("no supported OpenAI WASM tokenizer module shape found");
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
	const adapters = [...(options.adapters ?? [])].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
	return {
		id: "token-counter-registry",
		priority: 100,
		isAvailable: () => true,
		supports: () => true,
		countText(input, modelId) {
			const notes: string[] = [];
			for (const adapter of adapters) {
				if (!adapter.supports(modelId)) {
					continue;
				}
				try {
					if (!adapter.isAvailable()) {
						notes.push(`${adapter.id}:unavailable`);
						continue;
					}
					return adapter.countText(input, modelId);
				} catch (error) {
					const message = error instanceof Error ? error.message : "unknown adapter failure";
					notes.push(`${adapter.id}:failed:${message}`);
				}
			}
			const result = fallback.countText(input, modelId);
			return { ...result, notes: [...notes, ...result.notes] };
		},
	};
}

function countWithOptionalTokenizerModule(
	moduleValue: unknown,
	specifier: string,
	input: string,
	modelId: string,
): TokenCountResult | undefined {
	const moduleObject = unwrapDefaultModule(moduleValue);
	const jsTiktoken = moduleObject as JsTiktokenModule;
	if (typeof jsTiktoken.encodingForModel === "function") {
		const encoding = jsTiktoken.encodingForModel(modelId);
		return countWithEncoding(encoding, specifier, input, modelId, "model-encoding");
	}
	if (typeof jsTiktoken.getEncoding === "function") {
		const encoding = jsTiktoken.getEncoding(selectOpenAiEncoding(modelId));
		return countWithEncoding(encoding, specifier, input, modelId, "fallback-encoding");
	}
	const generic = moduleObject as GenericEncodeModule;
	if (typeof generic.encode === "function") {
		return createTokenResult(generic.encode(input).length, "exact", "medium", specifier, modelId, ["generic-encode"]);
	}
	return undefined;
}

function countWithEncoding(
	encoding: EncodeCapable,
	adapterId: string,
	input: string,
	modelId: string,
	note: string,
): TokenCountResult {
	return createTokenResult(encoding.encode(input).length, "exact", "high", adapterId, modelId, [note]);
}

function unwrapDefaultModule(moduleValue: unknown): unknown {
	if (moduleValue && typeof moduleValue === "object" && "default" in moduleValue) {
		return (moduleValue as { readonly default: unknown }).default;
	}
	return moduleValue;
}

function createTokenResult(
	tokens: number,
	method: ContextBudgetTokenCountMethod,
	confidence: ContextBudgetTokenConfidence,
	adapterId: string,
	modelId: string,
	notes: readonly string[],
): TokenCountResult {
	return {
		tokens: Math.max(0, Math.ceil(tokens)),
		method,
		confidence,
		adapterId,
		modelId,
		notes,
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

function isAsciiAlphaNumeric(codePoint: number): boolean {
	return (
		(codePoint >= 48 && codePoint <= 57) ||
		(codePoint >= 65 && codePoint <= 90) ||
		(codePoint >= 97 && codePoint <= 122)
	);
}

function isAsciiPunctuation(codePoint: number): boolean {
	return codePoint >= 33 && codePoint <= 126;
}

function isHangul(codePoint: number): boolean {
	return (codePoint >= 0xac00 && codePoint <= 0xd7af) || (codePoint >= 0x1100 && codePoint <= 0x11ff);
}

function isCjk(codePoint: number): boolean {
	return (
		(codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
		(codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
		(codePoint >= 0x3040 && codePoint <= 0x30ff)
	);
}

function isEmojiOrWideSymbol(codePoint: number): boolean {
	return codePoint >= 0x1f000 || (codePoint >= 0x2600 && codePoint <= 0x27bf);
}

function looksJsonLike(input: string): boolean {
	const trimmed = input.trim();
	return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function looksCodeLike(input: string, punctuation: number, whitespace: number): boolean {
	if (/\b(function|const|let|class|interface|import|export|return|async|await)\b/.test(input)) {
		return true;
	}
	return punctuation > input.length / 8 && whitespace > input.length / 20;
}
