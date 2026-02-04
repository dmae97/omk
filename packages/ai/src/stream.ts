import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { supportsXhigh } from "./models";
import { type BedrockOptions, streamBedrock } from "./providers/amazon-bedrock";
import { type AnthropicOptions, streamAnthropic } from "./providers/anthropic";
import { streamAzureOpenAIResponses } from "./providers/azure-openai-responses";
import { type CursorOptions, streamCursor } from "./providers/cursor";
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
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	OptionsForApi,
	SimpleStreamOptions,
	ThinkingBudgets,
	ThinkingLevel,
	ToolChoice,
} from "./types";

let cachedVertexAdcCredentialsExists: boolean | null = null;

// Cached .env file contents (parsed once per process)
let cachedEnvMap: Record<string, string> | null = null;

/**
 * Parses a .env file synchronously and extracts key-value pairs.
 */
function parseEnvFile(filePath: string): Record<string, string> {
	const result: Record<string, string> = {};
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;

			const eqIndex = trimmed.indexOf("=");
			if (eqIndex === -1) continue;

			const key = trimmed.slice(0, eqIndex).trim();
			let value = trimmed.slice(eqIndex + 1).trim();

			// Remove surrounding quotes
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}

			result[key] = value;
		}
	} catch {
		// File doesn't exist or can't be read - return empty
	}
	return result;
}

function getEnvMap(): Record<string, string> {
	if (cachedEnvMap) return cachedEnvMap;

	const pruneEmpty = (env: any) =>
		Object.fromEntries(
			Object.entries(env).filter(([k, v]) => typeof k === "string" && typeof v === "string" && v) as [
				string,
				string,
			][],
		);

	cachedEnvMap = {
		...pruneEmpty(parseEnvFile(path.join(os.homedir(), ".env"))),
		...pruneEmpty(parseEnvFile(path.join(process.cwd(), ".env"))),
		...pruneEmpty(process.env),
	};
	return cachedEnvMap;
}

/**
 * Gets an environment variable from process.env or .env files.
 * Checks: process.env → cwd/.env → ~/.env
 */
export function getEnv(key: string): string | undefined {
	return getEnvMap()[key];
}

function hasVertexAdcCredentials(env: Record<string, string>): boolean {
	if (cachedVertexAdcCredentialsExists === null) {
		const gacPath = env.GOOGLE_APPLICATION_CREDENTIALS;
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

type KeyResolver = string | ((env: Record<string, string>) => string | undefined);

const serviceProviderMap: Record<string, KeyResolver> = {
	openai: "OPENAI_API_KEY",
	google: "GEMINI_API_KEY",
	groq: "GROQ_API_KEY",
	cerebras: "CEREBRAS_API_KEY",
	xai: "XAI_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
	zai: "ZAI_API_KEY",
	mistral: "MISTRAL_API_KEY",
	minimax: "MINIMAX_API_KEY",
	opencode: "OPENCODE_API_KEY",
	cursor: "CURSOR_ACCESS_TOKEN",
	"azure-openai-responses": "AZURE_OPENAI_API_KEY",
	exa: "EXA_API_KEY",
	perplexity: "PERPLEXITY_API_KEY",
	// GitHub Copilot uses GitHub personal access token
	"github-copilot": env => env.COPILOT_GITHUB_TOKEN || env.GH_TOKEN || env.GITHUB_TOKEN,
	// ANTHROPIC_OAUTH_TOKEN takes precedence over ANTHROPIC_API_KEY
	anthropic: env => env.ANTHROPIC_OAUTH_TOKEN || env.ANTHROPIC_API_KEY,
	// Vertex AI uses Application Default Credentials, not API keys.
	// Auth is configured via `gcloud auth application-default login`.
	"google-vertex": env => {
		const hasCredentials = hasVertexAdcCredentials(env);
		const hasProject = !!(env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT);
		const hasLocation = !!env.GOOGLE_CLOUD_LOCATION;
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
	"amazon-bedrock": env => {
		const hasEcsCredentials =
			!!env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || !!env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
		const hasWebIdentity = !!env.AWS_WEB_IDENTITY_TOKEN_FILE && !!env.AWS_ROLE_ARN;
		if (
			env.AWS_PROFILE ||
			(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) ||
			env.AWS_BEARER_TOKEN_BEDROCK ||
			hasEcsCredentials ||
			hasWebIdentity
		) {
			return "<authenticated>";
		}
	},
};

/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 * Checks process.env, then cwd/.env, then ~/.env.
 */
export function getEnvApiKey(provider: string): string | undefined {
	const env = getEnvMap();
	const resolver = serviceProviderMap[provider];
	if (typeof resolver === "string") {
		return env[resolver];
	}
	return resolver?.(env);
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: OptionsForApi<TApi>,
): AssistantMessageEventStream {
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

		default: {
			// This should never be reached if all Api cases are handled
			const _exhaustive: never = api;
			throw new Error(`Unhandled API: ${_exhaustive}`);
		}
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

	// Kimi Code - route to dedicated handler that wraps OpenAI or Anthropic API
	if (isKimiModel(model)) {
		// Pass raw SimpleStreamOptions - streamKimi handles mapping internally
		return streamKimi(model as Model<"openai-completions">, context, {
			...options,
			apiKey,
			format: options?.kimiApiFormat ?? "anthropic",
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

const ANTHROPIC_THINKING: Record<ThinkingLevel, number> = {
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

function mapAnthropicToolChoice(choice?: ToolChoice): AnthropicOptions["toolChoice"] {
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
		maxTokens: options?.maxTokens || Math.min(model.maxTokens, 32000),
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
		headers: options?.headers,
		sessionId: options?.sessionId,
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

		default: {
			// Exhaustiveness check
			const _exhaustive: never = model.api;
			throw new Error(`Unhandled API in mapOptionsForApi: ${_exhaustive}`);
		}
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
