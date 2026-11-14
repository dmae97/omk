import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "omk-agent-core";
import { type AssistantMessage, getModel } from "omk-ai";
import { registerOAuthProvider } from "omk-ai/oauth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestResourceLoader } from "./utilities.ts";

// Observed 2026-11-11: sessions sharing auth.json stopped mid-work whenever one of them could not
// resolve its stored login, and the next prompt the user typed went through at once. The request
// goes through the real provider stream and registry here; only the provider call is replaced.
const sentKeys = vi.hoisted(() => [] as (string | undefined)[]);

vi.mock("omk-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("omk-ai")>();
	return {
		...actual,
		streamSimple: ((model, _context, options) => {
			sentKeys.push(options?.apiKey);
			const stream = actual.createAssistantMessageEventStream();
			const message: AssistantMessage = {
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
				stream.push({ type: "done", reason: "stop", message });
				stream.end(message);
			});
			return stream;
		}) satisfies typeof actual.streamSimple,
	};
});

const { AgentSession } = await import("../src/core/agent-session.ts");
const { AuthStorage } = await import("../src/core/auth-storage.ts");
const { ModelRegistry } = await import("../src/core/model-registry.ts");
const { createSdkProviderStream } = await import("../src/core/sdk-provider-stream.ts");
const { SessionManager } = await import("../src/core/session-manager.ts");
const { SettingsManager } = await import("../src/core/settings-manager.ts");

const dirs: string[] = [];
const sessions: { dispose(): void }[] = [];
afterEach(() => {
	sentKeys.length = 0;
	while (sessions.length > 0) sessions.pop()?.dispose();
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function createSession(refreshFailures: number, maxRetries = 3, refreshError = "refresh endpoint unavailable") {
	const providerId = `oauth-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	let refreshCalls = 0;
	registerOAuthProvider({
		id: providerId,
		name: "OAuth provider whose refresh is busy at first",
		async login() {
			throw new Error("Not used in this test");
		},
		async refreshToken(credentials) {
			refreshCalls += 1;
			if (refreshCalls <= refreshFailures) throw new Error(refreshError);
			// wall-clock: a persisted absolute expiry, one hour ahead
			return { ...credentials, access: "refreshed-access-token", expires: Date.now() + 3_600_000 };
		},
		getApiKey(credentials) {
			return credentials.access;
		},
	});
	const authStorage = AuthStorage.inMemory({
		// wall-clock: a persisted absolute expiry, ten seconds in the past
		[providerId]: { type: "oauth", refresh: "refresh-token", access: "expired", expires: Date.now() - 10_000 },
	});
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	const settingsManager = SettingsManager.inMemory({ retry: { enabled: true, maxRetries, baseDelayMs: 1 } });
	const model = { ...getModel("anthropic", "claude-sonnet-4-5")!, provider: providerId };
	const dir = mkdtempSync(join(tmpdir(), "omk-credential-retry-"));
	dirs.push(dir);
	const session = new AgentSession({
		agent: new Agent({
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: createSdkProviderStream({ modelRegistry, settingsManager }),
		}),
		sessionManager: SessionManager.inMemory(),
		settingsManager,
		cwd: dir,
		modelRegistry,
		resourceLoader: createTestResourceLoader(),
	});
	sessions.push(session);
	const retries: number[] = [];
	const ends: boolean[] = [];
	session.subscribe((event) => {
		if (event.type === "auto_retry_start") retries.push(event.attempt);
		if (event.type === "auto_retry_end") ends.push(event.success);
	});
	return { session, providerId, retries, ends, refreshCalls: () => refreshCalls };
}

function lastAssistant(session: InstanceType<typeof AgentSession>): AssistantMessage | undefined {
	return session.messages.filter((message): message is AssistantMessage => message.role === "assistant").at(-1);
}

describe("a stored login that cannot be resolved at request time", () => {
	it("retries and finishes the turn once the login resolves", async () => {
		const created = createSession(1);

		await created.session.prompt("Test");

		expect(created.retries).toEqual([1]);
		expect(created.ends).toEqual([true]);
		expect(created.refreshCalls()).toBe(2);
		// The failed attempt sent nothing; the retry sent the refreshed token and no other key.
		expect(sentKeys).toEqual(["refreshed-access-token"]);
		expect(lastAssistant(created.session)?.stopReason).toBe("stop");
	});

	it("ends with the /login message when the login never resolves, without sending a key", async () => {
		const created = createSession(99, 2);

		await created.session.prompt("Test");

		expect(created.retries).toEqual([1, 2]);
		expect(created.ends).toEqual([false]);
		expect(sentKeys).toEqual([]);
		const last = lastAssistant(created.session);
		expect(last?.stopReason).toBe("error");
		expect(last?.errorMessage).toContain(`/login ${created.providerId}`);
	});

	it("ends at once when the token endpoint refused the refresh", async () => {
		// The refresh token is dead: every retry would spend another refused refresh request.
		const created = createSession(
			99,
			3,
			"Token refresh request failed. details=Error: HTTP request failed. status=400",
		);

		await created.session.prompt("Test");

		expect(created.retries).toEqual([]);
		expect(created.refreshCalls()).toBe(1);
		expect(sentKeys).toEqual([]);
		const last = lastAssistant(created.session);
		expect(last?.stopReason).toBe("error");
		expect(last?.errorMessage).toContain("refused");
		expect(last?.errorMessage).toContain(`/login ${created.providerId}`);
	});

	it("retries again after a refused refresh is followed by a new login", async () => {
		const created = createSession(
			1,
			3,
			"Token refresh request failed. details=Error: HTTP request failed. status=401",
		);
		await created.session.prompt("Test");
		expect(created.retries).toEqual([]);

		// The next request re-reads the login; a refresh that now succeeds clears the refusal.
		await created.session.prompt("Again");
		expect(sentKeys).toEqual(["refreshed-access-token"]);
		expect(lastAssistant(created.session)?.stopReason).toBe("stop");
	});
});
