import {
	applyModelContract,
	type ModelContract,
	projectToolImagesForModel,
	type StreamFn,
	snapshotModelContract,
} from "omk-agent-core";
import { type SimpleStreamOptions, streamSimple } from "omk-ai";
import type { ModelRegistry } from "./model-registry.ts";
import { mergeProviderAttributionHeaders } from "./provider-attribution.ts";
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

/** Shared by the main agent and first-party summary calls using agent.streamFn. */
export function createSdkProviderStream(runtime: SdkProviderRuntime): StreamFn {
	const { modelRegistry, settingsManager } = runtime;
	const contract = runtime.modelContract === undefined ? undefined : snapshotModelContract(runtime.modelContract);
	return async (model, context, options) => {
		const requestModel = contract ? structuredClone(model) : model;
		const requestOptions = contract ? applyModelContract(contract, requestModel, options ?? {}) : options;
		const requestContext = contract ? projectToolImagesForModel(context, requestModel).context : context;
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
