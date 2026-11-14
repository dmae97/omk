import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "../src/index.ts";

let root: string;
let cwd: string;
let agentDir: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-sdk-native-"));
	cwd = join(root, "project");
	agentDir = join(root, "agent");
	mkdirSync(join(cwd, ".git"), { recursive: true });
	mkdirSync(agentDir);
	vi.stubEnv("HOME", root);
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

describe("public SDK native resource loader injection", () => {
	it("consumes the supplied loader, executes validated bound tools, and tracks queued and post-bind provider owners", async () => {
		const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
		const faux = registerFauxProvider();
		const model = faux.getModel();
		const providerConfig = {
			api: model.api,
			baseUrl: model.baseUrl,
			apiKey: "fixture-only",
			models: [
				{
					id: model.id,
					name: model.name,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
				},
			],
		};
		const entry = join(cwd, "native.ts");
		writeFileSync(
			entry,
			`
			import { Type } from "typebox";
			import type { ExtensionAPI } from "open-multi-agent-kit";
			export default function(api: ExtensionAPI) {
				api.registerProvider(${JSON.stringify(model.provider)}, ${JSON.stringify(providerConfig)});
				api.on("session_start", (_event, ctx) => api.events.emit("sdk:capture", { api, ctx }));
				api.registerTool({ name: "native_increment", label: "Increment", description: "Increment a number",
					parameters: Type.Object({ value: Type.Number() }),
					execute: async (id, args, _signal, _update, ctx) => {
						const details = { id, value: args.value + 1, cwd: ctx.cwd, mode: ctx.mode, trusted: ctx.isProjectTrusted() };
						api.events.emit("sdk:executed", details);
						return { content: [{ type: "text", text: String(details.value) }], details };
					}
				});
			}
		`,
		);
		const settingsManager = SettingsManager.inMemory({
			packages: [],
			compaction: { enabled: false },
			retry: { enabled: false },
		});
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			packageManifestDialect: "omk",
			additionalExtensionPaths: [entry],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		const receipts: unknown[] = [];
		let captured: { api: ExtensionAPI } | undefined;
		loader.getEventBus().on("sdk:capture", (data) => {
			captured = data as typeof captured;
		});
		loader.getEventBus().on("sdk:executed", (data) => {
			receipts.push(data);
		});
		await loader.reload();
		const loaded = loader.getExtensions();
		expect(loaded.errors).toEqual([]);
		expect(loaded.runtime.pendingProviderRegistrations).toContainEqual({
			name: model.provider,
			config: expect.any(Object),
			extensionPath: entry,
		});
		expect(loaded.runtime.providerOwners.get(model.provider)).toBe(entry);
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(model.provider, "fixture-only");
		const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
		const { session, extensionsResult } = await createAgentSession({
			cwd,
			agentDir,
			authStorage,
			modelRegistry,
			model,
			resourceLoader: loader,
			settingsManager,
			sessionManager: SessionManager.inMemory(cwd),
			noTools: "builtin",
		});
		try {
			expect(session.resourceLoader).toBe(loader);
			expect(extensionsResult).toBe(loaded);
			expect(loaded.runtime.pendingProviderRegistrations).toEqual([]);
			expect(modelRegistry.find(model.provider, model.id)).toBeDefined();
			await session.bindExtensions({ mode: "print" });
			expect(captured).toBeDefined();
			captured!.api.registerProvider("native-sdk-postbind", providerConfig);
			expect(loaded.runtime.providerOwners.get("native-sdk-postbind")).toBe(entry);
			expect(modelRegistry.find("native-sdk-postbind", model.id)).toBeDefined();
			faux.setResponses([
				fauxAssistantMessage(fauxToolCall("native_increment", { value: 41 }, { id: "sdk-valid" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("completed"),
			]);
			await session.prompt("Execute the native fixture");
			expect(receipts).toEqual([{ id: "sdk-valid", value: 42, cwd, mode: "print", trusted: true }]);
			expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
				toolName: "native_increment",
				toolCallId: "sdk-valid",
				isError: false,
				content: [{ type: "text", text: "42" }],
			});
			faux.setResponses([
				fauxAssistantMessage(fauxToolCall("native_increment", { value: "invalid" }, { id: "sdk-invalid" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("invalid arguments rejected"),
			]);
			await session.prompt("Validate invalid arguments");
			expect(receipts).toHaveLength(1);
			expect(
				session.messages.find((message) => message.role === "toolResult" && message.toolCallId === "sdk-invalid"),
			).toMatchObject({ isError: true });
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			await session.close();
			faux.unregister();
		}
	});
});
