import { join, resolve } from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import Handlebars from "handlebars";
import { CONFIG_DIR_NAME, getPromptsDir } from "$c/config";
import { parseFrontmatter } from "$c/utils/frontmatter";

/**
 * Represents a prompt template loaded from a markdown file
 */
export interface PromptTemplate {
	name: string;
	description: string;
	content: string;
	source: string; // e.g., "(user)", "(project)", "(project:frontend)"
}

export interface TemplateContext extends Record<string, unknown> {
	args?: string[];
	ARGUMENTS?: string;
	arguments?: string;
}

const handlebars = Handlebars.create();

handlebars.registerHelper("arg", function (this: TemplateContext, index: number | string): string {
	const args = this.args ?? [];
	const parsedIndex = typeof index === "number" ? index : Number.parseInt(index, 10);
	if (!Number.isFinite(parsedIndex)) return "";
	const zeroBased = parsedIndex - 1;
	if (zeroBased < 0) return "";
	return args[zeroBased] ?? "";
});

/**
 * {{#list items prefix="- " suffix="" join="\n"}}{{this}}{{/list}}
 * Renders an array with customizable prefix, suffix, and join separator.
 * Note: Use \n in join for newlines (will be unescaped automatically).
 */
handlebars.registerHelper(
	"list",
	function (this: unknown, context: unknown[], options: Handlebars.HelperOptions): string {
		if (!Array.isArray(context) || context.length === 0) return "";
		const prefix = (options.hash.prefix as string) ?? "";
		const suffix = (options.hash.suffix as string) ?? "";
		const rawSeparator = (options.hash.join as string) ?? "\n";
		const separator = rawSeparator.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
		return context.map((item) => `${prefix}${options.fn(item)}${suffix}`).join(separator);
	},
);

/**
 * {{join array ", "}}
 * Joins an array with a separator (default: ", ").
 */
handlebars.registerHelper("join", (context: unknown[], separator?: unknown): string => {
	if (!Array.isArray(context)) return "";
	const sep = typeof separator === "string" ? separator : ", ";
	return context.join(sep);
});

/**
 * {{default value "fallback"}}
 * Returns the value if truthy, otherwise returns the fallback.
 */
handlebars.registerHelper("default", (value: unknown, defaultValue: unknown): unknown => value || defaultValue);

/**
 * {{pluralize count "item" "items"}}
 * Returns "1 item" or "5 items" based on count.
 */
handlebars.registerHelper(
	"pluralize",
	(count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`,
);

/**
 * {{#when value "==" compare}}...{{else}}...{{/when}}
 * Conditional block with comparison operators: ==, ===, !=, !==, >, <, >=, <=
 */
handlebars.registerHelper(
	"when",
	function (this: unknown, lhs: unknown, operator: string, rhs: unknown, options: Handlebars.HelperOptions): string {
		const ops: Record<string, (a: unknown, b: unknown) => boolean> = {
			"==": (a, b) => a === b,
			"===": (a, b) => a === b,
			"!=": (a, b) => a !== b,
			"!==": (a, b) => a !== b,
			">": (a, b) => (a as number) > (b as number),
			"<": (a, b) => (a as number) < (b as number),
			">=": (a, b) => (a as number) >= (b as number),
			"<=": (a, b) => (a as number) <= (b as number),
		};
		const fn = ops[operator];
		if (!fn) return options.inverse(this);
		return fn(lhs, rhs) ? options.fn(this) : options.inverse(this);
	},
);

/**
 * {{#ifAny a b c}}...{{else}}...{{/ifAny}}
 * True if any argument is truthy.
 */
handlebars.registerHelper("ifAny", function (this: unknown, ...args: unknown[]): string {
	const options = args.pop() as Handlebars.HelperOptions;
	return args.some(Boolean) ? options.fn(this) : options.inverse(this);
});

/**
 * {{#ifAll a b c}}...{{else}}...{{/ifAll}}
 * True if all arguments are truthy.
 */
handlebars.registerHelper("ifAll", function (this: unknown, ...args: unknown[]): string {
	const options = args.pop() as Handlebars.HelperOptions;
	return args.every(Boolean) ? options.fn(this) : options.inverse(this);
});

/**
 * {{#table rows headers="Col1|Col2"}}{{col1}}|{{col2}}{{/table}}
 * Generates a markdown table from an array of objects.
 */
handlebars.registerHelper(
	"table",
	function (this: unknown, context: unknown[], options: Handlebars.HelperOptions): string {
		if (!Array.isArray(context) || context.length === 0) return "";
		const headersStr = options.hash.headers as string | undefined;
		const headers = headersStr?.split("|") ?? [];
		const separator = headers.map(() => "---").join(" | ");
		const headerRow = headers.length > 0 ? `| ${headers.join(" | ")} |\n| ${separator} |\n` : "";
		const rows = context.map((item) => `| ${options.fn(item).trim()} |`).join("\n");
		return headerRow + rows;
	},
);

/**
 * {{#codeblock lang="diff"}}...{{/codeblock}}
 * Wraps content in a fenced code block.
 */
handlebars.registerHelper("codeblock", function (this: unknown, options: Handlebars.HelperOptions): string {
	const lang = (options.hash.lang as string) ?? "";
	const content = options.fn(this).trim();
	return `\`\`\`${lang}\n${content}\n\`\`\``;
});

/**
 * {{#xml "tag"}}content{{/xml}}
 * Wraps content in XML-style tags. Returns empty string if content is empty.
 */
handlebars.registerHelper("xml", function (this: unknown, tag: string, options: Handlebars.HelperOptions): string {
	const content = options.fn(this).trim();
	if (!content) return "";
	return `<${tag}>\n${content}\n</${tag}>`;
});

/**
 * {{escapeXml value}}
 * Escapes XML special characters: & < > "
 */
handlebars.registerHelper("escapeXml", (value: unknown): string => {
	if (value == null) return "";
	return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
});

/**
 * {{len array}}
 * Returns the length of an array or string.
 */
handlebars.registerHelper("len", (value: unknown): number => {
	if (Array.isArray(value)) return value.length;
	if (typeof value === "string") return value.length;
	return 0;
});

/**
 * {{add a b}}
 * Adds two numbers.
 */
handlebars.registerHelper("add", (a: number, b: number): number => (a ?? 0) + (b ?? 0));

/**
 * {{sub a b}}
 * Subtracts b from a.
 */
handlebars.registerHelper("sub", (a: number, b: number): number => (a ?? 0) - (b ?? 0));

/**
 * {{#has collection item}}...{{else}}...{{/has}}
 * Checks if an array includes an item or if a Set/Map has a key.
 */
handlebars.registerHelper(
	"has",
	function (this: unknown, collection: unknown, item: unknown, options: Handlebars.HelperOptions): string {
		let found = false;
		if (Array.isArray(collection)) {
			found = collection.includes(item);
		} else if (collection instanceof Set) {
			found = collection.has(item);
		} else if (collection instanceof Map) {
			found = collection.has(item);
		} else if (collection && typeof collection === "object") {
			if (typeof item === "string" || typeof item === "number" || typeof item === "symbol") {
				found = item in collection;
			}
		}
		return found ? options.fn(this) : options.inverse(this);
	},
);

/**
 * {{includes array item}}
 * Returns true if array includes item. For use in other helpers.
 */
handlebars.registerHelper("includes", (collection: unknown, item: unknown): boolean => {
	if (Array.isArray(collection)) return collection.includes(item);
	if (collection instanceof Set) return collection.has(item);
	if (collection instanceof Map) return collection.has(item);
	return false;
});

/**
 * {{not value}}
 * Returns logical NOT of value. For use in subexpressions.
 */
handlebars.registerHelper("not", (value: unknown): boolean => !value);

export function renderPromptTemplate(template: string, context: TemplateContext = {}): string {
	const compiled = handlebars.compile(template, { noEscape: true, strict: false });
	const rendered = compiled(context ?? {});
	return optimizePromptLayout(rendered);
}

function optimizePromptLayout(input: string): string {
	// 1) strip CR / normalize line endings
	let s = input.replace(/\r\n?/g, "\n");

	// normalize NBSP -> space
	s = s.replace(/\u00A0/g, " ");

	const lines = s.split("\n").map((line) => {
		// 2) remove trailing whitespace (spaces/tabs) per line
		let l = line.replace(/[ \t]+$/g, "");

		// 3) lines with only whitespace -> empty line
		if (/^[ \t]*$/.test(l)) return "";

		// 4) normalize leading indentation: every 2 spaces -> \t (preserve leftover 1 space)
		//    NOTE: This is intentionally *only* leading indentation to avoid mangling prose.
		const m = l.match(/^[ \t]+/);
		if (m) {
			const indent = m[0];
			const rest = l.slice(indent.length);

			let out = "";
			let spaces = 0;

			for (const ch of indent) {
				if (ch === "\t") {
					// flush pending spaces before existing tab
					out += "\t".repeat(Math.floor(spaces / 2));
					if (spaces % 2) out += " ";
					spaces = 0;
					out += "\t";
				} else {
					spaces++;
				}
			}

			out += "\t".repeat(Math.floor(spaces / 2));
			if (spaces % 2) out += " ";

			l = out + rest;
		}

		return l;
	});

	s = lines.join("\n");

	// 5) collapse excessive blank lines
	s = s.replace(/\n{3,}/g, "\n\n");

	return s.trim();
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
 * Substitute argument placeholders in template content
 * Supports $1, $2, ... for positional args, $@ and $ARGUMENTS for all args
 *
 * Note: Replacement happens on the template string only. Argument values
 * containing patterns like $1, $@, or $ARGUMENTS are NOT recursively substituted.
 */
export function substituteArgs(content: string, args: string[]): string {
	let result = content;

	// Replace $1, $2, etc. with positional args FIRST (before wildcards)
	// This prevents wildcard replacement values containing $<digit> patterns from being re-substituted
	result = result.replace(/\$(\d+)/g, (_, num) => {
		const index = parseInt(num, 10) - 1;
		return args[index] ?? "";
	});

	result = result.replace(/\$@\[(\d+)(?::(\d*)?)?\]/g, (_, startRaw: string, lengthRaw?: string) => {
		const start = Number.parseInt(startRaw, 10);
		if (!Number.isFinite(start) || start < 1) return "";
		const startIndex = start - 1;
		if (startIndex >= args.length) return "";

		if (lengthRaw === undefined || lengthRaw === "") {
			return args.slice(startIndex).join(" ");
		}

		const length = Number.parseInt(lengthRaw, 10);
		if (!Number.isFinite(length) || length <= 0) return "";
		return args.slice(startIndex, startIndex + length).join(" ");
	});

	// Pre-compute all args joined (optimization)
	const allArgs = args.join(" ");

	// Replace $ARGUMENTS with all args joined (new syntax, aligns with Claude, Codex, OpenCode)
	result = result.replace(/\$ARGUMENTS/g, allArgs);

	// Replace $@ with all args joined (existing syntax)
	result = result.replace(/\$@/g, allArgs);

	return result;
}

/**
 * Recursively scan a directory for .md files (and symlinks to .md files) and load them as prompt templates
 */
async function loadTemplatesFromDir(
	dir: string,
	source: "user" | "project",
	subdir: string = "",
): Promise<PromptTemplate[]> {
	const templates: PromptTemplate[] = [];
	try {
		const glob = new Bun.Glob("**/*");
		const entries = [];
		for await (const entry of glob.scan({ cwd: dir, absolute: false, onlyFiles: false })) {
			entries.push(entry);
		}

		// Group by path depth to process directories before deeply nested files
		entries.sort((a, b) => a.split("/").length - b.split("/").length);

		for (const entry of entries) {
			const fullPath = join(dir, entry);
			const file = Bun.file(fullPath);

			try {
				const stat = await file.exists();
				if (!stat) continue;

				if (entry.endsWith(".md")) {
					const rawContent = await file.text();
					const { frontmatter, body } = parseFrontmatter(rawContent, { source: fullPath });

					const name = entry.split("/").pop()!.slice(0, -3); // Remove .md extension

					// Build source string based on subdirectory structure
					const entryDir = entry.includes("/") ? entry.split("/").slice(0, -1).join(":") : "";
					const fullSubdir = subdir && entryDir ? `${subdir}:${entryDir}` : entryDir || subdir;

					let sourceStr: string;
					if (source === "user") {
						sourceStr = fullSubdir ? `(user:${fullSubdir})` : "(user)";
					} else {
						sourceStr = fullSubdir ? `(project:${fullSubdir})` : "(project)";
					}

					// Get description from frontmatter or first non-empty line
					let description = String(frontmatter.description || "");
					if (!description) {
						const firstLine = body.split("\n").find((line) => line.trim());
						if (firstLine) {
							// Truncate if too long
							description = firstLine.slice(0, 60);
							if (firstLine.length > 60) description += "...";
						}
					}

					// Append source to description
					description = description ? `${description} ${sourceStr}` : sourceStr;

					templates.push({
						name,
						description,
						content: body,
						source: sourceStr,
					});
				}
			} catch (error) {
				logger.warn("Failed to load prompt template", { path: fullPath, error: String(error) });
			}
		}
	} catch (error) {
		if (!(await Bun.file(dir).exists())) {
			return [];
		}
		logger.warn("Failed to scan prompt templates directory", { dir, error: String(error) });
	}

	return templates;
}

export interface LoadPromptTemplatesOptions {
	/** Working directory for project-local templates. Default: process.cwd() */
	cwd?: string;
	/** Agent config directory for global templates. Default: from getPromptsDir() */
	agentDir?: string;
}

/**
 * Load all prompt templates from:
 * 1. Global: agentDir/prompts/
 * 2. Project: cwd/{CONFIG_DIR_NAME}/prompts/
 */
export async function loadPromptTemplates(options: LoadPromptTemplatesOptions = {}): Promise<PromptTemplate[]> {
	const resolvedCwd = options.cwd ?? process.cwd();
	const resolvedAgentDir = options.agentDir ?? getPromptsDir();

	const templates: PromptTemplate[] = [];

	// 1. Load global templates from agentDir/prompts/
	// Note: if agentDir is provided, it should be the agent dir, not the prompts dir
	const globalPromptsDir = options.agentDir ? join(options.agentDir, "prompts") : resolvedAgentDir;
	templates.push(...(await loadTemplatesFromDir(globalPromptsDir, "user")));

	// 2. Load project templates from cwd/{CONFIG_DIR_NAME}/prompts/
	const projectPromptsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "prompts");
	templates.push(...(await loadTemplatesFromDir(projectPromptsDir, "project")));

	return templates;
}

/**
 * Expand a prompt template if it matches a template name.
 * Returns the expanded content or the original text if not a template.
 */
export function expandPromptTemplate(text: string, templates: PromptTemplate[]): string {
	if (!text.startsWith("/")) return text;

	const spaceIndex = text.indexOf(" ");
	const templateName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

	const template = templates.find((t) => t.name === templateName);
	if (template) {
		const args = parseCommandArgs(argsString);
		const argsText = args.join(" ");
		const substituted = substituteArgs(template.content, args);
		return renderPromptTemplate(substituted, { args, ARGUMENTS: argsText, arguments: argsText });
	}

	return text;
}
