import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export type BuiltinSlashCommandGroup = "mode" | "runtime" | "ui" | "provider" | "tools" | "session";

export interface BuiltinSlashCommand {
	name: string;
	aliases?: string[];
	group: BuiltinSlashCommandGroup;
	description: string;
	usage: string;
}

export interface ParsedSlashCommand {
	raw: string;
	name: string;
	args: string[];
	argsText: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", group: "ui", description: "Open settings menu", usage: "/settings" },
	{
		name: "model",
		aliases: ["m"],
		group: "provider",
		description: "Select model or set provider/model directly",
		usage: "/model [provider/model]",
	},
	{
		name: "think",
		aliases: ["t"],
		group: "mode",
		description: "Set thinking level directly (off, minimal, low, medium, high, xhigh, max)",
		usage: "/think [off|minimal|low|medium|high|xhigh|max]",
	},
	{
		name: "scoped-models",
		group: "provider",
		description: "Enable/disable models for Ctrl+P cycling",
		usage: "/scoped-models",
	},
	{ name: "theme", group: "ui", description: "Switch terminal theme directly", usage: "/theme [theme-name]" },
	{
		name: "panel",
		group: "ui",
		description: "Control OMK pinned dashboard panel",
		usage: "/panel [pin|hide|compact|wide]",
	},
	{ name: "doctor", group: "runtime", description: "Show OMK runtime diagnostics", usage: "/doctor [tui]" },
	{ name: "brand", group: "ui", description: "Show OMK cyberpunk/matrix brand surface", usage: "/brand" },
	{
		name: "export",
		group: "session",
		description: "Export session (HTML default, or specify path: .html/.jsonl)",
		usage: "/export [path]",
	},
	{
		name: "import",
		group: "session",
		description: "Import and resume a session from a JSONL file",
		usage: "/import <path>",
	},
	{ name: "share", group: "session", description: "Share session as a secret GitHub gist", usage: "/share" },
	{ name: "copy", group: "session", description: "Copy last agent message to clipboard", usage: "/copy" },
	{ name: "name", group: "session", description: "Set session display name", usage: "/name [name]" },
	{ name: "session", group: "session", description: "Show session info and stats", usage: "/session" },
	{ name: "changelog", group: "ui", description: "Show changelog entries", usage: "/changelog" },
	{ name: "hotkeys", group: "ui", description: "Show all keyboard shortcuts", usage: "/hotkeys" },
	{ name: "fork", group: "session", description: "Create a new fork from a previous user message", usage: "/fork" },
	{
		name: "clone",
		group: "session",
		description: "Duplicate the current session at the current position",
		usage: "/clone",
	},
	{ name: "tree", group: "session", description: "Navigate session tree (switch branches)", usage: "/tree" },
	{ name: "login", group: "provider", description: "Configure provider authentication", usage: "/login" },
	{ name: "logout", group: "provider", description: "Remove provider authentication", usage: "/logout" },
	{ name: "new", group: "session", description: "Start a new session", usage: "/new" },
	{
		name: "compact",
		group: "runtime",
		description: "Manually compact the session context",
		usage: "/compact [instructions]",
	},
	{ name: "resume", group: "session", description: "Resume a different session", usage: "/resume" },
	{
		name: "reload",
		group: "runtime",
		description: "Reload keybindings, extensions, skills, prompts, and themes",
		usage: "/reload",
	},
	{ name: "quit", group: "session", description: `Quit ${APP_NAME}`, usage: "/quit" },
];

export function parseSlashCommandInput(input: string): ParsedSlashCommand | undefined {
	const raw = input.trim();
	if (!raw.startsWith("/") || raw === "/") return undefined;
	const body = raw.slice(1).trim();
	if (!body) return undefined;
	const firstSpace = body.search(/\s/);
	const name = firstSpace === -1 ? body : body.slice(0, firstSpace);
	const argsText = firstSpace === -1 ? "" : body.slice(firstSpace).trim();
	return {
		raw,
		name,
		args: argsText ? argsText.split(/\s+/) : [],
		argsText,
	};
}

export function findBuiltinSlashCommand(name: string): BuiltinSlashCommand | undefined {
	const normalized = name.toLowerCase();
	return BUILTIN_SLASH_COMMANDS.find(
		(command) => command.name === normalized || (command.aliases?.includes(normalized) ?? false),
	);
}
