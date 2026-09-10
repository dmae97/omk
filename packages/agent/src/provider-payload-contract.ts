import type { Api, Model, SimpleStreamOptions } from "omk-ai";
import { createImmutableSnapshot } from "./plain-data.ts";
import { ModelContractViolation } from "./run-model-contract.ts";

type PayloadHook = NonNullable<SimpleStreamOptions["onPayload"]>;
const contractHooks = new WeakSet<PayloadHook>();

function assertCompletionPayload(payload: unknown, modelId: string, maxTokens: number): void {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload) || !("model" in payload)) {
		throw new ModelContractViolation("invalid-request");
	}
	if (payload.model !== modelId) throw new ModelContractViolation("model-not-allowed");
	const legacyLimit = "max_tokens" in payload ? payload.max_tokens : undefined;
	const completionLimit = "max_completion_tokens" in payload ? payload.max_completion_tokens : undefined;
	if (legacyLimit !== undefined && completionLimit !== undefined) {
		throw new ModelContractViolation("invalid-request-limit");
	}
	const limit = legacyLimit !== undefined ? legacyLimit : completionLimit;
	if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0) {
		throw new ModelContractViolation("invalid-request-limit");
	}
	if (limit > maxTokens) throw new ModelContractViolation("output-limit-exceeded");
}

/** Validate supported final payloads and preserve immutable user observation. */
export function createContractPayloadHook(
	model: Pick<Model<Api>, "api" | "id">,
	maxTokens: number,
	observer?: PayloadHook,
): PayloadHook {
	const { api, id } = model;
	const hook: PayloadHook = async (payload, requestModel) => {
		if (api === "openai-completions") assertCompletionPayload(payload, id, maxTokens);
		if (!observer) return;
		// The core and SDK both enforce contracts. Only the innermost user hook needs a snapshot.
		if (contractHooks.has(observer)) return observer(payload, requestModel);
		const original = createImmutableSnapshot(payload);
		const result = (await observer(original, createImmutableSnapshot(requestModel))) ?? original;
		if (JSON.stringify(result) !== JSON.stringify(original)) {
			throw new TypeError("Model contract forbids payload replacement");
		}
		return structuredClone(original);
	};
	contractHooks.add(hook);
	return hook;
}
