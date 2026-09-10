import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "omk-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSessionFromServices, createAgentSessionServices } from "../src/core/agent-session-services.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { completeSummarization } from "../src/core/compaction/compaction.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const model: Model<"openai-responses"> = {
	id: "contract-sdk-fixture",
	name: "Contract SDK fixture",
	provider: "contract-sdk-fixture",
	api: "openai-responses",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
};
const contract = {
	allowedModels: [{ provider: model.provider, id: model.id }],
	allowedProviders: [model.provider],
	allowedAuthOrigins: [model.provider],
	thinking: false,
	maxOutputTokens: 512,
};
const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function createFixture(fromServices = false) {
	const directory = mkdtempSync(join(tmpdir(), "omk-sdk-model-contract-"));
	cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
	const cwd = join(directory, "project");
	const agentDir = join(directory, "agent");
	mkdirSync(cwd);
	mkdirSync(agentDir);
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	authStorage.setRuntimeApiKey(model.provider, "fixture-key");
	const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
	const captured: SimpleStreamOptions[] = [];
	const contexts: Context[] = [];
	modelRegistry.registerProvider(model.provider, {
		api: model.api,
		streamSimple: (_selected, context, options) => {
			captured.push(options ?? {});
			contexts.push(context);
			const stream = createAssistantMessageEventStream();
			const message: AssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "fixture summary" }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				stopReason: "stop",
				timestamp: 0,
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			queueMicrotask(() => stream.push({ type: "done", reason: "stop", message }));
			return stream;
		},
	});
	cleanups.push(() => modelRegistry.unregisterProvider(model.provider));
	const options = {
		cwd,
		agentDir,
		model,
		modelContract: contract,
		thinkingLevel: "off" as const,
		authStorage,
		modelRegistry,
		noTools: "all" as const,
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
		sessionManager: SessionManager.inMemory(cwd),
	};
	const { session } = fromServices
		? await createAgentSessionFromServices({ ...options, services: await createAgentSessionServices(options) })
		: await createAgentSession(options);
	cleanups.push(() => session.dispose());
	return { session, captured, contexts };
}

describe("SDK request contract", () => {
	it("projects tool images on the shared summarization stream without rewriting its input", async () => {
		const { session, contexts } = await createFixture();
		const context: Context = {
			messages: [
				{
					role: "toolResult",
					toolCallId: "read-image",
					toolName: "read",
					isError: false,
					timestamp: 0,
					content: [
						{ type: "text", text: "Source: /work/plot.png" },
						{ type: "image", mimeType: "image/png", data: "fixture-image-bytes" },
					],
				},
			],
		};
		await completeSummarization(model, context, {}, session.agent.streamFn);
		expect(JSON.stringify(contexts)).not.toContain("fixture-image-bytes");
		expect(JSON.stringify(contexts)).toContain("/work/plot.png");
		expect(context.messages[0]?.content).toContainEqual(expect.objectContaining({ type: "image" }));
	});

	it("classifies a denied model as non-retryable configuration, not a provider protocol failure", async () => {
		const { session, captured } = await createFixture();
		session.agent.state.model = { ...model, id: "forbidden" };
		await session.prompt("Run the fixture.");
		expect(captured).toEqual([]);
		expect(session.lastTermination).toMatchObject({
			kind: "configuration",
			retryable: false,
			safeToAutoRetry: false,
		});
		// A later authorized prompt must not inherit the previous denial.
		session.agent.state.model = model;
		await session.prompt("Run the authorized fixture.");
		expect(session.lastTermination?.kind).toBe("completed");
	});

	it("preserves the contract through the CLI service factory", async () => {
		const { session, captured } = await createFixture(true);
		await session.prompt("Return the fixture result.");
		expect(captured).toHaveLength(1);
		expect(captured[0]?.maxTokens).toBe(512);
	});
	it("enforces an output cap through the real session prompt path", async () => {
		const { session, captured } = await createFixture();
		await session.prompt("Return the fixture result.");
		expect(captured).toHaveLength(1);
		expect(captured[0]?.maxTokens).toBe(512);
	});

	it("enforces the same policy on the shared summarization stream", async () => {
		const { session, captured } = await createFixture();
		await completeSummarization(model, { messages: [] }, {}, session.agent.streamFn);
		expect(captured).toHaveLength(1);
		expect(captured[0]?.maxTokens).toBe(512);
		expect(captured[0]?.cacheRetention).toBe("none");
	});

	it("refuses a summarizer that selects another model", async () => {
		const { session, captured } = await createFixture();
		await expect(
			completeSummarization({ ...model, id: "other" }, { messages: [] }, {}, session.agent.streamFn),
		).rejects.toThrow();
		expect(captured).toEqual([]);
	});

	it("refuses an excessive explicit summary cap rather than silently clamping it", async () => {
		const { session, captured } = await createFixture();
		await expect(
			completeSummarization(model, { messages: [] }, { maxTokens: 513 }, session.agent.streamFn),
		).rejects.toThrow();
		expect(captured).toEqual([]);
	});

	it("refuses payload replacement through the SDK stream hook", async () => {
		const { session, captured } = await createFixture();
		await session.agent.streamFn(model, { messages: [] }, { onPayload: () => ({ model: "other" }) });
		const onPayload = captured[0]?.onPayload;
		expect(onPayload).toBeTypeOf("function");
		await expect(onPayload?.({ model: model.id, max_output_tokens: 512 }, model)).rejects.toThrow();
	});
});
