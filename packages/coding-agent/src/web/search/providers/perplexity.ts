/**
 * Perplexity Web Search Provider
 *
 * Supports both sonar (fast) and sonar-pro (comprehensive) models.
 * Returns synthesized answers with citations and related questions.
 */

import { getEnvApiKey } from "@oh-my-pi/pi-ai";
import type {
	PerplexityMessageOutput,
	PerplexityRequest,
	PerplexityResponse,
	SearchCitation,
	SearchResponse,
	SearchSource,
} from "../../../web/search/types";
import { SearchProviderError } from "../../../web/search/types";
import type { SearchParams } from "./base";
import { SearchProvider } from "./base";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_NUM_SEARCH_RESULTS = 10;

export interface PerplexitySearchParams {
	query: string;
	system_prompt?: string;
	search_recency_filter?: "hour" | "day" | "week" | "month" | "year";
	num_results?: number;
	/** Maximum output tokens. Defaults to 4096. */
	max_tokens?: number;
	/** Sampling temperature (0–1). Lower = more focused/factual. Defaults to 0.2. */
	temperature?: number;
	/** Number of search results to retrieve. Defaults to 10. */
	num_search_results?: number;
}

/** Find PERPLEXITY_API_KEY from environment or .env files (also checks PPLX_API_KEY) */
export function findApiKey(): string | null {
	return getEnvApiKey("perplexity") ?? null;
}

/** Call Perplexity API */
async function callPerplexity(apiKey: string, request: PerplexityRequest): Promise<PerplexityResponse> {
	const response = await fetch(PERPLEXITY_API_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(request),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new SearchProviderError(
			"perplexity",
			`Perplexity API error (${response.status}): ${errorText}`,
			response.status,
		);
	}

	return response.json() as Promise<PerplexityResponse>;
}

/** Calculate age in seconds from ISO date string */
function dateToAgeSeconds(dateStr: string | null | undefined): number | undefined {
	if (!dateStr) return undefined;
	try {
		const date = new Date(dateStr);
		if (Number.isNaN(date.getTime())) return undefined;
		return Math.floor((Date.now() - date.getTime()) / 1000);
	} catch {
		return undefined;
	}
}

function messageContentToText(content: PerplexityMessageOutput["content"]): string {
	if (!content) return "";
	if (typeof content === "string") return content;
	return content.map(chunk => (chunk.type === "text" ? chunk.text : "")).join("");
}

/** Parse API response into unified SearchResponse */
function parseResponse(response: PerplexityResponse): SearchResponse {
	const messageContent = response.choices[0]?.message?.content ?? null;
	const answer = messageContentToText(messageContent);

	// Build sources by matching citations to search_results
	const sources: SearchSource[] = [];
	const citations: SearchCitation[] = [];

	const citationUrls = response.citations ?? [];
	const searchResults = response.search_results ?? [];

	if (citationUrls.length > 0) {
		for (const url of citationUrls) {
			const searchResult = searchResults.find(r => r.url === url);
			sources.push({
				title: searchResult?.title ?? url,
				url,
				snippet: searchResult?.snippet,
				publishedDate: searchResult?.date ?? undefined,
				ageSeconds: dateToAgeSeconds(searchResult?.date),
			});
			citations.push({
				url,
				title: searchResult?.title ?? url,
			});
		}
	} else {
		for (const searchResult of searchResults) {
			sources.push({
				title: searchResult.title ?? searchResult.url,
				url: searchResult.url,
				snippet: searchResult.snippet,
				publishedDate: searchResult.date ?? undefined,
				ageSeconds: dateToAgeSeconds(searchResult.date),
			});
		}
	}

	return {
		provider: "perplexity",
		answer: answer || undefined,
		sources,
		citations: citations.length > 0 ? citations : undefined,
		usage: response.usage
			? {
					inputTokens: response.usage.prompt_tokens,
					outputTokens: response.usage.completion_tokens,
					totalTokens: response.usage.total_tokens,
				}
			: undefined,
		model: response.model,
		requestId: response.id,
	};
}

/** Execute Perplexity web search */
export async function searchPerplexity(params: PerplexitySearchParams): Promise<SearchResponse> {
	const apiKey = findApiKey();
	if (!apiKey) {
		throw new Error("PERPLEXITY_API_KEY not found. Set it in environment or .env file.");
	}

	const systemPrompt = params.system_prompt;
	const messages: PerplexityRequest["messages"] = [];
	if (systemPrompt) {
		messages.push({ role: "system", content: systemPrompt });
	}
	messages.push({ role: "user", content: params.query });

	const request: PerplexityRequest = {
		model: "sonar-pro",
		messages,
		max_tokens: params.max_tokens ?? DEFAULT_MAX_TOKENS,
		temperature: params.temperature ?? DEFAULT_TEMPERATURE,
		search_mode: "web",
		num_search_results: params.num_search_results ?? DEFAULT_NUM_SEARCH_RESULTS,
		web_search_options: {
			search_type: "pro",
			search_context_size: "medium",
		},
		enable_search_classifier: true,
		reasoning_effort: "medium",
		language_preference: "en",
	};

	if (params.search_recency_filter) {
		request.search_recency_filter = params.search_recency_filter;
	}

	const response = await callPerplexity(apiKey, request);
	const result = parseResponse(response);

	// Apply num_results limit if specified
	if (params.num_results && result.sources.length > params.num_results) {
		result.sources = result.sources.slice(0, params.num_results);
	}

	return result;
}

/** Search provider for Perplexity. */
export class PerplexityProvider extends SearchProvider {
	readonly id = "perplexity";
	readonly label = "Perplexity";

	isAvailable() {
		try {
			return !!findApiKey();
		} catch {
			return false;
		}
	}

	search(params: SearchParams): Promise<SearchResponse> {
		return searchPerplexity({
			query: params.query,
			temperature: params.temperature,
			max_tokens: params.maxOutputTokens,
			num_search_results: params.numSearchResults,
			system_prompt: params.systemPrompt,
			search_recency_filter: params.recency,
			num_results: params.limit,
		});
	}
}
