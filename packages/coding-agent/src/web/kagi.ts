import { getEnvApiKey } from "@oh-my-pi/pi-ai";
import { findCredential } from "./search/providers/utils";

const KAGI_SUMMARIZE_URL = "https://kagi.com/api/v0/summarize";
const KAGI_SEARCH_URL = "https://kagi.com/api/v0/search";

interface KagiSummarizeResponse {
	data?: {
		output?: string;
	};
	error?: Array<{
		msg?: string;
	}>;
}

interface KagiSearchResultObject {
	t: 0;
	url: string;
	title: string;
	snippet?: string;
	published?: string;
}

interface KagiRelatedSearchesObject {
	t: 1;
	list: string[];
}

type KagiSearchObject = KagiSearchResultObject | KagiRelatedSearchesObject;

interface KagiSearchResponse {
	meta: {
		id: string;
	};
	data: KagiSearchObject[];
	error?: Array<{
		code: number;
		msg: string;
	}>;
}

export class KagiApiError extends Error {
	readonly statusCode?: number;

	constructor(message: string, statusCode?: number) {
		super(message);
		this.name = "KagiApiError";
		this.statusCode = statusCode;
	}
}

export interface KagiSummarizeOptions {
	engine?: string;
	summaryType?: string;
	targetLanguage?: string;
	cache?: boolean;
	signal?: AbortSignal;
}

export interface KagiSearchOptions {
	limit?: number;
	signal?: AbortSignal;
}

export interface KagiSearchSource {
	title: string;
	url: string;
	snippet?: string;
	publishedDate?: string;
}

export interface KagiSearchResult {
	requestId: string;
	sources: KagiSearchSource[];
	relatedQuestions: string[];
}

export async function findKagiApiKey(): Promise<string | null> {
	return findCredential(getEnvApiKey("kagi"), "kagi");
}

function getAuthHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bot ${apiKey}`,
		Accept: "application/json",
	};
}

export async function summarizeUrlWithKagi(url: string, options: KagiSummarizeOptions = {}): Promise<string | null> {
	const apiKey = await findKagiApiKey();
	if (!apiKey) return null;

	const requestUrl = new URL(KAGI_SUMMARIZE_URL);
	requestUrl.searchParams.set("url", url);
	requestUrl.searchParams.set("summary_type", options.summaryType ?? "summary");
	if (options.engine) requestUrl.searchParams.set("engine", options.engine);
	if (options.targetLanguage) requestUrl.searchParams.set("target_language", options.targetLanguage);
	if (options.cache !== undefined) requestUrl.searchParams.set("cache", String(options.cache));

	const response = await fetch(requestUrl, {
		headers: getAuthHeaders(apiKey),
		signal: options.signal,
	});
	if (!response.ok) return null;

	const payload = (await response.json()) as KagiSummarizeResponse;
	if (payload.error && payload.error.length > 0) return null;

	const output = payload.data?.output?.trim();
	return output && output.length > 0 ? output : null;
}

export async function searchWithKagi(query: string, options: KagiSearchOptions = {}): Promise<KagiSearchResult> {
	const apiKey = await findKagiApiKey();
	if (!apiKey) {
		throw new KagiApiError("Kagi credentials not found. Set KAGI_API_KEY or login with 'omp /login kagi'.");
	}

	const requestUrl = new URL(KAGI_SEARCH_URL);
	requestUrl.searchParams.set("q", query);
	if (options.limit !== undefined) {
		requestUrl.searchParams.set("limit", String(options.limit));
	}

	const response = await fetch(requestUrl, {
		headers: getAuthHeaders(apiKey),
		signal: options.signal,
	});
	if (!response.ok) {
		const errorText = await response.text();
		throw new KagiApiError(`Kagi API error (${response.status}): ${errorText}`, response.status);
	}

	const payload = (await response.json()) as KagiSearchResponse;
	if (payload.error && payload.error.length > 0) {
		const firstError = payload.error[0];
		throw new KagiApiError(`Kagi API error: ${firstError.msg}`, firstError.code);
	}

	const sources: KagiSearchSource[] = [];
	const relatedQuestions: string[] = [];

	for (const item of payload.data) {
		if (item.t === 0) {
			sources.push({
				title: item.title,
				url: item.url,
				snippet: item.snippet,
				publishedDate: item.published ?? undefined,
			});
		} else if (item.t === 1) {
			relatedQuestions.push(...item.list);
		}
	}

	return {
		requestId: payload.meta.id,
		sources,
		relatedQuestions,
	};
}
