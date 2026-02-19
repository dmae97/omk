/**
 * Kimi Web Search Provider
 *
 * Uses Moonshot Kimi Code search API to retrieve web results.
 * Endpoint: POST https://api.kimi.com/coding/v1/search
 */
import { getEnvApiKey } from "@oh-my-pi/pi-ai";
import { $env } from "@oh-my-pi/pi-utils";
import { getAgentDbPath } from "@oh-my-pi/pi-utils/dirs";
import { AgentStorage } from "../../../session/agent-storage";
import type { SearchResponse, SearchSource } from "../../../web/search/types";
import { SearchProviderError } from "../../../web/search/types";
import type { SearchParams } from "./base";
import { SearchProvider } from "./base";
const KIMI_SEARCH_URL = "https://api.kimi.com/coding/v1/search";

const DEFAULT_NUM_RESULTS = 10;
const MAX_NUM_RESULTS = 20;
const DEFAULT_TIMEOUT_SECONDS = 30;

export interface KimiSearchParams {
	query: string;
	num_results?: number;
	include_content?: boolean;
	signal?: AbortSignal;
}

interface KimiSearchResult {
	site_name?: string;
	title?: string;
	url?: string;
	snippet?: string;
	content?: string;
	date?: string;
	icon?: string;
	mime?: string;
}

interface KimiSearchResponse {
	search_results?: KimiSearchResult[];
}

function asTrimmed(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function resolveBaseUrl(): string {
	return asTrimmed($env.MOONSHOT_SEARCH_BASE_URL) ?? asTrimmed($env.KIMI_SEARCH_BASE_URL) ?? KIMI_SEARCH_URL;
}


function clampNumResults(value: number | undefined): number {
	if (!value || Number.isNaN(value)) return DEFAULT_NUM_RESULTS;
	return Math.min(MAX_NUM_RESULTS, Math.max(1, value));
}

function dateToAgeSeconds(dateStr: string | undefined): number | undefined {
	if (!dateStr) return undefined;
	try {
		const date = new Date(dateStr);
		if (Number.isNaN(date.getTime())) return undefined;
		return Math.floor((Date.now() - date.getTime()) / 1000);
	} catch {
		return undefined;
	}
}

/**
 * Find Kimi search credentials from environment or agent.db credentials.
 * Priority: MOONSHOT_SEARCH_API_KEY / KIMI_SEARCH_API_KEY / MOONSHOT_API_KEY, then agent.db providers "moonshot" or "kimi-code".
 */
async function findApiKey(): Promise<string | null> {
	const envKey =
		asTrimmed($env.MOONSHOT_SEARCH_API_KEY) ??
		asTrimmed($env.KIMI_SEARCH_API_KEY) ??
		getEnvApiKey("moonshot") ??
		null;
	if (envKey) return envKey;

	try {
		const storage = await AgentStorage.open(getAgentDbPath());
		for (const provider of ["moonshot", "kimi-code"] as const) {
			const records = storage.listAuthCredentials(provider);
			for (const record of records) {
				const credential = record.credential;
				if (credential.type === "api_key" && credential.key.trim().length > 0) {
					return credential.key;
				}
				if (credential.type === "oauth" && credential.access.trim().length > 0) {
					return credential.access;
				}
			}
		}
	} catch {
		return null;
	}

	return null;
}


async function callKimiSearch(
	apiKey: string,
	params: { query: string; limit: number; includeContent: boolean; signal?: AbortSignal },
): Promise<{ response: KimiSearchResponse; requestId?: string }> {
	const response = await fetch(resolveBaseUrl(), {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			text_query: params.query,
			limit: params.limit,
			enable_page_crawling: params.includeContent,
			timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
		}),
		signal: params.signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new SearchProviderError(
			"kimi",
			`Kimi search API error (${response.status}): ${errorText}`,
			response.status,
		);
	}

	const data = (await response.json()) as KimiSearchResponse;
	const requestId = response.headers.get("x-request-id") ?? response.headers.get("x-msh-request-id") ?? undefined;
	return { response: data, requestId };
}

/** Execute Kimi web search. */
export async function searchKimi(params: KimiSearchParams): Promise<SearchResponse> {
	const apiKey = await findApiKey();
	if (!apiKey) {
		throw new Error(
			"Kimi search credentials not found. Set MOONSHOT_SEARCH_API_KEY, KIMI_SEARCH_API_KEY, MOONSHOT_API_KEY, or login with 'omp /login moonshot'.",
		);
	}

	const limit = clampNumResults(params.num_results);
	const { response, requestId } = await callKimiSearch(apiKey, {
		query: params.query,
		limit,
		includeContent: params.include_content ?? false,
		signal: params.signal,
	});
	const sources: SearchSource[] = [];

	for (const result of response.search_results ?? []) {
		if (!result.url) continue;
		const publishedDate = asTrimmed(result.date);
		const snippet = asTrimmed(result.snippet) ?? asTrimmed(result.content);
		sources.push({
			title: asTrimmed(result.title) ?? result.url,
			url: result.url,
			snippet,
			publishedDate,
			ageSeconds: dateToAgeSeconds(publishedDate),
			author: asTrimmed(result.site_name),
		});
	}

	return {
		provider: "kimi",
		sources: sources.slice(0, limit),
		requestId,
	};
}

/** Search provider for Kimi web search. */
export class KimiProvider extends SearchProvider {
	readonly id = "kimi";
	readonly label = "Kimi";

	async isAvailable(): Promise<boolean> {
		try {
			return !!(await findApiKey());
		} catch {
			return false;
		}
	}

	search(params: SearchParams): Promise<SearchResponse> {
		return searchKimi({
			query: params.query,
			num_results: params.numSearchResults ?? params.limit,
			signal: params.signal,
		});
	}
}
