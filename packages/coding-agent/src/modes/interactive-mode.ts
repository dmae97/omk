/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */
import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, Model, UsageReport } from "@oh-my-pi/pi-ai";
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
import { isEnoent, logger, postmortem } from "@oh-my-pi/pi-utils";
import chalk from "chalk";
import { KeybindingsManager } from "../config/keybindings";
import { renderPromptTemplate } from "../config/prompt-templates";
import { type Settings, settings } from "../config/settings";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "../extensibility/extensions";
import type { CompactOptions } from "../extensibility/extensions/types";
import { loadSlashCommands } from "../extensibility/slash-commands";
import { resolvePlanUrlToPath } from "../internal-urls";
import planModeApprovedPrompt from "../prompts/system/plan-mode-approved.md" with { type: "text" };
import type { AgentSession, AgentSessionEvent } from "../session/agent-session";
import { HistoryStorage } from "../session/history-storage";
import type { SessionContext, SessionManager } from "../session/session-manager";
import { getRecentSessions } from "../session/session-manager";
import type { ExitPlanModeDetails } from "../tools";
import { setTerminalTitle } from "../utils/title-generator";
import type { AssistantMessageComponent } from "./components/assistant-message";
import type { BashExecutionComponent } from "./components/bash-execution";
import { CustomEditor } from "./components/custom-editor";
import { DynamicBorder } from "./components/dynamic-border";
import type { HookEditorComponent } from "./components/hook-editor";
import type { HookInputComponent } from "./components/hook-input";
import type { HookSelectorComponent } from "./components/hook-selector";
import type { PythonExecutionComponent } from "./components/python-execution";
import { StatusLineComponent } from "./components/status-line";
import type { ToolExecutionHandle } from "./components/tool-execution";
import { WelcomeComponent } from "./components/welcome";
import { CommandController } from "./controllers/command-controller";
import { EventController } from "./controllers/event-controller";
import { ExtensionUiController } from "./controllers/extension-ui-controller";
import { InputController } from "./controllers/input-controller";
import { SelectorController } from "./controllers/selector-controller";
import { setMermaidRenderCallback } from "./theme/mermaid-cache";
import type { Theme } from "./theme/theme";
import { getEditorTheme, getMarkdownTheme, onThemeChange, theme } from "./theme/theme";
import type { CompactionQueuedMessage, InteractiveModeContext, TodoItem } from "./types";
import { UiHelpers } from "./utils/ui-helpers";

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
	public settings: Settings;
	public keybindings: KeybindingsManager;
	public agent: AgentSession["agent"];
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
	public planModeEnabled = false;
	public planModePaused = false;
	public planModePlanFilePath: string | undefined = undefined;
	public todoItems: TodoItem[] = [];
	public hideThinkingBlock = false;
	public pendingImages: ImageContent[] = [];
	public compactionQueuedMessages: CompactionQueuedMessage[] = [];
	public pendingTools = new Map<string, ToolExecutionHandle>();
	public pendingBashComponents: BashExecutionComponent[] = [];
	public bashComponent: BashExecutionComponent | undefined = undefined;
	public pendingPythonComponents: PythonExecutionComponent[] = [];
	public pythonComponent: PythonExecutionComponent | undefined = undefined;
	public isPythonMode = false;
	public streamingComponent: AssistantMessageComponent | undefined = undefined;
	public streamingMessage: AssistantMessage | undefined = undefined;
	public loadingAnimation: Loader | undefined = undefined;
	public autoCompactionLoader: Loader | undefined = undefined;
	public retryLoader: Loader | undefined = undefined;
	private pendingWorkingMessage: string | undefined;
	private readonly defaultWorkingMessage = `Working… (esc to interrupt)`;
	public autoCompactionEscapeHandler?: () => void;
	public retryEscapeHandler?: () => void;
	public unsubscribe?: () => void;
	public onInputCallback?: (input: { text: string; images?: ImageContent[] }) => void;
	public lastSigintTime = 0;
	public lastEscapeTime = 0;
	public shutdownRequested = false;
	private isShuttingDown = false;
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
	private planModePreviousTools: string[] | undefined;
	private planModePreviousModel: Model<any> | undefined;
	private planModeHasEntered = false;
	public readonly lspServers:
		| Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>
		| undefined = undefined;
	public mcpManager?: import("../mcp").MCPManager;
	private readonly toolUiContextSetter: (uiContext: ExtensionUIContext, hasUI: boolean) => void;

	private readonly commandController: CommandController;
	private readonly eventController: EventController;
	private readonly extensionUiController: ExtensionUiController;
	private readonly inputController: InputController;
	private readonly selectorController: SelectorController;
	private readonly uiHelpers: UiHelpers;

	constructor(
		session: AgentSession,
		version: string,
		changelogMarkdown: string | undefined = undefined,
		setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void = () => {},
		lspServers:
			| Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>
			| undefined = undefined,
		mcpManager?: import("../mcp").MCPManager,
	) {
		this.session = session;
		this.sessionManager = session.sessionManager;
		this.settings = session.settings;
		this.keybindings = KeybindingsManager.inMemory();
		this.agent = session.agent;
		this.version = version;
		this.changelogMarkdown = changelogMarkdown;
		this.toolUiContextSetter = setToolUIContext;
		this.lspServers = lspServers;
		this.mcpManager = mcpManager;

		this.ui = new TUI(new ProcessTerminal(), settings.get("showHardwareCursor"));
		setMermaidRenderCallback(() => this.ui.requestRender());
		this.chatContainer = new Container();
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.todoContainer = new Container();
		this.editor = new CustomEditor(getEditorTheme());
		this.editor.setUseTerminalCursor(this.ui.getShowHardwareCursor());
		this.editor.onAutocompleteCancel = () => {
			this.ui.requestRender(true);
		};
		this.editor.onAutocompleteUpdate = () => {
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

		this.hideThinkingBlock = settings.get("hideThinkingBlock");

		// Define slash commands for autocomplete
		const slashCommands: SlashCommand[] = [
			{ name: "settings", description: "Open settings menu" },
			{ name: "plan", description: "Toggle plan mode (agent plans before executing)" },
			{ name: "model", description: "Select model (opens selector UI)" },
			{ name: "export", description: "Export session to HTML file" },
			{ name: "dump", description: "Copy session transcript to clipboard" },
			{ name: "share", description: "Share session as a secret GitHub gist" },
			{ name: "copy", description: "Copy last agent message to clipboard" },
			{ name: "session", description: "Show session info and stats" },
			{ name: "usage", description: "Show provider usage and limits" },
			{ name: "extensions", description: "Open Extension Control Center dashboard" },
			{ name: "status", description: "Alias for /extensions" },
			{ name: "changelog", description: "Show changelog entries" },
			{ name: "hotkeys", description: "Show all keyboard shortcuts" },
			{ name: "branch", description: "Create a new branch from a previous message" },
			{ name: "tree", description: "Navigate session tree (switch branches)" },
			{ name: "login", description: "Login with OAuth provider" },
			{ name: "logout", description: "Logout from OAuth provider" },
			{ name: "new", description: "Start a new session" },
			{ name: "fork", description: "Duplicate current session into a new session" },
			{ name: "compact", description: "Manually compact the session context" },
			{ name: "handoff", description: "Hand off the session context to a new session" },
			{ name: "background", description: "Detach UI and continue running in background" },
			{ name: "bg", description: "Alias for /background" },
			{ name: "resume", description: "Resume a different session" },
			{ name: "debug", description: "Write debug log (TUI state and messages)" },
			{ name: "exit", description: "Exit the application" },
		];

		// Convert hook commands to SlashCommand format
		const hookCommands: SlashCommand[] = (this.session.extensionRunner?.getRegisteredCommands() ?? []).map(cmd => ({
			name: cmd.name,
			description: cmd.description ?? "(hook command)",
			getArgumentCompletions: cmd.getArgumentCompletions,
		}));

		// Convert custom commands (TypeScript) to SlashCommand format
		const customCommands: SlashCommand[] = this.session.customCommands.map(loaded => ({
			name: loaded.command.name,
			description: `${loaded.command.description} (${loaded.source})`,
		}));

		// Build skill commands from session.skills (if enabled)
		const skillCommandList: SlashCommand[] = [];
		if (settings.get("skills.enableSkillCommands")) {
			for (const skill of this.session.skills) {
				const commandName = `skill:${skill.name}`;
				this.skillCommands.set(commandName, skill.filePath);
				skillCommandList.push({ name: commandName, description: skill.description });
			}
		}

		// Store pending commands for init() where file commands are loaded async
		this.pendingSlashCommands = [...slashCommands, ...hookCommands, ...customCommands, ...skillCommandList];

		this.uiHelpers = new UiHelpers(this);
		this.extensionUiController = new ExtensionUiController(this);
		this.eventController = new EventController(this);
		this.commandController = new CommandController(this);
		this.selectorController = new SelectorController(this);
		this.inputController = new InputController(this);
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		this.keybindings = await KeybindingsManager.create();

		// Register session manager flush for signal handlers (SIGINT, SIGTERM, SIGHUP)
		this.cleanupUnsubscribe = postmortem.register("session-manager-flush", () => this.sessionManager.flush());

		// Load and convert file commands to SlashCommand format (async)
		const fileCommands = await loadSlashCommands({ cwd: process.cwd() });
		this.fileSlashCommands = new Set(fileCommands.map(cmd => cmd.name));
		const fileSlashCommands: SlashCommand[] = fileCommands.map(cmd => ({
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
		const recentSessions = (await getRecentSessions(this.sessionManager.getSessionDir())).map(s => ({
			name: s.name,
			timeAgo: s.timeAgo,
		}));

		// Convert LSP servers to welcome format
		const lspServerInfo =
			this.lspServers?.map(s => ({
				name: s.name,
				status: s.status as "ready" | "error" | "connecting",
				fileTypes: s.fileTypes,
			})) ?? [];

		const startupQuiet = settings.get("startup.quiet");

		if (!startupQuiet) {
			// Add welcome header
			const welcome = new WelcomeComponent(this.version, modelName, providerName, recentSessions, lspServerInfo);

			// Setup UI layout
			this.ui.addChild(new Spacer(1));
			this.ui.addChild(welcome);
			this.ui.addChild(new Spacer(1));

			// Add changelog if provided
			if (this.changelogMarkdown) {
				this.ui.addChild(new DynamicBorder());
				if (settings.get("collapseChangelog")) {
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
		}

		// Set terminal title if session already has one (resumed session)
		const existingTitle = this.sessionManager.getSessionName();
		if (existingTitle) {
			setTerminalTitle(`pi: ${existingTitle}`);
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
		this.ui.requestRender(true);

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
		const { promise, resolve } = Promise.withResolvers<{ text: string; images?: ImageContent[] }>();
		this.onInputCallback = input => {
			this.onInputCallback = undefined;
			resolve(input);
		};
		return promise;
	}

	updateEditorBorderColor(): void {
		if (this.isBashMode) {
			this.editor.borderColor = theme.getBashModeBorderColor();
		} else if (this.isPythonMode) {
			this.editor.borderColor = theme.getPythonModeBorderColor();
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
		const label = todo.content;
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
		const artifactsDir = sessionFile.slice(0, -6);
		const todoPath = path.join(artifactsDir, TODO_FILE_NAME);
		try {
			const data = (await Bun.file(todoPath).json()) as { todos?: TodoItem[] };
			if (data?.todos && Array.isArray(data.todos)) {
				this.todoItems = data.todos;
			}
		} catch (error) {
			if (isEnoent(error)) {
				this.renderTodoList();
				return;
			}
			logger.warn("Failed to load todos", { path: todoPath, error: String(error) });
		}
		this.renderTodoList();
	}

	private getPlanFilePath(): string {
		const sessionId = this.sessionManager.getSessionId();
		return `plan://${sessionId}/plan.md`;
	}

	private resolvePlanFilePath(planFilePath: string): string {
		if (planFilePath.startsWith("plan://")) {
			return resolvePlanUrlToPath(planFilePath, {
				getPlansDirectory: () => this.settings.getPlansDirectory(),
				cwd: this.sessionManager.getCwd(),
			});
		}
		return planFilePath;
	}

	private updatePlanModeStatus(): void {
		const status =
			this.planModeEnabled || this.planModePaused
				? {
						enabled: this.planModeEnabled,
						paused: this.planModePaused,
					}
				: undefined;
		this.statusLine.setPlanModeStatus(status);
		this.updateEditorTopBorder();
		this.ui.requestRender();
	}

	private async applyPlanModeModel(): Promise<void> {
		const planModel = this.session.resolveRoleModel("plan");
		if (!planModel) return;
		const currentModel = this.session.model;
		if (currentModel && currentModel.provider === planModel.provider && currentModel.id === planModel.id) {
			return;
		}
		this.planModePreviousModel = currentModel;
		try {
			await this.session.setModelTemporary(planModel);
		} catch (error) {
			this.showWarning(
				`Failed to switch to plan model for plan mode: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async enterPlanMode(options?: {
		planFilePath?: string;
		workflow?: "parallel" | "iterative";
	}): Promise<void> {
		if (this.planModeEnabled) {
			return;
		}

		this.planModePaused = false;

		const planFilePath = options?.planFilePath ?? this.getPlanFilePath();
		const previousTools = this.session.getActiveToolNames();
		const hasExitTool = this.session.getToolByName("exit_plan_mode") !== undefined;
		const planTools = hasExitTool ? [...previousTools, "exit_plan_mode"] : previousTools;
		const uniquePlanTools = [...new Set(planTools)];

		this.planModePreviousTools = previousTools;
		this.planModePlanFilePath = planFilePath;
		this.planModeEnabled = true;

		await this.session.setActiveToolsByName(uniquePlanTools);
		this.session.setPlanModeState({
			enabled: true,
			planFilePath,
			workflow: options?.workflow ?? "parallel",
			reentry: this.planModeHasEntered,
		});
		this.planModeHasEntered = true;
		await this.applyPlanModeModel();
		this.updatePlanModeStatus();
		this.showStatus(`Plan mode enabled. Plan file: ${planFilePath}`);
	}

	private async exitPlanMode(options?: { silent?: boolean; paused?: boolean }): Promise<void> {
		if (!this.planModeEnabled) {
			return;
		}

		const previousTools = this.planModePreviousTools;
		if (previousTools && previousTools.length > 0) {
			await this.session.setActiveToolsByName(previousTools);
		}
		if (this.planModePreviousModel) {
			await this.session.setModelTemporary(this.planModePreviousModel);
		}

		this.session.setPlanModeState(undefined);
		this.planModeEnabled = false;
		this.planModePaused = options?.paused ?? false;
		this.planModePlanFilePath = undefined;
		this.planModePreviousTools = undefined;
		this.planModePreviousModel = undefined;
		this.updatePlanModeStatus();
		if (!options?.silent) {
			this.showStatus(this.planModePaused ? "Plan mode paused." : "Plan mode disabled.");
		}
	}

	private async readPlanFile(planFilePath: string): Promise<string | null> {
		const resolvedPath = this.resolvePlanFilePath(planFilePath);
		try {
			return await Bun.file(resolvedPath).text();
		} catch (error) {
			if (isEnoent(error)) {
				return null;
			}
			throw error;
		}
	}

	private renderPlanPreview(planContent: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Plan Review")), 1, 1));
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(planContent, 1, 1, getMarkdownTheme()));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	private async approvePlan(planContent: string): Promise<void> {
		const previousTools = this.planModePreviousTools ?? this.session.getActiveToolNames();
		await this.exitPlanMode({ silent: true, paused: false });
		await this.handleClearCommand();
		if (previousTools.length > 0) {
			await this.session.setActiveToolsByName(previousTools);
		}
		this.session.markPlanReferenceSent();
		const prompt = renderPromptTemplate(planModeApprovedPrompt, { planContent });
		await this.session.prompt(prompt);
	}

	async handlePlanModeCommand(): Promise<void> {
		if (this.planModeEnabled) {
			const confirmed = await this.showHookConfirm(
				"Exit plan mode?",
				"This exits plan mode without approving a plan.",
			);
			if (!confirmed) return;
			await this.exitPlanMode({ paused: true });
			return;
		}
		await this.enterPlanMode();
	}

	async handleExitPlanModeTool(details: ExitPlanModeDetails): Promise<void> {
		if (!this.planModeEnabled) {
			this.showWarning("Plan mode is not active.");
			return;
		}

		const planFilePath = details.planFilePath || this.planModePlanFilePath || this.getPlanFilePath();
		this.planModePlanFilePath = planFilePath;
		const planContent = await this.readPlanFile(planFilePath);
		if (!planContent) {
			this.showError(`Plan file not found at ${planFilePath}`);
			return;
		}

		this.renderPlanPreview(planContent);
		const choice = await this.showHookSelector("Plan mode - next step", [
			"Approve and execute",
			"Refine plan",
			"Stay in plan mode",
		]);

		if (choice === "Approve and execute") {
			await this.approvePlan(planContent);
			return;
		}
		if (choice === "Refine plan") {
			const refinement = await this.showHookInput("What should be refined?");
			if (refinement) {
				this.editor.setText(refinement);
			}
		}
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

		// Flush pending session writes before shutdown
		await this.sessionManager.flush();

		// Emit shutdown event to hooks
		await this.session.emitCustomToolSessionEvent("shutdown");

		if (this.isInitialized) {
			await this.ui.waitForRender();
		}

		this.stop();
		await postmortem.quit(0);
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

	setWorkingMessage(message?: string): void {
		if (message === undefined) {
			this.pendingWorkingMessage = undefined;
			if (this.loadingAnimation) {
				this.loadingAnimation.setMessage(this.defaultWorkingMessage);
			}
			return;
		}

		if (this.loadingAnimation) {
			this.loadingAnimation.setMessage(message);
			return;
		}

		this.pendingWorkingMessage = message;
	}

	applyPendingWorkingMessage(): void {
		if (this.pendingWorkingMessage === undefined) {
			return;
		}

		const message = this.pendingWorkingMessage;
		this.pendingWorkingMessage = undefined;
		this.setWorkingMessage(message);
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

	handleSessionCommand(): Promise<void> {
		return this.commandController.handleSessionCommand();
	}

	handleUsageCommand(reports?: UsageReport[] | null): Promise<void> {
		return this.commandController.handleUsageCommand(reports);
	}

	async handleChangelogCommand(): Promise<void> {
		await this.commandController.handleChangelogCommand();
	}

	handleHotkeysCommand(): void {
		this.commandController.handleHotkeysCommand();
	}

	handleClearCommand(): Promise<void> {
		return this.commandController.handleClearCommand();
	}

	handleForkCommand(): Promise<void> {
		return this.commandController.handleForkCommand();
	}

	showDebugSelector(): void {
		this.selectorController.showDebugSelector();
	}

	handleArminSaysHi(): void {
		this.commandController.handleArminSaysHi();
	}

	handleBashCommand(command: string, excludeFromContext?: boolean): Promise<void> {
		return this.commandController.handleBashCommand(command, excludeFromContext);
	}

	handlePythonCommand(code: string, excludeFromContext?: boolean): Promise<void> {
		return this.commandController.handlePythonCommand(code, excludeFromContext);
	}

	handleCompactCommand(customInstructions?: string): Promise<void> {
		return this.commandController.handleCompactCommand(customInstructions);
	}

	handleHandoffCommand(customInstructions?: string): Promise<void> {
		return this.commandController.handleHandoffCommand(customInstructions);
	}

	executeCompaction(customInstructionsOrOptions?: string | CompactOptions, isAuto?: boolean): Promise<void> {
		return this.commandController.executeCompaction(customInstructionsOrOptions, isAuto);
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

	showHookSelector(
		title: string,
		options: string[],
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		return this.extensionUiController.showHookSelector(title, options, dialogOptions);
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
