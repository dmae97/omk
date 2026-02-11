#!/usr/bin/env bun

import { join } from "node:path";
import { $env } from "@oh-my-pi/pi-utils";
import { CliAuthStorage } from "../src/storage";
import { getOAuthApiKey } from "../src/utils/oauth";
import type { Api, KnownProvider, Model } from "../src/types";

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
	// Kimi Code /models endpoint requires authentication
	// Use KIMI_API_KEY env var if available, otherwise return fallback models
	const apiKey = $env.KIMI_API_KEY;
	if (apiKey) {
		try {
			console.log("Fetching models from Kimi Code API...");
			const response = await fetch(`${KIMI_CODE_BASE_URL}/models`, {
				headers: { Authorization: `Bearer ${apiKey}` },
			});

			if (!response.ok) {
				console.warn(`Kimi Code API returned ${response.status}, using fallback models`);
				return getKimiCodeFallbackModels();
			}

			const data = await response.json();
			const items = Array.isArray(data.data) ? (data.data as KimiModelInfo[]) : [];
			const models: Model<"openai-completions">[] = [];

			for (const model of items) {
				if (!model.id) continue;

				// Derive capabilities from model info
				const hasThinking = model.supports_reasoning || model.id.toLowerCase().includes("thinking");
				const hasImage = model.supports_image_in || model.id.toLowerCase().includes("k2.5");

				const input: ("text" | "image")[] = ["text"];
				if (hasImage) input.push("image");

				// Use display_name if available, otherwise format from model ID
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

			// The /models endpoint only returns "kimi-for-coding" but the API
			// accepts other model IDs too — merge in fallback models not returned by the API
			const fetchedIds = new Set(models.map((m) => m.id));
			const fallbacks = getKimiCodeFallbackModels();
			for (const fb of fallbacks) {
				if (!fetchedIds.has(fb.id)) {
					models.push(fb);
				}
			}
			console.log(`Fetched ${fetchedIds.size} models from Kimi Code API, ${models.length} total with fallbacks`);
			return models;
		} catch (error) {
			console.error("Failed to fetch Kimi Code models:", error);
			return getKimiCodeFallbackModels();
		}
	}

	console.log("KIMI_API_KEY not set, using fallback Kimi Code models");
	return getKimiCodeFallbackModels();
}

function getKimiCodeFallbackModels(): Model<"openai-completions">[] {
	// Kimi Code models - the /models endpoint returns "kimi-for-coding" but the API
	// accepts various model IDs. "kimi-for-coding" is an alias powered by kimi-k2.5.
	const CONTEXT = 262144;
	const MAX_TOKENS = KIMI_CODE_DEFAULT_MAX_TOKENS;
	const compat = {
		thinkingFormat: "zai" as const,
		reasoningContentField: "reasoning_content" as const,
		supportsDeveloperRole: false,
	};
	const headers = { ...KIMI_CODE_HEADERS };

	return [
		{
			id: "kimi-for-coding",
			name: "Kimi For Coding",
			api: "openai-completions",
			provider: "kimi-code",
			baseUrl: KIMI_CODE_BASE_URL,
			headers,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: CONTEXT,
			maxTokens: MAX_TOKENS,
			compat,
		},
		{
			id: "kimi-k2.5",
			name: "Kimi K2.5",
			api: "openai-completions",
			provider: "kimi-code",
			baseUrl: KIMI_CODE_BASE_URL,
			headers,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: CONTEXT,
			maxTokens: MAX_TOKENS,
			compat,
		},
		{
			id: "kimi-k2-turbo-preview",
			name: "Kimi K2 Turbo Preview",
			api: "openai-completions",
			provider: "kimi-code",
			baseUrl: KIMI_CODE_BASE_URL,
			headers,
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: CONTEXT,
			maxTokens: MAX_TOKENS,
			compat,
		},
		{
			id: "kimi-k2",
			name: "Kimi K2",
			api: "openai-completions",
			provider: "kimi-code",
			baseUrl: KIMI_CODE_BASE_URL,
			headers,
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: CONTEXT,
			maxTokens: MAX_TOKENS,
			compat,
		},
	];
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
				if (
					modelId.startsWith("anthropic.claude-haiku-4-5") ||
					modelId.startsWith("anthropic.claude-sonnet-4-5") ||
					modelId.startsWith("anthropic.claude-opus-4-5")
				) {
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
					api: "openai-completions",
					provider: "zai",
					baseUrl: "https://api.z.ai/api/coding/paas/v4",
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

				// gpt-5 models require responses API, others use completions
				const needsResponsesApi = modelId.startsWith("gpt-5") || modelId.startsWith("oswe");

				const copilotModel: Model = {
					id: modelId,
					name: m.name || modelId,
					api: needsResponsesApi ? "openai-responses" : "openai-completions",
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
					...(needsResponsesApi
						? {}
						: {
								compat: {
									supportsStore: false,
									supportsDeveloperRole: false,
									supportsReasoningEffort: false,
								},
							}),
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

		console.log(`Loaded ${models.length} tool-capable models from models.dev`);
		return models;
	} catch (error) {
		console.error("Failed to load models.dev data:", error);
		return [];
	}
}

const ANTIGRAVITY_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";

interface AntigravityApiModel {
	displayName?: string;
	supportsImages?: boolean;
	supportsThinking?: boolean;
	thinkingBudget?: number;
	recommended?: boolean;
	maxTokens?: number;
	maxOutputTokens?: number;
	model?: string;
	apiProvider?: string;
	modelProvider?: string;
	isInternal?: boolean;
	supportsVideo?: boolean;
}

interface AntigravityApiResponse {
	models: Record<string, AntigravityApiModel>;
	agentModelSorts?: Array<{
		groups?: Array<{ modelIds?: string[] }>;
	}>;
}

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
 * Fetch available Antigravity models from the API.
 * Falls back to hardcoded models if no auth is available.
 */
async function fetchAntigravityModels(): Promise<Model<"google-gemini-cli">[]> {
	const auth = await getAntigravityToken();
	if (auth) {
		try {
			console.log("Fetching models from Antigravity API...");
			const response = await fetch(`${ANTIGRAVITY_ENDPOINT}/v1internal:fetchAvailableModels`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${auth.token}`,
					"Content-Type": "application/json",
					"User-Agent": "antigravity/1.107.0 linux/amd64",
				},
				body: JSON.stringify({ project: "" }),
			});

			if (!response.ok) {
				console.warn(`Antigravity API returned ${response.status}, using fallback models`);
				return getAntigravityFallbackModels();
			}

			const data = (await response.json()) as AntigravityApiResponse;

			// Collect recommended agent model IDs
			const recommendedIds = new Set<string>();
			for (const sort of data.agentModelSorts ?? []) {
				for (const group of sort.groups ?? []) {
					for (const id of group.modelIds ?? []) {
						recommendedIds.add(id);
					}
				}
			}

			const models: Model<"google-gemini-cli">[] = [];
			for (const [modelId, m] of Object.entries(data.models)) {
				// Skip internal/non-recommended models (tab completion, embeddings, etc.)
				if (m.isInternal) continue;
				if (!m.recommended && !recommendedIds.has(modelId)) continue;

				const supportsImages = m.supportsImages === true;
				const reasoning = m.supportsThinking === true;

				models.push({
					id: modelId,
					name: m.displayName ? `${m.displayName} (Antigravity)` : modelId,
					api: "google-gemini-cli",
					provider: "google-antigravity",
					baseUrl: ANTIGRAVITY_ENDPOINT,
					reasoning,
					input: supportsImages ? ["text", "image"] : ["text"],
					// Antigravity is free (quota-based), costs are for tracking only
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: m.maxTokens || 200000,
					maxTokens: m.maxOutputTokens || 64000,
				});
			}

			console.log(`Fetched ${models.length} models from Antigravity API`);
			return models;
		} catch (error) {
			console.error("Failed to fetch Antigravity models:", error);
			return getAntigravityFallbackModels();
		} finally {
			auth.storage.close();
		}
	}

	console.log("No Antigravity credentials found, using fallback models");
	return getAntigravityFallbackModels();
}

function getAntigravityFallbackModels(): Model<"google-gemini-cli">[] {
	return [
		{
			id: "gemini-3-pro-high",
			name: "Gemini 3 Pro High (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
		{
			id: "gemini-3-pro-low",
			name: "Gemini 3 Pro Low (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
		{
			id: "gemini-3-flash",
			name: "Gemini 3 Flash (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		{
			id: "claude-sonnet-4-5",
			name: "Claude Sonnet 4.5 (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: "claude-sonnet-4-5-thinking",
			name: "Claude Sonnet 4.5 Thinking (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: "claude-opus-4-5-thinking",
			name: "Claude Opus 4.5 Thinking (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: "claude-opus-4-6-thinking",
			name: "Claude Opus 4.6 Thinking (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: "gpt-oss-120b-medium",
			name: "GPT-OSS 120B Medium (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 131072,
			maxTokens: 32768,
		},
		{
			id: "gemini-2.5-pro",
			name: "Gemini 2.5 Pro (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
		{
			id: "gemini-2.5-flash",
			name: "Gemini 2.5 Flash (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
		{
			id: "gemini-2.5-flash-thinking",
			name: "Gemini 2.5 Flash Thinking (Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: ANTIGRAVITY_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
	];
}

async function generateModels() {
	// Fetch models from both sources
	// models.dev: Anthropic, Google, OpenAI, Groq, Cerebras
	// OpenRouter: xAI and other providers (excluding Anthropic, Google, OpenAI)
	// AI Gateway: OpenAI-compatible catalog with tool-capable models
	const modelsDevModels = await loadModelsDevData();
	const openRouterModels = await fetchOpenRouterModels();
	const aiGatewayModels = await fetchAiGatewayModels();
	const kimiCodeModels = await fetchKimiCodeModels();

	// Combine models (models.dev has priority)
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
		// Opus 4.6 1M context is API-only; all providers should use 200K
		if (candidate.id.includes("opus-4-6") || candidate.id.includes("opus-4.6")) {
			candidate.contextWindow = 200000;
		}
		// opencode lists Claude Sonnet 4/4.5 with 1M context, actual limit is 200K
		if (candidate.provider === "opencode" && (candidate.id === "claude-sonnet-4-5" || candidate.id === "claude-sonnet-4")) {
			candidate.contextWindow = 200000;
		}
	}

	// Add missing gpt models
	if (!allModels.some((m) => m.provider === "openai" && m.id === "gpt-5-chat-latest")) {
		allModels.push({
			id: "gpt-5-chat-latest",
			name: "GPT-5 Chat Latest",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			provider: "openai",
			reasoning: false,
			input: ["text", "image"],
			cost: {
				input: 1.25,
				output: 10,
				cacheRead: 0.125,
				cacheWrite: 0,
			},
			contextWindow: 128000,
			maxTokens: 16384,
		});
	}

	if (!allModels.some((m) => m.provider === "openai" && m.id === "gpt-5.1-codex")) {
		allModels.push({
			id: "gpt-5.1-codex",
			name: "GPT-5.1 Codex",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			provider: "openai",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 1.25,
				output: 5,
				cacheRead: 0.125,
				cacheWrite: 1.25,
			},
			contextWindow: 400000,
			maxTokens: 128000,
		});
	}

	if (!allModels.some((m) => m.provider === "openai" && m.id === "gpt-5.1-codex-max")) {
		allModels.push({
			id: "gpt-5.1-codex-max",
			name: "GPT-5.1 Codex Max",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			provider: "openai",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 1.25,
				output: 10,
				cacheRead: 0.125,
				cacheWrite: 0,
			},
			contextWindow: 400000,
			maxTokens: 128000,
		});
	}

	// OpenAI Codex (ChatGPT OAuth) models
	// NOTE: These are not fetched from models.dev; we keep a small, explicit list to avoid aliases.
	// Context window is based on observed server limits (400s above ~272k), not marketing numbers.
	const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
	const CODEX_CONTEXT = 272000;
	const CODEX_MAX_TOKENS = 128000;
	const codexModels: Model<"openai-codex-responses">[] = [
		{
			id: "gpt-5.1",
			name: "GPT-5.1",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: CODEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
			contextWindow: CODEX_CONTEXT,
			maxTokens: CODEX_MAX_TOKENS,
		},
		{
			id: "gpt-5.1-codex-max",
			name: "GPT-5.1 Codex Max",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: CODEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
			contextWindow: CODEX_CONTEXT,
			maxTokens: CODEX_MAX_TOKENS,
		},
		{
			id: "gpt-5.1-codex-mini",
			name: "GPT-5.1 Codex Mini",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: CODEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
			contextWindow: CODEX_CONTEXT,
			maxTokens: CODEX_MAX_TOKENS,
		},
		{
			id: "gpt-5.2",
			name: "GPT-5.2",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: CODEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
			contextWindow: CODEX_CONTEXT,
			maxTokens: CODEX_MAX_TOKENS,
		},
		{
			id: "gpt-5.2-codex",
			name: "GPT-5.2 Codex",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: CODEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
			contextWindow: CODEX_CONTEXT,
			maxTokens: CODEX_MAX_TOKENS,
		},
		{
			id: "gpt-5.3-codex",
			name: "GPT-5.3 Codex",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: CODEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: CODEX_MAX_TOKENS,
		},
	];
	allModels.push(...codexModels);


	// Add missing Grok models
	if (!allModels.some((m) => m.provider === "xai" && m.id === "grok-code-fast-1")) {
		allModels.push({
			id: "grok-code-fast-1",
			name: "Grok Code Fast 1",
			api: "openai-completions",
			baseUrl: "https://api.x.ai/v1",
			provider: "xai",
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0.2,
				output: 1.5,
				cacheRead: 0.02,
				cacheWrite: 0,
			},
			contextWindow: 32768,
			maxTokens: 8192,
		});
	}

	// Add "auto" alias for openrouter/auto
	if (!allModels.some((m) => m.provider === "openrouter" && m.id === "auto")) {
		allModels.push({
			id: "auto",
			name: "Auto",
			api: "openai-completions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				// we dont know about the costs because OpenRouter auto routes to different models
				// and then charges you for the underlying used model
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 2000000,
			maxTokens: 30000,
		});
	}

	// MiniMax Coding Plan fallback models
	// These are subscription-based plans with separate API keys
	// International endpoint: https://api.minimax.io/v1
	// China endpoint: https://api.minimaxi.com/v1
	const minimaxCodeFallbackModels: Model<"openai-completions">[] = [
		{
			id: "MiniMax-M2.1",
			name: "MiniMax M2.1 (Coding Plan)",
			api: "openai-completions",
			provider: "minimax-code",
			baseUrl: "https://api.minimax.io/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			compat: {
				supportsDeveloperRole: false,
				thinkingFormat: "zai",
				reasoningContentField: "reasoning_content",
			},
			contextWindow: 1000000,
			maxTokens: 32000,
		},
		{
			id: "MiniMax-M2.1-lightning",
			name: "MiniMax M2.1 Lightning (Coding Plan)",
			api: "openai-completions",
			provider: "minimax-code",
			baseUrl: "https://api.minimax.io/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			compat: {
				supportsDeveloperRole: false,
				thinkingFormat: "zai",
				reasoningContentField: "reasoning_content",
			},
			contextWindow: 1000000,
			maxTokens: 32000,
		},
	];

	// Only add fallback models if not already present from API
	for (const model of minimaxCodeFallbackModels) {
		if (!allModels.some((m) => m.provider === model.provider && m.id === model.id)) {
			allModels.push(model);
		}
	}

	// China variants
	const minimaxCodeCnFallbackModels: Model<"openai-completions">[] = [
		{
			id: "MiniMax-M2.1",
			name: "MiniMax M2.1 (Coding Plan CN)",
			api: "openai-completions",
			provider: "minimax-code-cn",
			baseUrl: "https://api.minimaxi.com/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			compat: {
				supportsDeveloperRole: false,
				thinkingFormat: "zai",
				reasoningContentField: "reasoning_content",
			},
			contextWindow: 1000000,
			maxTokens: 32000,
		},
		{
			id: "MiniMax-M2.1-lightning",
			name: "MiniMax M2.1 Lightning (Coding Plan CN)",
			api: "openai-completions",
			provider: "minimax-code-cn",
			baseUrl: "https://api.minimaxi.com/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			compat: {
				supportsDeveloperRole: false,
				thinkingFormat: "zai",
				reasoningContentField: "reasoning_content",
			},
			contextWindow: 1000000,
			maxTokens: 32000,
		},
	];

	for (const model of minimaxCodeCnFallbackModels) {
		if (!allModels.some((m) => m.provider === model.provider && m.id === model.id)) {
			allModels.push(model);
		}
	}

	// Google Cloud Code Assist models (Gemini CLI)
	// Uses production endpoint, standard Gemini models only
	const CLOUD_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
	const cloudCodeAssistModels: Model<"google-gemini-cli">[] = [
		{
			id: "gemini-2.5-pro",
			name: "Gemini 2.5 Pro (Cloud Code Assist)",
			api: "google-gemini-cli",
			provider: "google-gemini-cli",
			baseUrl: CLOUD_CODE_ASSIST_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
		{
			id: "gemini-2.5-flash",
			name: "Gemini 2.5 Flash (Cloud Code Assist)",
			api: "google-gemini-cli",
			provider: "google-gemini-cli",
			baseUrl: CLOUD_CODE_ASSIST_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
		{
			id: "gemini-2.0-flash",
			name: "Gemini 2.0 Flash (Cloud Code Assist)",
			api: "google-gemini-cli",
			provider: "google-gemini-cli",
			baseUrl: CLOUD_CODE_ASSIST_ENDPOINT,
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 8192,
		},
		{
			id: "gemini-3-pro-preview",
			name: "Gemini 3 Pro Preview (Cloud Code Assist)",
			api: "google-gemini-cli",
			provider: "google-gemini-cli",
			baseUrl: CLOUD_CODE_ASSIST_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
		{
			id: "gemini-3-flash-preview",
			name: "Gemini 3 Flash Preview (Cloud Code Assist)",
			api: "google-gemini-cli",
			provider: "google-gemini-cli",
			baseUrl: CLOUD_CODE_ASSIST_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
	];
	allModels.push(...cloudCodeAssistModels);

	// Antigravity models (Gemini 3, Claude, GPT-OSS via Google Cloud)
	// Fetched from API if credentials available, otherwise uses hardcoded fallback
	const antigravityModels = await fetchAntigravityModels();
	allModels.push(...antigravityModels);

	const VERTEX_BASE_URL = "https://{location}-aiplatform.googleapis.com";
	const vertexModels: Model<"google-vertex">[] = [
		{
			id: "gemini-3-pro-preview",
			name: "Gemini 3 Pro Preview (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 64000,
		},
		{
			id: "gemini-3-flash-preview",
			name: "Gemini 3 Flash Preview (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		{
			id: "gemini-2.0-flash",
			name: "Gemini 2.0 Flash (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 8192,
		},
		{
			id: "gemini-2.0-flash-lite",
			name: "Gemini 2.0 Flash Lite (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		{
			id: "gemini-2.5-pro",
			name: "Gemini 2.5 Pro (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		{
			id: "gemini-2.5-flash",
			name: "Gemini 2.5 Flash (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		{
			id: "gemini-2.5-flash-lite-preview-09-2025",
			name: "Gemini 2.5 Flash Lite Preview 09-25 (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		{
			id: "gemini-2.5-flash-lite",
			name: "Gemini 2.5 Flash Lite (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		{
			id: "gemini-1.5-pro",
			name: "Gemini 1.5 Pro (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 1.25, output: 5, cacheRead: 0.3125, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 8192,
		},
		{
			id: "gemini-1.5-flash",
			name: "Gemini 1.5 Flash (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 8192,
		},
		{
			id: "gemini-1.5-flash-8b",
			name: "Gemini 1.5 Flash-8B (Vertex)",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: VERTEX_BASE_URL,
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0.0375, output: 0.15, cacheRead: 0.01, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 8192,
		},
	];
	allModels.push(...vertexModels);

	// Cursor Agent models (subscription-based, costs are 0)
	// Model IDs fetched from GetUsableModels RPC
	const CURSOR_BASE_URL = "https://api2.cursor.sh";
	const cursorModels: Model<"cursor-agent">[] = [
		{
			id: "default",
			name: "Auto (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: "claude-4.5-sonnet",
			name: "Claude 4.5 Sonnet (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: "claude-4.5-sonnet-thinking",
			name: "Claude 4.5 Sonnet Thinking (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: "claude-4.5-opus-high",
			name: "Claude 4.5 Opus (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: "claude-4.5-opus-high-thinking",
			name: "Claude 4.5 Opus Thinking (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: "gpt-5.1-codex-max",
			name: "GPT-5.1 Codex Max (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		},
		{
			id: "gpt-5.1-codex-max-high",
			name: "GPT-5.1 Codex Max High (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		},
		{
			id: "gpt-5.2",
			name: "GPT-5.2 (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		},
		{
			id: "gpt-5.2-high",
			name: "GPT-5.2 High (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		},
		{
			id: "gemini-3-pro",
			name: "Gemini 3 Pro (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
		{
			id: "gemini-3-flash",
			name: "Gemini 3 Flash (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 65535,
		},
		{
			id: "grok-code-fast-1",
			name: "Grok (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32768,
			maxTokens: 8192,
		},
		{
			id: "composer-1",
			name: "Composer 1 (Cursor)",
			api: "cursor-agent",
			provider: "cursor",
			baseUrl: CURSOR_BASE_URL,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 64000,
		},
	];
	allModels.push(...cursorModels);

	// Group by provider and deduplicate by model ID
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
