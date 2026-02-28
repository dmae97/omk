/**
 * Unified Web Search Tool
 *
 * Single tool supporting Anthropic, Perplexity, Exa, Brave, Jina, Kimi, Gemini, Codex, Z.AI, and Synthetic
 * providers with provider-specific parameters exposed conditionally.
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
import { renderPromptTemplate } from "../../config/prompt-templates";
import { callExaTool, findApiKey as findExaKey, formatSearchResults, isSearchResponse } from "../../exa/mcp-client";
import { renderExaCall, renderExaResult } from "../../exa/render";
import type { ExaRenderDetails } from "../../exa/types";
import type { CustomTool, CustomToolContext, RenderResultOptions } from "../../extensibility/custom-tools/types";
import type { Theme } from "../../modes/theme/theme";
import webSearchSystemPrompt from "../../prompts/system/web-search.md" with { type: "text" };
import webSearchDescription from "../../prompts/tools/web-search.md" with { type: "text" };
import type { ToolSession } from "../../tools";
import { formatAge } from "../../tools/render-utils";
import { getSearchProvider, resolveProviderChain, type SearchProvider } from "./provider";
import { renderSearchCall, renderSearchResult, type SearchRenderDetails } from "./render";
import type { SearchResponse } from "./types";
import { SearchProviderError } from "./types";

/** Web search parameters schema */
export const webSearchSchema = Type.Object({
	query: Type.String({ description: "Search query" }),
	provider: Type.Optional(
		StringEnum(
			["auto", "exa", "brave", "jina", "kimi", "zai", "anthropic", "perplexity", "gemini", "codex", "synthetic"],
			{
				description: "Search provider (default: auto)",
			},
		),
	),
	recency: Type.Optional(
		StringEnum(["day", "week", "month", "year"], {
			description: "Recency filter (Brave, Perplexity)",
		}),
	),
	limit: Type.Optional(Type.Number({ description: "Max results to return" })),
	max_tokens: Type.Optional(Type.Number({ description: "Maximum output tokens" })),
	temperature: Type.Optional(Type.Number({ description: "Sampling temperature" })),
	num_search_results: Type.Optional(Type.Number({ description: "Number of search results to retrieve" })),
});

export type SearchParams = {
	query: string;
	provider?:
		| "auto"
		| "exa"
		| "brave"
		| "jina"
		| "kimi"
		| "zai"
		| "anthropic"
		| "perplexity"
		| "gemini"
		| "codex"
		| "synthetic";
	recency?: "day" | "week" | "month" | "year";
	limit?: number;
	/** Maximum output tokens. Defaults to 4096. */
	max_tokens?: number;
	/** Sampling temperature (0–1). Lower = more focused/factual. Defaults to 0.2. */
	temperature?: number;
	/** Number of search results to retrieve. Defaults to 10. */
	num_search_results?: number;
	/** Deprecated CLI flag; explicit provider fallback now happens only when provider is unavailable. */
	no_fallback?: boolean;
};

function formatProviderList(providers: SearchProvider[]): string {
	return providers.map(provider => provider.label).join(", ");
}

function formatProviderError(error: unknown, provider: SearchProvider): string {
	if (error instanceof SearchProviderError) {
		if (error.provider === "anthropic" && error.status === 404) {
			return "Anthropic web search returned 404 (model or endpoint not found).";
		}
		if (error.status === 401 || error.status === 403) {
			if (error.provider === "zai") {
				return error.message;
			}
			return `${getSearchProvider(error.provider).label} authorization failed (${error.status}). Check API key or base URL.`;
		}
		return error.message;
	}
	if (error instanceof Error) return error.message;
	return `Unknown error from ${provider.label}`;
}

/** Truncate text for tool output */
function truncateText(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

function formatCount(label: string, count: number): string {
	return `${count} ${label}${count === 1 ? "" : "s"}`;
}

/** Format response for LLM consumption */
function formatForLLM(response: SearchResponse): string {
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
async function executeSearch(
	_toolCallId: string,
	params: SearchParams,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: SearchRenderDetails }> {
	const providers =
		params.provider && params.provider !== "auto"
			? (await getSearchProvider(params.provider).isAvailable())
				? [getSearchProvider(params.provider)]
				: await resolveProviderChain("auto")
			: await resolveProviderChain(params.provider);
	if (providers.length === 0) {
		const message = "No web search provider configured.";
		return {
			content: [{ type: "text" as const, text: `Error: ${message}` }],
			details: { response: { provider: "none", sources: [] }, error: message },
		};
	}

	let lastError: unknown;
	let lastProvider = providers[0];

	for (const provider of providers) {
		lastProvider = provider;
		try {
			const response = await provider.search({
				query: params.query.replace(/202\d/g, String(new Date().getFullYear())), // LUL
				limit: params.limit,
				recency: params.recency,
				systemPrompt: webSearchSystemPrompt,
				maxOutputTokens: params.max_tokens,
				numSearchResults: params.num_search_results,
				temperature: params.temperature,
			});

			const text = formatForLLM(response);

			return {
				content: [{ type: "text" as const, text }],
				details: { response },
			};
		} catch (error) {
			lastError = error;
		}
	}

	const baseMessage = formatProviderError(lastError, lastProvider);
	const message =
		providers.length > 1
			? `All web search providers failed (${formatProviderList(providers)}). Last error: ${baseMessage}`
			: baseMessage;

	return {
		content: [{ type: "text" as const, text: `Error: ${message}` }],
		details: { response: { provider: lastProvider.id, sources: [] }, error: message },
	};
}

/**
 * Execute a web search query for CLI/testing workflows.
 */
export async function runSearchQuery(
	params: SearchParams,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: SearchRenderDetails }> {
	return executeSearch("cli-web-search", params);
}

/**
 * Web search tool implementation.
 *
 * Supports Anthropic, Perplexity, Exa, Brave, Jina, Kimi, Gemini, Codex, Z.AI, and Synthetic providers with automatic fallback.
 * Session is accepted for interface consistency but not used.
 */
export class SearchTool implements AgentTool<typeof webSearchSchema, SearchRenderDetails> {
	readonly name = "web_search";
	readonly label = "Web Search";
	readonly description: string;
	readonly parameters = webSearchSchema;
	readonly strict = true;

	constructor(_session: ToolSession) {
		this.description = renderPromptTemplate(webSearchDescription);
	}

	async execute(
		_toolCallId: string,
		params: SearchParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SearchRenderDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<SearchRenderDetails>> {
		return executeSearch(_toolCallId, params);
	}
}

/** Web search tool as CustomTool (for TUI rendering support) */
export const webSearchCustomTool: CustomTool<typeof webSearchSchema, SearchRenderDetails> = {
	name: "web_search",
	label: "Web Search",
	description: renderPromptTemplate(webSearchDescription),
	parameters: webSearchSchema,

	async execute(toolCallId: string, params: SearchParams, _onUpdate, _ctx: CustomToolContext, _signal?: AbortSignal) {
		return executeSearch(toolCallId, params);
	},

	renderCall(args: SearchParams, options: RenderResultOptions, theme: Theme) {
		return renderSearchCall(args, options, theme);
	},

	renderResult(result, options: RenderResultOptions, theme: Theme) {
		return renderSearchResult(result, options, theme);
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
		const args = { ...rest, type: "auto", numResults: num_results ?? 10 };
		return executeExaTool("web_search_exa", args, "web_search_deep");
	},

	renderCall(args, _options, theme) {
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

	renderCall(args, _options, theme) {
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
		return executeExaTool("crawling_exa", params as Record<string, unknown>, "web_search_crawl");
	},

	renderCall(args, _options, theme) {
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
		return executeExaTool("linkedin_search_exa", params as Record<string, unknown>, "web_search_linkedin");
	},

	renderCall(args, _options, theme) {
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
		return executeExaTool("company_research_exa", params as Record<string, unknown>, "web_search_company");
	},

	renderCall(args, _options, theme) {
		const name = (args as { company_name: string }).company_name;
		return renderExaCall({ query: name }, "Company Research", theme);
	},

	renderResult(result, options, theme) {
		return renderExaResult(result, options, theme);
	},
};

/** All Exa-specific web search tools */
export const exaSearchTools: CustomTool<any, ExaRenderDetails>[] = [
	webSearchDeepTool,
	webSearchCodeContextTool,
	webSearchCrawlTool,
];

/** LinkedIn-specific tool (requires LinkedIn addon on Exa account) */
export const linkedinSearchTools: CustomTool<any, ExaRenderDetails>[] = [webSearchLinkedinTool];

/** Company-specific tool (requires Company addon on Exa account) */
export const companySearchTools: CustomTool<any, ExaRenderDetails>[] = [webSearchCompanyTool];

export interface SearchToolsOptions {
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
 * - Always: web_search_deep, web_search_code_context (public Exa MCP tools)
 * - With EXA_API_KEY: web_search_crawl
 * - With EXA_API_KEY + options.enableLinkedin: web_search_linkedin
 * - With EXA_API_KEY + options.enableCompany: web_search_company
 */
export async function getSearchTools(options: SearchToolsOptions = {}): Promise<CustomTool<any, any>[]> {
	const tools: CustomTool<any, any>[] = [webSearchCustomTool];

	tools.push(webSearchDeepTool, webSearchCodeContextTool);

	// Advanced/add-on tools remain key-gated to avoid exposing known unauthenticated failures
	const exaKey = await findExaKey();
	if (exaKey) {
		tools.push(webSearchCrawlTool);

		if (options.enableLinkedin) {
			tools.push(...linkedinSearchTools);
		}
		if (options.enableCompany) {
			tools.push(...companySearchTools);
		}
	}

	return tools;
}
export {
	getSearchProvider,
	setPreferredSearchProvider,
} from "./provider";
export type { SearchProviderId as SearchProvider, SearchResponse } from "./types";
