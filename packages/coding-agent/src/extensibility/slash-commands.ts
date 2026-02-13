import type { AutocompleteItem } from "@oh-my-pi/pi-tui";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export type SlashCommandLocation = "user" | "project" | "path";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	location?: SlashCommandLocation;
	path?: string;
}

/** Declarative subcommand definition for commands like /mcp */
export interface SubcommandDef {
	name: string;
	description: string;
	/** Usage hint shown as dim ghost text, e.g. "<name> [--scope project|user]" */
	usage?: string;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	/** Subcommands for dropdown completion (e.g. /mcp add, /mcp list) */
	subcommands?: SubcommandDef[];
	/** Static inline hint when command takes a simple argument (no subcommands) */
	inlineHint?: string;
}

/**
 * Build getArgumentCompletions from declarative subcommand definitions.
 * Returns subcommand names filtered by prefix in the dropdown.
 */
function buildArgumentCompletions(subcommands: SubcommandDef[]): (prefix: string) => AutocompleteItem[] | null {
	return (argumentPrefix: string) => {
		if (argumentPrefix.includes(" ")) return null; // past the subcommand
		const lower = argumentPrefix.toLowerCase();
		const matches = subcommands
			.filter(s => s.name.startsWith(lower))
			.map(s => ({
				value: `${s.name} `,
				label: s.name,
				description: s.description,
				hint: s.usage,
			}));
		return matches.length > 0 ? matches : null;
	};
}

/**
 * Build getInlineHint from declarative subcommand definitions.
 * Shows remaining completion + usage as dim ghost text after cursor.
 */
function buildSubcommandInlineHint(subcommands: SubcommandDef[]): (argumentText: string) => string | null {
	return (argumentText: string) => {
		const trimmed = argumentText.trimStart();
		const spaceIndex = trimmed.indexOf(" ");

		if (spaceIndex === -1) {
			// Still typing subcommand name — show remaining chars + usage
			const prefix = trimmed.toLowerCase();
			if (prefix.length === 0) return null;
			const match = subcommands.find(s => s.name.startsWith(prefix));
			if (!match) return null;
			const remaining = match.name.slice(prefix.length);
			return remaining + (match.usage ? ` ${match.usage}` : "");
		}

		// Subcommand typed — show remaining usage params
		const subName = trimmed.slice(0, spaceIndex).toLowerCase();
		const afterSub = trimmed.slice(spaceIndex + 1);
		const sub = subcommands.find(s => s.name === subName);
		if (!sub?.usage) return null;

		if (afterSub.length > 0) {
			const usageParts = sub.usage.split(" ");
			const inputParts = afterSub.trim().split(/\s+/);
			const remaining = usageParts.slice(inputParts.length);
			return remaining.length > 0 ? remaining.join(" ") : null;
		}

		return sub.usage;
	};
}

/**
 * Build getInlineHint for commands with a simple static hint string.
 * Shows the hint only when no arguments have been typed yet.
 */
function buildStaticInlineHint(hint: string): (argumentText: string) => string | null {
	return (argumentText: string) => (argumentText.trim().length === 0 ? hint : null);
}

const BUILTIN_SLASH_COMMAND_DEFS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "plan", description: "Toggle plan mode (agent plans before executing)" },
	{ name: "model", description: "Select model (opens selector UI)" },
	{ name: "export", description: "Export session to HTML file", inlineHint: "[path]" },
	{ name: "dump", description: "Copy session transcript to clipboard" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{
		name: "browser",
		description: "Toggle browser headless vs visible mode",
		subcommands: [
			{ name: "headless", description: "Switch to headless mode" },
			{ name: "visible", description: "Switch to visible mode" },
		],
	},
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "usage", description: "Show provider usage and limits" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "extensions", description: "Open Extension Control Center dashboard" },
	{ name: "branch", description: "Create a new branch from a previous message" },
	{ name: "fork", description: "Create a new fork from a previous message" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "login", description: "Login with OAuth provider" },
	{ name: "logout", description: "Logout from OAuth provider" },
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
	},
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context", inlineHint: "[focus instructions]" },
	{ name: "handoff", description: "Hand off session context to a new session", inlineHint: "[focus instructions]" },
	{ name: "resume", description: "Resume a different session" },
	{ name: "background", description: "Detach UI and continue running in background" },
	{ name: "debug", description: "Write debug log (TUI state and messages)" },
	{ name: "move", description: "Move session to a different working directory", inlineHint: "<path>" },
	{ name: "exit", description: "Exit the application" },
	{ name: "quit", description: "Quit the application" },
];

/**
 * Materialized builtin slash commands with completion functions derived from
 * declarative subcommand/hint definitions.
 */
export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<
	BuiltinSlashCommand & {
		getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null;
		getInlineHint?: (argumentText: string) => string | null;
	}
> = BUILTIN_SLASH_COMMAND_DEFS.map(cmd => {
	if (cmd.subcommands) {
		return {
			...cmd,
			getArgumentCompletions: buildArgumentCompletions(cmd.subcommands),
			getInlineHint: buildSubcommandInlineHint(cmd.subcommands),
		};
	}
	if (cmd.inlineHint) {
		return {
			...cmd,
			getInlineHint: buildStaticInlineHint(cmd.inlineHint),
		};
	}
	return cmd;
});

import { slashCommandCapability } from "../capability/slash-command";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { SlashCommand } from "../discovery";
import { loadCapability } from "../discovery";
import { EMBEDDED_COMMAND_TEMPLATES } from "../task/commands";
import { parseFrontmatter } from "../utils/frontmatter";

/**
 * Represents a custom slash command loaded from a file
 */
export interface FileSlashCommand {
	name: string;
	description: string;
	content: string;
	source: string; // e.g., "via Claude Code (User)"
	/** Source metadata for display */
	_source?: { providerName: string; level: "user" | "project" | "native" };
}

const EMBEDDED_SLASH_COMMANDS = EMBEDDED_COMMAND_TEMPLATES;

function parseCommandTemplate(
	content: string,
	options: { source: string; level?: "off" | "warn" | "fatal" },
): { description: string; body: string } {
	const { frontmatter, body } = parseFrontmatter(content, options);
	const frontmatterDesc = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";

	// Get description from frontmatter or first non-empty line
	let description = frontmatterDesc;
	if (!description) {
		const firstLine = body.split("\n").find(line => line.trim());
		if (firstLine) {
			description = firstLine.slice(0, 60);
			if (firstLine.length > 60) description += "...";
		}
	}

	return { description, body };
}

/**
 * Parse command arguments respecting quoted strings (bash-style)
 * Returns array of arguments
 */
export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (let i = 0; i < argsString.length; i++) {
		const char = argsString[i];

		if (inQuote) {
			if (char === inQuote) {
				inQuote = null;
			} else {
				current += char;
			}
		} else if (char === '"' || char === "'") {
			inQuote = char;
		} else if (char === " " || char === "\t") {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}

	if (current) {
		args.push(current);
	}

	return args;
}

/**
 * Substitute argument placeholders in command content
 * Supports $1, $2, ... for positional args, $@ and $ARGUMENTS for all args
 */
export function substituteArgs(content: string, args: string[]): string {
	let result = content;

	// Replace $1, $2, etc. with positional args FIRST (before wildcards)
	// This prevents wildcard replacement values containing $<digit> patterns from being re-substituted
	result = result.replace(/\$(\d+)/g, (_, num) => {
		const index = parseInt(num, 10) - 1;
		return args[index] ?? "";
	});

	// Pre-compute all args joined
	const allArgs = args.join(" ");

	// Replace $ARGUMENTS with all args joined (aligns with Claude, Codex)
	result = result.replace(/\$ARGUMENTS/g, allArgs);

	// Replace $@ with all args joined
	result = result.replace(/\$@/g, allArgs);

	return result;
}

export interface LoadSlashCommandsOptions {
	/** Working directory for project-local commands. Default: getProjectDir() */
	cwd?: string;
}

/**
 * Load all custom slash commands using the capability API.
 * Loads from all registered providers (builtin, user, project).
 */
export async function loadSlashCommands(options: LoadSlashCommandsOptions = {}): Promise<FileSlashCommand[]> {
	const result = await loadCapability<SlashCommand>(slashCommandCapability.id, { cwd: options.cwd });

	const fileCommands: FileSlashCommand[] = result.items.map(cmd => {
		const { description, body } = parseCommandTemplate(cmd.content, {
			source: cmd.path ?? `slash-command:${cmd.name}`,
			level: cmd.level === "native" ? "fatal" : "warn",
		});

		// Format source label: "via ProviderName Level"
		const capitalizedLevel = cmd.level.charAt(0).toUpperCase() + cmd.level.slice(1);
		const sourceStr = `via ${cmd._source.providerName} ${capitalizedLevel}`;

		return {
			name: cmd.name,
			description,
			content: body,
			source: sourceStr,
			_source: { providerName: cmd._source.providerName, level: cmd.level },
		};
	});

	const seenNames = new Set(fileCommands.map(cmd => cmd.name));
	for (const cmd of EMBEDDED_SLASH_COMMANDS) {
		const name = cmd.name.replace(/\.md$/, "");
		if (seenNames.has(name)) continue;

		const { description, body } = parseCommandTemplate(cmd.content, {
			source: `embedded:${cmd.name}`,
			level: "fatal",
		});
		fileCommands.push({
			name,
			description,
			content: body,
			source: "bundled",
		});
		seenNames.add(name);
	}

	return fileCommands;
}

/**
 * Expand a slash command if it matches a file-based command.
 * Returns the expanded content or the original text if not a slash command.
 */
export function expandSlashCommand(text: string, fileCommands: FileSlashCommand[]): string {
	if (!text.startsWith("/")) return text;

	const spaceIndex = text.indexOf(" ");
	const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

	const fileCommand = fileCommands.find(cmd => cmd.name === commandName);
	if (fileCommand) {
		const args = parseCommandArgs(argsString);
		const argsText = args.join(" ");
		const substituted = substituteArgs(fileCommand.content, args);
		return renderPromptTemplate(substituted, { args, ARGUMENTS: argsText, arguments: argsText });
	}

	return text;
}
