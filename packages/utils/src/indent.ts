/**
 * Shared tab indentation resolution utilities.
 *
 * Resolves tab width from a configurable default and optional per-file `.editorconfig` rules.
 * This module intentionally has no dependency on higher-level settings systems.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectDir } from "./dirs";

const DEFAULT_TAB_WIDTH = 3;
const MIN_TAB_WIDTH = 1;
const MAX_TAB_WIDTH = 16;
const EDITORCONFIG_NAME = ".editorconfig";

/** Parsed `.editorconfig` section `[pattern]` with normalized key/value properties */
interface EditorConfigSection {
	pattern: string;
	properties: Record<string, string>;
}

/** Parsed `.editorconfig` document with top-level `root` flag and ordered sections */
interface ParsedEditorConfig {
	root: boolean;
	sections: EditorConfigSection[];
}


/** Effective editorconfig indent-related properties merged for one target file */
interface EditorConfigMatch {
	indentStyle?: "space" | "tab";
	indentSize?: number | "tab";
	tabWidth?: number;
}

const editorConfigCache = new Map<string, ParsedEditorConfig>();
const editorConfigChainCache = new Map<string, Array<{ dir: string; parsed: ParsedEditorConfig }>>();
const indentationCache = new Map<string, string>();
let defaultTabWidth = DEFAULT_TAB_WIDTH;

function clampTabWidth(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_TAB_WIDTH;
	return Math.min(MAX_TAB_WIDTH, Math.max(MIN_TAB_WIDTH, Math.round(value)));
}

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (!value) return undefined;
	if (!/^\d+$/.test(value)) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return clampTabWidth(parsed);
}

function parseEditorConfigFile(content: string): ParsedEditorConfig {
	const parsed: ParsedEditorConfig = { root: false, sections: [] };
	let currentSection: EditorConfigSection | null = null;

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0) continue;
		if (line.startsWith("#") || line.startsWith(";")) continue;

		const sectionMatch = line.match(/^\[(.+)\]$/);
		if (sectionMatch) {
			const pattern = sectionMatch[1].trim();
			if (pattern.length === 0) {
				currentSection = null;
				continue;
			}
			currentSection = { pattern, properties: {} };
			parsed.sections.push(currentSection);
			continue;
		}

		const equalsIndex = line.indexOf("=");
		if (equalsIndex === -1) continue;

		const key = line.slice(0, equalsIndex).trim().toLowerCase();
		const value = line
			.slice(equalsIndex + 1)
			.trim()
			.toLowerCase();
		if (key.length === 0) continue;

		if (currentSection === null) {
			if (key === "root") parsed.root = value === "true";
			continue;
		}

		currentSection.properties[key] = value;
	}

	return parsed;
}

function parseCachedEditorConfig(configPath: string): ParsedEditorConfig | null {
	const cached = editorConfigCache.get(configPath);
	if (cached) return cached;

	let content: string;
	try {
		content = fs.readFileSync(configPath, "utf8");
	} catch {
		return null;
	}

	const parsed = parseEditorConfigFile(content);
	editorConfigCache.set(configPath, parsed);
	return parsed;
}

function matchesEditorConfigPattern(pattern: string, relativePath: string): boolean {
	const normalizedPattern = pattern.replace(/^\//, "");
	if (normalizedPattern.length === 0) return false;

	const candidates = new Set<string>();
	candidates.add(normalizedPattern);
	if (!normalizedPattern.includes("/")) {
		candidates.add(`**/${normalizedPattern}`);
	}

	for (const candidate of candidates) {
		try {
			if (new Bun.Glob(candidate).match(relativePath)) {
				return true;
			}
		} catch {}
	}

	return false;
}

function resolveFilePath(file: string): string {
	if (path.isAbsolute(file)) return path.normalize(file);
	return path.normalize(path.resolve(getProjectDir(), file));
}

function collectEditorConfigChain(startDir: string): Array<{ dir: string; parsed: ParsedEditorConfig }> {
	const cached = editorConfigChainCache.get(startDir);
	if (cached) return cached;

	const chain: Array<{ dir: string; parsed: ParsedEditorConfig }> = [];
	let cursor = path.resolve(startDir);

	while (true) {
		const configPath = path.join(cursor, EDITORCONFIG_NAME);
		const parsed = parseCachedEditorConfig(configPath);
		if (parsed) {
			chain.push({ dir: cursor, parsed });
			if (parsed.root) break;
		}

		const parent = path.dirname(cursor);
		if (parent === cursor) break;
		cursor = parent;
	}

	const result = chain.reverse();
	editorConfigChainCache.set(startDir, result);
	return result;
}

function resolveEditorConfigMatch(absoluteFile: string): EditorConfigMatch | null {
	const fileDir = path.dirname(absoluteFile);
	const chain = collectEditorConfigChain(fileDir);
	if (chain.length === 0) return null;

	const match: EditorConfigMatch = {};

	for (const { dir, parsed } of chain) {
		const relativePath = path.relative(dir, absoluteFile).split(path.sep).join("/");
		for (const section of parsed.sections) {
			if (!matchesEditorConfigPattern(section.pattern, relativePath)) continue;
			const indentStyle = section.properties.indent_style;
			if (indentStyle === "space" || indentStyle === "tab") {
				match.indentStyle = indentStyle;
			}

			const indentSizeRaw = section.properties.indent_size;
			if (indentSizeRaw === "tab") {
				match.indentSize = "tab";
			} else {
				const indentSize = parsePositiveInteger(indentSizeRaw);
				if (indentSize !== undefined) {
					match.indentSize = indentSize;
				}
			}

			const tabWidth = parsePositiveInteger(section.properties.tab_width);
			if (tabWidth !== undefined) {
				match.tabWidth = tabWidth;
			}
		}
	}

	if (match.indentStyle || match.indentSize !== undefined || match.tabWidth !== undefined) {
		return match;
	}
	return null;
}

function resolveEditorConfigTabWidth(match: EditorConfigMatch | null, fallbackWidth: number): number | null {
	if (!match) return null;

	if (typeof match.indentSize === "number") {
		return match.indentSize;
	}

	if (match.indentSize === "tab") {
		if (typeof match.tabWidth === "number") return match.tabWidth;
		return fallbackWidth;
	}

	if (typeof match.tabWidth === "number") {
		return match.tabWidth;
	}

	if (match.indentStyle === "tab") {
		return fallbackWidth;
	}

	return null;
}

/**
 * Sets the process-wide default tab width used when no file-specific override applies.
 *
 * @param width Desired tab width in spaces. Values are clamped to a safe range.
 */
export function setDefaultTabWidth(width: number): void {
	defaultTabWidth = clampTabWidth(width);
	indentationCache.clear();
}

/**
 * Gets the current process-wide default tab width.
 */
export function getDefaultTabWidth(): number {
	return defaultTabWidth;
}

/**
 * Returns indentation used to replace a tab character.
 *
 * If `file` is provided, `.editorconfig` rules are resolved for that file path and applied.
 * Otherwise, the configured default tab width is used.
 *
 * @param file Optional absolute or project-relative file path for editorconfig resolution
 * @returns A string containing N spaces representing one tab
 */
export function getIndentation(file?: string): string {
	if (!file) return " ".repeat(getDefaultTabWidth());

	const absoluteFile = resolveFilePath(file);
	const cached = indentationCache.get(absoluteFile);
	if (cached) return cached;

	const fallbackWidth = getDefaultTabWidth();
	const editorConfigMatch = resolveEditorConfigMatch(absoluteFile);
	const resolvedWidth = resolveEditorConfigTabWidth(editorConfigMatch, fallbackWidth) ?? fallbackWidth;
	const result = " ".repeat(clampTabWidth(resolvedWidth));
	indentationCache.set(absoluteFile, result);
	return result;
}
