// Core session management

// TypeBox helper for string enums (convenience for custom tools)
// Re-export from pi-ai which uses the correct enum-based schema format
export { StringEnum } from "@oh-my-pi/pi-ai";
// Re-export TUI components for custom tool rendering
export { Container, Markdown, Spacer, Text } from "@oh-my-pi/pi-tui";
// Logging
export { logger } from "@oh-my-pi/pi-utils";
export { getAgentDir, VERSION } from "./config";
export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type ModelCycleResult,
	type PromptOptions,
	type SessionStats,
} from "./core/agent-session";
// Auth and model registry
export { type ApiKeyCredential, type AuthCredential, AuthStorage, type OAuthCredential } from "./core/auth-storage";
// Compaction
export {
	type BranchPreparation,
	type BranchSummaryResult,
	type CollectEntriesResult,
	type CompactionResult,
	type CutPointResult,
	calculateContextTokens,
	collectEntriesForBranchSummary,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens,
	type FileOperations,
	findCutPoint,
	findTurnStartIndex,
	type GenerateBranchSummaryOptions,
	generateBranchSummary,
	generateSummary,
	getLastAssistantUsage,
	prepareBranchEntries,
	serializeConversation,
	shouldCompact,
} from "./core/compaction/index";
// Custom commands
export type {
	CustomCommand,
	CustomCommandAPI,
	CustomCommandFactory,
	CustomCommandSource,
	CustomCommandsLoadResult,
	LoadedCustomCommand,
} from "./core/custom-commands/types";
export type {
	AgentToolUpdateCallback,
	CustomTool,
	CustomToolAPI,
	CustomToolContext,
	CustomToolFactory,
	CustomToolSessionEvent,
	CustomToolsLoadResult,
	CustomToolUIContext,
	ExecResult,
	LoadedCustomTool,
	RenderResultOptions,
} from "./core/custom-tools/index";
// Custom tools
export { CustomToolLoader, discoverAndLoadCustomTools, loadCustomTools } from "./core/custom-tools/index";
export type {
	AppAction,
	Extension,
	ExtensionActions,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionCommandContextActions,
	ExtensionContext,
	ExtensionContextActions,
	ExtensionError,
	ExtensionEvent,
	ExtensionFactory,
	ExtensionFlag,
	ExtensionHandler,
	ExtensionShortcut,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	InputEvent,
	InputEventResult,
	KeybindingsManager,
	LoadExtensionsResult,
	MessageRenderer,
	MessageRenderOptions,
	RegisteredCommand,
	ToolResultEvent,
	TurnEndEvent,
	TurnStartEvent,
	UserBashEvent,
	UserBashEventResult,
	UserPythonEvent,
	UserPythonEventResult,
} from "./core/extensions/index";
// Extension types and utilities
export {
	discoverAndLoadExtensions,
	ExtensionRunner,
	ExtensionRuntime,
	isBashToolResult,
	isEditToolResult,
	isFindToolResult,
	isGrepToolResult,
	isLsToolResult,
	isReadToolResult,
	isWriteToolResult,
} from "./core/extensions/index";
// Hook system types (legacy re-export)
export type * from "./core/hooks/index";
export { formatKeyHint, formatKeyHints } from "./core/keybindings";
export { convertToLlm } from "./core/messages";
export { ModelRegistry } from "./core/model-registry";
// Prompt templates
export type { PromptTemplate } from "./core/prompt-templates";
// SDK for programmatic usage
export {
	// Factory
	BashTool,
	// Tool factories
	BUILTIN_TOOLS,
	type BuildSystemPromptOptions,
	buildSystemPrompt,
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
	createAgentSession,
	createTools,
	// Discovery
	discoverAuthStorage,
	discoverContextFiles,
	discoverCustomTSCommands,
	discoverExtensions,
	discoverMCPServers,
	discoverModels,
	discoverPromptTemplates,
	discoverSkills,
	EditTool,
	FindTool,
	GrepTool,
	LsTool,
	loadSettings,
	loadSshTool,
	PythonTool,
	ReadTool,
	type ToolSession,
	WriteTool,
} from "./core/sdk";
export {
	type BranchSummaryEntry,
	buildSessionContext,
	type CompactionEntry,
	CURRENT_SESSION_VERSION,
	type CustomEntry,
	type CustomMessageEntry,
	type FileEntry,
	getLatestCompactionEntry,
	type ModelChangeEntry,
	migrateSessionEntries,
	type NewSessionOptions,
	parseSessionEntries,
	type SessionContext,
	type SessionEntry,
	type SessionEntryBase,
	type SessionHeader,
	type SessionInfo,
	SessionManager,
	type SessionMessageEntry,
	type ThinkingLevelChangeEntry,
} from "./core/session-manager";
export {
	type CompactionSettings,
	type ImageSettings,
	type LspSettings,
	type RetrySettings,
	type Settings,
	SettingsManager,
	type SkillsSettings,
} from "./core/settings-manager";
// Skills
export {
	type LoadSkillsFromDirOptions,
	type LoadSkillsResult,
	loadSkills,
	loadSkillsFromDir,
	type Skill,
	type SkillFrontmatter,
	type SkillWarning,
} from "./core/skills";
// Slash commands
export { type FileSlashCommand, loadSlashCommands as discoverSlashCommands } from "./core/slash-commands";
// Tools (detail types and utilities)
export {
	type BashToolDetails,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type FindOperations,
	type FindToolDetails,
	type FindToolOptions,
	formatSize,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolOptions,
	type LsOperations,
	type LsToolDetails,
	type LsToolOptions,
	type PythonToolDetails,
	type ReadToolDetails,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
	type WriteToolDetails,
} from "./core/tools/index";
export type { FileDiagnosticsResult } from "./core/tools/lsp/index";
// Main entry point
export { main } from "./main";
// Run modes for programmatic SDK usage
export {
	InteractiveMode,
	type InteractiveModeOptions,
	type PrintModeOptions,
	RpcClient,
	type RpcClientOptions,
	type RpcEventListener,
	runPrintMode,
	runRpcMode,
} from "./modes/index";
// UI components for extensions
export {
	ArminComponent,
	AssistantMessageComponent,
	BashExecutionComponent,
	BorderedLoader,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomEditor,
	CustomMessageComponent,
	DynamicBorder,
	FooterComponent,
	HookEditorComponent as ExtensionEditorComponent,
	HookInputComponent as ExtensionInputComponent,
	HookSelectorComponent as ExtensionSelectorComponent,
	LoginDialogComponent,
	ModelSelectorComponent,
	OAuthSelectorComponent,
	type RenderDiffOptions,
	renderDiff,
	SessionSelectorComponent,
	type SettingsCallbacks,
	SettingsSelectorComponent,
	ShowImagesSelectorComponent,
	ThemeSelectorComponent,
	ThinkingSelectorComponent,
	ToolExecutionComponent,
	type ToolExecutionOptions,
	TreeSelectorComponent,
	truncateToVisualLines,
	UserMessageComponent,
	UserMessageSelectorComponent,
	type VisualTruncateResult,
} from "./modes/interactive/components/index";
// Theme utilities for custom tools
export {
	getLanguageFromPath,
	getMarkdownTheme,
	getSelectListTheme,
	getSettingsListTheme,
	highlightCode,
	initTheme,
	Theme,
	type ThemeColor,
} from "./modes/interactive/theme/theme";
export { getShellConfig } from "./utils/shell";
