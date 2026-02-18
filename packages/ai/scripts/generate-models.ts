#!/usr/bin/env bun

import * as path from "node:path";
import { $env } from "@oh-my-pi/pi-utils";
import { createModelManager } from "../src/model-manager";
import {
	GENERATE_MODELS_PROVIDER_DESCRIPTORS,
	type GenerateModelsProviderDescriptor,
	MODELS_DEV_PROVIDER_DESCRIPTORS,
	mapModelsDevToModels,
} from "../src/provider-models/openai-compat";
import {
	CLOUDFLARE_FALLBACK_MODEL,
	applyGeneratedModelPolicies,
	linkSparkPromotionTargets,
} from "../src/provider-models/model-policies";
import { JWT_CLAIM_PATH } from "../src/providers/openai-codex/constants";
import { CliAuthStorage } from "../src/storage";
import type { Model } from "../src/types";
import { fetchAntigravityDiscoveryModels } from "../src/utils/discovery/antigravity";
import { fetchCodexModels } from "../src/utils/discovery/codex";
import { fetchCursorUsableModels } from "../src/utils/discovery/cursor";
import { getOAuthApiKey } from "../src/utils/oauth";
import type { OAuthProvider } from "../src/utils/oauth/types";
import prevModelsJson from "../src/models.json" with { type: "json" };

const packageRoot = path.join(import.meta.dir, "..");

interface ProviderApiKeyOptions {
	provider: string;
	envVars: string[];
	oauthProvider?: OAuthProvider;
}

async function resolveProviderApiKey({ provider, envVars, oauthProvider }: ProviderApiKeyOptions): Promise<string | undefined> {
	for (const envVar of envVars) {
		const value = $env[envVar as keyof typeof $env];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}

	try {
		const storage = await CliAuthStorage.create();
		try {
			const storedApiKey = storage.getApiKey(provider);
			if (storedApiKey) {
				return storedApiKey;
			}
			if (oauthProvider) {
				const storedOAuth = storage.getOAuth(oauthProvider);
				if (storedOAuth) {
					const result = await getOAuthApiKey(oauthProvider, { [oauthProvider]: storedOAuth });
					if (result) {
						storage.saveOAuth(oauthProvider, result.newCredentials);
						return result.apiKey;
					}
				}
			}
		} finally {
			storage.close();
		}
	} catch {
		// Ignore missing/unreadable auth storage.
	}

	return undefined;
}

async function fetchProviderModelsFromCatalog(descriptor: GenerateModelsProviderDescriptor): Promise<Model[]> {
	const apiKey = await resolveProviderApiKey({
		provider: descriptor.providerId,
		envVars: descriptor.envVars,
		oauthProvider: descriptor.oauthProvider,
	});

	if (!apiKey && !descriptor.allowUnauthenticated) {
		console.log(`No ${descriptor.label} credentials found (env or agent.db), using fallback models`);
		return [];
	}

	try {
		console.log(`Fetching models from ${descriptor.label} model manager...`);
		const manager = createModelManager(descriptor.createModelManagerOptions({ apiKey }));
		const result = await manager.refresh("online");
		const models = result.models.filter(model => model.provider === descriptor.providerId);
		if (models.length === 0) {
			console.warn(`${descriptor.label} discovery returned no models, using fallback models`);
			return [];
		}
		console.log(`Fetched ${models.length} models from ${descriptor.label} model manager`);
		return models;
	} catch (error) {
		console.error(`Failed to fetch ${descriptor.label} models:`, error);
		return [];
	}
}

async function loadModelsDevData(): Promise<Model[]> {
	try {
		console.log("Fetching models from models.dev API...");
		const response = await fetch("https://models.dev/api.json");
		const data = await response.json();
		const models = mapModelsDevToModels(data as Record<string, unknown>, MODELS_DEV_PROVIDER_DESCRIPTORS);
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
	const catalogProviderModels = (
		await Promise.all(GENERATE_MODELS_PROVIDER_DESCRIPTORS.map(descriptor => fetchProviderModelsFromCatalog(descriptor)))
	).flat();

	// Combine models (models.dev has priority)
	const allModels = [...modelsDevModels, ...catalogProviderModels];

	if (!allModels.some((model) => model.provider === "cloudflare-ai-gateway")) {
		allModels.push(CLOUDFLARE_FALLBACK_MODEL);
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

	applyGeneratedModelPolicies(allModels);
	linkSparkPromotionTargets(allModels);

	// Merge previous models.json entries as fallback for any provider/model
	// not fetched dynamically. This replaces all hardcoded fallback lists —
	// static-only providers (vertex, gemini-cli), auth-gated providers when
	// credentials are unavailable, and ad-hoc model additions all persist
	// through the existing models.json seed.
	// Discovery-only providers (local inference servers) — never bundle static models.
	const discoveryOnlyProviders = new Set(["ollama", "vllm"]);
	const fetchedKeys = new Set(allModels.map((m) => `${m.provider}/${m.id}`));
	for (const models of Object.values(prevModelsJson as Record<string, Record<string, Model>>)) {
		for (const model of Object.values(models)) {
			if (!fetchedKeys.has(`${model.provider}/${model.id}`) && !discoveryOnlyProviders.has(model.provider)) {
				allModels.push(model);
			}
		}
	}

	// Group by provider and sort each provider's models
	const providers: Record<string, Record<string, Model>> = {};
	for (const model of allModels) {
		if (discoveryOnlyProviders.has(model.provider)) continue;
		if (!providers[model.provider]) {
			providers[model.provider] = {};
		}
		// Use model ID as key to automatically deduplicate
		// Only add if not already present (models.dev takes priority over endpoint discovery)
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
	await Bun.write(path.join(packageRoot, "src/models.json"), JSON.stringify(MODELS, null, "	"));
	console.log("Generated src/models.json");

	// Print statistics
	const totalModels = allModels.length;
	const reasoningModels = allModels.filter((m) => m.reasoning).length;

	console.log(`
Model Statistics:`);
	console.log(`  Total tool-capable models: ${totalModels}`);
	console.log(`  Reasoning-capable models: ${reasoningModels}`);

	for (const [provider, models] of Object.entries(providers)) {
		console.log(`  ${provider}: ${Object.keys(models).length} models`);
	}
}

// Run the generator
generateModels().catch(console.error);
