/**
 * Core modules shared between all run modes.
 */

export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type ModelCycleResult,
	type PromptOptions,
	type SessionStats,
} from "./agent-session";
export { type BashExecutorOptions, type BashResult, executeBash, executeBashWithOperations } from "./bash-executor";
export type { CompactionResult } from "./compaction/index";
export {
	discoverAndLoadExtensions,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ExtensionFactory,
	ExtensionRunner,
	type ExtensionUIContext,
	type ExtensionUIDialogOptions,
	loadExtensionFromFactory,
	type ToolDefinition,
} from "./extensions/index";
export { HistoryStorage } from "./history-storage";
export {
	createMCPManager,
	discoverAndLoadMCPTools,
	loadAllMCPConfigs,
	type MCPConfigFile,
	type MCPLoadResult,
	MCPManager,
	type MCPServerConfig,
	type MCPServerConnection,
	MCPToolCache,
	type MCPToolDefinition,
	type MCPToolDetails,
	type MCPToolsLoadResult,
	type MCPTransport,
} from "./mcp/index";
export {
	buildRemoteCommand,
	closeAllConnections,
	closeConnection,
	ensureConnection,
	getControlDir,
	getControlPathTemplate,
	type SSHConnectionTarget,
} from "./ssh/connection-manager";
export { executeSSH, type SSHExecutorOptions, type SSHResult } from "./ssh/ssh-executor";
export { hasSshfs, isMounted, mountRemote, unmountAll, unmountRemote } from "./ssh/sshfs-mount";

export * as utils from "./utils";
