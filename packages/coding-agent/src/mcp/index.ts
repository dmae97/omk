/**
 * MCP (Model Context Protocol) support.
 *
 * Provides per-project .mcp.json configuration for connecting to
 * MCP servers via stdio or HTTP transports.
 */

// Client
export { callTool, connectToServer, disconnectServer, listTools, serverSupportsTools } from "./client";
// Config
export type { ExaFilterResult, LoadMCPConfigsOptions, LoadMCPConfigsResult } from "./config";
export {
	extractExaApiKey,
	filterExaMCPServers,
	isExaMCPServer,
	loadAllMCPConfigs,
	validateServerConfig,
} from "./config";
// JSON-RPC (lightweight HTTP-based MCP calls)
export type { JsonRpcResponse } from "./json-rpc";
export { callMCP, parseSSE } from "./json-rpc";
// Loader (for SDK integration)
export type { MCPToolsLoadOptions, MCPToolsLoadResult } from "./loader";
export { discoverAndLoadMCPTools } from "./loader";
// Manager
export type { MCPDiscoverOptions, MCPLoadResult } from "./manager";
export { createMCPManager, MCPManager } from "./manager";
// Tool bridge
export type { MCPToolDetails } from "./tool-bridge";
export { createMCPToolName, DeferredMCPTool, MCPTool, parseMCPToolName } from "./tool-bridge";
// Tool cache
export { MCPToolCache } from "./tool-cache";
// Transports
export { createHttpTransport, HttpTransport } from "./transports/http";
export { createStdioTransport, StdioTransport } from "./transports/stdio";
// Types
export type {
	MCPConfigFile,
	MCPContent,
	MCPHttpServerConfig,
	MCPServerCapabilities,
	MCPServerConfig,
	MCPServerConnection,
	MCPSseServerConfig,
	MCPStdioServerConfig,
	MCPToolDefinition,
	MCPToolWithServer,
	MCPTransport,
} from "./types";
