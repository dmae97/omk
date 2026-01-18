/**
 * Extension system for lifecycle events and custom tools.
 */

export { createExtensionRuntime, discoverAndLoadExtensions, loadExtensionFromFactory, loadExtensions } from "./loader";
export type {
	BranchHandler,
	ExtensionErrorListener,
	NavigateTreeHandler,
	NewSessionHandler,
	ShutdownHandler,
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
	BashToolResultEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	// Events - Agent
	ContextEvent,
	// Event Results
	ContextEventResult,
	CustomToolResultEvent,
	EditToolResultEvent,
	ExecOptions,
	ExecResult,
	Extension,
	ExtensionActions,
	// API
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
	ExtensionRuntime,
	ExtensionShortcut,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	FindToolResultEvent,
	GetActiveToolsHandler,
	GetAllToolsHandler,
	GetThinkingLevelHandler,
	GrepToolResultEvent,
	InputEvent,
	InputEventResult,
	KeybindingsManager,
	LoadExtensionsResult,
	LsToolResultEvent,
	// Message Rendering
	MessageRenderer,
	MessageRenderOptions,
	ReadToolResultEvent,
	// Commands
	RegisteredCommand,
	RegisteredTool,
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
	WriteToolResultEvent,
} from "./types";
// Type guards
export {
	isBashToolResult,
	isEditToolResult,
	isFindToolResult,
	isGrepToolResult,
	isLsToolResult,
	isReadToolResult,
	isWriteToolResult,
} from "./types";
export { wrapRegisteredTool, wrapRegisteredTools, wrapToolWithExtensions } from "./wrapper";
