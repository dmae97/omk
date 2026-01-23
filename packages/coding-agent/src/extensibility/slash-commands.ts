import { slashCommandCapability } from "$c/capability/slash-command";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import type { SlashCommand } from "$c/discovery";
import { loadCapability } from "$c/discovery";
import { EMBEDDED_COMMAND_TEMPLATES } from "$c/task/commands";
import { parseFrontmatter } from "$c/utils/frontmatter";

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
		const firstLine = body.split("\n").find((line) => line.trim());
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
	/** Working directory for project-local commands. Default: process.cwd() */
	cwd?: string;
}

/**
 * Load all custom slash commands using the capability API.
 * Loads from all registered providers (builtin, user, project).
 */
export async function loadSlashCommands(options: LoadSlashCommandsOptions = {}): Promise<FileSlashCommand[]> {
	const result = await loadCapability<SlashCommand>(slashCommandCapability.id, { cwd: options.cwd });

	const fileCommands: FileSlashCommand[] = result.items.map((cmd) => {
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

	const seenNames = new Set(fileCommands.map((cmd) => cmd.name));
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

	const fileCommand = fileCommands.find((cmd) => cmd.name === commandName);
	if (fileCommand) {
		const args = parseCommandArgs(argsString);
		const argsText = args.join(" ");
		const substituted = substituteArgs(fileCommand.content, args);
		return renderPromptTemplate(substituted, { args, ARGUMENTS: argsText, arguments: argsText });
	}

	return text;
}
