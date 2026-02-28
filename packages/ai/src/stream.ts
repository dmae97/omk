import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { $env, $pickenv } from "@oh-my-pi/pi-utils";
import { getCustomApi } from "./api-registry";
import { supportsXhigh } from "./models";
import { type BedrockOptions, streamBedrock } from "./providers/amazon-bedrock";
import { type AnthropicOptions, streamAnthropic } from "./providers/anthropic";
import { streamAzureOpenAIResponses } from "./providers/azure-openai-responses";
import { type CursorOptions, streamCursor } from "./providers/cursor";
import { isGitLabDuoModel, streamGitLabDuo } from "./providers/gitlab-duo";
import { type GoogleOptions, streamGoogle } from "./providers/google";
import {
	type GoogleGeminiCliOptions,
	type GoogleThinkingLevel,
	streamGoogleGeminiCli,
} from "./providers/google-gemini-cli";
import { type GoogleVertexOptions, streamGoogleVertex } from "./providers/google-vertex";
import { isKimiModel, streamKimi } from "./providers/kimi";
import { streamOpenAICodexResponses } from "./providers/openai-codex-responses";
import { type OpenAICompletionsOptions, streamOpenAICompletions } from "./providers/openai-completions";
import { streamOpenAIResponses } from "./providers/openai-responses";
import { isSyntheticModel, streamSynthetic } from "./providers/synthetic";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	OptionsForApi,
	SimpleStreamOptions,
	StreamOptions,
	ThinkingBudgets,
	ThinkingLevel,
	ToolChoice,
} from "./types";

let cachedVertexAdcCredentialsExists: boolean | null = null;

function hasVertexAdcCredentials(): boolean {
	if (cachedVertexAdcCredentialsExists === null) {
		const gacPath = $env.GOOGLE_APPLICATION_CREDENTIALS;
		if (gacPath) {
			cachedVertexAdcCredentialsExists = fs.existsSync(gacPath);
		} else {
			cachedVertexAdcCredentialsExists = fs.existsSync(
				path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json"),
			);
		}
	}
	return cachedVertexAdcCredentialsExists;
}

type KeyResolver = string | (() => string | undefined);

const serviceProviderMap: Record<string, KeyResolver> = {
	openai: "OPENAI_API_KEY",
	google: "GEMINI_API_KEY",
	groq: "GROQ_API_KEY",
	cerebras: "CEREBRAS_API_KEY",
	xai: "XAI_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	kilo: "KILO_API_KEY",
	"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
	zai: "ZAI_API_KEY",
	mistral: "MISTRAL_API_KEY",
	minimax: "MINIMAX_API_KEY",
	"minimax-code": "MINIMAX_CODE_API_KEY",
	"minimax-code-cn": "MINIMAX_CODE_CN_API_KEY",
	opencode: "OPENCODE_API_KEY",
	cursor: "CURSOR_ACCESS_TOKEN",
	"azure-openai-responses": "AZURE_OPENAI_API_KEY",
	exa: "EXA_API_KEY",
	jina: "JINA_API_KEY",
	brave: "BRAVE_API_KEY",
	perplexity: "PERPLEXITY_API_KEY",
	// GitHub Copilot uses GitHub personal access token
	"github-copilot": () => $pickenv("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"),
	// ANTHROPIC_OAUTH_TOKEN takes precedence over ANTHROPIC_API_KEY
	anthropic: () => $pickenv("ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"),
	"gitlab-duo": "GITLAB_TOKEN",
	// Vertex AI uses Application Default Credentials, not API keys.
	// Auth is configured via `gcloud auth application-default login`.
	"google-vertex": () => {
		const hasCredentials = hasVertexAdcCredentials();
		const hasProject = !!($env.GOOGLE_CLOUD_PROJECT || $env.GCLOUD_PROJECT);
		const hasLocation = !!$env.GOOGLE_CLOUD_LOCATION;
		if (hasCredentials && hasProject && hasLocation) {
			return "<authenticated>";
		}
	},
	// Amazon Bedrock supports multiple credential sources:
	// 1. AWS_PROFILE - named profile from ~/.aws/credentials
	// 2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY - standard IAM keys
	// 3. AWS_BEARER_TOKEN_BEDROCK - Bedrock API keys (bearer token)
	// 4. AWS_CONTAINER_CREDENTIALS_* - ECS/Task IAM role credentials
	// 5. AWS_WEB_IDENTITY_TOKEN_FILE + AWS_ROLE_ARN - IRSA (EKS) web identity
	"amazon-bedrock": () => {
		const hasEcsCredentials =
			!!$env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || !!$env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
		const hasWebIdentity = !!$env.AWS_WEB_IDENTITY_TOKEN_FILE && !!$env.AWS_ROLE_ARN;
		if (
			$env.AWS_PROFILE ||
			($env.AWS_ACCESS_KEY_ID && $env.AWS_SECRET_ACCESS_KEY) ||
			$env.AWS_BEARER_TOKEN_BEDROCK ||
			hasEcsCredentials ||
			hasWebIdentity
		) {
			return "<authenticated>";
		}
	},
	synthetic: "SYNTHETIC_API_KEY",
	"cloudflare-ai-gateway": "CLOUDFLARE_AI_GATEWAY_API_KEY",
	huggingface: () => $pickenv("HUGGINGFACE_HUB_TOKEN", "HF_TOKEN"),
	litellm: "LITELLM_API_KEY",
	moonshot: "MOONSHOT_API_KEY",
	nvidia: "NVIDIA_API_KEY",
	nanogpt: "NANO_GPT_API_KEY",
	ollama: "OLLAMA_API_KEY",
	qianfan: "QIANFAN_API_KEY",
	"qwen-portal": () => $pickenv("QWEN_OAUTH_TOKEN", "QWEN_PORTAL_API_KEY"),
	together: "TOGETHER_API_KEY",
	venice: "VENICE_API_KEY",
	vllm: "VLLM_API_KEY",
	xiaomi: "XIAOMI_API_KEY",
};

/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 * Checks Bun.env, then cwd/.env, then ~/.env.
 */
export function getEnvApiKey(provider: string): string | undefined {
	const resolver = serviceProviderMap[provider];
	if (typeof resolver === "string") {
		return $env[resolver];
	}
	return resolver?.();
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: OptionsForApi<TApi>,
): AssistantMessageEventStream {
	// Check custom API registry first (extension-provided APIs like "vertex-claude-api")
	const customApiProvider = getCustomApi(model.api);
	if (customApiProvider) {
		return customApiProvider.stream(model, context, options as StreamOptions);
	}

	if (isGitLabDuoModel(model)) {
		const apiKey = (options as StreamOptions | undefined)?.apiKey || getEnvApiKey(model.provider);
		if (!apiKey) {
			throw new Error(`No API key for provider: ${model.provider}`);
		}
		return streamGitLabDuo(model, context, {
			...(options as SimpleStreamOptions | undefined),
			apiKey,
		});
	}

	// Vertex AI uses Application Default Credentials, not API keys
	if (model.api === "google-vertex") {
		return streamGoogleVertex(model as Model<"google-vertex">, context, options as GoogleVertexOptions);
	} else if (model.api === "bedrock-converse-stream") {
		// Bedrock doesn't have any API keys instead it sources credentials from standard AWS env variables or from given AWS profile.
		return streamBedrock(model as Model<"bedrock-converse-stream">, context, (options || {}) as BedrockOptions);
	}

	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}
	const providerOptions = { ...options, apiKey };

	const api: Api = model.api;
	switch (api) {
		case "anthropic-messages":
			return streamAnthropic(model as Model<"anthropic-messages">, context, providerOptions);

		case "openai-completions":
			return streamOpenAICompletions(model as Model<"openai-completions">, context, providerOptions as any);

		case "openai-responses":
			return streamOpenAIResponses(model as Model<"openai-responses">, context, providerOptions as any);

		case "azure-openai-responses":
			return streamAzureOpenAIResponses(model as Model<"azure-openai-responses">, context, providerOptions as any);

		case "openai-codex-responses":
			return streamOpenAICodexResponses(model as Model<"openai-codex-responses">, context, providerOptions as any);

		case "google-generative-ai":
			return streamGoogle(model as Model<"google-generative-ai">, context, providerOptions);

		case "google-gemini-cli":
			return streamGoogleGeminiCli(
				model as Model<"google-gemini-cli">,
				context,
				providerOptions as GoogleGeminiCliOptions,
			);

		case "cursor-agent":
			return streamCursor(model as Model<"cursor-agent">, context, providerOptions as CursorOptions);

		default:
			throw new Error(`Unhandled API: ${api}`);
	}
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: OptionsForApi<TApi>,
): Promise<AssistantMessage> {
	const s = stream(model, context, options);
	return s.result();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	// Check custom API registry first (extension-provided APIs)
	const customApiProvider = getCustomApi(model.api);
	if (customApiProvider) {
		return customApiProvider.streamSimple(model, context, options);
	}

	// Vertex AI uses Application Default Credentials, not API keys
	if (model.api === "google-vertex") {
		const providerOptions = mapOptionsForApi(model, options, undefined);
		return stream(model, context, providerOptions);
	} else if (model.api === "bedrock-converse-stream") {
		// Bedrock doesn't have any API keys instead it sources credentials from standard AWS env variables or from given AWS profile.
		const providerOptions = mapOptionsForApi(model, options, undefined);
		return stream(model, context, providerOptions);
	}

	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	// GitLab Duo - wraps Anthropic/OpenAI behind GitLab AI Gateway direct access tokens
	if (isGitLabDuoModel(model)) {
		return streamGitLabDuo(model, context, {
			...options,
			apiKey,
		});
	}

	// Kimi Code - route to dedicated handler that wraps OpenAI or Anthropic API
	if (isKimiModel(model)) {
		// Pass raw SimpleStreamOptions - streamKimi handles mapping internally
		return streamKimi(model as Model<"openai-completions">, context, {
			...options,
			apiKey,
			format: options?.kimiApiFormat ?? "anthropic",
		});
	}

	// Synthetic - route to dedicated handler that wraps OpenAI or Anthropic API
	if (isSyntheticModel(model)) {
		// Pass raw SimpleStreamOptions - streamSynthetic handles mapping internally
		return streamSynthetic(model as Model<"openai-completions">, context, {
			...options,
			apiKey,
			format: options?.syntheticApiFormat ?? "openai", // Default to OpenAI format
		});
	}

	const providerOptions = mapOptionsForApi(model, options, apiKey);
	return stream(model, context, providerOptions);
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const s = streamSimple(model, context, options);
	return s.result();
}

const MIN_OUTPUT_TOKENS = 1024;
export const OUTPUT_FALLBACK_BUFFER = 4000;
const ANTHROPIC_USE_INTERLEAVED_THINKING = true;

export const ANTHROPIC_THINKING: Record<ThinkingLevel, number> = {
	minimal: 1024,
	low: 4096,
	medium: 8192,
	high: 16384,
	xhigh: 32768,
};

const GOOGLE_THINKING: Record<ThinkingLevel, number> = {
	minimal: 1024,
	low: 4096,
	medium: 8192,
	high: 16384,
	xhigh: 24575,
};

const BEDROCK_CLAUDE_THINKING: Record<ThinkingLevel, number> = {
	minimal: 1024,
	low: 2048,
	medium: 8192,
	high: 16384,
	xhigh: 16384,
};

function resolveBedrockThinkingBudget(
	model: Model<"bedrock-converse-stream">,
	options?: SimpleStreamOptions,
): { budget: number; level: ThinkingLevel } | null {
	if (!options?.reasoning || !model.reasoning) return null;
	if (!model.id.includes("anthropic.claude")) return null;
	const level = options.reasoning === "xhigh" ? "high" : options.reasoning;
	const budget = options.thinkingBudgets?.[level] ?? BEDROCK_CLAUDE_THINKING[level];
	return { budget, level };
}

export function mapAnthropicToolChoice(choice?: ToolChoice): AnthropicOptions["toolChoice"] {
	if (!choice) return undefined;
	if (typeof choice === "string") {
		if (choice === "required") return "any";
		if (choice === "auto" || choice === "none" || choice === "any") return choice;
		return undefined;
	}
	if (choice.type === "tool") {
		return choice.name ? { type: "tool", name: choice.name } : undefined;
	}
	if (choice.type === "function") {
		const name = "function" in choice ? choice.function?.name : choice.name;
		return name ? { type: "tool", name } : undefined;
	}
	return undefined;
}

/**
 * Map ThinkingLevel to Anthropic effort levels for adaptive thinking (Opus 4.6+)
 */
function mapThinkingLevelToAnthropicEffort(level: ThinkingLevel): AnthropicOptions["effort"] {
	switch (level) {
		case "minimal":
			return "low";
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
			return "max";
		default:
			return "high";
	}
}

function mapGoogleToolChoice(
	choice?: ToolChoice,
): GoogleOptions["toolChoice"] | GoogleGeminiCliOptions["toolChoice"] | GoogleVertexOptions["toolChoice"] {
	if (!choice) return undefined;
	if (typeof choice === "string") {
		if (choice === "required") return "any";
		if (choice === "auto" || choice === "none" || choice === "any") return choice;
		return undefined;
	}
	return "any";
}

function mapOpenAiToolChoice(choice?: ToolChoice): OpenAICompletionsOptions["toolChoice"] {
	if (!choice) return undefined;
	if (typeof choice === "string") {
		if (choice === "any") return "required";
		if (choice === "auto" || choice === "none" || choice === "required") return choice;
		return undefined;
	}
	if (choice.type === "tool") {
		return choice.name ? { type: "function", function: { name: choice.name } } : undefined;
	}
	if (choice.type === "function") {
		const name = "function" in choice ? choice.function?.name : choice.name;
		return name ? { type: "function", function: { name } } : undefined;
	}
	return undefined;
}

function mapOptionsForApi<TApi extends Api>(
	model: Model<TApi>,
	options?: SimpleStreamOptions,
	apiKey?: string,
): OptionsForApi<TApi> {
	const base = {
		temperature: options?.temperature,
		topP: options?.topP,
		topK: options?.topK,
		minP: options?.minP,
		presencePenalty: options?.presencePenalty,
		repetitionPenalty: options?.repetitionPenalty,
		maxTokens: options?.maxTokens || Math.min(model.maxTokens, 32000),
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
		cacheRetention: options?.cacheRetention,
		headers: options?.headers,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
		sessionId: options?.sessionId,
		providerSessionState: options?.providerSessionState,
		onPayload: options?.onPayload,
		execHandlers: options?.execHandlers,
	};

	// Helper to clamp xhigh to high for providers that don't support it
	const clampReasoning = (effort: ThinkingLevel | undefined) => (effort === "xhigh" ? "high" : effort);

	switch (model.api) {
		case "anthropic-messages": {
			// Explicitly disable thinking when reasoning is not specified
			const reasoning = options?.reasoning;
			if (!reasoning) {
				return {
					...base,
					thinkingEnabled: false,
					toolChoice: mapAnthropicToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}

			let thinkingBudget = options.thinkingBudgets?.[reasoning] ?? ANTHROPIC_THINKING[reasoning];
			if (thinkingBudget <= 0) {
				return {
					...base,
					thinkingEnabled: false,
					toolChoice: mapAnthropicToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}

			// For Opus 4.6+ and Sonnet 4.6+: use adaptive thinking with effort level
			// For older models: use budget-based thinking
			if (
				model.id.includes("opus-4-6") ||
				model.id.includes("opus-4.6") ||
				model.id.includes("sonnet-4-6") ||
				model.id.includes("sonnet-4.6")
			) {
				const supportsMaxEffort = model.id.includes("opus-4-6") || model.id.includes("opus-4.6");
				const effort = mapThinkingLevelToAnthropicEffort(
					supportsMaxEffort ? reasoning : (clampReasoning(reasoning) ?? reasoning),
				);
				return {
					...base,
					thinkingEnabled: true,
					effort,
					toolChoice: mapAnthropicToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}

			if (ANTHROPIC_USE_INTERLEAVED_THINKING) {
				return {
					...base,
					thinkingEnabled: true,
					thinkingBudgetTokens: thinkingBudget,
					toolChoice: mapAnthropicToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}

			// Caller's maxTokens is the desired output; add thinking budget on top, capped at model limit
			const maxTokens = Math.min((base.maxTokens || 0) + thinkingBudget, model.maxTokens);

			// If not enough room for thinking + output, reduce thinking budget
			if (maxTokens <= thinkingBudget) {
				thinkingBudget = maxTokens - MIN_OUTPUT_TOKENS;
			}

			// If thinking budget is too low, disable thinking
			if (thinkingBudget <= 0) {
				return {
					...base,
					thinkingEnabled: false,
					toolChoice: mapAnthropicToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			} else {
				return {
					...base,
					maxTokens,
					thinkingEnabled: true,
					thinkingBudgetTokens: thinkingBudget,
					toolChoice: mapAnthropicToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}
		}

		case "bedrock-converse-stream": {
			const bedrockBase: BedrockOptions = {
				...base,
				reasoning: options?.reasoning,
				thinkingBudgets: options?.thinkingBudgets,
				toolChoice: mapAnthropicToolChoice(options?.toolChoice),
			};
			const budgetInfo = resolveBedrockThinkingBudget(model as Model<"bedrock-converse-stream">, options);
			if (!budgetInfo) return bedrockBase as OptionsForApi<TApi>;
			let maxTokens = bedrockBase.maxTokens ?? model.maxTokens;
			let thinkingBudgets = bedrockBase.thinkingBudgets;
			if (maxTokens <= budgetInfo.budget) {
				const desiredMaxTokens = Math.min(model.maxTokens, budgetInfo.budget + MIN_OUTPUT_TOKENS);
				if (desiredMaxTokens > maxTokens) {
					maxTokens = desiredMaxTokens;
				}
			}
			if (maxTokens <= budgetInfo.budget) {
				const adjustedBudget = Math.max(0, maxTokens - MIN_OUTPUT_TOKENS);
				thinkingBudgets = { ...(thinkingBudgets ?? {}), [budgetInfo.level]: adjustedBudget };
			}
			return { ...bedrockBase, maxTokens, thinkingBudgets } as OptionsForApi<TApi>;
		}

		case "openai-completions":
			return {
				...base,
				reasoningEffort: supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning),
				toolChoice: mapOpenAiToolChoice(options?.toolChoice),
			} as OptionsForApi<TApi>;

		case "openai-responses":
			return {
				...base,
				reasoningEffort: supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning),
				toolChoice: mapOpenAiToolChoice(options?.toolChoice),
			} as OptionsForApi<TApi>;

		case "azure-openai-responses":
			return {
				...base,
				reasoningEffort: supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning),
				toolChoice: mapOpenAiToolChoice(options?.toolChoice),
			} as OptionsForApi<TApi>;

		case "openai-codex-responses":
			return {
				...base,
				reasoningEffort: supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning),
				toolChoice: mapOpenAiToolChoice(options?.toolChoice),
				preferWebsockets: options?.preferWebsockets,
			} as OptionsForApi<TApi>;

		case "google-generative-ai": {
			// Explicitly disable thinking when reasoning is not specified
			// This is needed because Gemini has "dynamic thinking" enabled by default
			if (!options?.reasoning) {
				return {
					...base,
					thinking: { enabled: false },
					toolChoice: mapGoogleToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}

			const googleModel = model as Model<"google-generative-ai">;
			const effort = clampReasoning(options.reasoning)!;

			// Gemini 3 models use thinkingLevel exclusively instead of thinkingBudget.
			// https://ai.google.dev/gemini-api/docs/thinking#set-budget
			if (isGemini3ProModel(googleModel) || isGemini3FlashModel(googleModel)) {
				return {
					...base,
					thinking: {
						enabled: true,
						level: getGemini3ThinkingLevel(effort, googleModel),
					},
					toolChoice: mapGoogleToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}

			return {
				...base,
				thinking: {
					enabled: true,
					budgetTokens: getGoogleBudget(googleModel, effort, options?.thinkingBudgets),
				},
				toolChoice: mapGoogleToolChoice(options?.toolChoice),
			} as OptionsForApi<TApi>;
		}

		case "google-gemini-cli": {
			if (!options?.reasoning) {
				return {
					...base,
					thinking: { enabled: false },
					toolChoice: mapGoogleToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}

			const effort = clampReasoning(options.reasoning)!;

			// Gemini 3 models use thinkingLevel instead of thinkingBudget
			if (model.id.includes("3-pro") || model.id.includes("3-flash")) {
				return {
					...base,
					thinking: {
						enabled: true,
						level: getGeminiCliThinkingLevel(effort, model.id),
					},
					toolChoice: mapGoogleToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}

			let thinkingBudget = options.thinkingBudgets?.[effort] ?? GOOGLE_THINKING[effort];

			// Caller's maxTokens is the desired output; add thinking budget on top, capped at model limit
			const maxTokens = Math.min((base.maxTokens || 0) + thinkingBudget, model.maxTokens);

			// If not enough room for thinking + output, reduce thinking budget
			if (maxTokens <= thinkingBudget) {
				thinkingBudget = Math.max(0, maxTokens - MIN_OUTPUT_TOKENS) ?? 0;
			}

			// If thinking budget is too low, disable thinking
			if (thinkingBudget <= 0) {
				return {
					...base,
					thinking: { enabled: false },
					toolChoice: mapGoogleToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			} else {
				return {
					...base,
					maxTokens,
					thinking: { enabled: true, budgetTokens: thinkingBudget },
					toolChoice: mapGoogleToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}
		}

		case "google-vertex": {
			// Explicitly disable thinking when reasoning is not specified
			if (!options?.reasoning) {
				return {
					...base,
					thinking: { enabled: false },
					toolChoice: mapGoogleToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}

			const vertexModel = model as Model<"google-vertex">;
			const effort = clampReasoning(options.reasoning)!;
			const geminiModel = vertexModel as unknown as Model<"google-generative-ai">;

			if (isGemini3ProModel(geminiModel) || isGemini3FlashModel(geminiModel)) {
				return {
					...base,
					thinking: {
						enabled: true,
						level: getGemini3ThinkingLevel(effort, geminiModel),
					},
					toolChoice: mapGoogleToolChoice(options?.toolChoice),
				} as OptionsForApi<TApi>;
			}

			return {
				...base,
				thinking: {
					enabled: true,
					budgetTokens: getGoogleBudget(geminiModel, effort, options?.thinkingBudgets),
				},
				toolChoice: mapGoogleToolChoice(options?.toolChoice),
			} as OptionsForApi<TApi>;
		}

		case "cursor-agent": {
			const execHandlers = options?.cursorExecHandlers ?? options?.execHandlers;
			const onToolResult = options?.cursorOnToolResult ?? execHandlers?.onToolResult;
			return {
				...base,
				execHandlers,
				onToolResult,
			} as OptionsForApi<TApi>;
		}

		default:
			throw new Error(`Unhandled API in mapOptionsForApi: ${model.api}`);
	}
}

type ClampedThinkingLevel = Exclude<ThinkingLevel, "xhigh">;

function isGemini3ProModel(model: Model<"google-generative-ai">): boolean {
	// Covers gemini-3-pro, gemini-3-pro-preview, and possible other prefixed ids in the future
	return model.id.includes("3-pro");
}

function isGemini3FlashModel(model: Model<"google-generative-ai">): boolean {
	// Covers gemini-3-flash, gemini-3-flash-preview, and possible other prefixed ids in the future
	return model.id.includes("3-flash");
}

function getGemini3ThinkingLevel(
	effort: ClampedThinkingLevel,
	model: Model<"google-generative-ai">,
): GoogleThinkingLevel {
	if (isGemini3ProModel(model)) {
		// Gemini 3 Pro only supports LOW/HIGH (for now)
		switch (effort) {
			case "minimal":
			case "low":
				return "LOW";
			case "medium":
			case "high":
				return "HIGH";
		}
	}
	// Gemini 3 Flash supports all four levels
	switch (effort) {
		case "minimal":
			return "MINIMAL";
		case "low":
			return "LOW";
		case "medium":
			return "MEDIUM";
		case "high":
			return "HIGH";
	}
}

function getGeminiCliThinkingLevel(effort: ClampedThinkingLevel, modelId: string): GoogleThinkingLevel {
	if (modelId.includes("3-pro")) {
		// Gemini 3 Pro only supports LOW/HIGH (for now)
		switch (effort) {
			case "minimal":
			case "low":
				return "LOW";
			case "medium":
			case "high":
				return "HIGH";
		}
	}
	// Gemini 3 Flash supports all four levels
	switch (effort) {
		case "minimal":
			return "MINIMAL";
		case "low":
			return "LOW";
		case "medium":
			return "MEDIUM";
		case "high":
			return "HIGH";
	}
}

function getGoogleBudget(
	model: Model<"google-generative-ai">,
	effort: ClampedThinkingLevel,
	customBudgets?: ThinkingBudgets,
): number {
	// Custom budgets take precedence if provided for this level
	if (customBudgets?.[effort] !== undefined) {
		return customBudgets[effort]!;
	}

	// See https://ai.google.dev/gemini-api/docs/thinking#set-budget
	if (model.id.includes("2.5-pro")) {
		const budgets: Record<ClampedThinkingLevel, number> = {
			minimal: 128,
			low: 2048,
			medium: 8192,
			high: 32768,
		};
		return budgets[effort];
	}

	if (model.id.includes("2.5-flash")) {
		// Covers 2.5-flash-lite as well
		const budgets: Record<ClampedThinkingLevel, number> = {
			minimal: 128,
			low: 2048,
			medium: 8192,
			high: 24576,
		};
		return budgets[effort];
	}

	// Unknown model - use dynamic
	return -1;
}
