import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentEvent, type AgentTool } from "omk-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "omk-ai";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { resolveUnresolvedOAuthLogin } from "../src/core/provider-request-key.ts";
import { QuotaExhaustedNoRetryError, quotaNoRetryErrorOf } from "../src/core/quota-retry-policy.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string, overrides?: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

type SessionWithExtensionEmitHook = {
	_emitExtensionEvent: (event: AgentEvent) => Promise<void>;
};

describe("AgentSession retry", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-retry-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function createSession(options?: {
		failCount?: number;
		emptyStopCount?: number;
		maxRetries?: number;
		delayAssistantMessageEndMs?: number;
		baseDelayMs?: number;
		errorMessage?: string;
		modelPinned?: boolean;
		providerResilience?: Record<string, unknown>;
	}) {
		const failCount = options?.failCount ?? 1;
		const emptyStopCount = options?.emptyStopCount ?? 0;
		const maxRetries = options?.maxRetries ?? 3;
		const baseDelayMs = options?.baseDelayMs ?? 1;
		const errorMessage = options?.errorMessage ?? "overloaded_error";
		const delayAssistantMessageEndMs = options?.delayAssistantMessageEndMs ?? 0;
		let callCount = 0;

		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: () => {
				callCount++;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (callCount <= emptyStopCount) {
						// Success-shaped dead stream: stop=stop, zero usable output.
						const msg = createAssistantMessage("");
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "stop", message: msg });
					} else if (callCount <= failCount) {
						const msg = createAssistantMessage("", {
							stopReason: "error",
							errorMessage,
						});
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "error", reason: "error", error: msg });
					} else {
						const msg = createAssistantMessage("Success");
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "stop", message: msg });
					}
				});
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage, tempDir);
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		authStorage.setRuntimeApiKey("deepseek", "test-key");
		settingsManager.applyOverrides({
			retry: { enabled: true, maxRetries, baseDelayMs },
			providerResilience: {
				failoverCandidates: [{ provider: "deepseek", id: "deepseek-v4-flash" }],
				...options?.providerResilience,
			},
		});

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			modelPinned: options?.modelPinned,
			resourceLoader: createTestResourceLoader(),
		});

		if (delayAssistantMessageEndMs > 0) {
			const sessionWithHook = session as unknown as SessionWithExtensionEmitHook;
			const original = sessionWithHook._emitExtensionEvent.bind(sessionWithHook);
			sessionWithHook._emitExtensionEvent = async (event: AgentEvent) => {
				if (event.type === "message_end" && event.message.role === "assistant") {
					await new Promise((resolve) => setTimeout(resolve, delayAssistantMessageEndMs));
				}
				await original(event);
			};
		}

		return { session, getCallCount: () => callCount };
	}

	it("retries after a transient error and succeeds", async () => {
		const created = createSession({ failCount: 1 });
		const events: string[] = [];
		created.session.subscribe((event) => {
			if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
			if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
		});

		await created.session.prompt("Test");

		expect(created.getCallCount()).toBe(2);
		expect(events).toEqual(["start:1", "end:success=true"]);
		expect(created.session.isRetrying).toBe(false);
	});

	it("auto-retries an Explabs Cloudflare 520 and completes the turn", async () => {
		// Regression: explabs/deepseek-v4.1-flash-1017 surfaced
		// "520 status code (no body)"; the retry gate did not classify 520 as
		// transient, so the turn ended instead of continuing automatically.
		const created = createSession({ failCount: 1, errorMessage: "520 status code (no body)" });
		const events: string[] = [];
		created.session.subscribe((event) => {
			if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
			if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
		});

		await created.session.prompt("Test");

		expect(created.getCallCount()).toBe(2);
		expect(events).toEqual(["start:1", "end:success=true"]);
		expect(created.session.isRetrying).toBe(false);
	});

	it("auto-retries an Explabs free-limit quota body and completes the turn", async () => {
		const created = createSession({
			failCount: 1,
			errorMessage: "429 You've hit the free limit for DeepSeek V4.1 Flash 1017 free (your free daily allowance).",
		});
		const events: string[] = [];
		created.session.subscribe((event) => {
			if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
			if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
		});

		await created.session.prompt("Test");

		expect(created.getCallCount()).toBe(2);
		expect(events).toEqual(["start:1", "end:success=true"]);
	});

	it("fails over a quota-exhausted model even when the CLI pinned it", async () => {
		const created = createSession({
			failCount: 1,
			errorMessage: "429 You've hit the free limit for DeepSeek V4.1 Flash 1017 free (your free daily allowance).",
			modelPinned: true,
		});
		const events: string[] = [];
		created.session.subscribe((event) => {
			if (event.type === "auto_retry_start") events.push(`start:${event.attempt}:${event.errorMessage}`);
			if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
		});

		await created.session.prompt("Test");

		expect(created.getCallCount()).toBe(2);
		expect(created.session.model?.id).toBe("deepseek-v4-flash");
		expect(events[0]).toContain("→ failover deepseek/deepseek-v4-flash");
		expect(events).toContain("end:success=true");
	});

	const QUOTA_BODY = "429 You've hit the free limit for DeepSeek V4.1 Flash 1017 free (your free daily allowance).";

	function recordRetries(target: AgentSession, abortOnStart = false) {
		const starts: Array<{ attempt: number; delayMs: number; errorMessage: string }> = [];
		target.subscribe((event) => {
			if (event.type !== "auto_retry_start") return;
			starts.push({ attempt: event.attempt, delayMs: event.delayMs, errorMessage: event.errorMessage });
			if (abortOnStart) queueMicrotask(() => target.abortRetry());
		});
		return starts;
	}

	it("spec 090: ends a quota-exhausted turn at once when quota failover is disabled", async () => {
		const created = createSession({
			failCount: 99,
			errorMessage: QUOTA_BODY,
			providerResilience: { autoFailoverOnQuotaExhaustion: false },
		});
		const starts = recordRetries(created.session);
		await created.session.prompt("Test");
		expect(created.getCallCount()).toBe(1);
		expect(starts).toEqual([]);
		expect(created.session.isRetrying).toBe(false);
	});

	it("spec 090: fails over quota exhaustion with zero retry wait (pinned)", async () => {
		const created = createSession({ failCount: 1, errorMessage: QUOTA_BODY, modelPinned: true });
		const starts = recordRetries(created.session);
		await created.session.prompt("Test");
		expect(created.getCallCount()).toBe(2);
		expect(created.session.model?.id).toBe("deepseek-v4-flash");
		expect(starts.map((s) => s.delayMs)).toEqual([0]);
	});

	it("spec 090: fails over quota exhaustion with zero retry wait (unpinned)", async () => {
		const created = createSession({ failCount: 1, errorMessage: QUOTA_BODY });
		const starts = recordRetries(created.session);
		await created.session.prompt("Test");
		expect(created.session.model?.id).toBe("deepseek-v4-flash");
		expect(starts.map((s) => s.delayMs)).toEqual([0]);
	});

	it("spec 090: ends at once when quota failover has no usable candidate", async () => {
		const created = createSession({
			failCount: 99,
			errorMessage: QUOTA_BODY,
			providerResilience: { failoverCandidates: [{ provider: "nope-provider", id: "nope-model" }] },
		});
		const starts = recordRetries(created.session);
		await created.session.prompt("Test");
		expect(created.getCallCount()).toBe(1);
		expect(starts).toEqual([]);
		expect(created.session.isRetrying).toBe(false);
	});

	it("spec 090: failover off ends the session with QuotaExhaustedNoRetryError carrying the provider message", async () => {
		const created = createSession({
			failCount: 99,
			errorMessage: QUOTA_BODY,
			providerResilience: { autoFailoverOnQuotaExhaustion: false },
		});
		await created.session.prompt("Test");
		const error = quotaNoRetryErrorOf(created.session);
		expect(error).toBeInstanceOf(QuotaExhaustedNoRetryError);
		expect(error?.cause).toBe(QUOTA_BODY);
		expect(error?.message).toContain("quota exhausted, no retry");
		expect(created.getCallCount()).toBe(1);
	});

	it("spec 090: failover on with no usable candidate ends with the same typed error", async () => {
		const created = createSession({
			failCount: 99,
			errorMessage: QUOTA_BODY,
			providerResilience: { failoverCandidates: [{ provider: "nope-provider", id: "nope-model" }] },
		});
		await created.session.prompt("Test");
		const error = quotaNoRetryErrorOf(created.session);
		expect(error).toBeInstanceOf(QuotaExhaustedNoRetryError);
		expect(error?.cause).toBe(QUOTA_BODY);
		expect(created.getCallCount()).toBe(1);
	});

	it("spec 090: a successful quota failover leaves no typed no-retry error", async () => {
		const created = createSession({ failCount: 1, errorMessage: QUOTA_BODY });
		await created.session.prompt("Test");
		expect(quotaNoRetryErrorOf(created.session)).toBeUndefined();
	});

	function readQuotaRunLog(dir: string): Array<Record<string, unknown>> {
		const file = join(dir, "quota-no-retry.jsonl");
		if (!existsSync(file)) return [];
		return readFileSync(file, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	it("spec 090: a quota termination appends exactly one quota-no-retry run-log entry", async () => {
		const logDir = join(tempDir, "run-log");
		const previous = process.env.OMK_RUN_LOG_DIR;
		process.env.OMK_RUN_LOG_DIR = logDir;
		try {
			const off = createSession({
				failCount: 99,
				errorMessage: QUOTA_BODY,
				providerResilience: { autoFailoverOnQuotaExhaustion: false },
			});
			await off.session.prompt("Test");
			let entries = readQuotaRunLog(logDir);
			expect(entries).toHaveLength(1);
			expect(entries[0]).toMatchObject({
				code: "quota_exhausted",
				provider: "anthropic",
				model: "mock",
				failover: false,
				noCandidate: false,
			});
			expect(JSON.stringify(entries[0])).not.toContain("free limit");

			const none = createSession({
				failCount: 99,
				errorMessage: QUOTA_BODY,
				providerResilience: { failoverCandidates: [{ provider: "nope-provider", id: "nope-model" }] },
			});
			await none.session.prompt("Test");
			entries = readQuotaRunLog(logDir);
			expect(entries).toHaveLength(2);
			expect(entries[1]).toMatchObject({ code: "quota_exhausted", failover: true, noCandidate: true });

			const ok = createSession({ failCount: 1, errorMessage: QUOTA_BODY });
			await ok.session.prompt("Test");
			expect(readQuotaRunLog(logDir)).toHaveLength(2);
		} finally {
			if (previous === undefined) delete process.env.OMK_RUN_LOG_DIR;
			else process.env.OMK_RUN_LOG_DIR = previous;
		}
	});

	it("spec 090: quota with no usable failover candidate does not rotate the route", async () => {
		const created = createSession({
			failCount: 99,
			errorMessage: "503 service unavailable: insufficient_quota",
			providerResilience: { failoverCandidates: [{ provider: "nope-provider", id: "nope-model" }] },
		});
		const hooks = created.session as unknown as { _maybeRotateModelRoutes: () => Promise<string | undefined> };
		let rotations = 0;
		hooks._maybeRotateModelRoutes = async () => {
			rotations++;
			return "anthropic/rotated";
		};
		const before = `${created.session.model?.provider}/${created.session.model?.id}`;
		await created.session.prompt("Test");
		expect(rotations).toBe(0);
		expect(`${created.session.model?.provider}/${created.session.model?.id}`).toBe(before);
		expect(created.getCallCount()).toBe(1);
		expect(quotaNoRetryErrorOf(created.session)).toBeInstanceOf(QuotaExhaustedNoRetryError);
	});

	it("spec 090: honors a Retry-After hint on a transient 429", async () => {
		const created = createSession({ failCount: 99, errorMessage: "429 Too Many Requests. Retry-After: 2" });
		const starts = recordRetries(created.session, true);
		await created.session.prompt("Test");
		expect(starts[0]?.delayMs).toBe(2000);
	});

	it("spec 090: caps a Retry-After wait at 60s", async () => {
		const created = createSession({
			failCount: 99,
			errorMessage: "429 rate limited, please retry after 600 seconds",
		});
		const starts = recordRetries(created.session, true);
		await created.session.prompt("Test");
		expect(starts[0]?.delayMs).toBe(60_000);
	});

	it("waits out an account rate limit that carries no Retry-After", async () => {
		// Observed 2026-11-11: 2 s, 4 s and 8 s spent the retry budget 14 s after the first 429,
		// and every session sharing the account stopped mid-work.
		const created = createSession({
			failCount: 99,
			baseDelayMs: 2000,
			errorMessage:
				'429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your' +
				" account's rate limit. Please try again later.\"}}",
		});
		const starts = recordRetries(created.session, true);
		await created.session.prompt("Test");
		expect(starts[0]?.delayMs).toBeGreaterThan(12_000);
		expect(starts[0]?.delayMs).toBeLessThanOrEqual(16_000);
	});

	it("retries a stored login another session was still refreshing", async () => {
		const storage = AuthStorage.inMemory({
			// wall-clock: a persisted absolute expiry, ten seconds in the past
			anthropic: { type: "oauth", refresh: "refresh-token", access: "expired", expires: Date.now() - 10_000 },
		});
		const unresolved = resolveUnresolvedOAuthLogin(storage, "anthropic");
		if (!unresolved || unresolved.ok) throw new Error("expected an unresolved OAuth login");
		const created = createSession({ failCount: 1, errorMessage: unresolved.error });
		const starts = recordRetries(created.session);

		await created.session.prompt("Test");

		expect(created.getCallCount()).toBe(2);
		expect(starts.map((start) => start.attempt)).toEqual([1]);
		expect(created.session.isRetrying).toBe(false);
	});

	it("shows one pinned-quota failover notice per turn on a pinned model (spec 089)", async () => {
		const created = createSession({
			failCount: 1,
			errorMessage: "429 You've hit the free limit for DeepSeek V4.1 Flash 1017 free (your free daily allowance).",
			modelPinned: true,
		});
		const notices: string[] = [];
		created.session.subscribe((event) => {
			if (event.type === "pinned_quota_failover") notices.push(`${event.to}|${event.message}`);
		});

		await created.session.prompt("Test");

		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain("deepseek/deepseek-v4-flash|");
		expect(notices[0]).toContain("autoFailoverOnQuotaExhaustion: false");
	});

	it("keeps one pinned-quota notice across two separate retries in one turn and re-arms next turn (spec 089)", async () => {
		const quota = "429 You've hit the free limit for DeepSeek V4.1 Flash 1017 free (your free daily allowance).";
		const echoTool: AgentTool = {
			name: "echo",
			label: "Echo",
			description: "Echo text back",
			parameters: Type.Object({ text: Type.String() }),
			execute: async () => ({ content: [{ type: "text", text: "echoed" }], details: undefined }),
		};
		// 1 quota → retry ok with tool call; 3 quota (second, separate retry) → 4 ok; next turn: 5 quota → 6 ok.
		let callCount = 0;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model: getModel("anthropic", "claude-sonnet-4-5")!, systemPrompt: "Test", tools: [] },
			streamFn: () => {
				callCount++;
				const n = callCount;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (n === 1 || n === 3 || n === 5) {
						const msg = createAssistantMessage("", { stopReason: "error", errorMessage: quota });
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "error", reason: "error", error: msg });
					} else if (n === 2) {
						const msg: AssistantMessage = {
							...createAssistantMessage(""),
							stopReason: "toolUse",
							content: [{ type: "toolCall", id: "call_1", name: "echo", arguments: { text: "hi" } }],
						};
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "toolUse", message: msg });
					} else {
						const msg = createAssistantMessage("Done");
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "stop", message: msg });
					}
				});
				return stream;
			},
		});
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		authStorage.setRuntimeApiKey("deepseek", "test-key");
		settingsManager.applyOverrides({
			retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
			providerResilience: {
				failoverCandidates: [
					{ provider: "deepseek", id: "deepseek-v4-flash" },
					{ provider: "anthropic", id: "claude-sonnet-4-5" },
				],
			},
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settingsManager,
			cwd: tempDir,
			modelRegistry: ModelRegistry.create(authStorage, tempDir),
			modelPinned: true,
			resourceLoader: createTestResourceLoader(),
			baseToolsOverride: { echo: echoTool },
		});
		const notices: string[] = [];
		const retryEnds: boolean[] = [];
		session.subscribe((event) => {
			if (event.type === "pinned_quota_failover") notices.push(`${event.from}->${event.to}`);
			if (event.type === "auto_retry_end") retryEnds.push(event.success);
		});

		await session.prompt("Test");
		expect(callCount).toBe(4);
		expect(retryEnds).toEqual([true, true]);
		expect(notices).toHaveLength(1);

		await session.prompt("Next turn");
		expect(callCount).toBe(6);
		expect(notices).toHaveLength(2);
	});

	it("shows no pinned-quota notice when the model was not pinned (spec 089)", async () => {
		const created = createSession({
			failCount: 1,
			errorMessage: "429 You've hit the free limit for DeepSeek V4.1 Flash 1017 free (your free daily allowance).",
		});
		let notices = 0;
		created.session.subscribe((event) => {
			if (event.type === "pinned_quota_failover") notices += 1;
		});

		await created.session.prompt("Test");

		expect(created.getCallCount()).toBe(2);
		expect(notices).toBe(0);
	});

	it("exhausts max retries and emits failure", async () => {
		const created = createSession({ failCount: 99, maxRetries: 2 });
		const events: string[] = [];
		created.session.subscribe((event) => {
			if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
			if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
		});

		await created.session.prompt("Test");

		expect(created.getCallCount()).toBe(3);
		expect(events).toContain("start:1");
		expect(events).toContain("start:2");
		expect(events).toContain("end:success=false");
		expect(created.session.isRetrying).toBe(false);
	});

	it("exhausts max retries on repeated empty streamed completions instead of looping forever", async () => {
		// Regression: the success-reset treated stop=stop empty completions as
		// successful answers and zeroed the retry budget every cycle, so a
		// provider that only ever returned empty completions (union-alpha relay)
		// pinned the UI in "Working" with infinite auto-retry.
		const created = createSession({ emptyStopCount: 99, maxRetries: 2 });
		const events: string[] = [];
		created.session.subscribe((event) => {
			if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
			if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
		});

		await created.session.prompt("Test");

		expect(created.getCallCount()).toBe(3);
		expect(events).toEqual(["start:1", "start:2", "end:success=false"]);
		expect(created.session.isRetrying).toBe(false);
	});

	it("recovers when an empty streamed completion is followed by a real answer", async () => {
		const created = createSession({ emptyStopCount: 1 });
		const events: string[] = [];
		created.session.subscribe((event) => {
			if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
			if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
		});

		await created.session.prompt("Test");

		expect(created.getCallCount()).toBe(2);
		expect(events).toEqual(["start:1", "end:success=true"]);
	});

	it("queues sendCustomMessage(triggerTurn) during retry backoff instead of starting a competing run", async () => {
		// Regression: a subagent result delivered with triggerTurn while the session
		// was sleeping in retry backoff (isStreaming=false, isRetrying=true) started a
		// second top-level run. The retry then woke up, agent.continue() threw
		// "Agent is already processing", and its runtime-failure handler closed the
		// run journal owned by the competing run, which later died with
		// "run journal received agent_end without run_started".
		const backoffMs = 50;
		let callCount = 0;
		const streamFn = () => {
			callCount++;
			const call = callCount;
			const stream = new MockAssistantStream();
			const finish = () => {
				if (call === 1) {
					const msg = createAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" });
					stream.push({ type: "start", partial: msg });
					stream.push({ type: "error", reason: "error", error: msg });
					return;
				}
				const msg = createAssistantMessage(`Success ${call}`);
				stream.push({ type: "start", partial: msg });
				stream.push({ type: "done", reason: "stop", message: msg });
			};
			// The second provider call outlives the retry backoff, like a real LLM turn.
			if (call === 2) setTimeout(finish, backoffMs * 3);
			else queueMicrotask(finish);
			return stream;
		};

		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn,
		});
		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage, tempDir);
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 3, baseDelayMs: backoffMs } });
		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: createTestResourceLoader(),
		});

		let customMessagePromise: Promise<void> | undefined;
		session.subscribe((event) => {
			if (event.type !== "auto_retry_start" || customMessagePromise) return;
			setTimeout(() => {
				expect(session.isRetrying).toBe(true);
				customMessagePromise = session.sendCustomMessage(
					{ customType: "task-result", content: "background task done", display: true, details: {} },
					{ triggerTurn: true, deliverAs: "followUp" },
				);
			}, 0);
		});

		await session.prompt("Test");
		expect(customMessagePromise).toBeDefined();
		await customMessagePromise;

		// initial failure + successful retry + one follow-up turn for the queued custom message
		expect(callCount).toBe(3);
		expect(
			session.messages.some((message) => message.role === "custom" && message.customType === "task-result"),
		).toBe(true);
		expect(session.isRetrying).toBe(false);
		expect(session.isStreaming).toBe(false);
		const lastRun = session.runJournalRecords.at(-1);
		expect(lastRun?.event).toBe("run_finished");
		expect(lastRun?.event === "run_finished" ? lastRun.termination.kind : undefined).not.toBe("internal_error");
	});

	it("does not close the live run journal when a competing top-level run is rejected", async () => {
		// Defense for the same wedge: a caller that reaches _runAgentPrompt while
		// another run is active gets "Agent is already processing", but its runtime
		// failure handler must not finish/null the journal run it never owned.
		let releaseFirstCall: (() => void) | undefined;
		const firstCallStarted = new Promise<void>((resolve) => {
			releaseFirstCall = resolve;
		});
		let finishFirstCall: (() => void) | undefined;
		const streamFn = () => {
			const stream = new MockAssistantStream();
			const msg = createAssistantMessage("Success");
			stream.push({ type: "start", partial: msg });
			finishFirstCall = () => stream.push({ type: "done", reason: "stop", message: msg });
			releaseFirstCall?.();
			return stream;
		};

		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn,
		});
		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage, tempDir);
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: createTestResourceLoader(),
		});

		const promptPromise = session.prompt("Test");
		await firstCallStarted;
		expect(session.isStreaming).toBe(true);

		const competing = (session as unknown as { _runAgentPrompt(message: unknown): Promise<void> })._runAgentPrompt({
			role: "user",
			content: [{ type: "text", text: "late" }],
			timestamp: Date.now(),
		});
		await expect(competing).rejects.toThrow(/already processing/);

		finishFirstCall?.();
		await promptPromise;

		const lastRun = session.runJournalRecords.at(-1);
		expect(lastRun?.event).toBe("run_finished");
		expect(lastRun?.event === "run_finished" ? lastRun.termination.kind : undefined).toBe("completed");
		expect(session.isStreaming).toBe(false);
	});

	it("prompt waits for retry completion even when assistant message_end handling is delayed", async () => {
		const created = createSession({ failCount: 1, delayAssistantMessageEndMs: 40 });

		await created.session.prompt("Test");

		expect(created.getCallCount()).toBe(2);
		expect(created.session.isRetrying).toBe(false);
	});

	it("retries provider network_error failures", async () => {
		const created = createSession({ failCount: 0 });
		let callCount = 0;
		const streamFn = () => {
			callCount++;
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callCount === 1) {
					const msg = createAssistantMessage("", {
						stopReason: "error",
						errorMessage: "Provider finish_reason: network_error",
					});
					stream.push({ type: "start", partial: msg });
					stream.push({ type: "error", reason: "error", error: msg });
					return;
				}

				const msg = createAssistantMessage("Recovered after retry");
				stream.push({ type: "start", partial: msg });
				stream.push({ type: "done", reason: "stop", message: msg });
			});
			return stream;
		};
		created.session.dispose();

		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn,
		});
		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage, tempDir);
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } });
		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: createTestResourceLoader(),
		});

		const events: string[] = [];
		session.subscribe((event) => {
			if (event.type === "auto_retry_start") events.push(`start:${event.attempt}`);
			if (event.type === "auto_retry_end") events.push(`end:success=${event.success}`);
		});

		await session.prompt("Test");

		expect(callCount).toBe(2);
		expect(events).toEqual(["start:1", "end:success=true"]);
	});

	it("prompt waits for full agent loop when retry produces tool calls", async () => {
		// Regression: when auto-retry fires and the retry response includes tool_use,
		// session.prompt() must wait for the entire tool loop to finish before returning.
		// Previously, _resolveRetry() on the first successful message_end would unblock
		// waitForRetry() while the agent was still executing tools.
		let callCount = 0;
		const toolExecuted = { value: false };

		const echoTool: AgentTool = {
			name: "echo",
			label: "Echo",
			description: "Echo text back",
			parameters: Type.Object({ text: Type.String() }),
			execute: async () => {
				toolExecuted.value = true;
				return { content: [{ type: "text", text: "echoed" }], details: undefined };
			},
		};

		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: () => {
				callCount++;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (callCount === 1) {
						// First call: overloaded error
						const msg = createAssistantMessage("", {
							stopReason: "error",
							errorMessage: "overloaded_error",
						});
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "error", reason: "error", error: msg });
					} else if (callCount === 2) {
						// Second call (retry): text + tool_use
						const msg: AssistantMessage = {
							...createAssistantMessage("Looking that up now."),
							stopReason: "toolUse",
							content: [
								{ type: "text", text: "Looking that up now." },
								{ type: "toolCall", id: "call_1", name: "echo", arguments: { text: "hello" } },
							],
						};
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "toolUse", message: msg });
					} else {
						// Third call (after tool result): final response
						const msg = createAssistantMessage("Final answer.");
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "stop", message: msg });
					}
				});
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage, tempDir);
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } });

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: createTestResourceLoader(),
			baseToolsOverride: { echo: echoTool },
		});

		await session.prompt("Test");

		// All three LLM calls must have completed
		expect(callCount).toBe(3);
		// Tool must have been executed
		expect(toolExecuted.value).toBe(true);
		// Agent must not be streaming after prompt returns
		expect(session.isStreaming).toBe(false);
		// A follow-up prompt must work (no "Agent is already processing" error)
		await session.prompt("Follow-up");
		expect(callCount).toBe(4);
	});
});
