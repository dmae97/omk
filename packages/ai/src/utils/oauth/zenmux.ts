/**
 * ZenMux login flow.
 *
 * ZenMux provides both OpenAI-compatible and Anthropic-compatible endpoints.
 * This is an API key flow:
 * 1. Open browser to ZenMux API key settings
 * 2. User copies their API key
 * 3. User pastes the API key into CLI
 */

import { validateApiKeyAgainstModelsEndpoint } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://zenmux.ai/settings/keys";
const API_BASE_URL = "https://zenmux.ai/api/v1";
const MODELS_URL = `${API_BASE_URL}/models`;

export async function loginZenMux(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("ZenMux login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Create or copy your ZenMux API key",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your ZenMux API key",
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
	await validateApiKeyAgainstModelsEndpoint({
		provider: "ZenMux",
		apiKey: trimmed,
		modelsUrl: MODELS_URL,
		signal: options.signal,
	});

	return trimmed;
}
