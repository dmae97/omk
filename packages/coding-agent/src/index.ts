// Core session management

// TypeBox helper for string enums (convenience for custom tools)
// Re-export from pi-ai which uses the correct enum-based schema format
export { StringEnum } from "@oh-my-pi/pi-ai";
// Re-export TUI components for custom tool rendering
export { Container, Markdown, Spacer, Text } from "@oh-my-pi/pi-tui";
// Logging
export { logger } from "@oh-my-pi/pi-utils";
export { getAgentDir, VERSION } from "./config";
export { formatKeyHint, formatKeyHints } from "./config/keybindings";
export { ModelRegistry } from "./config/model-registry";
// Prompt templates
export type { PromptTemplate } from "./config/prompt-templates";
export type { CompactionSettings, RetrySettings, SkillsSettings } from "./config/settings";
export { Settings, settings } from "./config/settings";
// Custom commands
export type {
	CustomCommand,
	CustomCommandAPI,
	CustomCommandFactory,
	CustomCommandSource,
	CustomCommandsLoadResult,
	LoadedCustomCommand,
} from "./extensibility/custom-commands/types";
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
} from "./extensibility/custom-tools";
// Custom tools
export { CustomToolLoader, discoverAndLoadCustomTools, loadCustomTools } from "./extensibility/custom-tools";
export type {
	AppAction,
	BashToolCallEvent,
	CustomToolCallEvent,
	EditToolCallEvent,
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
	FindToolCallEvent,
	GrepToolCallEvent,
	InputEvent,
	InputEventResult,
	KeybindingsManager,
	LoadExtensionsResult,
	MessageRenderer,
	MessageRenderOptions,
	ReadToolCallEvent,
	RegisteredCommand,
	ToolCallEvent,
	ToolResultEvent,
	TurnEndEvent,
	TurnStartEvent,
	UserBashEvent,
	UserBashEventResult,
	UserPythonEvent,
	UserPythonEventResult,
	WriteToolCallEvent,
} from "./extensibility/extensions";
// Extension types and utilities
export {
	discoverAndLoadExtensions,
	ExtensionRunner,
	ExtensionRuntime,
	isToolCallEventType,
} from "./extensibility/extensions";
// Hook system types (legacy re-export)
export type * from "./extensibility/hooks";
// Skills
export {
	type LoadSkillsFromDirOptions,
	type LoadSkillsResult,
	loadSkills,
	loadSkillsFromDir,
	type Skill,
	type SkillFrontmatter,
	type SkillWarning,
} from "./extensibility/skills";
// Slash commands
export { type FileSlashCommand, loadSlashCommands as discoverSlashCommands } from "./extensibility/slash-commands";
export type { FileDiagnosticsResult } from "./lsp";
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
} from "./modes";
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
} from "./modes/components";
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
} from "./modes/theme/theme";
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
	discoverPromptTemplates,
	discoverSkills,
	EditTool,
	FindTool,
	GrepTool,
	loadSshTool,
	PythonTool,
	ReadTool,
	type ToolSession,
	WriteTool,
} from "./sdk";
export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type ModelCycleResult,
	type PromptOptions,
	type SessionStats,
} from "./session/agent-session";
// Auth and model registry
export { type ApiKeyCredential, type AuthCredential, AuthStorage, type OAuthCredential } from "./session/auth-storage";
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
} from "./session/compaction";
export { convertToLlm } from "./session/messages";
export {
	type BranchSummaryEntry,
	buildSessionContext,
	type CompactionEntry,
	CURRENT_SESSION_VERSION,
	type CustomEntry,
	type CustomMessageEntry,
	type FileEntry,
	getLatestCompactionEntry,
	type ModeChangeEntry,
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
} from "./session/session-manager";
// Tools (detail types and utilities)
export {
	type BashToolDetails,
	type BashToolInput,
	type BrowserToolDetails,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
	formatSize,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
	type PythonToolDetails,
	type ReadToolDetails,
	type ReadToolInput,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
	type WriteToolDetails,
	type WriteToolInput,
} from "./tools";
