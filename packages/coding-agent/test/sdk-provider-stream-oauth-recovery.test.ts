import { type Api, type AssistantMessage, getModel, type Model, type SimpleStreamOptions } from "omk-ai";
import { registerOAuthProvider, unregisterOAuthProvider } from "omk-ai/oauth";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mirrors compaction/oauth-recovery.ts: a main-turn dispatch whose bearer token the
// provider rejected (401 token_expired/token_revoked) must force one OAuth refresh and
// re-issue once, instead of letting the dead token end the turn. The stream-level retry
// lives inside createProviderStream, so the mock drives streamSimple's returned events.

type IssuedCall = { apiKey: string | undefined; authorization: string | undefined };

// Controlled by each test: which apiKey produces which terminal event.
const behavior = vi.hoisted(() => ({
	// map from apiKey -> array of events pushed by that dispatch's inner stream
	byKey: new Map<string | undefined, AssistantMessage[]>(),
	calls: [] as IssuedCall[],
	endMode: "event" as "event" | "result" | "empty",
	// keys whose dispatch emits a "start" event before its terminal event
	startedKeys: new Set<string | undefined>(),
}));

function terminalFor(message: AssistantMessage, errorText?: string): AssistantMessage {
	if (errorText === undefined) return { ...message, stopReason: "stop" };
	return { ...message, stopReason: "error", errorMessage: errorText };
}

vi.mock("omk-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("omk-ai")>();
	return {
		...actual,
		streamSimple: ((model: Model<Api>, _context: unknown, options?: SimpleStreamOptions) => {
			const apiKey = options?.apiKey;
			behavior.calls.push({ apiKey, authorization: options?.headers?.Authorization });
			const stream = actual.createAssistantMessageEventStream();
			const base: AssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 5,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 6,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 0,
			};
			queueMicrotask(() => {
				const outcome = behavior.byKey.get(apiKey);
				const final = outcome?.[0] ?? base;
				if (behavior.startedKeys.has(apiKey)) stream.push({ type: "start", partial: { ...final, content: [] } });
				if (behavior.endMode !== "event") {
					stream.end(behavior.endMode === "result" ? final : undefined);
					return;
				}
				if (final.stopReason === "error" || final.stopReason === "aborted") {
					stream.push({ type: "error", reason: final.stopReason, error: final });
				} else {
					stream.push({ type: "done", reason: final.stopReason as "stop", message: final });
				}
				stream.end(final);
			});
			return stream;
		}) satisfies typeof actual.streamSimple,
	};
});

const { createSdkProviderStream } = await import("../src/core/sdk-provider-stream.ts");
const { SettingsManager } = await import("../src/core/settings-manager.ts");
const { AuthStorage } = await import("../src/core/auth-storage.ts");
const { ModelRegistry } = await import("../src/core/model-registry.ts");

const model = getModel("xai", "grok-4.7");

function baseContext() {
	return { systemPrompt: "s", messages: [{ role: "user" as const, content: "hi", timestamp: 0 }] };
}

/** Minimal modelRegistry surface used by createProviderStream + the recovery pump. */
function fakeRegistry(opts: {
	authApiKey?: string;
	isOAuth: boolean;
	refreshedKey?: string;
	refreshError?: Error;
	onRefresh?: (rejected: string) => void;
}) {
	const calls = { refresh: [] as string[] };
	const registry = {
		async getApiKeyAndHeaders() {
			return { ok: true as const, apiKey: opts.authApiKey, oauth: opts.isOAuth ? true : undefined };
		},
		async refreshRejectedOAuthToken(_m: Model<Api>, rejectedApiKey: string) {
			calls.refresh.push(rejectedApiKey);
			opts.onRefresh?.(rejectedApiKey);
			if (opts.refreshError) throw opts.refreshError;
			return opts.refreshedKey;
		},
	};
	return { registry: registry as never, calls };
}

afterEach(() => {
	behavior.byKey.clear();
	behavior.startedKeys.clear();
	behavior.calls.length = 0;
	behavior.endMode = "event";
});

describe("main-turn 401 forces one OAuth refresh and retry (parity with compaction)", () => {
	it.each(["result", "empty"] as const)(
		"settles OAuth streams that close without a terminal event (%s)",
		async (mode) => {
			behavior.endMode = mode;
			const { registry, calls } = fakeRegistry({ authApiKey: "local-key", isOAuth: true });
			const stream = createSdkProviderStream({
				modelRegistry: registry,
				settingsManager: SettingsManager.inMemory(),
			});
			const response = await stream(model, baseContext());
			const final = await response.result();
			expect(final.stopReason).toBe(mode === "result" ? "stop" : "error");
			if (mode === "empty") expect(final.errorMessage).toContain("Stream ended without a final result");
			expect(calls.refresh).toEqual([]);
		},
	);
	it.each(["oauth", "runtime-key", "explicit-header"])(
		"retries only when OAuth supplied the request credential (%s)",
		async (source) => {
			const dead = terminalFor(
				{
					role: "assistant",
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
					stopReason: "error",
					timestamp: 0,
				} as AssistantMessage,
				"401 token_expired",
			);
			const ok = { ...dead, stopReason: "stop" as const, errorMessage: undefined };
			behavior.byKey.set("dead-key", [dead]);
			behavior.byKey.set("fresh-key", [ok]);

			const provider = "test-main-turn-oauth";
			const storage = AuthStorage.inMemory({
				[provider]: { type: "oauth", access: "dead-key", refresh: "test-refresh", expires: Date.now() + 60_000 },
			});
			const refreshToken = vi.fn(async (credentials: { access: string; refresh: string; expires: number }) => ({
				...credentials,
				access: "fresh-key",
			}));
			registerOAuthProvider({
				id: provider,
				name: "Test main-turn OAuth",
				async login() {
					throw new Error("Unexpected login");
				},
				getApiKey: (credentials) => credentials.access,
				refreshToken,
			});
			try {
				const registry = ModelRegistry.create(storage);
				registry.registerProvider(provider, { authHeader: true });
				if (source === "runtime-key") storage.setRuntimeApiKey(provider, "dead-key");
				const headers = source === "explicit-header" ? { Authorization: "Bearer explicit" } : undefined;
				const shouldRefresh = source === "oauth";
				const stream = createSdkProviderStream({
					modelRegistry: registry,
					settingsManager: SettingsManager.inMemory(),
				});
				const final = await (await stream({ ...model, provider }, baseContext(), { headers })).result();
				expect(behavior.calls).toEqual([
					{ apiKey: "dead-key", authorization: headers?.Authorization ?? "Bearer dead-key" },
					...(shouldRefresh ? [{ apiKey: "fresh-key", authorization: "Bearer fresh-key" }] : []),
				]);
				expect(refreshToken).toHaveBeenCalledTimes(shouldRefresh ? 1 : 0);
				expect(final.stopReason).toBe(shouldRefresh ? "stop" : "error");
			} finally {
				unregisterOAuthProvider(provider);
			}
		},
	);

	it("refresh rejected (RFC6749) -> /login hint, no second dispatch", async () => {
		const dead = terminalFor(
			{
				role: "assistant",
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
				stopReason: "error",
				timestamp: 0,
			} as AssistantMessage,
			"401 token_expired: fixture-access-value",
		);
		behavior.byKey.set("dead-key", [dead]);

		const { registry, calls } = fakeRegistry({
			authApiKey: "dead-key",
			isOAuth: true,
			refreshError: new Error("invalid_grant: fixture-refresh-value"),
		});
		const stream = createSdkProviderStream({ modelRegistry: registry, settingsManager: SettingsManager.inMemory() });
		const final = await (await stream(model, baseContext(), {})).result();

		expect(calls.refresh).toEqual(["dead-key"]);
		expect(behavior.calls).toHaveLength(1); // no re-issue
		expect(final.stopReason).toBe("error");
		expect(final.errorMessage).toBe(
			"Provider rejected the OAuth credential. OAuth refresh for xai failed; run '/login xai'.",
		);
		expect(dead.errorMessage).toBe("401 token_expired: fixture-access-value");
	});

	it("non-OAuth provider rejected key -> forwarded as-is, no refresh attempt", async () => {
		const dead = terminalFor(
			{
				role: "assistant",
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
				stopReason: "error",
				timestamp: 0,
			} as AssistantMessage,
			"401 token_expired",
		);
		behavior.byKey.set("dead-key", [dead]);

		const { registry, calls } = fakeRegistry({ authApiKey: "dead-key", isOAuth: false, refreshedKey: "fresh-key" });
		const stream = createSdkProviderStream({ modelRegistry: registry, settingsManager: SettingsManager.inMemory() });
		const final = await (await stream(model, baseContext(), {})).result();

		expect(calls.refresh).toHaveLength(0);
		expect(behavior.calls).toHaveLength(1);
		expect(final.stopReason).toBe("error");
		expect(final.errorMessage).toBe("401 token_expired");
	});

	it("non-auth error is not retried (no refresh, single dispatch)", async () => {
		const quota = terminalFor(
			{
				role: "assistant",
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
				stopReason: "error",
				timestamp: 0,
			} as AssistantMessage,
			"429 insufficient_quota",
		);
		behavior.byKey.set("dead-key", [quota]);

		const { registry, calls } = fakeRegistry({ authApiKey: "dead-key", isOAuth: true, refreshedKey: "fresh-key" });
		const stream = createSdkProviderStream({ modelRegistry: registry, settingsManager: SettingsManager.inMemory() });
		const final = await (await stream(model, baseContext(), {})).result();

		expect(calls.refresh).toHaveLength(0);
		expect(behavior.calls).toHaveLength(1);
		expect(final.errorMessage).toBe("429 insufficient_quota");
	});

	it("rejection after output was already forwarded is not retried (no duplicate start)", async () => {
		const dead = terminalFor(
			{
				role: "assistant",
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
				stopReason: "error",
				timestamp: 0,
			} as AssistantMessage,
			"401 token_expired",
		);
		behavior.byKey.set("dead-key", [dead]);
		behavior.startedKeys.add("dead-key");

		const { registry, calls } = fakeRegistry({ authApiKey: "dead-key", isOAuth: true, refreshedKey: "fresh-key" });
		const stream = createSdkProviderStream({ modelRegistry: registry, settingsManager: SettingsManager.inMemory() });
		const events = await stream(model, baseContext(), {});
		const types: string[] = [];
		for await (const event of events) types.push(event.type);

		expect(calls.refresh).toHaveLength(0);
		expect(behavior.calls).toHaveLength(1);
		expect(types).toEqual(["start", "error"]);
		expect((await events.result()).errorMessage).toBe("401 token_expired");
	});
});
