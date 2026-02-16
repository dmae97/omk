import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	type AssistantMessageEventStream,
	clearCustomApis,
	getCustomApi,
	getOAuthProviders,
	type OAuthCredentials,
	unregisterOAuthProviders,
} from "@oh-my-pi/pi-ai";
import { ModelRegistry, type ProviderConfigInput } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { Snowflake } from "@oh-my-pi/pi-utils";

describe("ModelRegistry runtime provider registration", () => {
	let tempDir: string;
	let modelsJsonPath: string;
	let authStorage: AuthStorage;

	const sourceIds = ["ext://atomic", "ext://runtime", "ext://oauth"];

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `pi-test-model-registry-runtime-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		modelsJsonPath = path.join(tempDir, "models.json");
		authStorage = await AuthStorage.create(path.join(tempDir, "testauth.db"));
	});

	afterEach(() => {
		clearCustomApis();
		for (const sourceId of sourceIds) {
			unregisterOAuthProviders(sourceId);
		}
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	const baseModel: NonNullable<ProviderConfigInput["models"]>[number] = {
		id: "runtime-model",
		name: "Runtime Model",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	};

	const streamSimple: NonNullable<ProviderConfigInput["streamSimple"]> = () =>
		({}) as unknown as AssistantMessageEventStream;

	test("validates provider config before mutating custom API state", () => {
		const registry = new ModelRegistry(authStorage, modelsJsonPath);
		const beforeAnthropicCount = registry.getAll().filter(model => model.provider === "anthropic").length;

		const invalidConfig: ProviderConfigInput = {
			api: "custom-atomic-api",
			apiKey: "RUNTIME_KEY",
			streamSimple,
			models: [{ ...baseModel, id: "broken" }],
			// baseUrl intentionally missing to force validation failure
		};

		expect(() => registry.registerProvider("atomic-provider", invalidConfig, "ext://atomic")).toThrow(
			'Provider atomic-provider: "baseUrl" is required when defining models.',
		);
		expect(getCustomApi("custom-atomic-api")).toBeUndefined();

		const afterAnthropicCount = registry.getAll().filter(model => model.provider === "anthropic").length;
		expect(afterAnthropicCount).toBe(beforeAnthropicCount);
	});

	test("merges provider/model headers and adds Authorization when authHeader is enabled", () => {
		const registry = new ModelRegistry(authStorage, modelsJsonPath);

		const config: ProviderConfigInput = {
			baseUrl: "https://runtime.example.com/v1",
			apiKey: "RUNTIME_KEY",
			api: "openai-completions",
			authHeader: true,
			headers: { "X-Provider": "provider-header" },
			models: [{ ...baseModel, headers: { "X-Model": "model-header" } }],
		};

		registry.registerProvider("runtime-provider", config, "ext://runtime");
		const model = registry.find("runtime-provider", "runtime-model");

		expect(model).toBeDefined();
		expect(model?.headers?.Authorization).toBe("Bearer RUNTIME_KEY");
		expect(model?.headers?.["X-Provider"]).toBe("provider-header");
		expect(model?.headers?.["X-Model"]).toBe("model-header");
	});

	test("clearSourceRegistrations and syncExtensionSources remove source-scoped API and OAuth providers", () => {
		const registry = new ModelRegistry(authStorage, modelsJsonPath);
		const oauthCredentials: OAuthCredentials = {
			access: "access-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
		};

		const config: ProviderConfigInput = {
			api: "custom-oauth-api",
			streamSimple,
			oauth: {
				name: "Custom OAuth",
				login: async () => oauthCredentials,
				refreshToken: async credentials => credentials,
				getApiKey: credentials => credentials.access,
			},
		};

		registry.registerProvider("oauth-provider", config, "ext://oauth");
		expect(getCustomApi("custom-oauth-api")).toBeDefined();
		expect(getOAuthProviders().some(provider => provider.id === "oauth-provider")).toBe(true);

		registry.clearSourceRegistrations("ext://oauth");
		expect(getCustomApi("custom-oauth-api")).toBeUndefined();
		expect(getOAuthProviders().some(provider => provider.id === "oauth-provider")).toBe(false);

		registry.registerProvider("oauth-provider", config, "ext://oauth");
		expect(getCustomApi("custom-oauth-api")).toBeDefined();
		expect(getOAuthProviders().some(provider => provider.id === "oauth-provider")).toBe(true);

		registry.syncExtensionSources([]);
		expect(getCustomApi("custom-oauth-api")).toBeUndefined();
		expect(getOAuthProviders().some(provider => provider.id === "oauth-provider")).toBe(false);
	});
});
