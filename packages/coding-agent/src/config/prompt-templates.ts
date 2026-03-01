import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectDir, getProjectPromptsDir, getPromptsDir, logger } from "@oh-my-pi/pi-utils";
import Handlebars from "handlebars";
import { computeLineHash } from "../patch/hashline";
import { jtdToTypeScript } from "../tools/jtd-to-typescript";
import { parseCommandArgs, substituteArgs } from "../utils/command-args";
import { parseFrontmatter } from "../utils/frontmatter";
import { formatPromptContent } from "../utils/prompt-format";

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
		return context.map(item => `${prefix}${options.fn(item)}${suffix}`).join(separator);
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
		const rows = context.map(item => `| ${options.fn(item).trim()} |`).join("\n");
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

handlebars.registerHelper("jtdToTypeScript", (schema: unknown): string => {
	try {
		return jtdToTypeScript(schema);
	} catch {
		return "unknown";
	}
});

handlebars.registerHelper("jsonStringify", (value: unknown): string => JSON.stringify(value));

/**
 * Renders a section separator:
 *
 * ═══════════════════════════════
 *  Name
 * ═══════════════════════════════
 */
export function sectionSeparator(name: string): string {
	return `\n\n═══════════${name}═══════════\n`;
}

handlebars.registerHelper("SECTION_SEPERATOR", (name: unknown): string => sectionSeparator(String(name)));

/**
 * {{hlineref lineNum "content"}} — compute a real hashline ref for prompt examples.
 * Returns `"lineNum#hash"` using the actual hash algorithm.
 */
function formatHashlineRef(lineNum: unknown, content: unknown): { num: number; text: string; ref: string } {
	const num = typeof lineNum === "number" ? lineNum : Number.parseInt(String(lineNum), 10);
	const text = typeof content === "string" ? content : String(content ?? "");
	const ref = `${num}#${computeLineHash(num, text)}`;
	return { num, text, ref };
}

handlebars.registerHelper("hlineref", (lineNum: unknown, content: unknown): string => {
	const { ref } = formatHashlineRef(lineNum, content);
	return ref;
});

/**
 * {{hlinejsonref lineNum "content"}} — same as hlineref but returns a JSON-quoted string.
 * Useful for embedding hashline refs inside JSON blocks in prompts.
 */
handlebars.registerHelper("hlinejsonref", (lineNum: unknown, content: unknown): string => {
	const { ref } = formatHashlineRef(lineNum, content);
	return JSON.stringify(ref);
});

/**
 * {{hlinefull lineNum "content"}} — format a full read-style line with prefix.
 * Returns `"lineNum#hash:content"`.
 */
handlebars.registerHelper("hlinefull", (lineNum: unknown, content: unknown): string => {
	const { ref, text } = formatHashlineRef(lineNum, content);
	return `${ref}:${text}`;
});

export function renderPromptTemplate(template: string, context: TemplateContext = {}): string {
	const compiled = handlebars.compile(template, { noEscape: true, strict: false });
	const rendered = compiled(context ?? {});
	return formatPromptContent(rendered, { renderPhase: "post-render" });
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
			const fullPath = path.join(dir, entry);
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
						const firstLine = body.split("\n").find(line => line.trim());
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
		if (!fs.existsSync(dir)) {
			return [];
		}
		logger.warn("Failed to scan prompt templates directory", { dir, error: String(error) });
	}

	return templates;
}

export interface LoadPromptTemplatesOptions {
	/** Working directory for project-local templates. Default: getProjectDir() */
	cwd?: string;
	/** Agent config directory for global templates. Default: from getPromptsDir() */
	agentDir?: string;
}

/**
 * Load all prompt templates from:
 * 1. Global: agentDir/prompts/
 * 2. Project: cwd/.omp/prompts/
 */
export async function loadPromptTemplates(options: LoadPromptTemplatesOptions = {}): Promise<PromptTemplate[]> {
	const resolvedCwd = options.cwd ?? getProjectDir();
	const resolvedAgentDir = options.agentDir ?? getPromptsDir();

	const templates: PromptTemplate[] = [];

	// 1. Load global templates from agentDir/prompts/
	// Note: if agentDir is provided, it should be the agent dir, not the prompts dir
	const globalPromptsDir = options.agentDir ? path.join(options.agentDir, "prompts") : resolvedAgentDir;
	templates.push(...(await loadTemplatesFromDir(globalPromptsDir, "user")));

	// 2. Load project templates from cwd/.omp/prompts/
	const projectPromptsDir = getProjectPromptsDir(resolvedCwd);
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

	const template = templates.find(t => t.name === templateName);
	if (template) {
		const args = parseCommandArgs(argsString);
		const argsText = args.join(" ");
		const substituted = substituteArgs(template.content, args);
		return renderPromptTemplate(substituted, { args, ARGUMENTS: argsText, arguments: argsText });
	}

	return text;
}
