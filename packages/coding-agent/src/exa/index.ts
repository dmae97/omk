/**
 * Exa MCP Tools
 *
 * 22 tools for Exa's MCP servers:
 * - 4 search tools (search, deep, code, crawl)
 * - 1 LinkedIn search tool
 * - 1 company research tool
 * - 2 researcher tools (start, poll)
 * - 14 websets tools (CRUD, items, search, enrichment, monitor)
 */
import type { CustomTool } from "../extensibility/custom-tools/types";
import { companyTool } from "./company";
import { linkedinTool } from "./linkedin";
import { researcherTools } from "./researcher";
import { searchTools } from "./search";
import type { ExaRenderDetails } from "./types";
import { websetsTools } from "./websets";

/** All Exa tools (22 total) - static export for backward compatibility */
export const exaTools: CustomTool<any, ExaRenderDetails>[] = [
	...searchTools,
	linkedinTool,
	companyTool,
	...researcherTools,
	...websetsTools,
];

export { companyTool } from "./company";
export { linkedinTool } from "./linkedin";
export * from "./mcp-client";
export { renderExaCall, renderExaResult } from "./render";
export { researcherTools } from "./researcher";
// Re-export individual modules for selective importing
export { searchTools } from "./search";
// Re-export types and utilities
export type { ExaRenderDetails, ExaSearchResponse, ExaSearchResult, MCPToolWrapperConfig } from "./types";
export { websetsTools } from "./websets";
