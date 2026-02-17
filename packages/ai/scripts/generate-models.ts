#!/usr/bin/env bun

import { join } from "node:path";
import { $env } from "@oh-my-pi/pi-utils";
import { CliAuthStorage } from "../src/storage";
import { getOAuthApiKey } from "../src/utils/oauth";
import { fetchAntigravityDiscoveryModels } from "../src/utils/discovery/antigravity";
import { fetchCodexModels } from "../src/utils/discovery/codex";
import { fetchCursorUsableModels } from "../src/utils/discovery/cursor";
import { JWT_CLAIM_PATH } from "../src/providers/openai-codex/constants";
import type { Api, KnownProvider, Model } from "../src/types";
import prevModelsJson from "../src/models.json" with { type: "json" };

const packageRoot = join(import.meta.dir, "..");

interface ModelsDevModel {
	id: string;
	name: string;
	tool_call?: boolean;
	reasoning?: boolean;
	limit?: {
		context?: number;
		output?: number;
	};
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	modalities?: {
		input?: string[];
	};
	provider?: {
		npm?: string;
	};
}

interface AiGatewayModel {
	id: string;
	name?: string;
	context_window?: number;
	max_tokens?: number;
	tags?: string[];
	pricing?: {
		input?: string | number;
		output?: string | number;
		input_cache_read?: string | number;
		input_cache_write?: string | number;
	};
}

const COPILOT_STATIC_HEADERS = {
	"User-Agent": "GitHubCopilotChat/0.35.0",
	"Editor-Version": "vscode/1.107.0",
	"Editor-Plugin-Version": "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "vscode-chat",
} as const;

const AI_GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1";
const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

async function fetchOpenRouterModels(): Promise<Model[]> {
	try {
		console.log("Fetching models from OpenRouter API...");
		const response = await fetch("https://openrouter.ai/api/v1/models");
		const data = await response.json();

		const models: Model[] = [];

		for (const model of data.data) {
			// Only include models that support tools
			if (!model.supported_parameters?.includes("tools")) continue;

			// Parse provider from model ID
			let provider: KnownProvider = "openrouter";
			let modelKey = model.id;

			modelKey = model.id; // Keep full ID for OpenRouter

			// Parse input modalities
			const input: ("text" | "image")[] = ["text"];
			if (model.architecture?.modality?.includes("image")) {
				input.push("image");
			}

			// Convert pricing from $/token to $/million tokens
			const inputCost = parseFloat(model.pricing?.prompt || "0") * 1_000_000;
			const outputCost = parseFloat(model.pricing?.completion || "0") * 1_000_000;
			const cacheReadCost = parseFloat(model.pricing?.input_cache_read || "0") * 1_000_000;
			const cacheWriteCost = parseFloat(model.pricing?.input_cache_write || "0") * 1_000_000;
			// Check if model supports tool_choice parameter
			const supportsToolChoice = model.supported_parameters?.includes("tool_choice") ?? false;

			const normalizedModel: Model = {
				id: modelKey,
				name: model.name,
				api: "openai-completions",
				baseUrl: "https://openrouter.ai/api/v1",
				provider,
				reasoning: model.supported_parameters?.includes("reasoning") || false,
				input,
				cost: {
					input: inputCost,
					output: outputCost,
					cacheRead: cacheReadCost,
					cacheWrite: cacheWriteCost,
				},
				contextWindow: model.context_length || 4096,
				maxTokens: model.top_provider?.max_completion_tokens || 4096,
				// Only add compat if tool_choice is not supported (default is true)
				...(supportsToolChoice ? {} : { compat: { supportsToolChoice: false } }),
			};
			models.push(normalizedModel);
		}

		models.sort((a, b) => a.id.localeCompare(b.id));
		console.log(`Fetched ${models.length} tool-capable models from OpenRouter`);
		return models;
	} catch (error) {
		console.error("Failed to fetch OpenRouter models:", error);
		return [];
	}
}

async function fetchAiGatewayModels(): Promise<Model[]> {
	try {
		console.log("Fetching models from Vercel AI Gateway API...");
		const response = await fetch(`${AI_GATEWAY_MODELS_URL}/models`);
		const data = await response.json();
		const models: Model[] = [];

		const toNumber = (value: string | number | undefined): number => {
			if (typeof value === "number") {
				return Number.isFinite(value) ? value : 0;
			}
			const parsed = parseFloat(value ?? "0");
			return Number.isFinite(parsed) ? parsed : 0;
		};

		const items = Array.isArray(data.data) ? (data.data as AiGatewayModel[]) : [];
		for (const model of items) {
			const tags = Array.isArray(model.tags) ? model.tags : [];
			// Only include models that support tools
			if (!tags.includes("tool-use")) continue;

			const input: ("text" | "image")[] = ["text"];
			if (tags.includes("vision")) {
				input.push("image");
			}

			const inputCost = toNumber(model.pricing?.input) * 1_000_000;
			const outputCost = toNumber(model.pricing?.output) * 1_000_000;
			const cacheReadCost = toNumber(model.pricing?.input_cache_read) * 1_000_000;
			const cacheWriteCost = toNumber(model.pricing?.input_cache_write) * 1_000_000;

			models.push({
				id: model.id,
				name: model.name || model.id,
				api: "anthropic-messages",
				baseUrl: AI_GATEWAY_BASE_URL,
				provider: "vercel-ai-gateway",
				reasoning: tags.includes("reasoning"),
				input,
				cost: {
					input: inputCost,
					output: outputCost,
					cacheRead: cacheReadCost,
					cacheWrite: cacheWriteCost,
				},
				contextWindow: model.context_window || 4096,
				maxTokens: model.max_tokens || 4096,
			});
		}

		models.sort((a, b) => a.id.localeCompare(b.id));
		console.log(`Fetched ${models.length} tool-capable models from Vercel AI Gateway`);
		return models;
	} catch (error) {
		console.error("Failed to fetch Vercel AI Gateway models:", error);
		return [];
	}
}

const KIMI_CODE_BASE_URL = "https://api.kimi.com/coding/v1";
const KIMI_CODE_DEFAULT_MAX_TOKENS = 32000;
const KIMI_CODE_HEADERS = {
	"User-Agent": "KimiCLI/1.0",
	"X-Msh-Platform": "kimi_cli",
} as const;

interface KimiModelInfo {
	id: string;
	display_name?: string;
	context_length?: number;
	supports_reasoning?: boolean;
	supports_image_in?: boolean;
	supports_video_in?: boolean;
}


async function fetchKimiCodeModels(): Promise<Model<"openai-completions">[]> {
	const apiKey = $env.KIMI_API_KEY;
	if (!apiKey) {
		console.log("KIMI_API_KEY not set, will use previous models");
		return [];
	}

	try {
		console.log("Fetching models from Kimi Code API...");
		const response = await fetch(`${KIMI_CODE_BASE_URL}/models`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});

		if (!response.ok) {
			console.warn(`Kimi Code API returned ${response.status}, will use previous models`);
			return [];
		}

		const data = await response.json();
		const items = Array.isArray(data.data) ? (data.data as KimiModelInfo[]) : [];
		const models: Model<"openai-completions">[] = [];

		for (const model of items) {
			if (!model.id) continue;

			const hasThinking = model.supports_reasoning || model.id.toLowerCase().includes("thinking");
			const hasImage = model.supports_image_in || model.id.toLowerCase().includes("k2.5");

			const input: ("text" | "image")[] = ["text"];
			if (hasImage) input.push("image");

			const name =
				model.display_name ||
				model.id
					.split("-")
					.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
					.join(" ");

			models.push({
				id: model.id,
				name,
				api: "openai-completions",
				provider: "kimi-code",
				baseUrl: KIMI_CODE_BASE_URL,
				headers: { ...KIMI_CODE_HEADERS },
				reasoning: hasThinking,
				input,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: model.context_length || 262144,
				maxTokens: KIMI_CODE_DEFAULT_MAX_TOKENS,
				compat: {
					thinkingFormat: "zai",
					reasoningContentField: "reasoning_content",
					supportsDeveloperRole: false,
				},
			});
		}

		models.sort((a, b) => a.id.localeCompare(b.id));
		console.log(`Fetched ${models.length} models from Kimi Code API`);
		return models;
	} catch (error) {
		console.error("Failed to fetch Kimi Code models:", error);
		return [];
	}
}

async function loadModelsDevData(): Promise<Model[]> {
	try {
		console.log("Fetching models from models.dev API...");
		const response = await fetch("https://models.dev/api.json");
		const data = await response.json();

		const models: Model[] = [];

		// Process Amazon Bedrock models
		if (data["amazon-bedrock"]?.models) {
			for (const [modelId, model] of Object.entries(data["amazon-bedrock"].models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				let id = modelId;

				if (id.startsWith("ai21.jamba")) {
					// These models doesn't support tool use in streaming mode
					continue;
				}

				if (id.startsWith("amazon.titan-text-express") || id.startsWith("mistral.mistral-7b-instruct-v0")) {
					// These models doesn't support system messages
					continue;
				}

				// Some Amazon Bedrock models require cross-region inference profiles to work.
				// To use cross-region inference, we need to add a region prefix to the models.
				// See https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html#inference-profiles-support-system
				// TODO: Remove Claude models once https://github.com/anomalyco/models.dev/pull/607 is merged, and follow-up with other models.

				// Models with global cross-region inference profiles
				if (
					id.startsWith("anthropic.claude-haiku-4-5") ||
					id.startsWith("anthropic.claude-sonnet-4") ||
					id.startsWith("anthropic.claude-opus-4-5") ||
					id.startsWith("amazon.nova-2-lite") ||
					id.startsWith("cohere.embed-v4") ||
					id.startsWith("twelvelabs.pegasus-1-2")
				) {
					id = "global." + id;
				}

				// Models with US cross-region inference profiles
				if (
					id.startsWith("amazon.nova-lite") ||
					id.startsWith("amazon.nova-micro") ||
					id.startsWith("amazon.nova-premier") ||
					id.startsWith("amazon.nova-pro") ||
					id.startsWith("anthropic.claude-3-7-sonnet") ||
					id.startsWith("anthropic.claude-opus-4-1") ||
					id.startsWith("anthropic.claude-opus-4-20250514") ||
					id.startsWith("deepseek.r1") ||
					id.startsWith("meta.llama3-2") ||
					id.startsWith("meta.llama3-3") ||
					id.startsWith("meta.llama4")
				) {
					id = "us." + id;
				}

				const bedrockModel = {
					id,
					name: m.name || id,
					api: "bedrock-converse-stream" as const,
					provider: "amazon-bedrock" as const,
					baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
					reasoning: m.reasoning === true,
					input: (m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"]) as ("text" | "image")[],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				};
				models.push(bedrockModel);

				// Add EU cross-region inference variants for Claude models
				if (modelId.startsWith("anthropic.claude-")) {
					models.push({
						...bedrockModel,
						id: "eu." + modelId,
						name: (m.name || modelId) + " (EU)",
					});
				}
			}
		}

		// Process Anthropic models
		if (data.anthropic?.models) {
			for (const [modelId, model] of Object.entries(data.anthropic.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				// Skip deprecated Anthropic models (old naming convention)
				if (
					modelId.startsWith("claude-3-5-haiku") ||
					modelId.startsWith("claude-3-7-sonnet") ||
					modelId === "claude-3-opus-20240229" ||
					modelId === "claude-3-sonnet-20240229"
				) {
					continue;
				}

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "anthropic-messages",
					provider: "anthropic",
					baseUrl: "https://api.anthropic.com",
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		// Process Google models
		if (data.google?.models) {
			for (const [modelId, model] of Object.entries(data.google.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "google-generative-ai",
					provider: "google",
					baseUrl: "https://generativelanguage.googleapis.com/v1beta",
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		// Process OpenAI models
		if (data.openai?.models) {
			for (const [modelId, model] of Object.entries(data.openai.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "openai-responses",
					provider: "openai",
					baseUrl: "https://api.openai.com/v1",
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		// Process Groq models
		if (data.groq?.models) {
			for (const [modelId, model] of Object.entries(data.groq.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "openai-completions",
					provider: "groq",
					baseUrl: "https://api.groq.com/openai/v1",
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		// Process Cerebras models
		if (data.cerebras?.models) {
			for (const [modelId, model] of Object.entries(data.cerebras.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "openai-completions",
					provider: "cerebras",
					baseUrl: "https://api.cerebras.ai/v1",
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		// Process xAi models
		if (data.xai?.models) {
			for (const [modelId, model] of Object.entries(data.xai.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "openai-completions",
					provider: "xai",
					baseUrl: "https://api.x.ai/v1",
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		// Process zAi models
		if (data["zai-coding-plan"]?.models) {
			for (const [modelId, model] of Object.entries(data["zai-coding-plan"].models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;
				const supportsImage = m.modalities?.input?.includes("image");

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "anthropic-messages",
					provider: "zai",
					baseUrl: "https://api.z.ai/api/anthropic",
					reasoning: m.reasoning === true,
					input: supportsImage ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		// Process MiniMax Coding Plan models

		// Process MiniMax Coding Plan models
		// MiniMax Coding Plan uses OpenAI-compatible API with separate API key
		const minimaxCodeVariants = [
			{ key: "minimax-coding-plan", provider: "minimax-code", baseUrl: "https://api.minimax.io/v1" },
			{ key: "minimax-cn-coding-plan", provider: "minimax-code-cn", baseUrl: "https://api.minimaxi.com/v1" },
		] as const;

		for (const { key, provider, baseUrl } of minimaxCodeVariants) {
			if (data[key]?.models) {
				for (const [modelId, model] of Object.entries(data[key].models)) {
					const m = model as ModelsDevModel;
					if (m.tool_call !== true) continue;
					const supportsImage = m.modalities?.input?.includes("image");

					models.push({
						id: modelId,
						name: m.name || modelId,
						api: "openai-completions",
						provider,
						baseUrl,
						reasoning: m.reasoning === true,
						input: supportsImage ? ["text", "image"] : ["text"],
						cost: {
							input: m.cost?.input || 0,
							output: m.cost?.output || 0,
							cacheRead: m.cost?.cache_read || 0,
							cacheWrite: m.cost?.cache_write || 0,
						},
						compat: {
							supportsDeveloperRole: false,
							thinkingFormat: "zai",
							reasoningContentField: "reasoning_content",
						},
						contextWindow: m.limit?.context || 4096,
						maxTokens: m.limit?.output || 4096,
					});
				}
			}
		}

		// Process Mistral models
		if (data.mistral?.models) {
			for (const [modelId, model] of Object.entries(data.mistral.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "openai-completions",
					provider: "mistral",
					baseUrl: "https://api.mistral.ai/v1",
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		// Process OpenCode Zen models
		// API mapping based on provider.npm field:
		// - @ai-sdk/openai → openai-responses
		// - @ai-sdk/anthropic → anthropic-messages
		// - @ai-sdk/google → google-generative-ai
		// - null/undefined/@ai-sdk/openai-compatible → openai-completions
		if (data.opencode?.models) {
			for (const [modelId, model] of Object.entries(data.opencode.models)) {
				const m = model as ModelsDevModel & { status?: string };
				if (m.tool_call !== true) continue;
				if (m.status === "deprecated") continue;

				const npm = m.provider?.npm;
				let api: Api;
				let baseUrl: string;

				if (npm === "@ai-sdk/openai") {
					api = "openai-responses";
					baseUrl = "https://opencode.ai/zen/v1";
				} else if (npm === "@ai-sdk/anthropic") {
					api = "anthropic-messages";
					// Anthropic SDK appends /v1/messages to baseURL
					baseUrl = "https://opencode.ai/zen";
				} else if (npm === "@ai-sdk/google") {
					api = "google-generative-ai";
					baseUrl = "https://opencode.ai/zen/v1";
				} else {
					// null, undefined, or @ai-sdk/openai-compatible
					api = "openai-completions";
					baseUrl = "https://opencode.ai/zen/v1";
				}

				models.push({
					id: modelId,
					name: m.name || modelId,
					api,
					provider: "opencode",
					baseUrl,
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		// Process GitHub Copilot models
		if (data["github-copilot"]?.models) {
			for (const [modelId, model] of Object.entries(data["github-copilot"].models)) {
				const m = model as ModelsDevModel & { status?: string };
				if (m.tool_call !== true) continue;
				if (m.status === "deprecated") continue;

				// Claude 4.x models route to Anthropic Messages API
				const isCopilotClaude4 = /^claude-(haiku|sonnet|opus)-4([.\-]|$)/.test(modelId);
				// gpt-5 models require responses API, others use completions
				const needsResponsesApi = modelId.startsWith("gpt-5") || modelId.startsWith("oswe");
				const api: Api = isCopilotClaude4
					? "anthropic-messages"
					: needsResponsesApi
						? "openai-responses"
						: "openai-completions";

				const copilotModel: Model = {
					id: modelId,
					name: m.name || modelId,
					api,
					provider: "github-copilot",
					baseUrl: "https://api.individual.githubcopilot.com",
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 128000,
					maxTokens: m.limit?.output || 8192,
					headers: { ...COPILOT_STATIC_HEADERS },
					// compat only applies to openai-completions
					...(api === "openai-completions"
						? {
								compat: {
									supportsStore: false,
									supportsDeveloperRole: false,
									supportsReasoningEffort: false,
								},
							}
						: {}),
				};

				models.push(copilotModel);
			}
		}

		// Process MiniMax models
		const minimaxVariants = [
			{ key: "minimax", provider: "minimax", baseUrl: "https://api.minimax.io/anthropic" },
			{ key: "minimax-cn", provider: "minimax-cn", baseUrl: "https://api.minimaxi.com/anthropic" },
		] as const;

		for (const { key, provider, baseUrl } of minimaxVariants) {
			if (data[key]?.models) {
				for (const [modelId, model] of Object.entries(data[key].models)) {
					const m = model as ModelsDevModel;
					if (m.tool_call !== true) continue;

					models.push({
						id: modelId,
						name: m.name || modelId,
						api: "anthropic-messages",
						provider,
						// MiniMax's Anthropic-compatible API - SDK appends /v1/messages
						baseUrl,
						reasoning: m.reasoning === true,
						input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
						cost: {
							input: m.cost?.input || 0,
							output: m.cost?.output || 0,
							cacheRead: m.cost?.cache_read || 0,
							cacheWrite: m.cost?.cache_write || 0,
						},
						contextWindow: m.limit?.context || 4096,
						maxTokens: m.limit?.output || 4096,
					});
				}
			}
		}

		models.sort((a, b) => a.id.localeCompare(b.id));
		console.log(`Loaded ${models.length} tool-capable models from models.dev`);
		return models;
	} catch (error) {
		console.error("Failed to load models.dev data:", error);
		return [];
	}
}

const ANTIGRAVITY_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
/**
 * Try to get a fresh Antigravity access token from agent.db credentials.
 */
async function getAntigravityToken(): Promise<{ token: string; storage: CliAuthStorage } | null> {
	try {
		const storage = await CliAuthStorage.create();
		const creds = storage.getOAuth("google-antigravity");
		if (!creds) {
			storage.close();
			return null;
		}
		const result = await getOAuthApiKey("google-antigravity", { "google-antigravity": creds });
		if (!result) {
			storage.close();
			return null;
		}
		// Save refreshed credentials back
		storage.saveOAuth("google-antigravity", result.newCredentials);
		return { token: result.newCredentials.access, storage };
	} catch {
		return null;
	}
}

/**
 * Fetch available Antigravity models from the API using the discovery module.
 * Returns empty array if no auth is available (previous models used as fallback).
 */
async function fetchAntigravityModels(): Promise<Model<"google-gemini-cli">[]> {
	const auth = await getAntigravityToken();
	if (!auth) {
		console.log("No Antigravity credentials found, will use previous models");
		return [];
	}
	try {
		console.log("Fetching models from Antigravity API...");
		const discovered = await fetchAntigravityDiscoveryModels({
			token: auth.token,
			endpoint: ANTIGRAVITY_ENDPOINT,
		});
		if (discovered === null) {
			console.warn("Antigravity API fetch failed, will use previous models");
			return [];
		}
		if (discovered.length > 0) {
			console.log(`Fetched ${discovered.length} models from Antigravity API`);
			return discovered;
		}
		console.warn("Antigravity API returned no models, will use previous models");
		return [];
	} catch (error) {
		console.error("Failed to fetch Antigravity models:", error);
		return [];
	} finally {
		auth.storage.close();
	}
}

/**
 * Extract accountId from a Codex JWT access token.
 */
function extractCodexAccountId(accessToken: string): string | null {
	try {
		const parts = accessToken.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1] ?? "";
		const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
		const accountId = decoded?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
		return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
	} catch {
		return null;
	}
}

/**
 * Try to get Codex (ChatGPT) OAuth credentials from agent.db.
 */
async function getCodexCredentials(): Promise<{ accessToken: string; accountId?: string; storage: CliAuthStorage } | null> {
	try {
		const storage = await CliAuthStorage.create();
		const creds = storage.getOAuth("openai-codex");
		if (!creds) {
			storage.close();
			return null;
		}

		const result = await getOAuthApiKey("openai-codex", { "openai-codex": creds });
		if (!result) {
			storage.close();
			return null;
		}

		storage.saveOAuth("openai-codex", result.newCredentials);
		const accessToken = result.newCredentials.access;
		const accountId = result.newCredentials.accountId ?? extractCodexAccountId(accessToken);
		return {
			accessToken,
			accountId: accountId ?? undefined,
			storage,
		};
	} catch {
		return null;
	}
}

/**
 * Try to get Cursor API key from agent.db.
 */
async function getCursorApiKey(): Promise<{ apiKey: string; storage: CliAuthStorage } | null> {
	try {
		const storage = await CliAuthStorage.create();
		const creds = storage.getOAuth("cursor");
		if (!creds) {
			storage.close();
			return null;
		}

		const result = await getOAuthApiKey("cursor", { cursor: creds });
		if (!result) {
			storage.close();
			return null;
		}

		storage.saveOAuth("cursor", result.newCredentials);
		return { apiKey: result.newCredentials.access, storage };
	} catch {
		return null;
	}
}

async function generateModels() {
	// Fetch models from dynamic sources
	const modelsDevModels = await loadModelsDevData();
	const openRouterModels = await fetchOpenRouterModels();
	const aiGatewayModels = await fetchAiGatewayModels();
	const kimiCodeModels = await fetchKimiCodeModels();

	const allModels = [...modelsDevModels, ...openRouterModels, ...aiGatewayModels, ...kimiCodeModels];

	// Fix incorrect cache pricing for Claude Opus 4.5 from models.dev
	// models.dev has 3x the correct pricing (1.5/18.75 instead of 0.5/6.25)
	const opus45 = allModels.find((m) => m.provider === "anthropic" && m.id === "claude-opus-4-5");
	if (opus45) {
		opus45.cost.cacheRead = 0.5;
		opus45.cost.cacheWrite = 6.25;
	}

	// Temporary overrides until upstream model metadata is corrected.
	for (const candidate of allModels) {
		if (candidate.provider === "amazon-bedrock" && candidate.id.includes("anthropic.claude-opus-4-6-v1")) {
			candidate.cost.cacheRead = 0.5;
			candidate.cost.cacheWrite = 6.25;
		}
		// Opus 4.6 / Sonnet 4.6 1M context is beta; all providers should use 200K
		if (candidate.id.includes("opus-4-6") || candidate.id.includes("opus-4.6") || candidate.id.includes("sonnet-4-6") || candidate.id.includes("sonnet-4.6")) {
			candidate.contextWindow = 200000;
		}
		// opencode lists Claude Sonnet 4/4.5 with 1M context, actual limit is 200K
		if (candidate.provider === "opencode" && (candidate.id === "claude-sonnet-4-5" || candidate.id === "claude-sonnet-4")) {
			candidate.contextWindow = 200000;
		}
	}

	// Antigravity models (Gemini 3, Claude, GPT-OSS via Google Cloud)
	const antigravityModels = await fetchAntigravityModels();
	allModels.push(...antigravityModels);

	// OpenAI Codex (ChatGPT OAuth) models
	const codexAuth = await getCodexCredentials();
	if (codexAuth) {
		try {
			console.log("Fetching models from Codex API...");
			const codexDiscovery = await fetchCodexModels({
				accessToken: codexAuth.accessToken,
				accountId: codexAuth.accountId,
			});
			if (codexDiscovery === null) {
				console.warn("Codex API fetch failed");
			} else if (codexDiscovery.models.length > 0) {
				console.log(`Fetched ${codexDiscovery.models.length} models from Codex API`);
				allModels.push(...codexDiscovery.models);
			}
		} catch (error) {
			console.error("Failed to fetch Codex models:", error);
		} finally {
			codexAuth.storage.close();
		}
	}

	// Cursor Agent models
	const cursorAuth = await getCursorApiKey();
	if (cursorAuth) {
		try {
			console.log("Fetching models from Cursor API...");
			const discoveredCursor = await fetchCursorUsableModels({
				apiKey: cursorAuth.apiKey,
			});
			if (discoveredCursor === null) {
				console.warn("Cursor API fetch failed");
			} else if (discoveredCursor.length > 0) {
				console.log(`Fetched ${discoveredCursor.length} models from Cursor API`);
				allModels.push(...discoveredCursor);
			}
		} catch (error) {
			console.error("Failed to fetch Cursor models:", error);
		} finally {
			cursorAuth.storage.close();
		}
	}

	// Normalize Codex models to input-token window (272K). The 400K figure includes output budget.
	for (const candidate of allModels) {
		if (candidate.id.includes("codex") && !candidate.id.includes("codex-spark")) {
			candidate.contextWindow = 272000;
		}
	}

	for (const candidate of allModels) {
		if (!candidate.id.endsWith("-spark")) continue;
		const baseId = candidate.id.slice(0, -"-spark".length);
		const fallback = allModels.find(
			model => model.provider === candidate.provider && model.api === candidate.api && model.id === baseId,
		);
		if (!fallback) continue;
		candidate.contextPromotionTarget = `${fallback.provider}/${fallback.id}`;
	}

	// Merge previous models.json entries as fallback for any provider/model
	// not fetched dynamically. This replaces all hardcoded fallback lists —
	// static-only providers (vertex, gemini-cli), auth-gated providers when
	// credentials are unavailable, and ad-hoc model additions all persist
	// through the existing models.json seed.
	const fetchedKeys = new Set(allModels.map((m) => `${m.provider}/${m.id}`));
	for (const models of Object.values(prevModelsJson as Record<string, Record<string, Model>>)) {
		for (const model of Object.values(models)) {
			if (!fetchedKeys.has(`${model.provider}/${model.id}`)) {
				allModels.push(model);
			}
		}
	}

	// Group by provider and sort each provider's models
	const providers: Record<string, Record<string, Model>> = {};
	for (const model of allModels) {
		if (!providers[model.provider]) {
			providers[model.provider] = {};
		}
		// Use model ID as key to automatically deduplicate
		// Only add if not already present (models.dev takes priority over OpenRouter)
		if (!providers[model.provider][model.id]) {
			providers[model.provider][model.id] = model;
		}
	}

	// Sort models within each provider by ID
	for (const provider of Object.keys(providers)) {
		const models = Object.values(providers[provider]);
		models.sort((a, b) => a.id.localeCompare(b.id));
		// Rebuild the object with sorted keys
		providers[provider] = {};
		for (const model of models) {
			providers[provider][model.id] = model;
		}
	}

    // Generate JSON file
    const MODELS = providers;
    await Bun.write(join(packageRoot, "src/models.json"), JSON.stringify(MODELS, null, '\t'));
    console.log("Generated src/models.json");

	// Print statistics
	const totalModels = allModels.length;
	const reasoningModels = allModels.filter((m) => m.reasoning).length;

	console.log(`\nModel Statistics:`);
	console.log(`  Total tool-capable models: ${totalModels}`);
	console.log(`  Reasoning-capable models: ${reasoningModels}`);

	for (const [provider, models] of Object.entries(providers)) {
		console.log(`  ${provider}: ${Object.keys(models).length} models`);
	}
}

// Run the generator
generateModels().catch(console.error);
