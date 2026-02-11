/**
 * Z.AI login flow.
 *
 * Z.AI is a platform that provides access to GLM models through an OpenAI-compatible API.
 * API docs: https://docs.z.ai/guides/overview/quick-start
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. User gets their API key from https://z.ai/settings/api-keys
 * 2. User pastes the API key into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://z.ai/manage-apikey/apikey-list";
const API_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const VALIDATION_MODEL = "glm-5";

/**
 * Login to Z.AI.
 *
 * Opens browser to API keys page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginZai(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Z.AI login requires onPrompt callback");
	}

	// Open browser to API keys page
	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from the dashboard",
	});

	// Prompt user to paste their API key
	const apiKey = await options.onPrompt({
		message: "Paste your Z.AI API key",
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
		provider: "Z.AI",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});
	return trimmed;
}
