import type { ModelManagerOptions } from "../model-manager";
import { fetchCodexModels } from "../utils/discovery/codex";
import { fetchCursorUsableModels } from "../utils/discovery/cursor";

// ---------------------------------------------------------------------------
// OpenAI Codex
// ---------------------------------------------------------------------------

export interface OpenAICodexModelManagerConfig {
	accessToken?: string;
	accountId?: string;
	clientVersion?: string;
}

export function openaiCodexModelManagerOptions(
	config: OpenAICodexModelManagerConfig = {},
): ModelManagerOptions<"openai-codex-responses"> {
	const { accessToken, accountId, clientVersion } = config;
	return {
		providerId: "openai-codex",
		...(accessToken
			? {
					fetchDynamicModels: async () => {
						const result = await fetchCodexModels({ accessToken, accountId, clientVersion });
						return result?.models ?? null;
					},
				}
			: undefined),
	};
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export interface CursorModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
	clientVersion?: string;
}

export function cursorModelManagerOptions(config: CursorModelManagerConfig = {}): ModelManagerOptions<"cursor-agent"> {
	const { apiKey, baseUrl, clientVersion } = config;
	return {
		providerId: "cursor",
		...(apiKey
			? {
					fetchDynamicModels: () => fetchCursorUsableModels({ apiKey, baseUrl, clientVersion }),
				}
			: undefined),
	};
}

// ---------------------------------------------------------------------------
// Amazon Bedrock
// ---------------------------------------------------------------------------

// Dynamic discovery requires AWS SDK auth (ListFoundationModels). Not yet implemented.

export interface AmazonBedrockModelManagerConfig {}

export function amazonBedrockModelManagerOptions(
	_config: AmazonBedrockModelManagerConfig = {},
): ModelManagerOptions<"bedrock-converse-stream"> {
	return { providerId: "amazon-bedrock" };
}

// ---------------------------------------------------------------------------
// MiniMax variants (subscription-based, no model listing endpoint)
// ---------------------------------------------------------------------------

export interface MinimaxModelManagerConfig {}

export function minimaxModelManagerOptions(
	_config: MinimaxModelManagerConfig = {},
): ModelManagerOptions<"anthropic-messages"> {
	return { providerId: "minimax" };
}

export function minimaxCnModelManagerOptions(
	_config: MinimaxModelManagerConfig = {},
): ModelManagerOptions<"anthropic-messages"> {
	return { providerId: "minimax-cn" };
}

export function minimaxCodeModelManagerOptions(
	_config: MinimaxModelManagerConfig = {},
): ModelManagerOptions<"openai-completions"> {
	return { providerId: "minimax-code" };
}

export function minimaxCodeCnModelManagerOptions(
	_config: MinimaxModelManagerConfig = {},
): ModelManagerOptions<"openai-completions"> {
	return { providerId: "minimax-code-cn" };
}

// ---------------------------------------------------------------------------
// Zai
// ---------------------------------------------------------------------------

export interface ZaiModelManagerConfig {}

export function zaiModelManagerOptions(_config: ZaiModelManagerConfig = {}): ModelManagerOptions<"anthropic-messages"> {
	return { providerId: "zai" };
}
