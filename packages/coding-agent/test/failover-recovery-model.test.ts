import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "omk-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel, type Model } from "omk-ai";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

const QUOTA = "You have hit your ChatGPT usage limit (pro plan). Try again in ~745 min.";
const DENIED = "403 Access to model denied. Please make sure you are eligible for using the model.";

class Stream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("unexpected event");
			},
		);
	}
}

let tempDir: string;
let session: AgentSession | undefined;
afterEach(() => {
	session?.dispose();
	session = undefined;
	rmSync(tempDir, { recursive: true, force: true });
});

/** Each provider answers with a fixed error, or succeeds when it has none. */
function createSession(
	errors: Record<string, string>,
	candidates: Array<{ provider: string; id: string }>,
	modelPinned = false,
) {
	tempDir = mkdtempSync(join(tmpdir(), "omk-failover-model-"));
	const calls: string[] = [];
	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: { model: getModel("anthropic", "claude-sonnet-4-5")!, systemPrompt: "Test", tools: [] },
		streamFn: (model: Model<any>) => {
			calls.push(`${model.provider}/${model.id}`);
			const stream = new Stream();
			const error = errors[model.provider];
			const message: AssistantMessage = {
				role: "assistant",
				content: error ? [] : [{ type: "text", text: "ok" }],
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
				stopReason: error ? "error" : "stop",
				...(error ? { errorMessage: error } : {}),
				timestamp: Date.now(),
			};
			queueMicrotask(() => {
				stream.push({ type: "start", partial: message });
				if (error) stream.push({ type: "error", reason: "error", error: message });
				else stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		},
	});
	const settingsManager = SettingsManager.create(tempDir, tempDir);
	const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	for (const provider of ["anthropic", "deepseek", "opencode-go"]) authStorage.setRuntimeApiKey(provider, "k");
	settingsManager.setDefaultModelAndProvider("anthropic", "claude-sonnet-4-5");
	settingsManager.applyOverrides({
		retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
		providerResilience: { failoverCandidates: candidates },
	});
	session = new AgentSession({
		agent,
		sessionManager: SessionManager.inMemory(),
		settingsManager,
		cwd: tempDir,
		modelRegistry: ModelRegistry.create(authStorage, tempDir),
		modelPinned,
		resourceLoader: createTestResourceLoader(),
	});
	return { session, settingsManager, calls };
}

const QWEN = { provider: "opencode-go", id: "qwen3.8-max" };
const DEEPSEEK = { provider: "deepseek", id: "deepseek-v4-flash" };

describe("automatic failover model selection", () => {
	it("does not persist a failover model as the user's default", async () => {
		const created = createSession({ anthropic: QUOTA }, [DEEPSEEK]);
		await created.session.prompt("Test");
		expect(created.session.model?.id).toBe("deepseek-v4-flash");
		expect(created.settingsManager.getDefaultProvider()).toBe("anthropic");
		expect(created.settingsManager.getDefaultModel()).toBe("claude-sonnet-4-5");
	});

	it("advances past a failover candidate that denies access", async () => {
		const created = createSession({ anthropic: QUOTA, "opencode-go": DENIED }, [QWEN, DEEPSEEK]);
		await created.session.prompt("Test");
		expect(created.calls).toEqual([
			"anthropic/claude-sonnet-4-5",
			"opencode-go/qwen3.8-max",
			"deepseek/deepseek-v4-flash",
		]);
		expect(created.session.model?.id).toBe("deepseek-v4-flash");
	});

	it("ends when the only failover candidate denies access, without retrying it", async () => {
		const created = createSession({ anthropic: QUOTA, "opencode-go": DENIED }, [QWEN]);
		await created.session.prompt("Test");
		expect(created.calls).toEqual(["anthropic/claude-sonnet-4-5", "opencode-go/qwen3.8-max"]);
	});

	it("keeps an access denial on the user's own model non-retryable", async () => {
		const created = createSession({ anthropic: DENIED }, [DEEPSEEK]);
		await created.session.prompt("Test");
		expect(created.calls).toEqual(["anthropic/claude-sonnet-4-5"]);
		expect(created.session.model?.id).toBe("claude-sonnet-4-5");
	});

	it("keeps a --model pin when the quota failover candidate denies access", async () => {
		const created = createSession({ anthropic: QUOTA, "opencode-go": DENIED }, [QWEN, DEEPSEEK], true);
		await created.session.prompt("Test");
		expect(created.calls).toEqual(["anthropic/claude-sonnet-4-5", "opencode-go/qwen3.8-max"]);
	});
});
