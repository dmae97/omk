/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, ImageContent, Message } from "@oh-my-pi/pi-ai";
import type { Component, Loader, SlashCommand } from "@oh-my-pi/pi-tui";
import {
	CombinedAutocompleteProvider,
	Container,
	Markdown,
	ProcessTerminal,
	Spacer,
	Text,
	TUI,
} from "@oh-my-pi/pi-tui";
import chalk from "chalk";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session";
import type { ExtensionUIContext } from "../../core/extensions/index";
import { HistoryStorage } from "../../core/history-storage";
import type { KeybindingsManager } from "../../core/keybindings";
import { logger } from "../../core/logger";
import type { SessionContext, SessionManager } from "../../core/session-manager";
import { getRecentSessions } from "../../core/session-manager";
import type { SettingsManager } from "../../core/settings-manager";
import { loadSlashCommands } from "../../core/slash-commands";
import { setTerminalTitle } from "../../core/title-generator";
import { getArtifactsDir } from "../../core/tools/task/artifacts";
import { VoiceSupervisor } from "../../core/voice-supervisor";
import { registerAsyncCleanup } from "../cleanup";
import type { AssistantMessageComponent } from "./components/assistant-message";
import type { BashExecutionComponent } from "./components/bash-execution";
import { CustomEditor } from "./components/custom-editor";
import { DynamicBorder } from "./components/dynamic-border";
import type { HookEditorComponent } from "./components/hook-editor";
import type { HookInputComponent } from "./components/hook-input";
import type { HookSelectorComponent } from "./components/hook-selector";
import { StatusLineComponent } from "./components/status-line";
import type { ToolExecutionHandle } from "./components/tool-execution";
import { WelcomeComponent } from "./components/welcome";
import { CommandController } from "./controllers/command-controller";
import { EventController } from "./controllers/event-controller";
import { ExtensionUiController } from "./controllers/extension-ui-controller";
import { InputController } from "./controllers/input-controller";
import { SelectorController } from "./controllers/selector-controller";
import type { Theme } from "./theme/theme";
import { getEditorTheme, getMarkdownTheme, onThemeChange, theme } from "./theme/theme";
import type { CompactionQueuedMessage, InteractiveModeContext, TodoItem } from "./types";
import { UiHelpers } from "./utils/ui-helpers";
import { VoiceManager } from "./utils/voice-manager";

const TODO_FILE_NAME = "todos.json";

/** Options for creating an InteractiveMode instance (for future API use) */
export interface InteractiveModeOptions {
	/** Providers that were migrated during startup */
	migratedProviders?: string[];
	/** Warning message if model fallback occurred */
	modelFallbackMessage?: string;
	/** Initial message to send */
	initialMessage?: string;
	/** Initial images to include with the message */
	initialImages?: ImageContent[];
	/** Additional initial messages to queue */
	initialMessages?: string[];
}

export class InteractiveMode implements InteractiveModeContext {
	public session: AgentSession;
	public sessionManager: SessionManager;
	public settingsManager: SettingsManager;
	public agent: AgentSession["agent"];
	public voiceSupervisor: VoiceSupervisor;
	public historyStorage?: HistoryStorage;

	public ui: TUI;
	public chatContainer: Container;
	public pendingMessagesContainer: Container;
	public statusContainer: Container;
	public todoContainer: Container;
	public editor: CustomEditor;
	public editorContainer: Container;
	public statusLine: StatusLineComponent;

	public isInitialized = false;
	public isBackgrounded = false;
	public isBashMode = false;
	public toolOutputExpanded = false;
	public todoExpanded = false;
	public todoItems: TodoItem[] = [];
	public hideThinkingBlock = false;
	public pendingImages: ImageContent[] = [];
	public compactionQueuedMessages: CompactionQueuedMessage[] = [];
	public pendingTools = new Map<string, ToolExecutionHandle>();
	public pendingBashComponents: BashExecutionComponent[] = [];
	public bashComponent: BashExecutionComponent | undefined = undefined;
	public streamingComponent: AssistantMessageComponent | undefined = undefined;
	public streamingMessage: AssistantMessage | undefined = undefined;
	public loadingAnimation: Loader | undefined = undefined;
	public autoCompactionLoader: Loader | undefined = undefined;
	public retryLoader: Loader | undefined = undefined;
	public autoCompactionEscapeHandler?: () => void;
	public retryEscapeHandler?: () => void;
	public unsubscribe?: () => void;
	public onInputCallback?: (input: { text: string; images?: ImageContent[] }) => void;
	public lastSigintTime = 0;
	public lastEscapeTime = 0;
	public lastVoiceInterruptAt = 0;
	public voiceAutoModeEnabled = false;
	public shutdownRequested = false;
	private isShuttingDown = false;
	public voiceProgressTimer: ReturnType<typeof setTimeout> | undefined = undefined;
	public voiceProgressSpoken = false;
	public voiceProgressLastLength = 0;
	public hookSelector: HookSelectorComponent | undefined = undefined;
	public hookInput: HookInputComponent | undefined = undefined;
	public hookEditor: HookEditorComponent | undefined = undefined;
	public lastStatusSpacer: Spacer | undefined = undefined;
	public lastStatusText: Text | undefined = undefined;
	public fileSlashCommands: Set<string> = new Set();
	public skillCommands: Map<string, string> = new Map();

	private pendingSlashCommands: SlashCommand[] = [];
	private cleanupUnsubscribe?: () => void;
	private readonly version: string;
	private readonly changelogMarkdown: string | undefined;
	private readonly lspServers: Array<{ name: string; status: "ready" | "error"; fileTypes: string[] }> | undefined =
		undefined;
	private readonly toolUiContextSetter: (uiContext: ExtensionUIContext, hasUI: boolean) => void;

	private readonly commandController: CommandController;
	private readonly eventController: EventController;
	private readonly extensionUiController: ExtensionUiController;
	private readonly inputController: InputController;
	private readonly selectorController: SelectorController;
	private readonly uiHelpers: UiHelpers;
	private readonly voiceManager: VoiceManager;

	constructor(
		session: AgentSession,
		version: string,
		changelogMarkdown: string | undefined = undefined,
		setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void = () => {},
		lspServers: Array<{ name: string; status: "ready" | "error"; fileTypes: string[] }> | undefined = undefined,
	) {
		this.session = session;
		this.sessionManager = session.sessionManager;
		this.settingsManager = session.settingsManager;
		this.agent = session.agent;
		this.version = version;
		this.changelogMarkdown = changelogMarkdown;
		this.toolUiContextSetter = setToolUIContext;
		this.lspServers = lspServers;

		this.ui = new TUI(new ProcessTerminal());
		this.chatContainer = new Container();
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.todoContainer = new Container();
		this.editor = new CustomEditor(getEditorTheme());
		this.editor.setUseTerminalCursor(true);
		this.editor.onAutocompleteCancel = () => {
			this.ui.requestRender(true);
		};
		try {
			this.historyStorage = HistoryStorage.open();
			this.editor.setHistoryStorage(this.historyStorage);
		} catch (error) {
			logger.warn("History storage unavailable", { error: String(error) });
		}
		this.editorContainer = new Container();
		this.editorContainer.addChild(this.editor);
		this.statusLine = new StatusLineComponent(session);
		this.statusLine.setAutoCompactEnabled(session.autoCompactionEnabled);
		this.voiceSupervisor = new VoiceSupervisor(this.session.modelRegistry, {
			onSendToAgent: async (text) => {
				await this.submitVoiceText(text);
			},
			onInterruptAgent: async (reason) => {
				await this.handleVoiceInterrupt(reason);
			},
			onStatus: (status) => {
				this.setVoiceStatus(status);
			},
			onError: (error) => {
				this.showError(error.message);
				this.voiceAutoModeEnabled = false;
				void this.voiceSupervisor.stop();
				this.setVoiceStatus(undefined);
			},
			onWarning: (message) => {
				this.showWarning(message);
			},
		});

		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();

		// Define slash commands for autocomplete
		const slashCommands: SlashCommand[] = [
			{ name: "settings", description: "Open settings menu" },
			{ name: "model", description: "Select model (opens selector UI)" },
			{ name: "export", description: "Export session to HTML file" },
			{ name: "dump", description: "Copy session transcript to clipboard" },
			{ name: "share", description: "Share session as a secret GitHub gist" },
			{ name: "copy", description: "Copy last agent message to clipboard" },
			{ name: "session", description: "Show session info and stats" },
			{ name: "extensions", description: "Open Extension Control Center dashboard" },
			{ name: "status", description: "Alias for /extensions" },
			{ name: "changelog", description: "Show changelog entries" },
			{ name: "hotkeys", description: "Show all keyboard shortcuts" },
			{ name: "branch", description: "Create a new branch from a previous message" },
			{ name: "tree", description: "Navigate session tree (switch branches)" },
			{ name: "login", description: "Login with OAuth provider" },
			{ name: "logout", description: "Logout from OAuth provider" },
			{ name: "new", description: "Start a new session" },
			{ name: "compact", description: "Manually compact the session context" },
			{ name: "background", description: "Detach UI and continue running in background" },
			{ name: "bg", description: "Alias for /background" },
			{ name: "resume", description: "Resume a different session" },
			{ name: "exit", description: "Exit the application" },
		];

		// Convert hook commands to SlashCommand format
		const hookCommands: SlashCommand[] = (this.session.extensionRunner?.getRegisteredCommands() ?? []).map((cmd) => ({
			name: cmd.name,
			description: cmd.description ?? "(hook command)",
		}));

		// Convert custom commands (TypeScript) to SlashCommand format
		const customCommands: SlashCommand[] = this.session.customCommands.map((loaded) => ({
			name: loaded.command.name,
			description: `${loaded.command.description} (${loaded.source})`,
		}));

		// Build skill commands from session.skills (if enabled)
		const skillCommandList: SlashCommand[] = [];
		if (this.settingsManager.getEnableSkillCommands?.()) {
			for (const skill of this.session.skills) {
				const commandName = `skill:${skill.name}`;
				this.skillCommands.set(commandName, skill.filePath);
				skillCommandList.push({ name: commandName, description: skill.description });
			}
		}

		// Store pending commands for init() where file commands are loaded async
		this.pendingSlashCommands = [...slashCommands, ...hookCommands, ...customCommands, ...skillCommandList];

		this.uiHelpers = new UiHelpers(this);
		this.voiceManager = new VoiceManager(this);
		this.extensionUiController = new ExtensionUiController(this);
		this.eventController = new EventController(this);
		this.commandController = new CommandController(this);
		this.selectorController = new SelectorController(this);
		this.inputController = new InputController(this);
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		// Register session manager flush for signal handlers (SIGINT, SIGTERM, SIGHUP)
		this.cleanupUnsubscribe = registerAsyncCleanup(() => this.sessionManager.flush());

		// Load and convert file commands to SlashCommand format (async)
		const fileCommands = await loadSlashCommands({ cwd: process.cwd() });
		this.fileSlashCommands = new Set(fileCommands.map((cmd) => cmd.name));
		const fileSlashCommands: SlashCommand[] = fileCommands.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
		}));

		// Setup autocomplete with all commands
		const autocompleteProvider = new CombinedAutocompleteProvider(
			[...this.pendingSlashCommands, ...fileSlashCommands],
			process.cwd(),
		);
		this.editor.setAutocompleteProvider(autocompleteProvider);

		// Get current model info for welcome screen
		const modelName = this.session.model?.name ?? "Unknown";
		const providerName = this.session.model?.provider ?? "Unknown";

		// Get recent sessions
		const recentSessions = getRecentSessions(this.sessionManager.getSessionDir()).map((s) => ({
			name: s.name,
			timeAgo: s.timeAgo,
		}));

		// Convert LSP servers to welcome format
		const lspServerInfo =
			this.lspServers?.map((s) => ({
				name: s.name,
				status: s.status as "ready" | "error" | "connecting",
				fileTypes: s.fileTypes,
			})) ?? [];

		// Add welcome header
		const welcome = new WelcomeComponent(this.version, modelName, providerName, recentSessions, lspServerInfo);

		// Set terminal title if session already has one (resumed session)
		const existingTitle = this.sessionManager.getSessionTitle();
		if (existingTitle) {
			setTerminalTitle(`pi: ${existingTitle}`);
		}

		// Setup UI layout
		this.ui.addChild(new Spacer(1));
		this.ui.addChild(welcome);
		this.ui.addChild(new Spacer(1));

		// Add changelog if provided
		if (this.changelogMarkdown) {
			this.ui.addChild(new DynamicBorder());
			if (this.settingsManager.getCollapseChangelog()) {
				const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
				const latestVersion = versionMatch ? versionMatch[1] : this.version;
				const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
				this.ui.addChild(new Text(condensedText, 1, 0));
			} else {
				this.ui.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
				this.ui.addChild(new Spacer(1));
				this.ui.addChild(new Markdown(this.changelogMarkdown.trim(), 1, 0, getMarkdownTheme()));
				this.ui.addChild(new Spacer(1));
			}
			this.ui.addChild(new DynamicBorder());
		}

		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.pendingMessagesContainer);
		this.ui.addChild(this.statusContainer);
		this.ui.addChild(this.todoContainer);
		this.ui.addChild(new Spacer(1));
		this.ui.addChild(this.editorContainer);
		this.ui.addChild(this.statusLine); // Only renders hook statuses (main status in editor border)
		this.ui.setFocus(this.editor);

		this.inputController.setupKeyHandlers();
		this.inputController.setupEditorSubmitHandler();

		// Load initial todos
		await this.loadTodoList();

		// Start the UI
		this.ui.start();
		this.isInitialized = true;

		// Set initial terminal title (will be updated when session title is generated)
		this.ui.terminal.setTitle("π");

		// Initialize hooks with TUI-based UI context
		await this.initHooksAndCustomTools();

		// Subscribe to agent events
		this.subscribeToAgent();

		// Set up theme file watcher
		onThemeChange(() => {
			this.ui.invalidate();
			this.updateEditorBorderColor();
			this.ui.requestRender();
		});

		// Set up git branch watcher
		this.statusLine.watchBranch(() => {
			this.updateEditorTopBorder();
			this.ui.requestRender();
		});

		// Initial top border update
		this.updateEditorTopBorder();
	}

	async getUserInput(): Promise<{ text: string; images?: ImageContent[] }> {
		return new Promise((resolve) => {
			this.onInputCallback = (input) => {
				this.onInputCallback = undefined;
				resolve(input);
			};
		});
	}

	updateEditorBorderColor(): void {
		if (this.isBashMode) {
			this.editor.borderColor = theme.getBashModeBorderColor();
		} else {
			const level = this.session.thinkingLevel || "off";
			this.editor.borderColor = theme.getThinkingBorderColor(level);
		}
		this.updateEditorTopBorder();
		this.ui.requestRender();
	}

	updateEditorTopBorder(): void {
		const width = this.ui.getWidth();
		const topBorder = this.statusLine.getTopBorder(width);
		this.editor.setTopBorder(topBorder);
	}

	rebuildChatFromMessages(): void {
		this.chatContainer.clear();
		const context = this.sessionManager.buildSessionContext();
		this.renderSessionContext(context);
	}

	private formatTodoLine(todo: TodoItem, prefix: string): string {
		const checkbox = theme.checkbox;
		const label = todo.status === "in_progress" ? todo.activeForm : todo.content;
		switch (todo.status) {
			case "completed":
				return theme.fg("success", `${prefix}${checkbox.checked} ${chalk.strikethrough(todo.content)}`);
			case "in_progress":
				return theme.fg("accent", `${prefix}${checkbox.unchecked} ${label}`);
			default:
				return theme.fg("dim", `${prefix}${checkbox.unchecked} ${label}`);
		}
	}

	private getCollapsedTodos(todos: TodoItem[]): TodoItem[] {
		let startIndex = 0;
		for (let i = todos.length - 1; i >= 0; i -= 1) {
			if (todos[i].status === "completed") {
				startIndex = i;
				break;
			}
		}
		return todos.slice(startIndex, startIndex + 5);
	}

	private renderTodoList(): void {
		this.todoContainer.clear();
		if (this.todoItems.length === 0) {
			return;
		}

		const visibleTodos = this.todoExpanded ? this.todoItems : this.getCollapsedTodos(this.todoItems);
		const indent = "  ";
		const hook = theme.tree.hook;
		const lines = [indent + theme.bold(theme.fg("accent", "Todos"))];

		visibleTodos.forEach((todo, index) => {
			const prefix = `${indent}${index === 0 ? hook : " "} `;
			lines.push(this.formatTodoLine(todo, prefix));
		});

		if (!this.todoExpanded && visibleTodos.length < this.todoItems.length) {
			const remaining = this.todoItems.length - visibleTodos.length;
			lines.push(theme.fg("muted", `${indent}  ${hook} +${remaining} more (Ctrl+T to expand)`));
		}

		this.todoContainer.addChild(new Text(lines.join("\n"), 1, 0));
	}

	private async loadTodoList(): Promise<void> {
		const sessionFile = this.sessionManager.getSessionFile() ?? null;
		if (!sessionFile) {
			this.renderTodoList();
			return;
		}
		const artifactsDir = getArtifactsDir(sessionFile);
		if (!artifactsDir) {
			this.renderTodoList();
			return;
		}
		const todoPath = path.join(artifactsDir, TODO_FILE_NAME);
		const file = Bun.file(todoPath);
		if (!(await file.exists())) {
			this.renderTodoList();
			return;
		}
		try {
			const data = (await file.json()) as { todos?: TodoItem[] };
			if (data?.todos && Array.isArray(data.todos)) {
				this.todoItems = data.todos;
			}
		} catch (error) {
			logger.warn("Failed to load todos", { path: todoPath, error: String(error) });
		}
		this.renderTodoList();
	}

	stop(): void {
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = undefined;
		}
		this.statusLine.dispose();
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		if (this.cleanupUnsubscribe) {
			this.cleanupUnsubscribe();
		}
		if (this.isInitialized) {
			this.ui.stop();
			this.isInitialized = false;
		}
	}

	async shutdown(): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;

		this.voiceAutoModeEnabled = false;
		await this.voiceSupervisor.stop();

		// Flush pending session writes before shutdown
		await this.sessionManager.flush();

		// Emit shutdown event to hooks
		await this.session.emitCustomToolSessionEvent("shutdown");

		this.stop();
		process.exit(0);
	}

	async checkShutdownRequested(): Promise<void> {
		if (!this.shutdownRequested) return;
		await this.shutdown();
	}

	// Extension UI integration
	setToolUIContext(uiContext: ExtensionUIContext, hasUI: boolean): void {
		this.toolUiContextSetter(uiContext, hasUI);
	}

	initializeHookRunner(uiContext: ExtensionUIContext, hasUI: boolean): void {
		this.extensionUiController.initializeHookRunner(uiContext, hasUI);
	}

	createBackgroundUiContext(): ExtensionUIContext {
		return this.extensionUiController.createBackgroundUiContext();
	}

	// Event handling
	async handleBackgroundEvent(event: AgentSessionEvent): Promise<void> {
		await this.eventController.handleBackgroundEvent(event);
	}

	// UI helpers
	showStatus(message: string, options?: { dim?: boolean }): void {
		this.uiHelpers.showStatus(message, options);
	}

	showError(message: string): void {
		this.uiHelpers.showError(message);
	}

	showWarning(message: string): void {
		this.uiHelpers.showWarning(message);
	}

	showNewVersionNotification(newVersion: string): void {
		this.uiHelpers.showNewVersionNotification(newVersion);
	}

	clearEditor(): void {
		this.uiHelpers.clearEditor();
	}

	updatePendingMessagesDisplay(): void {
		this.uiHelpers.updatePendingMessagesDisplay();
	}

	queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
		this.uiHelpers.queueCompactionMessage(text, mode);
	}

	flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
		return this.uiHelpers.flushCompactionQueue(options);
	}

	flushPendingBashComponents(): void {
		this.uiHelpers.flushPendingBashComponents();
	}

	isKnownSlashCommand(text: string): boolean {
		return this.uiHelpers.isKnownSlashCommand(text);
	}

	addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void {
		this.uiHelpers.addMessageToChat(message, options);
	}

	renderSessionContext(
		sessionContext: SessionContext,
		options?: { updateFooter?: boolean; populateHistory?: boolean },
	): void {
		this.uiHelpers.renderSessionContext(sessionContext, options);
	}

	renderInitialMessages(): void {
		this.uiHelpers.renderInitialMessages();
	}

	getUserMessageText(message: Message): string {
		return this.uiHelpers.getUserMessageText(message);
	}

	findLastAssistantMessage(): AssistantMessage | undefined {
		return this.uiHelpers.findLastAssistantMessage();
	}

	extractAssistantText(message: AssistantMessage): string {
		return this.uiHelpers.extractAssistantText(message);
	}

	// Command handling
	handleExportCommand(text: string): Promise<void> {
		return this.commandController.handleExportCommand(text);
	}

	handleDumpCommand(): Promise<void> {
		return this.commandController.handleDumpCommand();
	}

	handleShareCommand(): Promise<void> {
		return this.commandController.handleShareCommand();
	}

	handleCopyCommand(): Promise<void> {
		return this.commandController.handleCopyCommand();
	}

	handleSessionCommand(): void {
		this.commandController.handleSessionCommand();
	}

	handleChangelogCommand(): void {
		this.commandController.handleChangelogCommand();
	}

	handleHotkeysCommand(): void {
		this.commandController.handleHotkeysCommand();
	}

	handleClearCommand(): Promise<void> {
		return this.commandController.handleClearCommand();
	}

	handleDebugCommand(): void {
		this.commandController.handleDebugCommand();
	}

	handleArminSaysHi(): void {
		this.commandController.handleArminSaysHi();
	}

	handleBashCommand(command: string, excludeFromContext?: boolean): Promise<void> {
		return this.commandController.handleBashCommand(command, excludeFromContext);
	}

	handleCompactCommand(customInstructions?: string): Promise<void> {
		return this.commandController.handleCompactCommand(customInstructions);
	}

	executeCompaction(customInstructions?: string, isAuto?: boolean): Promise<void> {
		return this.commandController.executeCompaction(customInstructions, isAuto);
	}

	openInBrowser(urlOrPath: string): void {
		this.commandController.openInBrowser(urlOrPath);
	}

	// Selector handling
	showSettingsSelector(): void {
		this.selectorController.showSettingsSelector();
	}

	showHistorySearch(): void {
		this.selectorController.showHistorySearch();
	}

	showExtensionsDashboard(): void {
		void this.selectorController.showExtensionsDashboard();
	}

	showModelSelector(options?: { temporaryOnly?: boolean }): void {
		this.selectorController.showModelSelector(options);
	}

	showUserMessageSelector(): void {
		this.selectorController.showUserMessageSelector();
	}

	showTreeSelector(): void {
		this.selectorController.showTreeSelector();
	}

	showSessionSelector(): void {
		this.selectorController.showSessionSelector();
	}

	handleResumeSession(sessionPath: string): Promise<void> {
		return this.selectorController.handleResumeSession(sessionPath);
	}

	showOAuthSelector(mode: "login" | "logout"): Promise<void> {
		return this.selectorController.showOAuthSelector(mode);
	}

	showHookConfirm(title: string, message: string): Promise<boolean> {
		return this.extensionUiController.showHookConfirm(title, message);
	}

	// Input handling
	handleCtrlC(): void {
		this.inputController.handleCtrlC();
	}

	handleCtrlD(): void {
		this.inputController.handleCtrlD();
	}

	handleCtrlZ(): void {
		this.inputController.handleCtrlZ();
	}

	handleDequeue(): void {
		this.inputController.handleDequeue();
	}

	handleBackgroundCommand(): void {
		this.inputController.handleBackgroundCommand();
	}

	handleImagePaste(): Promise<boolean> {
		return this.inputController.handleImagePaste();
	}

	cycleThinkingLevel(): void {
		this.inputController.cycleThinkingLevel();
	}

	cycleRoleModel(options?: { temporary?: boolean }): Promise<void> {
		return this.inputController.cycleRoleModel(options);
	}

	toggleToolOutputExpansion(): void {
		this.inputController.toggleToolOutputExpansion();
	}

	toggleThinkingBlockVisibility(): void {
		this.inputController.toggleThinkingBlockVisibility();
	}

	toggleTodoExpansion(): void {
		this.todoExpanded = !this.todoExpanded;
		this.renderTodoList();
		this.ui.requestRender();
	}

	setTodos(todos: TodoItem[]): void {
		this.todoItems = todos;
		this.renderTodoList();
		this.ui.requestRender();
	}

	async reloadTodos(): Promise<void> {
		await this.loadTodoList();
		this.ui.requestRender();
	}

	openExternalEditor(): void {
		this.inputController.openExternalEditor();
	}

	registerExtensionShortcuts(): void {
		this.inputController.registerExtensionShortcuts();
	}

	// Voice handling
	setVoiceStatus(text: string | undefined): void {
		this.voiceManager.setVoiceStatus(text);
	}

	handleVoiceInterrupt(reason?: string): Promise<void> {
		return this.voiceManager.handleVoiceInterrupt(reason);
	}

	startVoiceProgressTimer(): void {
		this.voiceManager.startVoiceProgressTimer();
	}

	stopVoiceProgressTimer(): void {
		this.voiceManager.stopVoiceProgressTimer();
	}

	maybeSpeakProgress(): Promise<void> {
		return this.voiceManager.maybeSpeakProgress();
	}

	submitVoiceText(text: string): Promise<void> {
		return this.voiceManager.submitVoiceText(text);
	}

	// Hook UI methods
	initHooksAndCustomTools(): Promise<void> {
		return this.extensionUiController.initHooksAndCustomTools();
	}

	emitCustomToolSessionEvent(
		reason: "start" | "switch" | "branch" | "tree" | "shutdown",
		previousSessionFile?: string,
	): Promise<void> {
		return this.extensionUiController.emitCustomToolSessionEvent(reason, previousSessionFile);
	}

	setHookWidget(key: string, content: unknown): void {
		this.extensionUiController.setHookWidget(key, content);
	}

	setHookStatus(key: string, text: string | undefined): void {
		this.extensionUiController.setHookStatus(key, text);
	}

	showHookSelector(title: string, options: string[], initialIndex?: number): Promise<string | undefined> {
		return this.extensionUiController.showHookSelector(title, options, initialIndex);
	}

	hideHookSelector(): void {
		this.extensionUiController.hideHookSelector();
	}

	showHookInput(title: string, placeholder?: string): Promise<string | undefined> {
		return this.extensionUiController.showHookInput(title, placeholder);
	}

	hideHookInput(): void {
		this.extensionUiController.hideHookInput();
	}

	showHookEditor(title: string, prefill?: string): Promise<string | undefined> {
		return this.extensionUiController.showHookEditor(title, prefill);
	}

	hideHookEditor(): void {
		this.extensionUiController.hideHookEditor();
	}

	showHookNotify(message: string, type?: "info" | "warning" | "error"): void {
		this.extensionUiController.showHookNotify(message, type);
	}

	showHookCustom<T>(
		factory: (
			tui: TUI,
			theme: Theme,
			keybindings: KeybindingsManager,
			done: (result: T) => void,
		) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
	): Promise<T> {
		return this.extensionUiController.showHookCustom(factory);
	}

	showExtensionError(extensionPath: string, error: string): void {
		this.extensionUiController.showExtensionError(extensionPath, error);
	}

	showToolError(toolName: string, error: string): void {
		this.extensionUiController.showToolError(toolName, error);
	}

	private subscribeToAgent(): void {
		this.eventController.subscribeToAgent();
	}
}
