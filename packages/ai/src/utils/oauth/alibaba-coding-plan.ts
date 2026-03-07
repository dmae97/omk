/**
 * Alibaba Coding Plan login flow.
 *
 * Alibaba Coding Plan provides OpenAI-compatible models via https://coding-intl.dashscope.aliyuncs.com/v1.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to Alibaba Cloud DashScope API key settings
 * 2. User copies their API key
 * 3. User pastes the API key into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://modelstudio.console.alibabacloud.com/";
const API_BASE_URL = "https://coding-intl.dashscope.aliyuncs.com/v1";
const VALIDATION_MODEL = "qwen3.5-plus";

/**
 * Login to Alibaba Coding Plan.
 *
 * Opens browser to API keys page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginAlibabaCodingPlan(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Alibaba Coding Plan login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from the Alibaba Cloud DashScope console",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Alibaba Coding Plan API key",
		placeholder: "sk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: "Alibaba Coding Plan",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});

	return trimmed;
}
