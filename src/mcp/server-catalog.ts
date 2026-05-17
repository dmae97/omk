/**
 * Curated catalog of MCP servers that pair well with oh-my-kimi.
 *
 * These servers were discovered via the GitHub MCP ecosystem and verified
 * against the npm registry. They cover categories useful for agentic
 * coding: reasoning, memory, documentation, web, and devtools.
 */

export interface McpCatalogEntry {
  /** Unique server name (used as the key in mcp.json) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Command to run the server */
  command: string;
  /** Arguments passed to the command */
  args: string[];
  /** Category for grouping in the init UI */
  category: "reasoning" | "memory" | "docs" | "web" | "devtools" | "ops";
  /** Environment variables to suppress noisy npm warnings in MCP client input */
  env?: Record<string, string>;
  /** Estimated cold-start timeout in seconds */
  startupTimeoutSec?: number;
  /** Whether this server is already commonly bundled with OMK projects */
  bundled?: boolean;
}

/**
 * Recommended MCP servers for OMK agentic coding workflows.
 *
 * All entries use `npx` so no global npm installation is required.
 * Servers with `bundled: true` are pre-selected hints for OMK users.
 */
const SILENT_NPX_ENV = { npm_config_loglevel: "error", NODE_NO_WARNINGS: "1" };

export const RECOMMENDED_MCP_SERVERS: McpCatalogEntry[] = [
  // ── Reasoning ──
  {
    name: "sequential-thinking",
    description: "Sequential thinking and structured problem-solving tools",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    category: "reasoning",
    env: SILENT_NPX_ENV,
    startupTimeoutSec: 15,
  },

  // ── Memory ──
  {
    name: "memory",
    description: "Persistent knowledge-graph memory across sessions",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    category: "memory",
    env: SILENT_NPX_ENV,
    startupTimeoutSec: 15,
  },

  // ── Docs ──
  {
    name: "context7",
    description: "Current library/API documentation via Context7 MCP",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    category: "docs",
    env: SILENT_NPX_ENV,
    startupTimeoutSec: 15,
    bundled: true,
  },
  {
    name: "pdf",
    description: "Load and extract text from PDF files with pagination",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-pdf", "--stdio"],
    category: "docs",
    env: SILENT_NPX_ENV,
    startupTimeoutSec: 15,
  },

  // ── Web ──
  {
    name: "fetch",
    description: "Fetch and convert web content for agent-readable context",
    command: "uvx",
    args: ["mcp-server-fetch"],
    category: "web",
    startupTimeoutSec: 15,
    bundled: true,
  },
  {
    name: "puppeteer",
    description: "Browser automation via Puppeteer (screenshots, navigation, DOM)",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    category: "web",
    env: SILENT_NPX_ENV,
    startupTimeoutSec: 20,
  },
  {
    name: "playwright",
    description: "Official Microsoft Playwright MCP server for browser UI verification",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    category: "web",
    env: SILENT_NPX_ENV,
    startupTimeoutSec: 20,
  },

  // ── DevTools ──
  {
    name: "github",
    description: "GitHub official remote MCP server (auth may be required by the host)",
    command: "https://api.githubcopilot.com/mcp/",
    args: [],
    category: "devtools",
    startupTimeoutSec: 15,
    bundled: true,
  },
  {
    name: "filesystem",
    description: "Project-local filesystem access (read, write, list, search)",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${PROJECT_ROOT}"],
    category: "devtools",
    env: SILENT_NPX_ENV,
    startupTimeoutSec: 10,
  },
  {
    name: "filesystem-readonly",
    description:
      "OMK bundled project-local filesystem inspection for worktree review lanes; exposes read/list/search tools only.",
    command: "omk",
    args: ["mcp", "serve", "filesystem-readonly"],
    category: "devtools",
    env: { OMK_MCP_MODE: "readonly" },
    startupTimeoutSec: 10,
  },

  // ── Ops ──
  {
    name: "supabase",
    description: "Supabase MCP server for database management, edge functions, and project operations (requires SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF)",
    command: "npx",
    args: ["-y", "@supabase/mcp-server-supabase@latest"],
    category: "ops",
    env: SILENT_NPX_ENV,
    startupTimeoutSec: 15,
  },
  {
    name: "railway-unofficial",
    description: "Unofficial Railway MCP server by jason-tan-swe that calls the Railway GraphQL API directly (requires RAILWAY_API_TOKEN; does not need Railway CLI)",
    command: "npx",
    args: ["-y", "@jasontanswe/railway-mcp"],
    category: "ops",
    env: SILENT_NPX_ENV,
    startupTimeoutSec: 20,
  },
];

/**
 * Return catalog entries, optionally filtered by category.
 */
export function getCatalogForInit(
  filterCategory?: McpCatalogEntry["category"]
): McpCatalogEntry[] {
  if (!filterCategory) return RECOMMENDED_MCP_SERVERS;
  return RECOMMENDED_MCP_SERVERS.filter((s) => s.category === filterCategory);
}

/**
 * Get default selections for OMK init.
 * Returns names of servers marked `bundled: true`.
 */
export function getDefaultSelections(): string[] {
  return RECOMMENDED_MCP_SERVERS.filter((s) => s.bundled).map((s) => s.name);
}
