/**
 * NanoGPT login flow.
 *
 * NanoGPT provides OpenAI-compatible access to multiple upstream text models.
 * This is an API key flow:
 * 1. Open NanoGPT API page
 * 2. Copy API key (sk-...)
 * 3. Paste key into CLI
 */

import { validateApiKeyAgainstModelsEndpoint } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://nano-gpt.com/api";
const API_BASE_URL = "https://nano-gpt.com/api/v1";
const MODELS_URL = `${API_BASE_URL}/models`;

export async function loginNanoGPT(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("NanoGPT login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Create or copy your NanoGPT API key",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your NanoGPT API key",
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
		provider: "NanoGPT",
		apiKey: trimmed,
		modelsUrl: MODELS_URL,
		signal: options.signal,
	});

	return trimmed;
}
