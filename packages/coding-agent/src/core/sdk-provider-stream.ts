import {
	applyModelContract,
	type ModelContract,
	projectToolImagesForModel,
	type StreamFn,
	snapshotModelContract,
} from "omk-agent-core";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	streamSimple,
} from "omk-ai";
import { isRejectedOAuthTokenMessage } from "./compaction/oauth-recovery.ts";
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
		// One dispatch with an explicit key; used for the first attempt and the
		// single forced-refresh retry (the second key wins over the rejected one).
		const issue = (apiKey: string | undefined): AssistantMessageEventStream =>
			streamSimple(requestModel, requestContext, {
				...requestOptions,
				apiKey,
				timeoutMs,
				websocketConnectTimeoutMs,
				maxRetries: requestOptions?.maxRetries ?? providerRetrySettings.maxRetries,
				maxRetryDelayMs: requestOptions?.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
				onRateLimit: async (snapshot, responseModel) => {
					runtime.onRateLimit?.(apiKey, snapshot, responseModel);
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
		return dispatchWithRejectedOAuthRecovery(issue, auth.apiKey, requestModel, modelRegistry);
	};
}

/**
 * One forced OAuth refresh and retry for a main-turn dispatch whose bearer token
 * the provider rejected.
 *
 * The compaction path already had this parity (summarizeWithOAuthRecovery); the
 * main turn did not. A provider can answer `401 token_expired`/`token_revoked`
 * for a token whose stored expiry is still in the future (server-side
 * revocation, rotation from another login). The transient-retry classifier
 * refuses to replay a 401, so without this step the same dead token would be
 * re-issued until the stored expiry passed — and the failover path cannot help
 * because an auth failure is not failover-eligible.
 *
 * The rejected key is the one resolved for this dispatch (`auth.apiKey`), so the
 * forced refresh targets exactly the credential the provider just refused. The
 * recovery re-issues the dispatch once with the refreshed key and replays its
 * events through the same outer stream, so callers see a single logical stream.
 */
function dispatchWithRejectedOAuthRecovery(
	issue: (apiKey: string | undefined) => AssistantMessageEventStream,
	apiKey: string | undefined,
	model: Model<Api>,
	modelRegistry: ModelRegistry,
): AssistantMessageEventStream {
	const outer = createAssistantMessageEventStream();
	// Refreshing is only worth attempting for a stored OAuth credential; an API
	// key the provider rejected cannot be renewed by /login-refresh machinery.
	const canRefresh = apiKey !== undefined && modelRegistry.isUsingOAuthProvider(model.provider);
	let recovered = false;
	// A retry after any forwarded event would emit a second "start" and duplicate the assistant message.
	let forwarded = false;

	const pump = async (stream: AssistantMessageEventStream, sentKey: string | undefined): Promise<void> => {
		for await (const event of stream) {
			if (event.type !== "error") {
				outer.push(event);
				forwarded = true;
				continue;
			}
			// Terminal event. A rejected-token error on an OAuth provider we have not
			// yet retried forces one refresh; anything else is forwarded as-is.
			const rejected = event.error;
			if (
				canRefresh &&
				!recovered &&
				!forwarded &&
				sentKey !== undefined &&
				isRejectedOAuthTokenMessage(rejected.errorMessage)
			) {
				recovered = true;
				let refreshed: string | undefined;
				try {
					refreshed = await modelRegistry.refreshRejectedOAuthToken(model, sentKey);
				} catch (refreshError) {
					// Refresh refused/failed (RFC6749): surface the original rejection with
					// the /login hint, matching the compaction recovery contract.
					rejected.errorMessage =
						`${rejected.errorMessage ?? "Provider rejected the token"} ` +
						`(OAuth refresh for ${model.provider} failed: ` +
						`${refreshError instanceof Error ? refreshError.message : String(refreshError)}; ` +
						`run '/login ${model.provider}')`;
					outer.push({ ...event, error: rejected });
					outer.end();
					return;
				}
				if (refreshed !== undefined) {
					// Re-issue once with the refreshed key; its events continue on the
					// same outer stream so the consumer sees one logical response.
					await pump(issue(refreshed), refreshed);
					return;
				}
				// No OAuth credential to refresh (provider flipped off OAuth): fall
				// through and forward the original rejection.
			}
			outer.push(event);
			return;
		}
		// A non-compliant stream that ended without a terminal event would leave
		// outer.result() pending forever; settle it defensively.
		outer.end();
	};

	void pump(issue(apiKey), apiKey).catch((error) => {
		// Defensive: a dispatch-level throw (not a stream error) becomes a terminal
		// error event so the consumer's result() still settles.
		const message = error instanceof Error ? error.message : String(error);
		const failed = {
			role: "assistant" as const,
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "error" as const,
			errorMessage: message,
			timestamp: Date.now(),
		} as AssistantMessage;
		outer.push({ type: "error", reason: "error", error: failed });
		outer.end();
	});
	return outer;
}
