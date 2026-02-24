/**
 * Exa Search Tools
 *
 * Basic neural/keyword search, deep research, code search, and URL crawling.
 */
import { StringEnum } from "@oh-my-pi/pi-ai";
import { Type } from "@sinclair/typebox";
import type { CustomTool } from "../extensibility/custom-tools/types";
import { createExaTool } from "./factory";
import type { ExaRenderDetails } from "./types";

/** exa_search - Basic neural/keyword search */
const exaSearchTool = createExaTool(
	"exa_search",
	"Exa Search",
	`Search the web using Exa's neural or keyword search.

Returns structured search results with optional text content and highlights.

Parameters:
- query: Search query (required)
- type: Search type - "neural" (semantic), "keyword" (exact), or "auto" (default: auto)
- include_domains: Array of domains to include in results
- exclude_domains: Array of domains to exclude from results
- start_published_date: Filter results published after this date (ISO 8601)
- end_published_date: Filter results published before this date (ISO 8601)
- use_autoprompt: Let Exa optimize your query automatically (default: true)
- text: Include page text content in results (default: false, costs more)
- highlights: Include highlighted relevant snippets (default: false)
- num_results: Maximum number of results to return (default: 10, max: 100)`,

	Type.Object({
		query: Type.String({ description: "Search query" }),
		type: Type.Optional(
			StringEnum(["keyword", "neural", "auto"], {
				description: "Search type - neural (semantic), keyword (exact), or auto",
			}),
		),
		include_domains: Type.Optional(
			Type.Array(Type.String(), {
				description: "Only include results from these domains",
			}),
		),
		exclude_domains: Type.Optional(
			Type.Array(Type.String(), {
				description: "Exclude results from these domains",
			}),
		),
		start_published_date: Type.Optional(
			Type.String({
				description: "Filter results published after this date (ISO 8601 format)",
			}),
		),
		end_published_date: Type.Optional(
			Type.String({
				description: "Filter results published before this date (ISO 8601 format)",
			}),
		),
		use_autoprompt: Type.Optional(
			Type.Boolean({
				description: "Let Exa optimize your query automatically (default: true)",
			}),
		),
		text: Type.Optional(
			Type.Boolean({
				description: "Include page text content in results (costs more, default: false)",
			}),
		),
		highlights: Type.Optional(
			Type.Boolean({
				description: "Include highlighted relevant snippets (default: false)",
			}),
		),
		num_results: Type.Optional(
			Type.Number({
				description: "Maximum number of results to return (default: 10, max: 100)",
				minimum: 1,
				maximum: 100,
			}),
		),
	}),
	"web_search_exa",
);

/** exa_search_deep - AI-synthesized deep research */
const exaSearchDeepTool = createExaTool(
	"exa_search_deep",
	"Exa Deep Search",
	`Perform AI-synthesized deep research using Exa.

Returns comprehensive research with synthesized answers and multiple sources.

Similar parameters to exa_search, optimized for research depth.`,

	Type.Object({
		query: Type.String({ description: "Research query" }),
		type: Type.Optional(
			StringEnum(["keyword", "neural", "auto"], {
				description: "Search type - neural (semantic), keyword (exact), or auto",
			}),
		),
		include_domains: Type.Optional(
			Type.Array(Type.String(), {
				description: "Only include results from these domains",
			}),
		),
		exclude_domains: Type.Optional(
			Type.Array(Type.String(), {
				description: "Exclude results from these domains",
			}),
		),
		start_published_date: Type.Optional(
			Type.String({
				description: "Filter results published after this date (ISO 8601 format)",
			}),
		),
		end_published_date: Type.Optional(
			Type.String({
				description: "Filter results published before this date (ISO 8601 format)",
			}),
		),
		use_autoprompt: Type.Optional(
			Type.Boolean({
				description: "Let Exa optimize your query automatically (default: true)",
			}),
		),
		text: Type.Optional(
			Type.Boolean({
				description: "Include page text content in results (costs more, default: false)",
			}),
		),
		highlights: Type.Optional(
			Type.Boolean({
				description: "Include highlighted relevant snippets (default: false)",
			}),
		),
		num_results: Type.Optional(
			Type.Number({
				description: "Maximum number of results to return (default: 10, max: 100)",
				minimum: 1,
				maximum: 100,
			}),
		),
	}),
	"web_search_exa",
	{ transformParams: params => ({ ...params, type: "deep" }) },
);

/** exa_search_code - Code-focused search */
const exaSearchCodeTool = createExaTool(
	"exa_search_code",
	"Exa Code Search",
	`Search for code examples and technical documentation using Exa.

Optimized for finding code snippets, API documentation, and technical content.

Parameters:
- query: Code or technical search query (required)
- code_context: Additional context about what you're looking for`,

	Type.Object({
		query: Type.String({ description: "Code or technical search query" }),
		code_context: Type.Optional(
			Type.String({
				description: "Additional context about what you're looking for",
			}),
		),
	}),
	"get_code_context_exa",
);

/** exa_crawl - URL content extraction */
const exaCrawlTool = createExaTool(
	"exa_crawl",
	"Exa Crawl",
	`Extract content from a specific URL using Exa.

Returns the page content with optional text and highlights.

Parameters:
- url: URL to crawl (required)
- text: Include full page text content (default: false)
- highlights: Include highlighted relevant snippets (default: false)`,

	Type.Object({
		url: Type.String({ description: "URL to crawl and extract content from" }),
		text: Type.Optional(
			Type.Boolean({
				description: "Include full page text content (default: false)",
			}),
		),
		highlights: Type.Optional(
			Type.Boolean({
				description: "Include highlighted relevant snippets (default: false)",
			}),
		),
	}),
	"crawling_exa",
);

export const searchTools: CustomTool<any, ExaRenderDetails>[] = [
	exaSearchTool,
	exaSearchDeepTool,
	exaSearchCodeTool,
	exaCrawlTool,
];
