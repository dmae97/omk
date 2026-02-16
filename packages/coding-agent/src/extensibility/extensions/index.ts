/**
 * Extension system for lifecycle events and custom tools.
 */

export type { SlashCommandInfo, SlashCommandLocation, SlashCommandSource } from "../slash-commands";
export { discoverAndLoadExtensions, ExtensionRuntime, loadExtensionFromFactory, loadExtensions } from "./loader";
export type {
	BranchHandler,
	ExtensionErrorListener,
	NavigateTreeHandler,
	NewSessionHandler,
	ShutdownHandler,
	SwitchSessionHandler,
} from "./runner";
export { ExtensionRunner } from "./runner";
export type {
	AgentEndEvent,
	AgentStartEvent,
	// Re-exports
	AgentToolResult,
	AgentToolUpdateCallback,
	AppAction,
	AppendEntryHandler,
	// Events - Tool (ToolCallEvent types)
	BashToolCallEvent,
	BashToolResultEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	// Events - Agent
	ContextEvent,
	// Event Results
	ContextEventResult,
	ContextUsage,
	CustomToolCallEvent,
	CustomToolResultEvent,
	EditToolCallEvent,
	EditToolResultEvent,
	ExecOptions,
	ExecResult,
	Extension,
	ExtensionActions,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionCommandContextActions,
	// Context
	ExtensionContext,
	ExtensionContextActions,
	// Errors
	ExtensionError,
	ExtensionEvent,
	ExtensionFactory,
	ExtensionFlag,
	ExtensionHandler,
	ExtensionShortcut,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	FindToolCallEvent,
	FindToolResultEvent,
	GetActiveToolsHandler,
	GetAllToolsHandler,
	GetCommandsHandler,
	GetThinkingLevelHandler,
	GrepToolCallEvent,
	GrepToolResultEvent,
	// Events - Input
	InputEvent,
	InputEventResult,
	KeybindingsManager,
	LoadExtensionsResult,
	// Message Rendering
	MessageRenderer,
	MessageRenderOptions,
	// Provider Registration
	ProviderConfig,
	ProviderModelConfig,
	ReadToolCallEvent,
	ReadToolResultEvent,
	// Commands
	RegisteredCommand,
	RegisteredTool,
	// Events - Resources
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	SendMessageHandler,
	SendUserMessageHandler,
	SessionBeforeBranchEvent,
	SessionBeforeBranchResult,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionBeforeSwitchEvent,
	SessionBeforeSwitchResult,
	SessionBeforeTreeEvent,
	SessionBeforeTreeResult,
	SessionBranchEvent,
	SessionCompactEvent,
	SessionCompactingEvent,
	SessionCompactingResult,
	SessionEvent,
	SessionShutdownEvent,
	// Events - Session
	SessionStartEvent,
	SessionSwitchEvent,
	SessionTreeEvent,
	SetActiveToolsHandler,
	SetModelHandler,
	SetThinkingLevelHandler,
	// Events - Tool
	ToolCallEvent,
	ToolCallEventResult,
	// Tools
	ToolDefinition,
	ToolRenderResultOptions,
	ToolResultEvent,
	ToolResultEventResult,
	TreePreparation,
	TurnEndEvent,
	TurnStartEvent,
	UserBashEvent,
	UserBashEventResult,
	UserPythonEvent,
	UserPythonEventResult,
	WriteToolCallEvent,
	WriteToolResultEvent,
} from "./types";
// Type guards
export { isToolCallEventType } from "./types";
export { ExtensionToolWrapper, RegisteredToolAdapter, wrapRegisteredTool, wrapRegisteredTools } from "./wrapper";
