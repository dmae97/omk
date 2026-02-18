/**
 * Synthetic Web Search Provider
 *
 * Uses Synthetic's zero-data-retention web search API for coding agents.
 * Endpoint: POST https://api.synthetic.new/v2/search
 */

import { getEnvApiKey } from "@oh-my-pi/pi-ai";
import { getAgentDbPath } from "@oh-my-pi/pi-utils/dirs";
import { AgentStorage } from "../../../session/agent-storage";
import type { SearchResponse, SearchSource } from "../../../web/search/types";
import { SearchProviderError } from "../../../web/search/types";
import type { SearchParams } from "./base";
import { SearchProvider } from "./base";

const SYNTHETIC_SEARCH_URL = "https://api.synthetic.new/v2/search";

interface SyntheticSearchResult {
	url: string;
	title: string;
	text?: string;
	published?: string;
}

interface SyntheticSearchResponse {
	results: SyntheticSearchResult[];
}

/**
 * Find Synthetic API key from environment or agent.db credentials.
 * Priority: SYNTHETIC_API_KEY env var, then credentials stored under provider "synthetic".
 */
export async function findApiKey(): Promise<string | null> {
	const envKey = getEnvApiKey("synthetic");
	if (envKey) return envKey;

	try {
		const storage = await AgentStorage.open(getAgentDbPath());
		const records = storage.listAuthCredentials("synthetic");
		for (const record of records) {
			const credential = record.credential;
			if (credential.type === "api_key" && credential.key.trim().length > 0) {
				return credential.key;
			}
			if (credential.type === "oauth" && credential.access.trim().length > 0) {
				return credential.access;
			}
		}
	} catch {
		return null;
	}

	return null;
}

/** Call Synthetic search API. */
async function callSyntheticSearch(
	apiKey: string,
	query: string,
	signal?: AbortSignal,
): Promise<SyntheticSearchResponse> {
	const response = await fetch(SYNTHETIC_SEARCH_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({ query }),
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new SearchProviderError(
			"synthetic",
			`Synthetic API error (${response.status}): ${errorText}`,
			response.status,
		);
	}

	return (await response.json()) as SyntheticSearchResponse;
}

/** Execute Synthetic web search. */
export async function searchSynthetic(params: {
	query: string;
	num_results?: number;
	signal?: AbortSignal;
}): Promise<SearchResponse> {
	const apiKey = await findApiKey();
	if (!apiKey) {
		throw new Error("Synthetic credentials not found. Set SYNTHETIC_API_KEY or login with 'omp /login synthetic'.");
	}

	const data = await callSyntheticSearch(apiKey, params.query, params.signal);
	const sources: SearchSource[] = [];

	for (const result of data.results ?? []) {
		if (!result.url) continue;
		sources.push({
			title: result.title ?? result.url,
			url: result.url,
			snippet: result.text ?? undefined,
			publishedDate: result.published ?? undefined,
		});
	}

	const limitedSources = params.num_results ? sources.slice(0, params.num_results) : sources;

	return {
		provider: "synthetic",
		sources: limitedSources,
	};
}

/** Search provider for Synthetic. */
export class SyntheticProvider extends SearchProvider {
	readonly id = "synthetic";
	readonly label = "Synthetic";

	async isAvailable(): Promise<boolean> {
		try {
			return !!(await findApiKey());
		} catch {
			return false;
		}
	}

	search(params: SearchParams): Promise<SearchResponse> {
		return searchSynthetic({
			query: params.query,
			num_results: params.numSearchResults ?? params.limit,
			signal: params.signal,
		});
	}
}
