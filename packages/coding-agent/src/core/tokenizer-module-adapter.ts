/** Versioned module-shape adapter. Factory-created encoders are owned for one call. */
import type { OptionalModuleLoader, TokenCountResult } from "./context-budget-token-counter-types.ts";

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && (typeof value === "object" || typeof value === "function")
		? (value as Record<string, unknown>)
		: undefined;
}
function factory(owner: Record<string, unknown>, names: readonly string[]): ((name: string) => unknown) | undefined {
	for (const name of names) {
		const fn = owner[name];
		if (typeof fn === "function") return (argument) => Reflect.apply(fn, owner, [argument]);
	}
	return undefined;
}
function tokenLength(value: unknown): number {
	const encoded = record(value);
	const length = encoded?.length;
	if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
		throw new TypeError("tokenizer.invalid_token_sequence");
	}
	return length;
}
function countOwned(encoderValue: unknown, text: string): number {
	const encoder = record(encoderValue);
	if (!encoder) throw new TypeError("tokenizer.invalid_encoder");
	try {
		if (typeof encoder.encode !== "function") throw new TypeError("tokenizer.invalid_encoder");
		return tokenLength(Reflect.apply(encoder.encode, encoderValue, [text]));
	} finally {
		if (typeof encoder.free === "function") Reflect.apply(encoder.free, encoderValue, []);
	}
}

export function countTokenizerModule(
	moduleValue: unknown,
	specifier: string,
	text: string,
	modelId: string,
	fallbackEncoding: string,
): TokenCountResult | undefined {
	const root = record(moduleValue);
	if (!root) return undefined;
	const namespaces = [root];
	const defaultNamespace = record(root.default);
	if (defaultNamespace && defaultNamespace !== root) namespaces.push(defaultNamespace);
	const makeResult = (tokens: number, modelMapped: boolean, note: string): TokenCountResult => ({
		tokens,
		method: modelMapped ? "exact" : "estimated",
		confidence: modelMapped ? "high" : "low",
		adapterId: `${specifier}:shape-v2:${modelMapped ? "model" : fallbackEncoding}`,
		modelId,
		notes: [note, ...(modelMapped ? [] : ["model-encoding-not-proven"])],
	});
	// Try model-specific factories across namespaces before guessing an encoding.
	for (const owner of namespaces) {
		const create = factory(owner, ["encodingForModel", "encoding_for_model"]);
		if (!create) continue;
		let encoder: unknown;
		try {
			encoder = create(modelId);
		} catch {
			continue;
		}
		return makeResult(countOwned(encoder, text), true, "model-encoding");
	}
	for (const owner of namespaces) {
		const create = factory(owner, ["getEncoding", "get_encoding"]);
		if (!create) continue;
		let encoder: unknown;
		try {
			encoder = create(fallbackEncoding);
		} catch {
			continue;
		}
		return makeResult(countOwned(encoder, text), false, "fallback-encoding");
	}
	for (const owner of namespaces) {
		if (typeof owner.encode !== "function") continue;
		// Module-level encoders are borrowed, never freed here.
		return makeResult(tokenLength(Reflect.apply(owner.encode, owner, [text])), false, "generic-encode");
	}
	return undefined;
}

export function countFromTokenizerPackages(
	loader: OptionalModuleLoader,
	packageNames: readonly string[],
	text: string,
	modelId: string,
	fallbackEncoding: string,
): TokenCountResult {
	let provisional: TokenCountResult | undefined;
	const diagnostics: string[] = [];
	for (const specifier of packageNames) {
		try {
			if (loader.resolve(specifier) === undefined) continue;
			const result = countTokenizerModule(loader.load(specifier), specifier, text, modelId, fallbackEncoding);
			if (result?.method === "exact") return { ...result, notes: [...diagnostics, ...result.notes] };
			provisional ??= result;
		} catch {
			// Do not copy arbitrary loader/encoder messages into prompt diagnostics.
			diagnostics.push(`${specifier}:adapter-failed`);
		}
	}
	if (provisional) return { ...provisional, notes: [...diagnostics, ...provisional.notes] };
	throw new Error("tokenizer.no_supported_module");
}

/** Do not let a third-party adapter introduce NaN or a negative cost into admission. */
export function validateTokenCountResult(result: TokenCountResult, modelId: string): TokenCountResult {
	if (!result || typeof result !== "object") throw new TypeError("tokenizer.invalid_count_result");
	const descriptors = Object.getOwnPropertyDescriptors(result);
	const read = (key: string): unknown => {
		const descriptor = descriptors[key];
		if (!descriptor || !("value" in descriptor)) throw new TypeError("tokenizer.invalid_count_result");
		return descriptor.value;
	};
	const tokens = read("tokens"),
		method = read("method"),
		confidence = read("confidence");
	const adapterId = read("adapterId"),
		reportedModel = read("modelId"),
		notes = read("notes");
	if (
		typeof tokens !== "number" ||
		!Number.isSafeInteger(tokens) ||
		tokens < 0 ||
		(method !== "exact" && method !== "estimated") ||
		(confidence !== "high" && confidence !== "medium" && confidence !== "low") ||
		typeof adapterId !== "string" ||
		adapterId.length === 0 ||
		reportedModel !== modelId ||
		!Array.isArray(notes)
	) {
		throw new TypeError("tokenizer.invalid_count_result");
	}
	const copiedNotes: string[] = [];
	for (let i = 0; i < notes.length; i++) {
		const descriptor = Object.getOwnPropertyDescriptor(notes, i);
		if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
			throw new TypeError("tokenizer.invalid_count_result");
		}
		copiedNotes.push(descriptor.value);
	}
	return { tokens, method, confidence, adapterId, modelId, notes: copiedNotes };
}
