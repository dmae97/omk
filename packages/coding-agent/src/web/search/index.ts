/**
 * Unified Web Search Tool
 *
 * Single tool supporting Anthropic, Perplexity, and Exa providers with
 * provider-specific parameters exposed conditionally.
 *
 * When EXA_API_KEY is available, additional specialized tools are exposed:
 * - web_search_deep: Natural language web search with synthesized results
 * - web_search_code_context: Search code snippets, docs, and examples
 * - web_search_crawl: Extract content from specific URLs
 * - web_search_linkedin: Search LinkedIn profiles and companies
 * - web_search_company: Comprehensive company research
 */

import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import { callExaTool, findApiKey as findExaKey, formatSearchResults, isSearchResponse } from "$c/exa/mcp-client";
import { renderExaCall, renderExaResult } from "$c/exa/render";
import type { ExaRenderDetails } from "$c/exa/types";
import type { CustomTool, CustomToolContext, RenderResultOptions } from "$c/extensibility/custom-tools/types";
import type { Theme } from "$c/modes/theme/theme";
import webSearchSystemPrompt from "$c/prompts/system/web-search.md" with { type: "text" };
import webSearchDescription from "$c/prompts/tools/web-search.md" with { type: "text" };
import type { ToolSession } from "$c/tools/index";
import { formatAge } from "$c/tools/render-utils";
import { findAnthropicAuth } from "./auth";
import { searchAnthropic } from "./providers/anthropic";
import { searchExa } from "./providers/exa";
import { findApiKey as findPerplexityKey, searchPerplexity } from "./providers/perplexity";
import { renderWebSearchCall, renderWebSearchResult, type WebSearchRenderDetails } from "./render";
import type { WebSearchProvider, WebSearchResponse } from "./types";
import { WebSearchProviderError } from "./types";

/** Web search parameters schema */
export const webSearchSchema = Type.Object({
	query: Type.String({ description: "Search query" }),
	provider: Type.Optional(
		StringEnum(["auto", "exa", "anthropic", "perplexity"], {
			description: "Search provider (default: auto)",
		}),
	),
	recency: Type.Optional(
		StringEnum(["day", "week", "month", "year"], {
			description: "Recency filter (Perplexity)",
		}),
	),
	limit: Type.Optional(Type.Number({ description: "Max results to return" })),
});

export type WebSearchParams = {
	query: string;
	provider?: "auto" | "exa" | "anthropic" | "perplexity";
	recency?: "day" | "week" | "month" | "year";
	limit?: number;
};

/** Preferred provider set via settings (default: auto) */
let preferredProvider: WebSearchProvider | "auto" = "auto";

/** Set the preferred web search provider from settings */
export function setPreferredWebSearchProvider(provider: WebSearchProvider | "auto"): void {
	preferredProvider = provider;
}

/** Determine which providers are configured (priority order) */
async function getAvailableProviders(): Promise<WebSearchProvider[]> {
	const providers: WebSearchProvider[] = [];

	const exaKey = await findExaKey();
	if (exaKey) providers.push("exa");

	const perplexityKey = await findPerplexityKey();
	if (perplexityKey) providers.push("perplexity");

	const anthropicAuth = await findAnthropicAuth();
	if (anthropicAuth) providers.push("anthropic");

	return providers;
}

function formatProviderLabel(provider: WebSearchProvider): string {
	switch (provider) {
		case "exa":
			return "Exa";
		case "perplexity":
			return "Perplexity";
		case "anthropic":
			return "Anthropic";
		default:
			return provider;
	}
}

function formatProviderList(providers: WebSearchProvider[]): string {
	return providers.map((provider) => formatProviderLabel(provider)).join(", ");
}

function buildNoProviderError(): string {
	return "No web search provider configured. Set EXA_API_KEY, PERPLEXITY_API_KEY, ANTHROPIC_SEARCH_API_KEY, or ANTHROPIC_API_KEY.";
}

function formatProviderError(error: unknown, provider: WebSearchProvider): string {
	if (error instanceof WebSearchProviderError) {
		if (error.provider === "anthropic" && error.status === 404) {
			return "Anthropic web search returned 404 (model or endpoint not found). Set ANTHROPIC_SEARCH_MODEL/ANTHROPIC_SEARCH_BASE_URL, or configure EXA_API_KEY or PERPLEXITY_API_KEY.";
		}
		if (error.status === 401 || error.status === 403) {
			return `${formatProviderLabel(error.provider)} authorization failed (${error.status}). Check API key or base URL.`;
		}
		return error.message;
	}
	if (error instanceof Error) return error.message;
	return `Unknown error from ${formatProviderLabel(provider)}`;
}

async function resolveProviderChain(
	requestedProvider?: WebSearchProvider | "auto",
): Promise<{ providers: WebSearchProvider[]; allowFallback: boolean }> {
	if (requestedProvider && requestedProvider !== "auto") {
		return { providers: [requestedProvider], allowFallback: false };
	}

	if (preferredProvider !== "auto") {
		return { providers: [preferredProvider], allowFallback: false };
	}

	const providers = await getAvailableProviders();
	return { providers, allowFallback: true };
}

/** Truncate text for tool output */
function truncateText(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function formatCount(label: string, count: number): string {
	return `${count} ${label}${count === 1 ? "" : "s"}`;
}

/** Format response for LLM consumption */
function formatForLLM(response: WebSearchResponse): string {
	const parts: string[] = [];

	parts.push("## Answer");
	parts.push(response.answer ? response.answer : "No answer text returned.");

	if (response.sources.length > 0) {
		parts.push("\n## Sources");
		parts.push(formatCount("source", response.sources.length));
		for (const [i, src] of response.sources.entries()) {
			const age = formatAge(src.ageSeconds) || src.publishedDate;
			const agePart = age ? ` (${age})` : "";
			parts.push(`[${i + 1}] ${src.title}${agePart}\n    ${src.url}`);
			if (src.snippet) {
				parts.push(`    ${truncateText(src.snippet, 240)}`);
			}
		}
	} else {
		parts.push("\n## Sources");
		parts.push("0 sources");
	}

	if (response.citations && response.citations.length > 0) {
		parts.push("\n## Citations");
		parts.push(formatCount("citation", response.citations.length));
		for (const [i, citation] of response.citations.entries()) {
			const title = citation.title || citation.url;
			parts.push(`[${i + 1}] ${title}\n    ${citation.url}`);
			if (citation.citedText) {
				parts.push(`    ${truncateText(citation.citedText, 240)}`);
			}
		}
	}

	if (response.relatedQuestions && response.relatedQuestions.length > 0) {
		parts.push("\n## Related");
		parts.push(formatCount("question", response.relatedQuestions.length));
		for (const q of response.relatedQuestions) {
			parts.push(`- ${q}`);
		}
	} else {
		parts.push("\n## Related");
		parts.push("0 questions");
	}

	parts.push("\n## Meta");
	parts.push(`Provider: ${response.provider}`);
	if (response.model) {
		parts.push(`Model: ${response.model}`);
	}
	if (response.usage) {
		const usageParts: string[] = [];
		if (response.usage.inputTokens !== undefined) usageParts.push(`in ${response.usage.inputTokens}`);
		if (response.usage.outputTokens !== undefined) usageParts.push(`out ${response.usage.outputTokens}`);
		if (response.usage.totalTokens !== undefined) usageParts.push(`total ${response.usage.totalTokens}`);
		if (response.usage.searchRequests !== undefined) usageParts.push(`search ${response.usage.searchRequests}`);
		if (usageParts.length > 0) {
			parts.push(`Usage: ${usageParts.join(" | ")}`);
		}
	}
	if (response.requestId) {
		parts.push(`Request: ${truncateText(response.requestId, 64)}`);
	}
	if (response.searchQueries && response.searchQueries.length > 0) {
		parts.push(`Search queries: ${response.searchQueries.length}`);
		for (const query of response.searchQueries.slice(0, 3)) {
			parts.push(`- ${truncateText(query, 120)}`);
		}
	}

	return parts.join("\n");
}

/** Execute web search */
async function executeWebSearch(
	_toolCallId: string,
	params: WebSearchParams,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: WebSearchRenderDetails }> {
	const { providers, allowFallback } = await resolveProviderChain(params.provider);

	if (providers.length === 0) {
		const message = buildNoProviderError();
		const fallbackProvider = preferredProvider === "auto" ? "anthropic" : preferredProvider;
		return {
			content: [{ type: "text" as const, text: `Error: ${message}` }],
			details: { response: { provider: fallbackProvider, sources: [] }, error: message },
		};
	}

	let lastError: unknown;
	let lastProvider = providers[0];

	for (const provider of providers) {
		lastProvider = provider;
		try {
			let response: WebSearchResponse;
			if (provider === "exa") {
				response = await searchExa({
					query: params.query,
					num_results: params.limit,
				});
			} else if (provider === "anthropic") {
				response = await searchAnthropic({
					query: params.query,
					system_prompt: webSearchSystemPrompt,
					num_results: params.limit,
				});
			} else {
				response = await searchPerplexity({
					query: params.query,
					system_prompt: webSearchSystemPrompt,
					search_recency_filter: params.recency,
					num_results: params.limit,
				});
			}

			const text = formatForLLM(response);

			return {
				content: [{ type: "text" as const, text }],
				details: { response },
			};
		} catch (error) {
			lastError = error;
			if (!allowFallback) break;
		}
	}

	const baseMessage = formatProviderError(lastError, lastProvider);
	const message =
		allowFallback && providers.length > 1
			? `All web search providers failed (${formatProviderList(providers)}). Last error: ${baseMessage}`
			: baseMessage;

	return {
		content: [{ type: "text" as const, text: `Error: ${message}` }],
		details: { response: { provider: lastProvider, sources: [] }, error: message },
	};
}

/**
 * Web search tool implementation.
 *
 * Supports Anthropic, Perplexity, and Exa providers with automatic fallback.
 * Session is accepted for interface consistency but not used.
 */
export class WebSearchTool implements AgentTool<typeof webSearchSchema, WebSearchRenderDetails> {
	public readonly name = "web_search";
	public readonly label = "Web Search";
	public readonly description: string;
	public readonly parameters = webSearchSchema;

	constructor(_session: ToolSession) {
		this.description = renderPromptTemplate(webSearchDescription);
	}

	public async execute(
		_toolCallId: string,
		params: WebSearchParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<WebSearchRenderDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<WebSearchRenderDetails>> {
		return executeWebSearch(_toolCallId, params);
	}
}

/** Web search tool as CustomTool (for TUI rendering support) */
export const webSearchCustomTool: CustomTool<typeof webSearchSchema, WebSearchRenderDetails> = {
	name: "web_search",
	label: "Web Search",
	description: renderPromptTemplate(webSearchDescription),
	parameters: webSearchSchema,

	async execute(
		toolCallId: string,
		params: WebSearchParams,
		_onUpdate,
		_ctx: CustomToolContext,
		_signal?: AbortSignal,
	) {
		return executeWebSearch(toolCallId, params);
	},

	renderCall(args: WebSearchParams, theme: Theme) {
		return renderWebSearchCall(args, theme);
	},

	renderResult(result, options: RenderResultOptions, theme: Theme) {
		return renderWebSearchResult(result, options, theme);
	},
};

// ============================================================================
// Exa-specific tools (available when EXA_API_KEY is present)
// ============================================================================

/** Schema for deep search */
const webSearchDeepSchema = Type.Object({
	query: Type.String({ description: "Research query" }),
	type: Type.Optional(
		StringEnum(["keyword", "neural", "auto"], {
			description: "Search type - neural (semantic), keyword (exact), or auto",
		}),
	),
	include_domains: Type.Optional(
		Type.Array(Type.String(), { description: "Only include results from these domains" }),
	),
	exclude_domains: Type.Optional(Type.Array(Type.String(), { description: "Exclude results from these domains" })),
	start_published_date: Type.Optional(
		Type.String({ description: "Filter results published after this date (ISO 8601)" }),
	),
	end_published_date: Type.Optional(
		Type.String({ description: "Filter results published before this date (ISO 8601)" }),
	),
	num_results: Type.Optional(
		Type.Number({ description: "Maximum results (default: 10, max: 100)", minimum: 1, maximum: 100 }),
	),
});

/** Schema for code context search */
const webSearchCodeContextSchema = Type.Object({
	query: Type.String({ description: "Code or technical search query" }),
	code_context: Type.Optional(Type.String({ description: "Additional context about what you're looking for" })),
});

/** Schema for URL crawling */
const webSearchCrawlSchema = Type.Object({
	url: Type.String({ description: "URL to crawl and extract content from" }),
	text: Type.Optional(Type.Boolean({ description: "Include full page text content (default: false)" })),
	highlights: Type.Optional(Type.Boolean({ description: "Include highlighted relevant snippets (default: false)" })),
});

/** Schema for LinkedIn search */
const webSearchLinkedinSchema = Type.Object({
	query: Type.String({ description: 'LinkedIn search query (e.g., "Software Engineer at OpenAI")' }),
});

/** Schema for company research */
const webSearchCompanySchema = Type.Object({
	company_name: Type.String({ description: "Name of the company to research" }),
});

/** Helper to execute Exa tool and format response */
async function executeExaTool(
	mcpToolName: string,
	params: Record<string, unknown>,
	toolName: string,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: ExaRenderDetails }> {
	try {
		const apiKey = await findExaKey();
		if (!apiKey) {
			return {
				content: [{ type: "text" as const, text: "Error: EXA_API_KEY not found" }],
				details: { error: "EXA_API_KEY not found", toolName },
			};
		}

		const response = await callExaTool(mcpToolName, params, apiKey);

		if (isSearchResponse(response)) {
			const formatted = formatSearchResults(response);
			return {
				content: [{ type: "text" as const, text: formatted }],
				details: { response, toolName },
			};
		}

		return {
			content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
			details: { raw: response, toolName },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text" as const, text: `Error: ${message}` }],
			details: { error: message, toolName },
		};
	}
}

/** Deep search - AI-synthesized research with multiple sources */
export const webSearchDeepTool: CustomTool<typeof webSearchDeepSchema, ExaRenderDetails> = {
	name: "web_search_deep",
	label: "Deep Search",
	description: `Natural language web search with synthesized results (requires Exa).

Performs AI-powered deep research that synthesizes information from multiple sources.
Best for complex research queries that need comprehensive answers.

Parameters:
- query: Research query (required)
- type: Search type - neural (semantic), keyword (exact), or auto
- include_domains/exclude_domains: Domain filters
- start/end_published_date: Date range filter (ISO 8601)
- num_results: Maximum results (default: 10)`,
	parameters: webSearchDeepSchema,

	async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
		const { num_results, ...rest } = params as Record<string, unknown>;
		const args = { ...rest, type: "deep", numResults: num_results ?? 10 };
		return executeExaTool("web_search_exa", args, "web_search_deep");
	},

	renderCall(args, theme) {
		return renderExaCall(args as Record<string, unknown>, "Deep Search", theme);
	},

	renderResult(result, options, theme) {
		return renderExaResult(result, options, theme);
	},
};

/** Code context search - optimized for code snippets and documentation */
export const webSearchCodeContextTool: CustomTool<typeof webSearchCodeContextSchema, ExaRenderDetails> = {
	name: "web_search_code_context",
	label: "Code Search",
	description: `Search code snippets, documentation, and technical examples (requires Exa).

Optimized for finding:
- Code examples and snippets
- API documentation
- Technical tutorials
- Stack Overflow answers
- GitHub code references

Parameters:
- query: Code or technical search query (required)
- code_context: Additional context about what you're looking for`,
	parameters: webSearchCodeContextSchema,

	async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
		return executeExaTool("get_code_context_exa", params as Record<string, unknown>, "web_search_code_context");
	},

	renderCall(args, theme) {
		return renderExaCall(args as Record<string, unknown>, "Code Search", theme);
	},

	renderResult(result, options, theme) {
		return renderExaResult(result, options, theme);
	},
};

/** URL crawl - extract content from specific URLs */
export const webSearchCrawlTool: CustomTool<typeof webSearchCrawlSchema, ExaRenderDetails> = {
	name: "web_search_crawl",
	label: "Crawl URL",
	description: `Extract content from a specific URL (requires Exa).

Fetches and extracts content from a URL with optional text and highlights.
Useful when you have a specific URL and want its content.

Parameters:
- url: URL to crawl (required)
- text: Include full page text content (default: false)
- highlights: Include highlighted snippets (default: false)`,
	parameters: webSearchCrawlSchema,

	async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
		return executeExaTool("crawling", params as Record<string, unknown>, "web_search_crawl");
	},

	renderCall(args, theme) {
		const url = (args as { url: string }).url;
		return renderExaCall({ query: url }, "Crawl URL", theme);
	},

	renderResult(result, options, theme) {
		return renderExaResult(result, options, theme);
	},
};

/** LinkedIn search - search LinkedIn profiles and companies */
export const webSearchLinkedinTool: CustomTool<typeof webSearchLinkedinSchema, ExaRenderDetails> = {
	name: "web_search_linkedin",
	label: "LinkedIn Search",
	description: `Search LinkedIn for people, companies, and professional content (requires Exa + LinkedIn addon).

Returns LinkedIn profiles, company pages, posts, and professional content.

Examples:
- "Software Engineer at OpenAI"
- "Y Combinator companies"
- "CEO fintech startup San Francisco"

Parameters:
- query: LinkedIn search query (required)`,
	parameters: webSearchLinkedinSchema,

	async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
		return executeExaTool("linkedin_search", params as Record<string, unknown>, "web_search_linkedin");
	},

	renderCall(args, theme) {
		return renderExaCall(args as Record<string, unknown>, "LinkedIn Search", theme);
	},

	renderResult(result, options, theme) {
		return renderExaResult(result, options, theme);
	},
};

/** Company research - comprehensive company information */
export const webSearchCompanyTool: CustomTool<typeof webSearchCompanySchema, ExaRenderDetails> = {
	name: "web_search_company",
	label: "Company Research",
	description: `Comprehensive company research (requires Exa + Company addon).

Returns detailed company information including:
- Company overview and description
- Recent news and announcements
- Key people and leadership
- Funding and financial information
- Products and services

Parameters:
- company_name: Name of the company to research (required)`,
	parameters: webSearchCompanySchema,

	async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
		return executeExaTool("company_research", params as Record<string, unknown>, "web_search_company");
	},

	renderCall(args, theme) {
		const name = (args as { company_name: string }).company_name;
		return renderExaCall({ query: name }, "Company Research", theme);
	},

	renderResult(result, options, theme) {
		return renderExaResult(result, options, theme);
	},
};

/** All Exa-specific web search tools */
export const exaWebSearchTools: CustomTool<any, ExaRenderDetails>[] = [
	webSearchDeepTool,
	webSearchCodeContextTool,
	webSearchCrawlTool,
];

/** LinkedIn-specific tool (requires LinkedIn addon on Exa account) */
export const linkedinWebSearchTools: CustomTool<any, ExaRenderDetails>[] = [webSearchLinkedinTool];

/** Company-specific tool (requires Company addon on Exa account) */
export const companyWebSearchTools: CustomTool<any, ExaRenderDetails>[] = [webSearchCompanyTool];

export interface WebSearchToolsOptions {
	/** Enable LinkedIn search tool (requires Exa LinkedIn addon) */
	enableLinkedin?: boolean;
	/** Enable company research tool (requires Exa Company addon) */
	enableCompany?: boolean;
}

/**
 * Get all available web search tools based on API key availability.
 *
 * Returns:
 * - Always: web_search (unified, works with Anthropic/Perplexity/Exa)
 * - With EXA_API_KEY: web_search_deep, web_search_code_context, web_search_crawl
 * - With EXA_API_KEY + options.enableLinkedin: web_search_linkedin
 * - With EXA_API_KEY + options.enableCompany: web_search_company
 */
export async function getWebSearchTools(options: WebSearchToolsOptions = {}): Promise<CustomTool<any, any>[]> {
	const tools: CustomTool<any, any>[] = [webSearchCustomTool];

	// Check for Exa API key
	const exaKey = await findExaKey();
	if (exaKey) {
		tools.push(...exaWebSearchTools);

		if (options.enableLinkedin) {
			tools.push(...linkedinWebSearchTools);
		}
		if (options.enableCompany) {
			tools.push(...companyWebSearchTools);
		}
	}

	return tools;
}

/**
 * Check if Exa-specific web search tools are available.
 */
export async function hasExaWebSearch(): Promise<boolean> {
	const exaKey = await findExaKey();
	return exaKey !== null;
}

export type { WebSearchProvider, WebSearchResponse } from "./types";
