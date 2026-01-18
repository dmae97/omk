import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, ImageContent, Message } from "@oh-my-pi/pi-ai";
import type { Component, Container, Loader, Spacer, Text, TUI } from "@oh-my-pi/pi-tui";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session";
import type { ExtensionUIContext } from "../../core/extensions/index";
import type { CompactOptions } from "../../core/extensions/types";
import type { HistoryStorage } from "../../core/history-storage";
import type { KeybindingsManager } from "../../core/keybindings";
import type { SessionContext, SessionManager } from "../../core/session-manager";
import type { SettingsManager } from "../../core/settings-manager";
import type { VoiceSupervisor } from "../../core/voice-supervisor";
import type { AssistantMessageComponent } from "./components/assistant-message";
import type { BashExecutionComponent } from "./components/bash-execution";
import type { CustomEditor } from "./components/custom-editor";
import type { HookEditorComponent } from "./components/hook-editor";
import type { HookInputComponent } from "./components/hook-input";
import type { HookSelectorComponent } from "./components/hook-selector";
import type { StatusLineComponent } from "./components/status-line";
import type { ToolExecutionHandle } from "./components/tool-execution";
import type { Theme } from "./theme/theme";

export type CompactionQueuedMessage = {
	text: string;
	mode: "steer" | "followUp";
};

export type TodoItem = {
	id: string;
	content: string;
	activeForm: string;
	status: "pending" | "in_progress" | "completed";
};

export interface InteractiveModeContext {
	// UI access
	ui: TUI;
	chatContainer: Container;
	pendingMessagesContainer: Container;
	statusContainer: Container;
	todoContainer: Container;
	editor: CustomEditor;
	editorContainer: Container;
	statusLine: StatusLineComponent;

	// Session access
	session: AgentSession;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	keybindings: KeybindingsManager;
	agent: AgentSession["agent"];
	voiceSupervisor: VoiceSupervisor;
	historyStorage?: HistoryStorage;

	// State
	isInitialized: boolean;
	isBackgrounded: boolean;
	isBashMode: boolean;
	toolOutputExpanded: boolean;
	todoExpanded: boolean;
	hideThinkingBlock: boolean;
	pendingImages: ImageContent[];
	compactionQueuedMessages: CompactionQueuedMessage[];
	pendingTools: Map<string, ToolExecutionHandle>;
	pendingBashComponents: BashExecutionComponent[];
	bashComponent: BashExecutionComponent | undefined;
	streamingComponent: AssistantMessageComponent | undefined;
	streamingMessage: AssistantMessage | undefined;
	loadingAnimation: Loader | undefined;
	autoCompactionLoader: Loader | undefined;
	retryLoader: Loader | undefined;
	autoCompactionEscapeHandler?: () => void;
	retryEscapeHandler?: () => void;
	unsubscribe?: () => void;
	onInputCallback?: (input: { text: string; images?: ImageContent[] }) => void;
	lastSigintTime: number;
	lastEscapeTime: number;
	lastVoiceInterruptAt: number;
	voiceAutoModeEnabled: boolean;
	shutdownRequested: boolean;
	voiceProgressTimer: ReturnType<typeof setTimeout> | undefined;
	voiceProgressSpoken: boolean;
	voiceProgressLastLength: number;
	hookSelector: HookSelectorComponent | undefined;
	hookInput: HookInputComponent | undefined;
	hookEditor: HookEditorComponent | undefined;
	lastStatusSpacer: Spacer | undefined;
	lastStatusText: Text | undefined;
	fileSlashCommands: Set<string>;
	skillCommands: Map<string, string>;
	todoItems: TodoItem[];

	// Lifecycle
	init(): Promise<void>;
	shutdown(): Promise<void>;
	checkShutdownRequested(): Promise<void>;

	// Extension UI integration
	setToolUIContext(uiContext: ExtensionUIContext, hasUI: boolean): void;
	initializeHookRunner(uiContext: ExtensionUIContext, hasUI: boolean): void;
	createBackgroundUiContext(): ExtensionUIContext;

	// Event handling
	handleBackgroundEvent(event: AgentSessionEvent): Promise<void>;

	// UI helpers
	showStatus(message: string, options?: { dim?: boolean }): void;
	showError(message: string): void;
	showWarning(message: string): void;
	showNewVersionNotification(newVersion: string): void;
	clearEditor(): void;
	updatePendingMessagesDisplay(): void;
	queueCompactionMessage(text: string, mode: "steer" | "followUp"): void;
	flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void>;
	flushPendingBashComponents(): void;
	isKnownSlashCommand(text: string): boolean;
	addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void;
	renderSessionContext(
		sessionContext: SessionContext,
		options?: { updateFooter?: boolean; populateHistory?: boolean },
	): void;
	renderInitialMessages(): void;
	getUserMessageText(message: Message): string;
	findLastAssistantMessage(): AssistantMessage | undefined;
	extractAssistantText(message: AssistantMessage): string;
	updateEditorTopBorder(): void;
	updateEditorBorderColor(): void;
	rebuildChatFromMessages(): void;
	setTodos(todos: TodoItem[]): void;
	reloadTodos(): Promise<void>;
	toggleTodoExpansion(): void;

	// Command handling
	handleExportCommand(text: string): Promise<void>;
	handleShareCommand(): Promise<void>;
	handleCopyCommand(): Promise<void>;
	handleSessionCommand(): void;
	handleChangelogCommand(): void;
	handleHotkeysCommand(): void;
	handleDumpCommand(): Promise<void>;
	handleClearCommand(): Promise<void>;
	handleDebugCommand(): void;
	handleArminSaysHi(): void;
	handleBashCommand(command: string, excludeFromContext?: boolean): Promise<void>;
	handleCompactCommand(customInstructions?: string): Promise<void>;
	executeCompaction(customInstructionsOrOptions?: string | CompactOptions, isAuto?: boolean): Promise<void>;
	openInBrowser(urlOrPath: string): void;

	// Selector handling
	showSettingsSelector(): void;
	showHistorySearch(): void;
	showExtensionsDashboard(): void;
	showModelSelector(options?: { temporaryOnly?: boolean }): void;
	showUserMessageSelector(): void;
	showTreeSelector(): void;
	showSessionSelector(): void;
	handleResumeSession(sessionPath: string): Promise<void>;
	showOAuthSelector(mode: "login" | "logout"): Promise<void>;
	showHookConfirm(title: string, message: string): Promise<boolean>;

	// Input handling
	handleCtrlC(): void;
	handleCtrlD(): void;
	handleCtrlZ(): void;
	handleDequeue(): void;
	handleBackgroundCommand(): void;
	handleImagePaste(): Promise<boolean>;
	cycleThinkingLevel(): void;
	cycleRoleModel(options?: { temporary?: boolean }): Promise<void>;
	toggleToolOutputExpansion(): void;
	toggleThinkingBlockVisibility(): void;
	openExternalEditor(): void;
	registerExtensionShortcuts(): void;

	// Voice handling
	setVoiceStatus(text: string | undefined): void;
	handleVoiceInterrupt(reason?: string): Promise<void>;
	startVoiceProgressTimer(): void;
	stopVoiceProgressTimer(): void;
	maybeSpeakProgress(): Promise<void>;
	submitVoiceText(text: string): Promise<void>;

	// Hook UI methods
	initHooksAndCustomTools(): Promise<void>;
	emitCustomToolSessionEvent(
		reason: "start" | "switch" | "branch" | "tree" | "shutdown",
		previousSessionFile?: string,
	): Promise<void>;
	setHookWidget(key: string, content: unknown): void;
	setHookStatus(key: string, text: string | undefined): void;
	showHookSelector(title: string, options: string[], initialIndex?: number): Promise<string | undefined>;
	hideHookSelector(): void;
	showHookInput(title: string, placeholder?: string): Promise<string | undefined>;
	hideHookInput(): void;
	showHookEditor(title: string, prefill?: string): Promise<string | undefined>;
	hideHookEditor(): void;
	showHookNotify(message: string, type?: "info" | "warning" | "error"): void;
	showHookCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
	): Promise<T>;
	showExtensionError(extensionPath: string, error: string): void;
	showToolError(toolName: string, error: string): void;
}
