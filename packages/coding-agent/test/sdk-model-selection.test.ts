import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createAgentSession, type ExtensionFactory } from "@oh-my-pi/pi-coding-agent/sdk";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { Snowflake } from "@oh-my-pi/pi-utils";

describe("createAgentSession deferred model pattern resolution", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `pi-sdk-model-selection-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	const providerExtension: ExtensionFactory = pi => {
		pi.registerProvider("runtime-provider", {
			baseUrl: "https://runtime.example.com/v1",
			apiKey: "RUNTIME_KEY",
			api: "openai-completions",
			models: [
				{
					id: "runtime-model",
					name: "Runtime Model",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 8192,
				},
			],
		});
	};

	function buildSessionOptions(modelPattern: string) {
		return {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			disableExtensionDiscovery: true,
			extensions: [providerExtension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			modelPattern,
		};
	}

	test("resolves explicit modelPattern after extension providers register", async () => {
		const { session, modelFallbackMessage } = await createAgentSession(
			buildSessionOptions("runtime-provider/runtime-model"),
		);

		expect(session.model).toBeDefined();
		expect(session.model?.provider).toBe("runtime-provider");
		expect(session.model?.id).toBe("runtime-model");
		expect(modelFallbackMessage).toBeUndefined();
	});

	test("does not silently fallback when explicit modelPattern is unresolved", async () => {
		const { session, modelFallbackMessage } = await createAgentSession(
			buildSessionOptions("missing-provider/missing-model"),
		);

		expect(session.model).toBeUndefined();
		expect(modelFallbackMessage).toBe('Model "missing-provider/missing-model" not found');
	});
});
