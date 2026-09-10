import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
	streamSimple,
} from "omk-ai";
import { projectToolImagesForModel } from "./provider-input.ts";
import { createContractPayloadHook } from "./provider-payload-contract.ts";
import {
	assertModelContract,
	type ModelContract,
	ModelContractViolation,
	snapshotModelContract,
} from "./run-model-contract.ts";
import type { AgentEvent, AgentLoopConfig, StreamFn } from "./types.ts";
import { getVisionRouteModel } from "./vision-route.ts";

export type { ProviderRequestEvent } from "./provider-request-types.ts";

/** Pin policy before any lifecycle subscriber can alter caller-owned configuration. */
export async function pinProviderConfig(
	config: AgentLoopConfig,
	emit: (event: AgentEvent) => Promise<void> | void,
): Promise<AgentLoopConfig> {
	if (config.modelContract === undefined) return config;
	try {
		return { ...config, modelContract: snapshotModelContract(config.modelContract) };
	} catch (error) {
		if (error instanceof ModelContractViolation) {
			await emit({ type: "provider_denied", requestId: crypto.randomUUID(), deniedReason: "contract-violation" });
		}
		throw error;
	}
}

/** Restrict logical dispatch and attach the supported final-payload checks. */
export function applyModelContract(
	contract: ModelContract,
	model: Model<Api>,
	options: SimpleStreamOptions,
): SimpleStreamOptions {
	const maxTokens = options.maxTokens ?? Math.min(model.maxTokens, contract.maxOutputTokens);
	assertModelContract(contract, {
		model,
		provider: model.provider,
		authOrigin: model.provider,
		thinking: options.reasoning !== undefined,
		thinkingLevel: options.reasoning ?? "off",
		maxOutputTokens: maxTokens,
	});
	return {
		...options,
		maxTokens,
		onPayload: createContractPayloadHook(model, maxTokens, options.onPayload),
	};
}

interface ProviderRuntime {
	readonly signal?: AbortSignal;
	readonly emit: (event: AgentEvent) => Promise<void> | void;
	readonly streamFn?: StreamFn;
	readonly consume: (stream: AssistantMessageEventStream) => Promise<AssistantMessage>;
}

/** Emit only bounded dispatch metadata; never payloads, headers, keys, or raw failures. */
export async function requestAssistantResponse(
	context: Context,
	config: AgentLoopConfig,
	runtime: ProviderRuntime,
): Promise<AssistantMessage> {
	const { signal, emit, consume } = runtime;
	const needsVisionRoute = context.messages.some(
		(message) =>
			(!config.modelContract || message.role !== "toolResult") &&
			Array.isArray(message.content) &&
			message.content.some((part) => part.type === "image"),
	);
	const model =
		needsVisionRoute && !(config.model.input ?? []).includes("image")
			? getVisionRouteModel(config.model)
			: config.model;
	const projection = config.modelContract
		? projectToolImagesForModel(context, model)
		: { context, omittedToolImages: 0 };
	const changedProvider = model.provider !== config.model.provider;
	const requestId = crypto.randomUUID();
	const { modelContract, ...configured } = config;
	let options: SimpleStreamOptions = configured;
	try {
		if (signal?.aborted) {
			if (modelContract) await emit({ type: "provider_denied", requestId, deniedReason: "aborted" });
			signal.throwIfAborted();
		}
		if (modelContract) options = applyModelContract(modelContract, model, configured);
	} catch (error) {
		if (error instanceof ModelContractViolation) {
			await emit({ type: "provider_denied", requestId, deniedReason: "contract-violation" });
		}
		throw error;
	}
	const key = await config.getApiKey?.(model.provider);
	if (signal?.aborted) {
		if (modelContract) await emit({ type: "provider_denied", requestId, deniedReason: "aborted" });
		signal.throwIfAborted();
	}
	const requestOptions: SimpleStreamOptions = {
		...options,
		apiKey: key || (changedProvider ? undefined : options.apiKey),
		headers: changedProvider ? undefined : options.headers,
		signal,
	};
	let outcome: "completed" | "error" | "aborted" = "error";
	try {
		if (modelContract) {
			await emit({
				type: "provider_request",
				requestId,
				provider: model.provider,
				model: model.id,
				maxOutputTokens: requestOptions.maxTokens ?? modelContract.maxOutputTokens,
				...(projection.omittedToolImages > 0 ? { omittedToolImages: projection.omittedToolImages } : {}),
				boundary: "stream-dispatch",
			});
		}
		signal?.throwIfAborted();
		const response = await (runtime.streamFn ?? streamSimple)(model, projection.context, requestOptions);
		const message = await consume(response);
		outcome = message.stopReason === "aborted" ? "aborted" : message.stopReason === "error" ? "error" : "completed";
		return message;
	} finally {
		if (modelContract) {
			await emit({
				type: "provider_request_end",
				requestId,
				outcome: signal?.aborted ? "aborted" : outcome,
				boundary: "stream-dispatch",
			});
		}
	}
}
