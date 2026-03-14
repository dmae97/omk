import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effort, type OpenAICompat, type ThinkingConfig } from "@oh-my-pi/pi-ai";
import { kNoAuth, MODEL_ROLES, ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { hookFetch, Snowflake } from "@oh-my-pi/pi-utils";

describe("ModelRegistry", () => {
	let tempDir: string;
	let modelsJsonPath: string;
	let authStorage: AuthStorage;

	test("commit role includes a visible badge tag", () => {
		expect(MODEL_ROLES.commit.tag).toBe("COMMIT");
		expect(MODEL_ROLES.commit.color).toBe("dim");
	});

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `pi-test-model-registry-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		modelsJsonPath = path.join(tempDir, "models.json");
		authStorage = await AuthStorage.create(path.join(tempDir, "testauth.db"));
	});

	afterEach(() => {
		authStorage.close();
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	type ProviderConfig = {
		baseUrl: string;
		apiKey: string;
		api: string;
		models: Array<{
			id: string;
			name: string;
			reasoning: boolean;
			thinking?: ThinkingConfig;
			input: string[];
			cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
			contextWindow: number;
			maxTokens: number;
		}>;
	};

	/** Create minimal provider config  */
	function providerConfig(
		baseUrl: string,
		models: Array<{ id: string; name?: string; reasoning?: boolean; thinking?: ThinkingConfig }>,
		api: string = "anthropic-messages",
	) {
		return {
			baseUrl,
			apiKey: "TEST_KEY",
			api,
			models: models.map(m => ({
				id: m.id,
				name: m.name ?? m.id,
				reasoning: m.reasoning ?? false,
				thinking: m.thinking,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100000,
				maxTokens: 8000,
			})),
		};
	}

	function writeModelsJson(providers: Record<string, ProviderConfig>) {
		fs.writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
	}

	function getModelsForProvider(registry: ModelRegistry, provider: string) {
		return registry.getAll().filter(m => m.provider === provider);
	}

	/** Create a baseUrl-only override (no custom models) */
	function overrideConfig(baseUrl: string, headers?: Record<string, string>) {
		return { baseUrl, ...(headers && { headers }) };
	}

	/** Write raw providers config (for mixed override/replacement scenarios) */
	function writeRawModelsJson(providers: Record<string, unknown>) {
		fs.writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
	}

	describe("baseUrl override (no custom models)", () => {
		test("overriding baseUrl keeps all built-in models", () => {
			writeRawModelsJson({
				anthropic: overrideConfig("https://my-proxy.example.com/v1"),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const anthropicModels = getModelsForProvider(registry, "anthropic");

			// Should have multiple built-in models, not just one
			expect(anthropicModels.length).toBeGreaterThan(1);
			expect(anthropicModels.some(m => m.id.includes("claude"))).toBe(true);
		});

		test("overriding baseUrl changes URL on all built-in models", () => {
			writeRawModelsJson({
				anthropic: overrideConfig("https://my-proxy.example.com/v1"),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const anthropicModels = getModelsForProvider(registry, "anthropic");

			// All models should have the new baseUrl
			for (const model of anthropicModels) {
				expect(model.baseUrl).toBe("https://my-proxy.example.com/v1");
			}
		});

		test("overriding headers merges with model headers", () => {
			writeRawModelsJson({
				anthropic: overrideConfig("https://my-proxy.example.com/v1", {
					"X-Custom-Header": "custom-value",
				}),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const anthropicModels = getModelsForProvider(registry, "anthropic");

			for (const model of anthropicModels) {
				expect(model.headers?.["X-Custom-Header"]).toBe("custom-value");
			}
		});

		test("baseUrl-only override does not affect other providers", () => {
			writeRawModelsJson({
				anthropic: overrideConfig("https://my-proxy.example.com/v1"),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const googleModels = getModelsForProvider(registry, "google");

			// Google models should still have their original baseUrl
			expect(googleModels.length).toBeGreaterThan(0);
			expect(googleModels[0].baseUrl).not.toBe("https://my-proxy.example.com/v1");
		});

		test("can mix baseUrl override and models merge", () => {
			writeRawModelsJson({
				// baseUrl-only for anthropic
				anthropic: overrideConfig("https://anthropic-proxy.example.com/v1"),
				// Add custom model for google (merged with built-ins)
				google: providerConfig(
					"https://google-proxy.example.com/v1",
					[{ id: "gemini-custom" }],
					"google-generative-ai",
				),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);

			// Anthropic: multiple built-in models with new baseUrl
			const anthropicModels = getModelsForProvider(registry, "anthropic");
			expect(anthropicModels.length).toBeGreaterThan(1);
			expect(anthropicModels[0].baseUrl).toBe("https://anthropic-proxy.example.com/v1");

			// Google: built-ins plus custom model
			const googleModels = getModelsForProvider(registry, "google");
			expect(googleModels.length).toBeGreaterThan(1);
			expect(googleModels.some(m => m.id === "gemini-custom")).toBe(true);
		});

		test("refresh() picks up baseUrl override changes", async () => {
			writeRawModelsJson({
				anthropic: overrideConfig("https://first-proxy.example.com/v1"),
			});
			const registry = new ModelRegistry(authStorage, modelsJsonPath);

			expect(getModelsForProvider(registry, "anthropic")[0].baseUrl).toBe("https://first-proxy.example.com/v1");

			// Update and refresh
			writeRawModelsJson({
				anthropic: overrideConfig("https://second-proxy.example.com/v1"),
			});
			await registry.refresh("offline");

			expect(getModelsForProvider(registry, "anthropic")[0].baseUrl).toBe("https://second-proxy.example.com/v1");
		});
	});

	describe("custom models merge behavior", () => {
		test("custom provider with same name as built-in merges with built-in models", () => {
			writeModelsJson({
				anthropic: providerConfig("https://my-proxy.example.com/v1", [{ id: "claude-custom" }]),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const anthropicModels = getModelsForProvider(registry, "anthropic");

			// Built-in models still present, custom model merged in
			expect(anthropicModels.length).toBeGreaterThan(1);
			const custom = anthropicModels.find(m => m.id === "claude-custom");
			expect(custom).toBeDefined();
			expect(custom!.baseUrl).toBe("https://my-proxy.example.com/v1");
		});

		test("custom model with same id replaces built-in model by id", () => {
			writeModelsJson({
				openrouter: providerConfig(
					"https://my-proxy.example.com/v1",
					[{ id: "anthropic/claude-sonnet-4" }],
					"openai-completions",
				),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");
			const sonnetModels = models.filter(m => m.id === "anthropic/claude-sonnet-4");

			expect(sonnetModels).toHaveLength(1);
			expect(sonnetModels[0].baseUrl).toBe("https://my-proxy.example.com/v1");
		});

		test("custom provider with same name as built-in does not affect other built-in providers", () => {
			writeModelsJson({
				anthropic: providerConfig("https://my-proxy.example.com/v1", [{ id: "claude-custom" }]),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);

			expect(getModelsForProvider(registry, "google").length).toBeGreaterThan(0);
			expect(getModelsForProvider(registry, "openai").length).toBeGreaterThan(0);
		});

		test("provider-level baseUrl applies to both built-in and custom models", () => {
			writeModelsJson({
				anthropic: providerConfig("https://merged-proxy.example.com/v1", [{ id: "claude-custom" }]),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const anthropicModels = getModelsForProvider(registry, "anthropic");

			for (const model of anthropicModels) {
				expect(model.baseUrl).toBe("https://merged-proxy.example.com/v1");
			}
		});

		test("model-level baseUrl overrides provider-level baseUrl for custom models", () => {
			writeRawModelsJson({
				"opencode-go": {
					baseUrl: "https://opencode.ai/zen/go/v1",
					apiKey: "TEST_KEY",
					models: [
						{
							id: "minimax-m2.5",
							api: "anthropic-messages",
							baseUrl: "https://opencode.ai/zen/go",
							reasoning: true,
							input: ["text"],
							cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
							contextWindow: 204800,
							maxTokens: 131072,
						},
						{
							id: "glm-5",
							api: "openai-completions",
							reasoning: true,
							input: ["text"],
							cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
							contextWindow: 204800,
							maxTokens: 131072,
						},
					],
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const m25 = registry.find("opencode-go", "minimax-m2.5");
			const glm5 = registry.find("opencode-go", "glm-5");

			expect(m25?.baseUrl).toBe("https://opencode.ai/zen/go");
			expect(glm5?.baseUrl).toBe("https://opencode.ai/zen/go/v1");
		});

		test("modelOverrides still apply when provider also defines models", () => {
			writeRawModelsJson({
				openrouter: {
					baseUrl: "https://my-proxy.example.com/v1",
					apiKey: "OPENROUTER_API_KEY",
					api: "openai-completions",
					models: [
						{
							id: "custom/openrouter-model",
							name: "Custom OpenRouter Model",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 128000,
							maxTokens: 16384,
						},
					],
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							name: "Overridden Built-in Sonnet",
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");

			expect(models.some(m => m.id === "custom/openrouter-model")).toBe(true);
			expect(models.some(m => m.id === "anthropic/claude-sonnet-4" && m.name === "Overridden Built-in Sonnet")).toBe(
				true,
			);
		});

		test("refresh() reloads merged custom models from disk", async () => {
			writeModelsJson({
				anthropic: providerConfig("https://first-proxy.example.com/v1", [{ id: "claude-custom" }]),
			});
			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			expect(getModelsForProvider(registry, "anthropic").some(m => m.id === "claude-custom")).toBe(true);

			// Update and refresh
			writeModelsJson({
				anthropic: providerConfig("https://second-proxy.example.com/v1", [{ id: "claude-custom-2" }]),
			});
			await registry.refresh("offline");

			const anthropicModels = getModelsForProvider(registry, "anthropic");
			expect(anthropicModels.some(m => m.id === "claude-custom")).toBe(false);
			expect(anthropicModels.some(m => m.id === "claude-custom-2")).toBe(true);
			expect(anthropicModels.some(m => m.id.includes("claude"))).toBe(true);
		});

		test("built-in gpt-5.4 applies the hardcoded context window policy", () => {
			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			expect(registry.find("openai", "gpt-5.4")?.contextWindow).toBe(1_000_000);
		});

		test("custom gpt-5.4 replacement also applies the hardcoded context window policy", () => {
			writeModelsJson({
				openai: providerConfig("https://my-proxy.example.com/v1", [{ id: "gpt-5.4" }], "openai-responses"),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			expect(registry.find("openai", "gpt-5.4")?.contextWindow).toBe(1_000_000);
		});

		test("removing custom models from models.json keeps built-in provider models", async () => {
			writeModelsJson({
				anthropic: providerConfig("https://proxy.example.com/v1", [{ id: "claude-custom" }]),
			});
			const registry = new ModelRegistry(authStorage, modelsJsonPath);

			expect(getModelsForProvider(registry, "anthropic").some(m => m.id === "claude-custom")).toBe(true);

			// Remove custom models and refresh
			writeModelsJson({});
			await registry.refresh("offline");

			const anthropicModels = getModelsForProvider(registry, "anthropic");
			expect(anthropicModels.length).toBeGreaterThan(1);
			expect(anthropicModels.some(m => m.id === "claude-custom")).toBe(false);
			expect(anthropicModels.some(m => m.id.includes("claude"))).toBe(true);
		});
	});

	describe("thinking metadata normalization", () => {
		test("custom models preserve explicit thinking", () => {
			const thinking: ThinkingConfig = {
				mode: "anthropic-adaptive",
				minLevel: Effort.Minimal,
				maxLevel: Effort.High,
			};

			writeModelsJson({
				anthropic: providerConfig("https://my-proxy.example.com/v1", [
					{ id: "claude-custom", reasoning: true, thinking },
				]),
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const model = getModelsForProvider(registry, "anthropic").find(m => m.id === "claude-custom");

			expect(model?.thinking).toEqual(thinking);
		});

		test("model overrides can replace canonical thinking metadata", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							thinking: { mode: "budget", minLevel: Effort.Low, maxLevel: Effort.Medium },
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const model = getModelsForProvider(registry, "openrouter").find(m => m.id === "anthropic/claude-sonnet-4");

			expect(model?.thinking).toEqual({
				mode: "budget",
				minLevel: Effort.Low,
				maxLevel: Effort.Medium,
			});
		});
	});

	describe("modelOverrides (per-model customization)", () => {
		test("model override applies to a single built-in model", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							name: "Custom Sonnet Name",
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");

			const sonnet = models.find(m => m.id === "anthropic/claude-sonnet-4");
			expect(sonnet?.name).toBe("Custom Sonnet Name");

			// Other models should be unchanged
			const opus = models.find(m => m.id === "anthropic/claude-opus-4");
			expect(opus?.name).not.toBe("Custom Sonnet Name");
		});

		test("model override with compat.openRouterRouting", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							compat: {
								openRouterRouting: { only: ["amazon-bedrock"] },
							},
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");

			const sonnet = models.find(m => m.id === "anthropic/claude-sonnet-4");
			const compat = sonnet?.compat as OpenAICompat | undefined;
			expect(compat?.openRouterRouting).toEqual({ only: ["amazon-bedrock"] });
		});

		test("model override deep merges compat settings", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							compat: {
								openRouterRouting: { order: ["anthropic", "together"] },
							},
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");
			const sonnet = models.find(m => m.id === "anthropic/claude-sonnet-4");

			const compat = sonnet?.compat as OpenAICompat | undefined;
			expect(compat?.openRouterRouting).toEqual({ order: ["anthropic", "together"] });
		});

		test("multiple model overrides on same provider", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							compat: { openRouterRouting: { only: ["amazon-bedrock"] } },
						},
						"anthropic/claude-opus-4": {
							compat: { openRouterRouting: { only: ["anthropic"] } },
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");

			const sonnet = models.find(m => m.id === "anthropic/claude-sonnet-4");
			const opus = models.find(m => m.id === "anthropic/claude-opus-4");

			const sonnetCompat = sonnet?.compat as OpenAICompat | undefined;
			const opusCompat = opus?.compat as OpenAICompat | undefined;
			expect(sonnetCompat?.openRouterRouting).toEqual({ only: ["amazon-bedrock"] });
			expect(opusCompat?.openRouterRouting).toEqual({ only: ["anthropic"] });
		});

		test("model override combined with baseUrl override", () => {
			writeRawModelsJson({
				openrouter: {
					baseUrl: "https://my-proxy.example.com/v1",
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							name: "Proxied Sonnet",
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");
			const sonnet = models.find(m => m.id === "anthropic/claude-sonnet-4");

			// Both overrides should apply
			expect(sonnet?.baseUrl).toBe("https://my-proxy.example.com/v1");
			expect(sonnet?.name).toBe("Proxied Sonnet");

			// Other models should have the baseUrl but not the name override
			const opus = models.find(m => m.id === "anthropic/claude-opus-4");
			expect(opus?.baseUrl).toBe("https://my-proxy.example.com/v1");
			expect(opus?.name).not.toBe("Proxied Sonnet");
		});

		test("model override for non-existent model ID is ignored", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"nonexistent/model-id": {
							name: "This should not appear",
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");

			// Should not create a new model
			expect(models.find(m => m.id === "nonexistent/model-id")).toBeUndefined();
			// Should not crash or show error
			expect(registry.getError()).toBeUndefined();
		});

		test("model override can change cost fields partially", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							cost: { input: 99 },
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");
			const sonnet = models.find(m => m.id === "anthropic/claude-sonnet-4");

			// Input cost should be overridden
			expect(sonnet?.cost.input).toBe(99);
			// Other cost fields should be preserved from built-in
			expect(sonnet?.cost.output).toBeGreaterThan(0);
		});

		test("model override can add headers", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							headers: { "X-Custom-Model-Header": "value" },
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");
			const sonnet = models.find(m => m.id === "anthropic/claude-sonnet-4");

			expect(sonnet?.headers?.["X-Custom-Model-Header"]).toBe("value");
		});

		test("refresh() picks up model override changes", async () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							name: "First Name",
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			expect(
				getModelsForProvider(registry, "openrouter").find(m => m.id === "anthropic/claude-sonnet-4")?.name,
			).toBe("First Name");

			// Update and refresh
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							name: "Second Name",
						},
					},
				},
			});
			await registry.refresh("offline");

			expect(
				getModelsForProvider(registry, "openrouter").find(m => m.id === "anthropic/claude-sonnet-4")?.name,
			).toBe("Second Name");
		});

		test("removing model override restores built-in values", async () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							name: "Custom Name",
						},
					},
				},
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const customName = getModelsForProvider(registry, "openrouter").find(
				m => m.id === "anthropic/claude-sonnet-4",
			)?.name;
			expect(customName).toBe("Custom Name");

			// Remove override and refresh
			writeRawModelsJson({});
			await registry.refresh("offline");

			const restoredName = getModelsForProvider(registry, "openrouter").find(
				m => m.id === "anthropic/claude-sonnet-4",
			)?.name;
			expect(restoredName).not.toBe("Custom Name");
		});
	});

	describe("github-copilot oauth endpoint alignment", () => {
		test("getApiKey does not mutate bundled github-copilot baseUrl", async () => {
			await authStorage.set("github-copilot", [
				{
					type: "oauth",
					access: "tid=1;proxy-ep=proxy.individual.githubcopilot.com;exp=9999999999",
					refresh: "refresh-individual",
					expires: Date.now() + 60_000,
				},
				{
					type: "oauth",
					access: "tid=2;proxy-ep=proxy.enterprise.githubcopilot.com;exp=9999999999",
					refresh: "refresh-enterprise",
					expires: Date.now() + 60_000,
				},
			]);

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			const model = registry.find("github-copilot", "gpt-4o");
			expect(model).toBeDefined();
			if (!model) throw new Error("Expected github-copilot/gpt-4o model");

			const initialBaseUrl = model.baseUrl;
			const firstApiKey = await registry.getApiKey(model);
			expect(firstApiKey).toContain("proxy.individual.githubcopilot.com");
			const secondApiKey = await registry.getApiKey(model);
			expect(secondApiKey).toContain("proxy.enterprise.githubcopilot.com");
			expect(model.baseUrl).toBe(initialBaseUrl);
		});
	});
	describe("runtime discovery", () => {
		test("auto-discovers ollama models without provider config", async () => {
			using _hook = hookFetch(input => {
				const url = String(input);
				if (url === "http://127.0.0.1:11434/api/tags") {
					return new Response(JSON.stringify({ models: [{ name: "phi4-mini" }] }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				if (url === "http://127.0.0.1:11434/api/show") {
					return new Response(JSON.stringify({ capabilities: ["completion"] }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				throw new Error(`Unexpected URL: ${url}`);
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			await registry.refresh();
			const ollamaModels = getModelsForProvider(registry, "ollama");
			expect(ollamaModels.some(m => m.id === "phi4-mini")).toBe(true);
			expect(registry.getAvailable().some(m => m.provider === "ollama" && m.id === "phi4-mini")).toBe(true);
			expect(await registry.getApiKey(ollamaModels[0])).toBe(kNoAuth);
		});

		test("discovers ollama models at runtime and treats auth:none providers as available", async () => {
			writeRawModelsJson({
				ollama: {
					baseUrl: "http://127.0.0.1:11434/v1",
					api: "openai-completions",
					auth: "none",
					discovery: { type: "ollama" },
				},
			});

			using _hook = hookFetch(input => {
				const url = String(input);
				if (url === "http://127.0.0.1:11434/api/tags") {
					return new Response(
						JSON.stringify({
							models: [{ name: "qwen2.5-coder:7b" }, { model: "llama3.2:3b", name: "llama3.2:3b" }],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				if (url === "http://127.0.0.1:11434/api/show") {
					return new Response(JSON.stringify({ capabilities: ["completion"] }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				throw new Error(`Unexpected URL: ${url}`);
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			await registry.refresh();

			const ollamaModels = getModelsForProvider(registry, "ollama");
			expect(ollamaModels.some(m => m.id === "qwen2.5-coder:7b")).toBe(true);
			expect(ollamaModels.some(m => m.id === "llama3.2:3b")).toBe(true);

			const available = registry.getAvailable().filter(m => m.provider === "ollama");
			expect(available.length).toBe(2);
			expect(await registry.getApiKey(available[0])).toBe(kNoAuth);
		});

		test("discovers ollama thinking capabilities from show metadata", async () => {
			writeRawModelsJson({
				ollama: {
					baseUrl: "http://127.0.0.1:11434/v1",
					api: "openai-completions",
					auth: "none",
					discovery: { type: "ollama" },
				},
			});

			using _hook = hookFetch((input, init) => {
				const url = String(input);
				if (url === "http://127.0.0.1:11434/api/tags") {
					return new Response(
						JSON.stringify({
							models: [{ name: "qwen3.5:397b-cloud" }, { name: "llama3.2:3b" }],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				if (url === "http://127.0.0.1:11434/api/show") {
					const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
					if (body.model === "qwen3.5:397b-cloud") {
						return new Response(JSON.stringify({ capabilities: ["completion", "thinking"] }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					}
					if (body.model === "llama3.2:3b") {
						return new Response(JSON.stringify({ capabilities: ["completion"] }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					}
				}
				throw new Error(`Unexpected request: ${url}`);
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			await registry.refresh();

			const qwen = registry.find("ollama", "qwen3.5:397b-cloud");
			expect(qwen?.reasoning).toBe(true);
			expect(qwen?.thinking).toEqual({
				mode: "effort",
				minLevel: Effort.Minimal,
				maxLevel: Effort.High,
			});

			const llama = registry.find("ollama", "llama3.2:3b");
			expect(llama?.reasoning).toBe(false);
		});

		test("discovery failure does not fail model registry refresh", async () => {
			writeRawModelsJson({
				ollama: {
					baseUrl: "http://127.0.0.1:11434",
					api: "openai-completions",
					auth: "none",
					discovery: { type: "ollama" },
				},
			});

			using _hook = hookFetch(() => {
				throw new Error("connection refused");
			});

			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			await registry.refresh();
			expect(getModelsForProvider(registry, "ollama")).toHaveLength(0);
			expect(registry.getError()).toBeUndefined();
		});
		test("loads cached local models before live refresh and preserves them on failure", async () => {
			writeRawModelsJson({
				ollama: {
					baseUrl: "http://127.0.0.1:11434/v1",
					api: "openai-completions",
					auth: "none",
					discovery: { type: "ollama" },
				},
			});

			{
				using _hook = hookFetch(input => {
					const url = String(input);
					if (url === "http://127.0.0.1:11434/api/tags") {
						return new Response(JSON.stringify({ models: [{ name: "phi4-mini" }] }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					}
					if (url === "http://127.0.0.1:11434/api/show") {
						return new Response(JSON.stringify({ capabilities: ["completion"] }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					}
					throw new Error(`Unexpected URL: ${url}`);
				});
				const primedRegistry = new ModelRegistry(authStorage, modelsJsonPath);
				await primedRegistry.refresh();
			}

			const cachedRegistry = new ModelRegistry(authStorage, modelsJsonPath);
			expect(getModelsForProvider(cachedRegistry, "ollama").some(model => model.id === "phi4-mini")).toBe(true);
			expect(cachedRegistry.getProviderDiscoveryState("ollama")?.status).toBe("cached");

			{
				using _hook = hookFetch(() => {
					throw new Error("connection refused");
				});
				await cachedRegistry.refreshProvider("ollama");
			}

			expect(getModelsForProvider(cachedRegistry, "ollama").some(model => model.id === "phi4-mini")).toBe(true);
			const state = cachedRegistry.getProviderDiscoveryState("ollama");
			expect(state?.status).toBe("cached");
			expect(state?.error).toContain("connection refused");
		});

		test("reports unauthenticated discoverable providers without discarding cached models", async () => {
			writeRawModelsJson({
				"custom-local": {
					baseUrl: "http://127.0.0.1:11434/v1",
					api: "openai-completions",
					discovery: { type: "ollama" },
				},
			});
			authStorage.setRuntimeApiKey("custom-local", "test-key");

			{
				using _hook = hookFetch(input => {
					const url = String(input);
					if (url === "http://127.0.0.1:11434/api/tags") {
						return new Response(JSON.stringify({ models: [{ name: "local-coder" }] }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					}
					if (url === "http://127.0.0.1:11434/api/show") {
						return new Response(JSON.stringify({ capabilities: ["completion"] }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					}
					throw new Error(`Unexpected URL: ${url}`);
				});
				const primedRegistry = new ModelRegistry(authStorage, modelsJsonPath);
				await primedRegistry.refreshProvider("custom-local");
			}

			authStorage.setRuntimeApiKey("custom-local", "");
			const cachedRegistry = new ModelRegistry(authStorage, modelsJsonPath);
			await cachedRegistry.refreshProvider("custom-local");

			expect(getModelsForProvider(cachedRegistry, "custom-local").some(model => model.id === "local-coder")).toBe(
				true,
			);
			const state = cachedRegistry.getProviderDiscoveryState("custom-local");
			expect(state?.status).toBe("unauthenticated");
			expect(state?.models).toContain("local-coder");
		});
		test("llama.cpp discovery honors configured API key", async () => {
			authStorage.setRuntimeApiKey("llama.cpp", "test-llama-key");
			using _hook = hookFetch((input, init) => {
				const url = String(input);
				if (url === "http://127.0.0.1:8080/models") {
					const headers = init?.headers as Headers | Record<string, string> | undefined;
					let authHeader: string | null = null;
					if (headers instanceof Headers) {
						authHeader = headers.get("Authorization");
					} else if (typeof headers === "object") {
						authHeader = headers.Authorization;
					}
					expect(String(authHeader ?? "")).toBe("Bearer test-llama-key");
					return new Response(JSON.stringify({ data: [{ id: "llama-3.2:3b" }, { id: "mistral:7b" }] }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				throw new Error(`Unexpected URL: ${url}`);
			});
			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			await registry.refresh();
			const llamaModels = getModelsForProvider(registry, "llama.cpp");
			expect(llamaModels.some(m => m.id === "llama-3.2:3b")).toBe(true);
			const apiKey = await registry.getApiKey(llamaModels[0]);
			expect(apiKey).toBe("test-llama-key");
			expect(apiKey).not.toBe(kNoAuth);
		});
		test("llama.cpp discovery without API key is treated as keyless", async () => {
			using _hook = hookFetch((input, init) => {
				const url = String(input);
				if (url === "http://127.0.0.1:8080/models") {
					const headers = init?.headers as Headers | Record<string, string> | undefined;
					let authHeader: string | null = null;
					if (headers instanceof Headers) {
						authHeader = headers.get("Authorization");
					} else if (typeof headers === "object") {
						authHeader = headers.Authorization;
					}
					// When no API key, headers should be empty object or undefined
					expect(authHeader).toBeUndefined();
					return new Response(JSON.stringify({ data: [{ id: "llama-3.2:3b" }] }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				throw new Error(`Unexpected URL: ${url}`);
			});
			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			await registry.refresh();
			const state = registry.getProviderDiscoveryState("llama.cpp");
			if (state?.status !== "ok") {
				throw new Error(`Discovery failed with status ${state?.status}: ${state?.error}`);
			}
			const llamaModels = getModelsForProvider(registry, "llama.cpp");
			const apiKey = await registry.getApiKey(llamaModels[0]);
			expect(apiKey).toBe(kNoAuth);
		});
	});
});
