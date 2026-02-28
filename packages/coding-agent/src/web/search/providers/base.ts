import type { SearchProviderId, SearchResponse } from "../types";

/** Shared web search parameters passed to providers. */
export interface SearchParams {
	query: string;
	limit?: number;
	recency?: "day" | "week" | "month" | "year";
	systemPrompt: string;
	signal?: AbortSignal;
	maxOutputTokens?: number;
	numSearchResults?: number;
	temperature?: number;
	googleSearch?: Record<string, unknown>;
	codeExecution?: Record<string, unknown>;
	urlContext?: Record<string, unknown>;
}

/** Base class for web search providers. */
export abstract class SearchProvider {
	abstract readonly id: SearchProviderId;
	abstract readonly label: string;

	abstract isAvailable(): Promise<boolean> | boolean;
	abstract search(params: SearchParams): Promise<SearchResponse>;
}
