import path from "node:path";
import { type Theme, theme } from "$c/modes/theme/theme";
import type {
	Diagnostic,
	DiagnosticSeverity,
	DocumentSymbol,
	Location,
	SymbolInformation,
	SymbolKind,
	TextEdit,
	WorkspaceEdit,
} from "./types";

// =============================================================================
// Language Detection
// =============================================================================

const LANGUAGE_MAP: Record<string, string> = {
	// TypeScript/JavaScript
	".ts": "typescript",
	".tsx": "typescriptreact",
	".js": "javascript",
	".jsx": "javascriptreact",
	".mjs": "javascript",
	".cjs": "javascript",
	".mts": "typescript",
	".cts": "typescript",

	// Systems languages
	".rs": "rust",
	".go": "go",
	".c": "c",
	".h": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".hpp": "cpp",
	".hxx": "cpp",
	".zig": "zig",

	// Scripting languages
	".py": "python",
	".rb": "ruby",
	".lua": "lua",
	".sh": "shellscript",
	".bash": "shellscript",
	".zsh": "shellscript",
	".fish": "fish",
	".pl": "perl",
	".php": "php",

	// JVM languages
	".java": "java",
	".kt": "kotlin",
	".kts": "kotlin",
	".scala": "scala",
	".groovy": "groovy",
	".clj": "clojure",

	// .NET languages
	".cs": "csharp",
	".fs": "fsharp",
	".vb": "vb",

	// Web
	".html": "html",
	".htm": "html",
	".css": "css",
	".scss": "scss",
	".sass": "sass",
	".less": "less",
	".vue": "vue",
	".svelte": "svelte",

	// Data formats
	".json": "json",
	".jsonc": "jsonc",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".xml": "xml",
	".ini": "ini",

	// Documentation
	".md": "markdown",
	".markdown": "markdown",
	".rst": "restructuredtext",
	".adoc": "asciidoc",
	".tex": "latex",

	// Other
	".sql": "sql",
	".graphql": "graphql",
	".gql": "graphql",
	".proto": "protobuf",
	".dockerfile": "dockerfile",
	".tf": "terraform",
	".hcl": "hcl",
	".nix": "nix",
	".ex": "elixir",
	".exs": "elixir",
	".erl": "erlang",
	".hrl": "erlang",
	".hs": "haskell",
	".ml": "ocaml",
	".mli": "ocaml",
	".swift": "swift",
	".r": "r",
	".R": "r",
	".jl": "julia",
	".dart": "dart",
	".elm": "elm",
	".v": "v",
	".nim": "nim",
	".cr": "crystal",
	".d": "d",
	".pas": "pascal",
	".pp": "pascal",
	".lisp": "lisp",
	".lsp": "lisp",
	".rkt": "racket",
	".scm": "scheme",
	".ps1": "powershell",
	".psm1": "powershell",
	".bat": "bat",
	".cmd": "bat",
};

/**
 * Detect language ID from file path.
 * Returns the LSP language identifier for the file type.
 */
export function detectLanguageId(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	const basename = path.basename(filePath).toLowerCase();

	// Handle special filenames
	if (basename === "dockerfile" || basename.startsWith("dockerfile.")) {
		return "dockerfile";
	}
	if (basename === "makefile" || basename === "gnumakefile") {
		return "makefile";
	}
	if (basename === "cmakelists.txt" || ext === ".cmake") {
		return "cmake";
	}

	return LANGUAGE_MAP[ext] ?? "plaintext";
}

// =============================================================================
// URI Handling (Cross-Platform)
// =============================================================================

/**
 * Convert a file path to a file:// URI.
 * Handles Windows drive letters correctly.
 */
export function fileToUri(filePath: string): string {
	const resolved = path.resolve(filePath);

	if (process.platform === "win32") {
		// Windows: file:///C:/path/to/file
		return `file:///${resolved.replace(/\\/g, "/")}`;
	}

	// Unix: file:///path/to/file
	return `file://${resolved}`;
}

/**
 * Convert a file:// URI to a file path.
 * Handles Windows drive letters correctly.
 */
export function uriToFile(uri: string): string {
	if (!uri.startsWith("file://")) {
		return uri;
	}

	let filePath = decodeURIComponent(uri.slice(7));

	// Windows: file:///C:/path → C:/path (strip leading slash before drive letter)
	if (process.platform === "win32" && filePath.startsWith("/") && /^[A-Za-z]:/.test(filePath.slice(1))) {
		filePath = filePath.slice(1);
	}

	return filePath;
}

// =============================================================================
// Diagnostic Formatting
// =============================================================================

const SEVERITY_NAMES: Record<DiagnosticSeverity, string> = {
	1: "error",
	2: "warning",
	3: "info",
	4: "hint",
};

/**
 * Convert diagnostic severity number to string name.
 */
export function severityToString(severity?: DiagnosticSeverity): string {
	return SEVERITY_NAMES[severity ?? 1] ?? "unknown";
}

/**
 * Get icon for diagnostic severity.
 */
export function severityToIcon(severity?: DiagnosticSeverity): string {
	const currentTheme = theme as Theme | undefined;
	const fallback = currentTheme?.format?.bullet ?? "*";
	const status = currentTheme?.status;
	switch (severity ?? 1) {
		case 1:
			return status?.error ?? fallback;
		case 2:
			return status?.warning ?? fallback;
		case 3:
			return status?.info ?? fallback;
		case 4:
			return currentTheme?.format?.bullet ?? fallback;
		default:
			return status?.error ?? fallback;
	}
}

/**
 * Strip noise from diagnostic messages (clippy URLs, override hints).
 */
function stripDiagnosticNoise(message: string): string {
	return message
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			// Skip "for further information visit <url>" lines
			if (trimmed.startsWith("for further information visit")) return false;
			// Skip bare URLs
			if (/^https?:\/\//.test(trimmed)) return false;
			return true;
		})
		.join("\n")
		.trim();
}

/**
 * Format a diagnostic as a human-readable string.
 */
export function formatDiagnostic(diagnostic: Diagnostic, filePath: string): string {
	const severity = severityToString(diagnostic.severity);
	const line = diagnostic.range.start.line + 1;
	const col = diagnostic.range.start.character + 1;
	const source = diagnostic.source ? `[${diagnostic.source}] ` : "";
	const code = diagnostic.code ? ` (${diagnostic.code})` : "";
	const message = stripDiagnosticNoise(diagnostic.message);

	return `${filePath}:${line}:${col} [${severity}] ${source}${message}${code}`;
}

/**
 * Format diagnostics grouped by severity.
 */
export function formatDiagnosticsSummary(diagnostics: Diagnostic[]): string {
	const counts = { error: 0, warning: 0, info: 0, hint: 0 };

	for (const d of diagnostics) {
		const sev = severityToString(d.severity);
		if (sev in counts) {
			counts[sev as keyof typeof counts]++;
		}
	}

	const parts: string[] = [];
	if (counts.error > 0) parts.push(`${counts.error} error(s)`);
	if (counts.warning > 0) parts.push(`${counts.warning} warning(s)`);
	if (counts.info > 0) parts.push(`${counts.info} info(s)`);
	if (counts.hint > 0) parts.push(`${counts.hint} hint(s)`);

	return parts.length > 0 ? parts.join(", ") : "no issues";
}

// =============================================================================
// Location Formatting
// =============================================================================

/**
 * Format a location as file:line:col relative to cwd.
 */
export function formatLocation(location: Location, cwd: string): string {
	const file = path.relative(cwd, uriToFile(location.uri));
	const line = location.range.start.line + 1;
	const col = location.range.start.character + 1;
	return `${file}:${line}:${col}`;
}

/**
 * Format a position as line:col.
 */
export function formatPosition(line: number, col: number): string {
	return `${line}:${col}`;
}

// =============================================================================
// WorkspaceEdit Formatting
// =============================================================================

/**
 * Format a workspace edit as a summary of changes.
 */
export function formatWorkspaceEdit(edit: WorkspaceEdit, cwd: string): string[] {
	const results: string[] = [];

	// Handle changes map (legacy format)
	if (edit.changes) {
		for (const [uri, textEdits] of Object.entries(edit.changes)) {
			const file = path.relative(cwd, uriToFile(uri));
			results.push(`${file}: ${textEdits.length} edit${textEdits.length > 1 ? "s" : ""}`);
		}
	}

	// Handle documentChanges array (modern format)
	if (edit.documentChanges) {
		for (const change of edit.documentChanges) {
			if ("edits" in change && change.textDocument) {
				const file = path.relative(cwd, uriToFile(change.textDocument.uri));
				results.push(`${file}: ${change.edits.length} edit${change.edits.length > 1 ? "s" : ""}`);
			} else if ("kind" in change) {
				switch (change.kind) {
					case "create":
						results.push(`CREATE: ${path.relative(cwd, uriToFile(change.uri))}`);
						break;
					case "rename":
						results.push(
							`RENAME: ${path.relative(cwd, uriToFile(change.oldUri))} ${theme.nav.cursor} ${path.relative(cwd, uriToFile(change.newUri))}`,
						);
						break;
					case "delete":
						results.push(`DELETE: ${path.relative(cwd, uriToFile(change.uri))}`);
						break;
				}
			}
		}
	}

	return results;
}

/**
 * Format a text edit as a preview.
 */
export function formatTextEdit(edit: TextEdit, maxLength = 50): string {
	const range = `${edit.range.start.line + 1}:${edit.range.start.character + 1}`;
	const preview =
		edit.newText.length > maxLength
			? `${edit.newText.slice(0, maxLength).replace(/\n/g, "\\n")}...`
			: edit.newText.replace(/\n/g, "\\n");
	return `line ${range} ${theme.nav.cursor} "${preview}"`;
}

// =============================================================================
// Symbol Formatting
// =============================================================================

function getSymbolKindIcons(): Record<SymbolKind, string> {
	const currentTheme = theme as Theme | undefined;
	const fallback = currentTheme?.format?.bullet ?? "*";
	const dash = currentTheme?.format?.dash ?? fallback;
	const icon = currentTheme?.icon;

	const file = icon?.file ?? fallback;
	const folder = icon?.folder ?? fallback;
	const pkg = icon?.package ?? folder;
	const model = icon?.model ?? fallback;
	const func = icon?.auto ?? dash;

	return {
		1: file, // File
		2: folder, // Module
		3: folder, // Namespace
		4: pkg, // Package
		5: model, // Class
		6: func, // Method
		7: fallback, // Property
		8: fallback, // Field
		9: func, // Constructor
		10: fallback, // Enum
		11: model, // Interface
		12: func, // Function
		13: fallback, // Variable
		14: fallback, // Constant
		15: fallback, // String
		16: fallback, // Number
		17: fallback, // Boolean
		18: fallback, // Array
		19: fallback, // Object
		20: fallback, // Key
		21: fallback, // Null
		22: fallback, // EnumMember
		23: folder, // Struct
		24: fallback, // Event
		25: fallback, // Operator
		26: fallback, // TypeParameter
	};
}

/**
 * Get icon for symbol kind.
 */
export function symbolKindToIcon(kind: SymbolKind): string {
	const currentTheme = theme as Theme | undefined;
	const bullet = currentTheme?.format?.bullet ?? "*";
	return getSymbolKindIcons()[kind] ?? bullet;
}

/**
 * Get name for symbol kind.
 */
export function symbolKindToName(kind: SymbolKind): string {
	const names: Record<number, string> = {
		1: "File",
		2: "Module",
		3: "Namespace",
		4: "Package",
		5: "Class",
		6: "Method",
		7: "Property",
		8: "Field",
		9: "Constructor",
		10: "Enum",
		11: "Interface",
		12: "Function",
		13: "Variable",
		14: "Constant",
		15: "String",
		16: "Number",
		17: "Boolean",
		18: "Array",
		19: "Object",
		20: "Key",
		21: "Null",
		22: "EnumMember",
		23: "Struct",
		24: "Event",
		25: "Operator",
		26: "TypeParameter",
	};
	return names[kind] ?? "Unknown";
}

/**
 * Format a document symbol with optional hierarchy.
 */
export function formatDocumentSymbol(symbol: DocumentSymbol, indent = 0): string[] {
	const prefix = "  ".repeat(indent);
	const icon = symbolKindToIcon(symbol.kind);
	const line = symbol.range.start.line + 1;
	const results = [`${prefix}${icon} ${symbol.name} @ line ${line}`];

	if (symbol.children) {
		for (const child of symbol.children) {
			results.push(...formatDocumentSymbol(child, indent + 1));
		}
	}

	return results;
}

/**
 * Format a symbol information (flat format).
 */
export function formatSymbolInformation(symbol: SymbolInformation, cwd: string): string {
	const icon = symbolKindToIcon(symbol.kind);
	const location = formatLocation(symbol.location, cwd);
	const container = symbol.containerName ? ` (${symbol.containerName})` : "";
	return `${icon} ${symbol.name}${container} @ ${location}`;
}

// =============================================================================
// Hover Content Extraction
// =============================================================================

/**
 * Extract plain text from hover contents.
 */
export function extractHoverText(
	contents: string | { kind: string; value: string } | { language: string; value: string } | unknown[],
): string {
	if (typeof contents === "string") {
		return contents;
	}

	if (Array.isArray(contents)) {
		return contents.map((c) => extractHoverText(c as string | { kind: string; value: string })).join("\n\n");
	}

	if (typeof contents === "object" && contents !== null) {
		if ("value" in contents && typeof contents.value === "string") {
			return contents.value;
		}
	}

	return String(contents);
}

// =============================================================================
// General Utilities
// =============================================================================

/**
 * Truncate a string to a maximum length with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
	if (str.length <= maxLength) return str;
	return `${str.slice(0, maxLength - 3)}...`;
}

/**
 * Group items by a key function.
 */
export function groupBy<T, K extends string | number>(items: T[], keyFn: (item: T) => K): Record<K, T[]> {
	const result = {} as Record<K, T[]>;
	for (const item of items) {
		const key = keyFn(item);
		if (!result[key]) {
			result[key] = [];
		}
		result[key].push(item);
	}
	return result;
}
