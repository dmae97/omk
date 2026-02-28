import type { SettingPath, SettingValue } from "../config/settings";
import { settings } from "../config/settings";
import type { InteractiveModeContext } from "../modes/types";

/** Declarative subcommand definition for commands like /mcp. */
export interface SubcommandDef {
	name: string;
	description: string;
	/** Usage hint shown as dim ghost text, e.g. "<name> [--scope project|user]". */
	usage?: string;
}

/** Declarative builtin slash command definition used by autocomplete and help UI. */
export interface BuiltinSlashCommand {
	name: string;
	description: string;
	/** Subcommands for dropdown completion (e.g. /mcp add, /mcp list). */
	subcommands?: SubcommandDef[];
	/** Static inline hint when command takes a simple argument (no subcommands). */
	inlineHint?: string;
}

interface ParsedBuiltinSlashCommand {
	name: string;
	args: string;
	text: string;
}

interface BuiltinSlashCommandSpec extends BuiltinSlashCommand {
	aliases?: string[];
	allowArgs?: boolean;
	handle: (command: ParsedBuiltinSlashCommand, runtime: BuiltinSlashCommandRuntime) => Promise<void> | void;
}

export interface BuiltinSlashCommandRuntime {
	ctx: InteractiveModeContext;
	handleBackgroundCommand: () => void;
}

function parseBuiltinSlashCommand(text: string): ParsedBuiltinSlashCommand | null {
	if (!text.startsWith("/")) return null;
	const body = text.slice(1);
	if (!body) return null;

	const firstWhitespace = body.search(/\s/);
	if (firstWhitespace === -1) {
		return {
			name: body,
			args: "",
			text,
		};
	}

	return {
		name: body.slice(0, firstWhitespace),
		args: body.slice(firstWhitespace).trim(),
		text,
	};
}

const shutdownHandler = (_command: ParsedBuiltinSlashCommand, runtime: BuiltinSlashCommandRuntime): void => {
	runtime.ctx.editor.setText("");
	void runtime.ctx.shutdown();
};

const BUILTIN_SLASH_COMMAND_REGISTRY: ReadonlyArray<BuiltinSlashCommandSpec> = [
	{
		name: "settings",
		description: "Open settings menu",
		handle: (_command, runtime) => {
			runtime.ctx.showSettingsSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "plan",
		description: "Toggle plan mode (agent plans before executing)",
		inlineHint: "[prompt]",
		allowArgs: true,
		handle: async (command, runtime) => {
			await runtime.ctx.handlePlanModeCommand(command.args || undefined);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "model",
		aliases: ["models"],
		description: "Select model (opens selector UI)",
		handle: (_command, runtime) => {
			runtime.ctx.showModelSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "export",
		description: "Export session to HTML file",
		inlineHint: "[path]",
		allowArgs: true,
		handle: async (command, runtime) => {
			await runtime.ctx.handleExportCommand(command.text);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "dump",
		description: "Copy session transcript to clipboard",
		handle: async (_command, runtime) => {
			await runtime.ctx.handleDumpCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "share",
		description: "Share session as a secret GitHub gist",
		handle: async (_command, runtime) => {
			await runtime.ctx.handleShareCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "browser",
		description: "Toggle browser headless vs visible mode",
		subcommands: [
			{ name: "headless", description: "Switch to headless mode" },
			{ name: "visible", description: "Switch to visible mode" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			const arg = command.args.toLowerCase();
			const current = settings.get("browser.headless" as SettingPath) as boolean;
			let next = current;
			if (!(settings.get("browser.enabled" as SettingPath) as boolean)) {
				runtime.ctx.showWarning("Browser tool is disabled (enable in settings)");
				runtime.ctx.editor.setText("");
				return;
			}
			if (!arg) {
				next = !current;
			} else if (["headless", "hidden"].includes(arg)) {
				next = true;
			} else if (["visible", "show", "headful"].includes(arg)) {
				next = false;
			} else {
				runtime.ctx.showStatus("Usage: /browser [headless|visible]");
				runtime.ctx.editor.setText("");
				return;
			}
			settings.set("browser.headless" as SettingPath, next as SettingValue<SettingPath>);
			const tool = runtime.ctx.session.getToolByName("browser");
			if (tool && "restartForModeChange" in tool) {
				try {
					await (tool as { restartForModeChange: () => Promise<void> }).restartForModeChange();
				} catch (error) {
					runtime.ctx.showWarning(
						`Failed to restart browser: ${error instanceof Error ? error.message : String(error)}`,
					);
					runtime.ctx.editor.setText("");
					return;
				}
			}
			runtime.ctx.showStatus(`Browser mode: ${next ? "headless" : "visible"}`);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "copy",
		description: "Copy last agent message to clipboard",
		handle: async (_command, runtime) => {
			await runtime.ctx.handleCopyCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "session",
		description: "Show session info and stats",
		handle: async (_command, runtime) => {
			await runtime.ctx.handleSessionCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "jobs",
		description: "Show async background jobs status",
		handle: async (_command, runtime) => {
			await runtime.ctx.handleJobsCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "usage",
		description: "Show provider usage and limits",
		handle: async (_command, runtime) => {
			await runtime.ctx.handleUsageCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "changelog",
		description: "Show changelog entries",
		subcommands: [{ name: "full", description: "Show complete changelog" }],
		allowArgs: true,
		handle: async (command, runtime) => {
			const showFull = command.args.split(/\s+/).filter(Boolean).includes("full");
			await runtime.ctx.handleChangelogCommand(showFull);
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "hotkeys",
		description: "Show all keyboard shortcuts",
		handle: (_command, runtime) => {
			runtime.ctx.handleHotkeysCommand();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "extensions",
		aliases: ["status"],
		description: "Open Extension Control Center dashboard",
		handle: (_command, runtime) => {
			runtime.ctx.showExtensionsDashboard();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "agents",
		description: "Open Agent Control Center dashboard",
		handle: (_command, runtime) => {
			runtime.ctx.showAgentsDashboard();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "branch",
		description: "Create a new branch from a previous message",
		handle: (_command, runtime) => {
			if (settings.get("doubleEscapeAction") === "tree") {
				runtime.ctx.showTreeSelector();
			} else {
				runtime.ctx.showUserMessageSelector();
			}
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "fork",
		description: "Create a new fork from a previous message",
		handle: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleForkCommand();
		},
	},
	{
		name: "tree",
		description: "Navigate session tree (switch branches)",
		handle: (_command, runtime) => {
			runtime.ctx.showTreeSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "login",
		description: "Login with OAuth provider",
		inlineHint: "[redirect URL]",
		allowArgs: true,
		handle: (command, runtime) => {
			const manualInput = runtime.ctx.oauthManualInput;
			const args = command.args.trim();
			if (args.length > 0) {
				const submitted = manualInput.submit(args);
				if (submitted) {
					runtime.ctx.showStatus("OAuth callback received; completing login…");
				} else {
					runtime.ctx.showWarning("No OAuth login is waiting for a manual callback.");
				}
				runtime.ctx.editor.setText("");
				return;
			}

			if (manualInput.hasPending()) {
				const provider = manualInput.pendingProviderId;
				const message = provider
					? `OAuth login already in progress for ${provider}. Paste the redirect URL with /login <url>.`
					: "OAuth login already in progress. Paste the redirect URL with /login <url>.";
				runtime.ctx.showWarning(message);
				runtime.ctx.editor.setText("");
				return;
			}

			void runtime.ctx.showOAuthSelector("login");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "logout",
		description: "Logout from OAuth provider",
		handle: (_command, runtime) => {
			void runtime.ctx.showOAuthSelector("logout");
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "mcp",
		description: "Manage MCP servers (add, list, remove, test)",
		subcommands: [
			{
				name: "add",
				description: "Add a new MCP server",
				usage: "<name> [--scope project|user] [--url <url>] [-- <command...>]",
			},
			{ name: "list", description: "List all configured MCP servers" },
			{ name: "remove", description: "Remove an MCP server", usage: "<name> [--scope project|user]" },
			{ name: "test", description: "Test connection to a server", usage: "<name>" },
			{ name: "reauth", description: "Reauthorize OAuth for a server", usage: "<name>" },
			{ name: "unauth", description: "Remove OAuth auth from a server", usage: "<name>" },
			{ name: "enable", description: "Enable an MCP server", usage: "<name>" },
			{ name: "disable", description: "Disable an MCP server", usage: "<name>" },
			{ name: "reload", description: "Force reload MCP runtime tools" },
			{ name: "help", description: "Show help message" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMCPCommand(command.text);
		},
	},
	{
		name: "ssh",
		description: "Manage SSH hosts (add, list, remove)",
		subcommands: [
			{
				name: "add",
				description: "Add an SSH host",
				usage: "<name> --host <host> [--user <user>] [--port <port>] [--key <keyPath>]",
			},
			{ name: "list", description: "List all configured SSH hosts" },
			{ name: "remove", description: "Remove an SSH host", usage: "<name> [--scope project|user]" },
			{ name: "help", description: "Show help message" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.addToHistory(command.text);
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleSSHCommand(command.text);
		},
	},
	{
		name: "new",
		description: "Start a new session",
		handle: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleClearCommand();
		},
	},
	{
		name: "compact",
		description: "Manually compact the session context",
		inlineHint: "[focus instructions]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const customInstructions = command.args || undefined;
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleCompactCommand(customInstructions);
		},
	},
	{
		name: "handoff",
		description: "Hand off session context to a new session",
		inlineHint: "[focus instructions]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const customInstructions = command.args || undefined;
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleHandoffCommand(customInstructions);
		},
	},
	{
		name: "resume",
		description: "Resume a different session",
		handle: (_command, runtime) => {
			runtime.ctx.showSessionSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "background",
		aliases: ["bg"],
		description: "Detach UI and continue running in background",
		handle: (_command, runtime) => {
			runtime.ctx.editor.setText("");
			runtime.handleBackgroundCommand();
		},
	},
	{
		name: "debug",
		description: "Write debug log (TUI state and messages)",
		handle: (_command, runtime) => {
			runtime.ctx.showDebugSelector();
			runtime.ctx.editor.setText("");
		},
	},
	{
		name: "memory",
		description: "Inspect and operate memory maintenance",
		subcommands: [
			{ name: "view", description: "Show current memory injection payload" },
			{ name: "clear", description: "Clear persisted memory data and artifacts" },
			{ name: "reset", description: "Alias for clear" },
			{ name: "enqueue", description: "Enqueue memory consolidation maintenance" },
			{ name: "rebuild", description: "Alias for enqueue" },
		],
		allowArgs: true,
		handle: async (command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMemoryCommand(command.text);
		},
	},
	{
		name: "move",
		description: "Move session to a different working directory",
		inlineHint: "<path>",
		allowArgs: true,
		handle: async (command, runtime) => {
			const targetPath = command.args;
			if (!targetPath) {
				runtime.ctx.showError("Usage: /move <path>");
				runtime.ctx.editor.setText("");
				return;
			}
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleMoveCommand(targetPath);
		},
	},
	{
		name: "exit",
		description: "Exit the application",
		handle: shutdownHandler,
	},
	{
		name: "quit",
		description: "Quit the application",
		handle: shutdownHandler,
	},
];

const BUILTIN_SLASH_COMMAND_LOOKUP = new Map<string, BuiltinSlashCommandSpec>();
for (const command of BUILTIN_SLASH_COMMAND_REGISTRY) {
	BUILTIN_SLASH_COMMAND_LOOKUP.set(command.name, command);
	for (const alias of command.aliases ?? []) {
		BUILTIN_SLASH_COMMAND_LOOKUP.set(alias, command);
	}
}

/** Builtin command metadata used for slash-command autocomplete and help text. */
export const BUILTIN_SLASH_COMMAND_DEFS: ReadonlyArray<BuiltinSlashCommand> = BUILTIN_SLASH_COMMAND_REGISTRY.map(
	command => ({
		name: command.name,
		description: command.description,
		subcommands: command.subcommands,
		inlineHint: command.inlineHint,
	}),
);

/**
 * Execute a builtin slash command when it matches known command syntax.
 *
 * Returns true when a builtin command consumed the input; false otherwise.
 */
export async function executeBuiltinSlashCommand(text: string, runtime: BuiltinSlashCommandRuntime): Promise<boolean> {
	const parsed = parseBuiltinSlashCommand(text);
	if (!parsed) return false;

	const command = BUILTIN_SLASH_COMMAND_LOOKUP.get(parsed.name);
	if (!command) return false;
	if (parsed.args.length > 0 && !command.allowArgs) {
		return false;
	}

	await command.handle(parsed, runtime);
	return true;
}
