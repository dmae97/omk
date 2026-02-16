import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, Model, ProviderSessionState } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("AgentSession context promotion", () => {
	let tempDir: TempDir;
	let session: AgentSession;
	let modelRegistry: ModelRegistry;
	let authStorage: AuthStorage;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-context-promotion-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("openai-codex", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
		}
		tempDir.removeSync();
	});

	function createAssistantMessage(model: Model, contextTokens: number): AssistantMessage {
		return {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: contextTokens,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: contextTokens,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
	}

	async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (predicate()) return;
			await Bun.sleep(10);
		}
		throw new Error("Timed out waiting for condition");
	}

	it("promotes to a larger-context model and clears codex websocket session state", async () => {
		const sparkModel = modelRegistry.find("openai-codex", "gpt-5.3-codex-spark");
		const codexModel = modelRegistry.find("openai-codex", "gpt-5.3-codex");
		if (!sparkModel || !codexModel) {
			throw new Error("Expected codex spark and codex models to exist");
		}

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"contextPromotion.enabled": true,
			"contextPromotion.thresholdPercent": 90,
		});

		const agent = new Agent({
			initialState: {
				model: sparkModel,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
		});

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});

		const closeSpy = vi.fn();
		session.providerSessionState.set("openai-codex-responses", {
			close: closeSpy,
		} satisfies ProviderSessionState);

		const assistantMessage = createAssistantMessage(sparkModel, 120_000);
		session.agent.emitExternalEvent({ type: "message_end", message: assistantMessage });
		session.agent.emitExternalEvent({ type: "agent_end", messages: [assistantMessage] });

		await waitFor(() => session.model?.id === codexModel.id);

		expect(session.model?.provider).toBe(codexModel.provider);
		expect(session.model?.id).toBe(codexModel.id);
		expect(closeSpy).toHaveBeenCalledTimes(1);
		expect(session.providerSessionState.size).toBe(0);
	});

	it("does not promote when context usage is below threshold", async () => {
		const sparkModel = modelRegistry.find("openai-codex", "gpt-5.3-codex-spark");
		if (!sparkModel) {
			throw new Error("Expected codex spark model to exist");
		}

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"contextPromotion.enabled": true,
			"contextPromotion.thresholdPercent": 90,
		});

		const agent = new Agent({
			initialState: {
				model: sparkModel,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
		});

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});

		const closeSpy = vi.fn();
		session.providerSessionState.set("openai-codex-responses", {
			close: closeSpy,
		} satisfies ProviderSessionState);

		const assistantMessage = createAssistantMessage(sparkModel, 80_000);
		session.agent.emitExternalEvent({ type: "message_end", message: assistantMessage });
		session.agent.emitExternalEvent({ type: "agent_end", messages: [assistantMessage] });

		await Bun.sleep(30);

		expect(session.model?.provider).toBe(sparkModel.provider);
		expect(session.model?.id).toBe(sparkModel.id);
		expect(closeSpy).not.toHaveBeenCalled();
		expect(session.providerSessionState.size).toBe(1);
	});
});
