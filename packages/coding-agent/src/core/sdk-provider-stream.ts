import {
	applyModelContract,
	type ModelContract,
	projectToolImagesForModel,
	type StreamFn,
	snapshotModelContract,
} from "omk-agent-core";
import { type SimpleStreamOptions, streamSimple } from "omk-ai";
import { isDefaultOnEnvFlag } from "./env-flag.ts";
import { createJsonSessionInfoStreamFn } from "./json-session-info.ts";
import { createLlmCallRunLogStreamFn } from "./llm-call-run-log.ts";
import type { ModelRegistry } from "./model-registry.ts";
import { mergeProviderAttributionHeaders } from "./provider-attribution.ts";
import { createResponseReasoningCapStreamFn, resolveResponseReasoningCapConfig } from "./response-reasoning-cap.ts";
import type { SettingsManager } from "./settings-manager.ts";

interface SdkProviderRuntime {
	readonly modelRegistry: ModelRegistry;
	readonly settingsManager: SettingsManager;
	readonly modelContract?: ModelContract;
	readonly onRateLimit?: (
		apiKey: string | undefined,
		...args: Parameters<NonNullable<SimpleStreamOptions["onRateLimit"]>>
	) => void;
}

/**
 * Shared by the main agent and first-party summary calls using agent.streamFn.
 * Spec 033: wrapped with the opt-in per-response reasoning cap (`OMK_RESPONSE_REASONING_CAP=1`).
 * Spec 059: below the cap, one `llm-call.jsonl` line per provider request when `OMK_RUN_LOG_DIR` is set.
 * Spec 037: outermost, the opt-in adaptive effort wrapper (`OMK_ADAPTIVE_EFFORT=1`).
 * The model contract is applied above the log, so the logged `effort`/`effortSent` are read from the
 * same model and options the provider is called with (#128 review).
 */
export function createSdkProviderStream(runtime: SdkProviderRuntime): StreamFn {
	const capped = createResponseReasoningCapStreamFn(
		createModelContractStreamFn(
			createLlmCallRunLogStreamFn(createJsonSessionInfoStreamFn(createProviderStream(runtime))),
			runtime.modelContract,
		),
		resolveResponseReasoningCapConfig(),
	);
	return isDefaultOnEnvFlag(process.env.OMK_ADAPTIVE_EFFORT) ? createLazyAdaptiveEffortStreamFn(capped) : capped;
}

/**
 * Spec 112: directly under the log, `OMK_JSON_SESSION_INFO=1` sees the same request context the log hashes.
 * Spec 037, outermost: `OMK_ADAPTIVE_EFFORT=1` (exactly "1") picks the effort per phase. The module
 * is imported on the first call only, so with the flag off nothing is loaded and `capped` is returned.
 */
function createLazyAdaptiveEffortStreamFn(inner: StreamFn): StreamFn {
	let adaptive: Promise<StreamFn> | undefined;
	return async (model, context, options) => {
		adaptive ??= import("./adaptive-effort.ts").then((module) => module.createAdaptiveEffortStreamFn(inner));
		return (await adaptive)(model, context, options);
	};
}

/** Without a contract the inner stream is returned itself; with one, every request is projected through it. */
function createModelContractStreamFn(inner: StreamFn, modelContract: ModelContract | undefined): StreamFn {
	if (modelContract === undefined) return inner;
	const contract = snapshotModelContract(modelContract);
	// async, so a contract violation rejects the returned promise as it did inside the provider stream.
	return async (model, context, options) => {
		const requestModel = structuredClone(model);
		const requestOptions = applyModelContract(contract, requestModel, options ?? {});
		const requestContext = projectToolImagesForModel(context, requestModel).context;
		return inner(requestModel, requestContext, requestOptions);
	};
}

function createProviderStream(runtime: SdkProviderRuntime): StreamFn {
	const { modelRegistry, settingsManager } = runtime;
	return async (requestModel, requestContext, requestOptions) => {
		requestOptions?.signal?.throwIfAborted();
		const auth = await modelRegistry.getApiKeyAndHeaders(requestModel);
		if (!auth.ok) throw new Error(auth.error);
		requestOptions?.signal?.throwIfAborted();
		const providerRetrySettings = settingsManager.getProviderRetrySettings();
		const httpIdleTimeoutMs = settingsManager.getHttpIdleTimeoutMs();
		// SDK timeout=0 means immediate failure, not unlimited waiting.
		const effectiveTimeoutMs = httpIdleTimeoutMs === 0 ? 2147483647 : httpIdleTimeoutMs;
		const timeoutMs = requestOptions?.timeoutMs ?? providerRetrySettings.timeoutMs ?? effectiveTimeoutMs;
		const websocketConnectTimeoutMs =
			requestOptions?.websocketConnectTimeoutMs ?? settingsManager.getWebSocketConnectTimeoutMs();
		return streamSimple(requestModel, requestContext, {
			...requestOptions,
			apiKey: auth.apiKey,
			timeoutMs,
			websocketConnectTimeoutMs,
			maxRetries: requestOptions?.maxRetries ?? providerRetrySettings.maxRetries,
			maxRetryDelayMs: requestOptions?.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
			onRateLimit: async (snapshot, responseModel) => {
				runtime.onRateLimit?.(auth.apiKey, snapshot, responseModel);
				await requestOptions?.onRateLimit?.(snapshot, responseModel);
			},
			headers: mergeProviderAttributionHeaders(
				requestModel,
				settingsManager,
				requestOptions?.sessionId,
				auth.headers,
				requestOptions?.headers,
			),
		});
	};
}
