import * as path from "node:path";
import {
	type ChunkNode,
	type ChunkTree,
	lineToContainingChunkPath,
	parseChunkTree,
	renderChunkTree,
	resolveChunkPath,
} from "@oh-my-pi/pi-natives";
import { HASHLINE_NIBBLE_ALPHABET } from "../patch/hashline";
import { normalizeToLF, stripBom } from "../patch/normalize";
import { stripNewLinePrefixes } from "../patch/prefix-stripping";

const readEnvInt = (name: string, defaultValue: number): number => {
	const v = Bun.env[name];
	if (!v) return defaultValue;
	const n = Number.parseInt(v, 10);
	if (Number.isNaN(n)) return defaultValue;
	if (n <= 0) return defaultValue;
	return n;
};

const CACHE_MAX_ENTRIES = readEnvInt("PI_CHUNK_CACHE_MAX_ENTRIES", 200);
const CHECKSUM_SUFFIX_RE = new RegExp(`^(.*?)(?:\\s+)?#([${HASHLINE_NIBBLE_ALPHABET}]{4})$`, "i");
const CONTAINER_NAME_PREFIXES = ["class_", "iface_", "enum_", "impl_", "trait_", "mod_", "type_"] as const;
const CHUNK_NAME_PREFIXES = ["fn_", "var_", "class_", "stmts_", "type_", "interface_", "enum_", "const_"] as const;
const LINE_RANGE_SELECTOR_RE = /^L(\d+)(?:-L?(\d+))?$/i;

type VisibleLineRange = {
	startLine: number;
	endLine: number;
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

type ChunkCacheEntry = {
	mtimeMs: number;
	size: number;
	source: string;
	tree: ChunkTree;
};

const chunkTreeCache = new Map<string, ChunkCacheEntry>();

/** Evict a single path from the chunk tree cache. */
export function invalidateChunkTreeCache(filePath: string): void {
	chunkTreeCache.delete(filePath);
}

function cachePut(key: string, entry: ChunkCacheEntry): void {
	// LRU: delete first so re-insert moves to end
	chunkTreeCache.delete(key);
	if (chunkTreeCache.size >= CACHE_MAX_ENTRIES) {
		// Evict oldest (first key in insertion-ordered Map)
		const oldest = chunkTreeCache.keys().next().value;
		if (oldest !== undefined) chunkTreeCache.delete(oldest);
	}
	chunkTreeCache.set(key, entry);
}

function cacheGet(key: string): ChunkCacheEntry | undefined {
	const entry = chunkTreeCache.get(key);
	if (entry) {
		// Move to end for LRU
		chunkTreeCache.delete(key);
		chunkTreeCache.set(key, entry);
	}
	return entry;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InsertPosition = "before" | "after" | "first_child" | "last_child";

export type ChunkEditOperation =
	| { op: "append_child"; sel?: string; crc?: string; content: string }
	| { op: "prepend_child"; sel?: string; crc?: string; content: string }
	| { op: "append_sibling"; sel?: string; crc?: string; content: string }
	| { op: "prepend_sibling"; sel?: string; crc?: string; content: string }
	| { op: "replace"; sel?: string; crc?: string; content: string; line?: number; endLine?: number }
	| { op: "delete"; sel?: string; crc?: string };

export type ChunkEditResult = {
	diffSourceBefore: string;
	diffSourceAfter: string;
	responseText: string;
	changed: boolean;
	parseValid: boolean;
	touchedPaths: string[];
	warnings: string[];
};

export type ChunkReadTarget =
	| {
			status: "ok";
			selector: string;
	  }
	| {
			status: "not_found";
			selector: string;
	  };

type ParsedChunkReadPath = {
	filePath: string;
	selector?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `PI_CHUNI_VALIDATE` — when `0`, chunk edit tool skips the validation of the edited
 */
export function chunkValidateEnabled(): boolean {
	const v = Bun.env.PI_CHUNK_VALIDATE;
	if (v === undefined || v === "" || v === "1") return true;
	if (v === "0") return false;
	throw new Error(`Invalid PI_CHUNK_VALIDATE: expected "0" or "1" (default: 1), got ${JSON.stringify(v)}`);
}

function normalizeChunkSource(text: string): string {
	return normalizeToLF(stripBom(text).text);
}

function lineOffsets(text: string): number[] {
	const offsets = [0];
	for (let index = 0; index < text.length; index++) {
		if (text[index] === "\n") {
			offsets.push(index + 1);
		}
	}
	return offsets;
}

function lineStartOffset(offsets: number[], line: number, text: string): number {
	if (line <= 1) return 0;
	return offsets[line - 1] ?? text.length;
}

function lineEndOffset(offsets: number[], line: number, text: string): number {
	return offsets[line] ?? text.length;
}

function chunkSlice(text: string, chunk: ChunkNode): string {
	if (chunk.lineCount === 0) return "";
	const lines = text.split("\n");
	return lines.slice(chunk.startLine - 1, chunk.endLine).join("\n");
}

function displayPathForFile(filePath: string, cwd: string): string {
	const relative = path.relative(cwd, filePath).replace(/\\/g, "/");
	return relative && !relative.startsWith("..") ? relative : filePath.replace(/\\/g, "/");
}

/** Index of `:` separating file path from chunk selector, or -1. Skips Windows `C:\` / `C:/` drive prefix. */
function chunkReadPathSeparatorIndex(readPath: string): number {
	if (/^[a-zA-Z]:[/\\]/.test(readPath)) {
		return readPath.indexOf(":", 2);
	}
	return readPath.indexOf(":");
}

export function parseChunkReadPath(readPath: string): ParsedChunkReadPath {
	const colonIndex = chunkReadPathSeparatorIndex(readPath);
	if (colonIndex === -1) {
		return { filePath: readPath };
	}
	const selector = parseChunkSelector(readPath.slice(colonIndex + 1) || undefined).selector;
	return {
		filePath: readPath.slice(0, colonIndex),
		selector,
	};
}

export function parseChunkSelector(selector: string | undefined): { selector?: string } {
	if (!selector || selector.length === 0) {
		return {};
	}
	const match = CHECKSUM_SUFFIX_RE.exec(selector);
	if (!match) return { selector };
	const normalizedSelector = match[1] ?? "";
	return normalizedSelector.length > 0 ? { selector: normalizedSelector } : { selector };
}

function parseVisibleLineRange(selector: string | undefined): VisibleLineRange | undefined {
	if (!selector) return undefined;
	const match = LINE_RANGE_SELECTOR_RE.exec(selector);
	if (!match) return undefined;
	const startLine = Math.max(1, Number.parseInt(match[1]!, 10));
	const parsedEnd = match[2] ? Number.parseInt(match[2], 10) : startLine;
	return { startLine, endLine: Math.max(startLine, parsedEnd) };
}

function getChunkMap(tree: ChunkTree): Map<string, ChunkNode> {
	return new Map(tree.chunks.map(chunk => [chunk.path, chunk]));
}

function getChunk(tree: ChunkTree, chunkPath: string): ChunkNode | undefined {
	return resolveChunkPath(tree, chunkPath) ?? undefined;
}

// ---------------------------------------------------------------------------
// Indentation helpers
// ---------------------------------------------------------------------------

/**
 * Detect the minimum common indentation across non-empty lines.
 * Returns { indent: string, count: number } where count is the number of
 * leading whitespace characters.
 */
function detectCommonIndent(text: string): { prefix: string; count: number } {
	let minCount = Infinity;
	let detectedChar = "";
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) continue;
		const match = /^([ \t]+)/.exec(line);
		if (!match) return { prefix: "", count: 0 };
		const ws = match[1]!;
		if (ws.length < minCount) {
			minCount = ws.length;
			detectedChar = ws[0]!;
		}
	}
	if (minCount === Infinity) return { prefix: "", count: 0 };
	return { prefix: detectedChar.repeat(minCount), count: minCount };
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Python textwrap.dedent margin algorithm: longest leading whitespace prefix
 * common to every line that has non-whitespace (blank and whitespace-only lines
 * are ignored for margin, matching Python).
 */
function dedentPythonStyle(text: string): string {
	let margin: string | undefined;
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) continue;
		const indent = /^([ \t]*)/.exec(line)?.[1] ?? "";
		if (margin === undefined) {
			margin = indent;
		} else if (indent.startsWith(margin)) {
			// pass — current line is deeper than margin
		} else if (margin.startsWith(indent)) {
			margin = indent;
		} else {
			let i = 0;
			for (; i < margin.length && i < indent.length; i++) {
				if (margin[i] !== indent[i]) break;
			}
			margin = margin.slice(0, i);
		}
	}
	if (margin === undefined || margin.length === 0) return text;
	return text.replace(new RegExp(`^${escapeRegex(margin)}`, "gm"), "");
}

/** Like Python textwrap.indent: add prefix to lines that are not whitespace-only. */
function indentNonEmptyLines(text: string, prefix: string): string {
	if (prefix.length === 0) return text;
	return text
		.split("\n")
		.map(line => {
			if (line.trim().length === 0) return line;
			return prefix + line;
		})
		.join("\n");
}

/** Normalize inserted chunk content: dedent common margin (Python textwrap), then apply target column. */
function reindentInsertedBlock(content: string, targetIndent: string): string {
	const lines = content.split("\n");
	if (lines.length === 0) {
		return "";
	}
	const nonEmptyRest = lines.slice(1).filter(line => line.trim().length > 0);
	if (lines.length === 1 || nonEmptyRest.length === 0) {
		return indentNonEmptyLines(dedentPythonStyle(content), targetIndent);
	}
	const firstLine = lines[0] ?? "";
	const firstIndent = /^([ \t]*)/.exec(firstLine)?.[1]?.length ?? 0;
	let minRestIndent = Infinity;
	for (const line of nonEmptyRest) {
		minRestIndent = Math.min(minRestIndent, /^([ \t]*)/.exec(line)?.[1]?.length ?? 0);
	}
	if (minRestIndent > firstIndent) {
		const tail = lines.slice(1).join("\n");
		const dedentedTail = dedentPythonStyle(tail);
		return indentNonEmptyLines(`${firstLine}\n${dedentedTail}`, targetIndent);
	}
	return indentNonEmptyLines(dedentPythonStyle(content), targetIndent);
}

function computeInsertIndent(state: MutableChunkState, anchor: ChunkNode, inside: boolean): string {
	if (!inside || anchor.path === "") return "";

	const chunkMap = getChunkMap(state.tree);
	// Use the indent of the first child if available.
	if (anchor.children.length > 0) {
		const firstChild = chunkMap.get(anchor.children[0]!);
		if (firstChild) {
			return (firstChild.indentChar || anchor.indentChar || "\t").repeat(firstChild.indent);
		}
	}

	// Collapsed containers render inline but still keep their original body lines.
	// Reuse the first non-empty interior line's indentation before falling back.
	const bodyLines = chunkSlice(state.source, anchor).split("\n").slice(1, -1);
	for (const line of bodyLines) {
		if (line.trim().length === 0) continue;
		const match = /^([ \t]+)/.exec(line);
		if (match) {
			return match[1]!;
		}
		break;
	}

	// No children: anchor indent + one level.
	const ch = anchor.indentChar || "\t";
	return ch.repeat(anchor.indent + 1);
}

// ---------------------------------------------------------------------------
// Content prefix stripping
// ---------------------------------------------------------------------------

/** Chunk gutter: code rows `…<digits> |` / `…<digits> │` (space optional); meta rows dropped when pasted. */
const CHUNK_GUTTER_CODE_ROW_RE = /^[\t ]*(\d+)\s*[|│]\s*(.*)$/;

function stripContentPrefixes(content: string): string {
	const lines = content.split("\n");
	let lineNumCount = 0;
	let nonEmpty = 0;
	for (const line of lines) {
		if (line.trim().length === 0) continue;
		nonEmpty++;
		if (CHUNK_GUTTER_CODE_ROW_RE.test(line)) lineNumCount++;
	}

	if (nonEmpty === 0) return content;

	const stripLine = (line: string): string => {
		const m = CHUNK_GUTTER_CODE_ROW_RE.exec(line);
		if (m) return m[2] ?? "";
		if (/^[\t ]*[|│]/.test(line)) return "";
		return line;
	};

	const withoutLineNumbers = lineNumCount > nonEmpty * 0.6 ? lines.map(stripLine) : lines;
	return stripNewLinePrefixes(withoutLineNumbers).join("\n");
}

function isContainerLikeChunk(chunk: ChunkNode): boolean {
	return chunk.kind === "branch" || CONTAINER_NAME_PREFIXES.some(prefix => chunk.name.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Formatting (gutter: absolute file lines, meta rows, U+2502)
// ---------------------------------------------------------------------------

function fileLanguageTag(filePath: string, language?: string): string | undefined {
	const normalizedLanguage = normalizeLanguage(language);
	if (normalizedLanguage.length > 0) return normalizedLanguage;
	const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
	return ext.length > 0 ? ext : undefined;
}

function normalizeLanguage(language: string | undefined): string {
	return language?.trim().toLowerCase() || "";
}

// ---------------------------------------------------------------------------
// Public read API
// ---------------------------------------------------------------------------

export function isChunkReadablePath(readPath: string): boolean {
	const { selector } = parseChunkReadPath(readPath);
	return selector !== undefined;
}

const TLAPLUS_BEGIN_TRANSLATION_RE = /^\s*\\\*\s*BEGIN TRANSLATION\s*$/;
const TLAPLUS_END_TRANSLATION_RE = /^\s*\\\*\s*END TRANSLATION\s*$/;

function maskChunkDisplaySource(source: string, language: string): string {
	if (language !== "tlaplus") return source;
	const lines = source.split("\n");
	const masked = [...lines];
	let index = 0;
	while (index < lines.length) {
		if (!TLAPLUS_BEGIN_TRANSLATION_RE.test(lines[index] ?? "")) {
			index++;
			continue;
		}
		const beginIndex = index;
		let endIndex = beginIndex + 1;
		while (endIndex < lines.length && !TLAPLUS_END_TRANSLATION_RE.test(lines[endIndex] ?? "")) {
			endIndex++;
		}
		if (beginIndex + 1 < lines.length) {
			masked[beginIndex + 1] = "\\* [translation hidden]";
			for (let hiddenIndex = beginIndex + 2; hiddenIndex < endIndex && hiddenIndex < lines.length; hiddenIndex++) {
				masked[hiddenIndex] = "";
			}
		}
		index = endIndex + 1;
	}
	return masked.join("\n");
}

export async function loadChunkTreeForFile(filePath: string, language: string | undefined): Promise<ChunkCacheEntry> {
	const file = Bun.file(filePath);
	const stat = await file.stat();
	const cached = cacheGet(filePath);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
		return cached;
	}

	const source = normalizeChunkSource(await file.text());
	const tree = parseChunkTree(source, normalizeLanguage(language));
	const entry = { mtimeMs: stat.mtimeMs, size: stat.size, source, tree };
	cachePut(filePath, entry);
	return entry;
}

export async function formatChunkedRead(params: {
	filePath: string;
	readPath: string;
	cwd: string;
	language?: string;
	/** Suppress #checksum suffix in headers (e.g. when the edit tool is unavailable). */
	omitChecksum?: boolean;
	/** Absolute file line range (`read` `sel` with a chunk path). Clipped to the chunk span. */
	absoluteLineRange?: { startLine: number; endLine?: number };
}): Promise<{ text: string; resolvedPath?: string; chunk?: ChunkReadTarget }> {
	const { filePath, readPath, cwd, language, omitChecksum = false, absoluteLineRange } = params;
	const normalizedLanguage = normalizeLanguage(language);
	const { selector } = parseChunkReadPath(readPath);
	const visibleRange = parseVisibleLineRange(selector);
	const { source, tree } = await loadChunkTreeForFile(filePath, normalizedLanguage);
	const displaySource = maskChunkDisplaySource(source, normalizedLanguage);
	const displayPath = displayPathForFile(filePath, cwd);
	const root = getChunk(tree, "");
	if (!root) {
		return { text: `${displayPath}\n\n[Chunk tree root missing]`, resolvedPath: filePath };
	}

	if (visibleRange) {
		if (visibleRange.startLine > tree.lineCount) {
			const suggestion =
				tree.lineCount === 0
					? "The file is empty."
					: `Use sel=L1 to read from the start, or sel=L${tree.lineCount} to read the last line.`;
			return {
				text: `Line ${visibleRange.startLine} is beyond end of file (${tree.lineCount} lines total). ${suggestion}`,
				resolvedPath: filePath,
			};
		}
		const clampedRange = {
			startLine: visibleRange.startLine,
			endLine: Math.min(visibleRange.endLine, tree.lineCount),
		};
		const notice = `[Notice: chunk view scoped to requested lines L${clampedRange.startLine}-L${clampedRange.endLine}; non-overlapping lines omitted.]`;
		const text = renderChunkTree({
			tree,
			chunkPath: root.path,
			source: displaySource,
			title: displayPath,
			languageTag: fileLanguageTag(filePath, normalizedLanguage),
			checksum: root.checksum,
			visibleRange: clampedRange,
			renderChildrenOnly: true,
			omitChecksum,
			showLeafPreview: true,
			tabReplacement: "    ",
		});
		return {
			text: `${notice}\n\n${text}`,
			resolvedPath: filePath,
		};
	}

	if (!selector) {
		return {
			text: renderChunkTree({
				tree,
				chunkPath: root.path,
				source: displaySource,
				title: displayPath,
				languageTag: fileLanguageTag(filePath, normalizedLanguage),
				checksum: root.checksum,
				renderChildrenOnly: true,
				omitChecksum,
				showLeafPreview: true,
				tabReplacement: "    ",
			}),
			resolvedPath: filePath,
		};
	}

	const chunk = getChunk(tree, selector);
	if (!chunk) {
		return {
			text: `${displayPath}:${selector}\n\n[Chunk not found]`,
			resolvedPath: filePath,
			chunk: { status: "not_found", selector },
		};
	}

	if (absoluteLineRange) {
		const rs = absoluteLineRange.startLine;
		const re = absoluteLineRange.endLine ?? rs;
		const iLow = Math.max(chunk.startLine, Math.min(rs, re));
		const iHigh = Math.min(chunk.endLine, Math.max(rs, re));
		if (iLow > iHigh) {
			const selHint = `L${chunk.startLine}-L${chunk.endLine}`;
			const req = rs === re ? `L${rs}` : `L${rs}-L${re}`;
			return {
				text: `Requested lines ${req} do not overlap chunk "${chunk.path}" (file lines ${chunk.startLine}-${chunk.endLine}). Use sel=${selHint} to read this chunk.`,
				resolvedPath: filePath,
				chunk: { status: "ok", selector: chunk.path },
			};
		}
		return {
			text: renderChunkTree({
				tree,
				chunkPath: chunk.path,
				source: displaySource,
				title: `${displayPath}:${chunk.path}`,
				languageTag: fileLanguageTag(filePath, normalizedLanguage),
				checksum: chunk.checksum,
				visibleRange: { startLine: iLow, endLine: iHigh },
				renderChildrenOnly: false,
				omitChecksum,
				showLeafPreview: true,
				tabReplacement: "    ",
			}),
			resolvedPath: filePath,
			chunk: { status: "ok", selector: chunk.path },
		};
	}

	return {
		text: renderChunkTree({
			tree,
			chunkPath: chunk.path,
			source: displaySource,
			title: `${displayPath}:${chunk.path}`,
			languageTag: fileLanguageTag(filePath, normalizedLanguage),
			checksum: chunk.checksum,
			renderChildrenOnly: false,
			omitChecksum,
			showLeafPreview: true,
			tabReplacement: "    ",
		}),
		resolvedPath: filePath,
		chunk: { status: "ok", selector: chunk.path },
	};
}
export async function formatChunkedGrepLine(params: {
	filePath: string;
	lineNumber: number;
	line: string;
	cwd: string;
	language?: string;
}): Promise<string> {
	const { filePath, lineNumber, line, cwd, language } = params;
	const { tree } = await loadChunkTreeForFile(filePath, language);
	const displayPath = displayPathForFile(filePath, cwd);
	const chunkPath = lineToContainingChunkPath(tree, lineNumber) ?? "";
	const location = chunkPath ? `${displayPath}:${chunkPath}` : displayPath;
	return `${location}  ln:${lineNumber}  |  ${line}`;
}

// ---------------------------------------------------------------------------
// Edit engine
// ---------------------------------------------------------------------------

type MutableChunkState = {
	source: string;
	tree: ChunkTree;
	language: string;
};

/** Score how similar two chunk path strings are (higher = more similar). */
function chunkPathSimilarity(query: string, candidate: string): number {
	// Exact suffix match (e.g. query="fn_foo" matches "class_Bar.fn_foo")
	if (candidate.endsWith(query) || candidate.endsWith(`.${query}`)) return 0.9;
	// The candidate's leaf name matches the query's leaf name
	const queryLeaf = query.split(".").pop() ?? query;
	const candidateLeaf = candidate.split(".").pop() ?? candidate;
	if (queryLeaf === candidateLeaf) return 0.85;
	// Substring match
	if (candidate.includes(query) || query.includes(candidate)) return 0.6;
	// Shared segments
	const queryParts = new Set(query.split("."));
	const candidateParts = candidate.split(".");
	const overlap = candidateParts.filter(p => queryParts.has(p)).length;
	if (overlap > 0) return 0.3 + 0.1 * overlap;
	return 0;
}

function suggestChunkPaths(tree: ChunkTree, query: string, limit = 3): string[] {
	return tree.chunks
		.filter(c => c.path.length > 0)
		.map(c => ({ path: c.path, score: chunkPathSimilarity(query, c.path) }))
		.filter(c => c.score > 0.1)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(c => c.path);
}

function resolveAnchorChunk(state: MutableChunkState, selector: string | undefined, warnings?: string[]): ChunkNode {
	const cleaned = sanitizeChunkSelector(selector);
	if (!cleaned || cleaned.length === 0) {
		const root = getChunk(state.tree, "");
		if (!root) {
			throw new Error("Chunk tree is missing the root chunk");
		}
		return root;
	}

	const chunk = getChunk(state.tree, cleaned);
	if (chunk) return chunk;

	// Auto-resolve suffix matches: "if_3" -> "default_export.if_3"
	const suffixMatches = state.tree.chunks.filter(
		c => c.path.length > 0 && (c.path.endsWith(`.${cleaned}`) || c.path === cleaned),
	);
	if (suffixMatches.length === 1) {
		warnings?.push(
			`Auto-resolved chunk selector "${cleaned}" to "${suffixMatches[0]!.path}". Use the full path from read output.`,
		);
		return suffixMatches[0]!;
	}
	if (suffixMatches.length > 1) {
		throw new Error(
			`Ambiguous chunk selector "${cleaned}" matches ${suffixMatches.length} chunks: ${suffixMatches.map(c => c.path).join(", ")}. Use the full path from read output.`,
		);
	}

	// Auto-resolve with common chunk name prefixes: "start" -> "fn_start", "Server" -> "class_Server"
	if (!cleaned.includes(".")) {
		const allPrefixMatches: ChunkNode[] = [];
		for (const prefix of CHUNK_NAME_PREFIXES) {
			const prefixed = prefix + cleaned;
			for (const c of state.tree.chunks) {
				if (c.path.length > 0 && (c.path.endsWith(`.${prefixed}`) || c.path === prefixed)) {
					allPrefixMatches.push(c);
				}
			}
		}
		if (allPrefixMatches.length === 1) {
			warnings?.push(
				`Auto-resolved chunk selector "${cleaned}" to "${allPrefixMatches[0]!.path}". Use the full path from read output.`,
			);
			return allPrefixMatches[0]!;
		}
		if (allPrefixMatches.length > 1) {
			throw new Error(
				`Ambiguous chunk selector "${cleaned}" matches ${allPrefixMatches.length} chunks: ${allPrefixMatches.map(c => c.path).join(", ")}. Use the full path from read output.`,
			);
		}
	}

	let directChildren: string[] | undefined;
	let directChildrenParent: string | undefined;
	let matchedEmptyPrefix: string | undefined;
	if (cleaned.includes(".")) {
		const parts = cleaned.split(".");
		for (let index = parts.length - 1; index > 0; index--) {
			const prefix = parts.slice(0, index).join(".");
			const parent = getChunk(state.tree, prefix);
			if (!parent) continue;
			if (parent.children.length > 0) {
				directChildrenParent = prefix;
				directChildren = [...parent.children].sort((a, b) => a.localeCompare(b));
				break;
			}
			if (matchedEmptyPrefix === undefined) {
				matchedEmptyPrefix = prefix;
			}
		}
	}

	const availablePaths = state.tree.chunks.filter(c => c.path.length > 0 && !c.path.includes(".")).map(c => c.path);
	const similarity = suggestChunkPaths(state.tree, cleaned, 8);
	let hint: string;
	if (directChildren !== undefined && directChildren.length > 0 && directChildrenParent !== undefined) {
		hint = ` Direct children of "${directChildrenParent}": ${directChildren.join(", ")}.`;
	} else if (matchedEmptyPrefix !== undefined) {
		hint =
			similarity.length > 0
				? ` The prefix "${matchedEmptyPrefix}" exists but has no child chunks. Similar paths: ${similarity.join(", ")}.`
				: ` The prefix "${matchedEmptyPrefix}" exists but has no child chunks.`;
	} else if (similarity.length > 0) {
		hint = ` Similar paths: ${similarity.join(", ")}.`;
	} else if (availablePaths.length > 0) {
		hint = ` Available top-level chunks: ${availablePaths.join(", ")}.`;
	} else {
		hint = " Re-read the file to see available chunk paths.";
	}
	throw new Error(
		`Chunk path not found: "${cleaned}".${hint} Re-read the file to see the full chunk tree with paths and checksums.`,
	);
}

/**
 * Normalize a chunk selector from model output:
 * - Strip `filename.ext:` prefix (model puts `path:chunk` format in `sel`)
 * - Strip leading `:` (model artifact)
 * - Strip trailing `#XXXX` hash suffix (model confuses checksum with path)
 * - Convert literal `"null"` string to empty
 */
function sanitizeChunkSelector(selector: string | undefined): string | undefined {
	if (selector === undefined || selector === null) return undefined;
	let s = typeof selector === "string" ? selector : String(selector);
	if (s === "null" || s === "undefined") return undefined;
	// Strip filename prefix: "pirate.ts:expression_2" -> "expression_2"
	// Models sometimes put the path:chunk format in the sel field instead of path.
	const colonIdx = chunkReadPathSeparatorIndex(s);
	if (colonIdx !== -1) s = s.slice(colonIdx + 1);
	// Strip leading colon (":error" -> "error")
	if (s.startsWith(":")) s = s.slice(1);
	// Strip trailing #XXXX checksum suffix ("imports#YKXY" -> "imports")
	s = s.replace(/#[A-Z]{4}$/i, "");
	return s.trim() || undefined;
}

function resolveAnchorWithCrc(
	state: MutableChunkState,
	selector: string | undefined,
	crc: string | undefined,
	warnings?: string[],
): { chunk: ChunkNode; crc: string | undefined } {
	const chunk = resolveAnchorChunk(state, selector, warnings);
	return { chunk, crc: sanitizeCrc(crc) };
}

/**
 * Normalize a CRC value from model output:
 * - Convert literal `"null"` / `"undefined"` strings to undefined
 * - Treat empty strings as undefined
 * - Normalize to uppercase (models sometimes emit lowercase checksums)
 */
function sanitizeCrc(crc: string | undefined): string | undefined {
	if (crc === undefined || crc === null) return undefined;
	if (crc === "null" || crc === "undefined" || crc === "") return undefined;
	return crc.toUpperCase();
}

function validateCrc(chunk: ChunkNode, crc: string | undefined): void {
	const cleaned = sanitizeCrc(crc);
	if (cleaned === undefined || cleaned.length === 0) {
		throw new Error(
			`Checksum required for ${operation_name(chunk)}. ` +
				`Re-read the chunk to get the current checksum, then pass crc: "XXXX" in your edit operation. ` +
				`Hint: use crc: "${chunk.checksum}" with sel: "${chunk.path}".`,
		);
	}
	if (chunk.checksum !== cleaned) {
		throw new Error(
			`Checksum mismatch for ${operation_name(chunk)}: expected "${chunk.checksum}", got "${cleaned}". ` +
				`The chunk content has changed since you last read it. ` +
				`Re-read the file to get updated checksums, then retry with the new crc value.`,
		);
	}
}

function operation_name(chunk: ChunkNode): string {
	return chunk.path || "<root>";
}

function validateBatchCrc(params: { chunk: ChunkNode; crc: string | undefined; required: boolean }): void {
	const { chunk, crc, required } = params;
	if (!required) return;
	validateCrc(chunk, crc);
}

/**
 * Validate that line/endLine fall within the anchor chunk's span.
 * Supports three modes:
 * - line <= endLine: replace lines line–endLine (inclusive)
 * - line = endLine + 1: zero-width insert between endLine and line
 * - single-line (endLine === line): replace just that line
 */
function validateLineRange(anchor: ChunkNode, line: number, endLine: number): void {
	const cStart = anchor.startLine;
	const cEnd = anchor.endLine;
	const chunkName = operation_name(anchor);
	if (line < 1) {
		throw new Error(
			`Line ${line} is invalid for ${chunkName}; line and end_line are absolute file line numbers (1-indexed). This chunk spans file lines ${cStart}-${cEnd}.`,
		);
	}
	if (endLine < 0) {
		throw new Error(`Invalid line range L${line}-L${endLine} for ${chunkName}: end_line cannot be negative.`);
	}
	if (line > endLine + 1) {
		throw new Error(
			`Invalid line range L${line}-L${endLine} for ${chunkName}: use line \u2264 end_line to replace lines, or line = end_line + 1 for zero-width insertion.`,
		);
	}
	if (line <= endLine) {
		if (line < cStart || endLine > cEnd) {
			throw new Error(
				`Line range L${line}-L${endLine} is outside ${chunkName} (chunk spans file lines ${cStart}-${cEnd}). Use absolute line numbers from read output.`,
			);
		}
		return;
	}
	// line === endLine + 1: zero-width insertion
	const beforeChunk = endLine === cStart - 1 && line === cStart;
	const insideGap = cStart <= endLine && endLine < cEnd && line === endLine + 1;
	const afterChunk = endLine === cEnd && line === cEnd + 1;
	if (beforeChunk || insideGap || afterChunk) {
		return;
	}
	throw new Error(
		`Invalid zero-width insert L${line}-L${endLine} for ${chunkName} (chunk spans file lines ${cStart}-${cEnd}). ` +
			`Use end_line = ${cStart - 1}, line = ${cStart} to insert before the first chunk line; ` +
			`end_line = k, line = k + 1 with ${cStart} \u2264 k < ${cEnd} between interior lines; ` +
			`end_line = ${cEnd}, line = ${cEnd + 1} to insert after the last chunk line.`,
	);
}

function isZeroWidthInsert(line: number, endLine: number): boolean {
	return line === endLine + 1;
}

/** Sort key for zero-width inserts: higher endLine runs first (bottom-up) so line numbers stay stable. */
function zeroWidthInsertSortKey(anchor: ChunkNode, endLine: number, line: number): number {
	const cStart = anchor.startLine;
	if (endLine === cStart - 1 && line === cStart) {
		return cStart;
	}
	return endLine;
}

type ScheduledChunkEditOperation = {
	operation: ChunkEditOperation;
	originalIndex: number;
	requestedSelector: string | undefined;
	initialChunk: ChunkNode | undefined;
};

function touchesChunkPath(touchedPaths: string[], selector: string): boolean {
	return touchedPaths.some(
		touched => touched === selector || touched.startsWith(`${selector}.`) || selector.startsWith(`${touched}.`),
	);
}

function ensureBatchOperationTargetCurrent(
	state: MutableChunkState,
	scheduled: ScheduledChunkEditOperation,
	crc: string | undefined,
	touchedPaths: string[],
): void {
	const selector = scheduled.requestedSelector;
	const initialChunk = scheduled.initialChunk;
	const cleanedCrc = sanitizeCrc(crc);
	if (!selector || !initialChunk || !cleanedCrc || !touchesChunkPath(touchedPaths, selector)) {
		return;
	}
	if (cleanedCrc !== initialChunk.checksum) {
		return;
	}

	const currentChunk = getChunk(state.tree, selector);
	if (!currentChunk) {
		throw new Error(
			`Chunk path "${selector}" was changed by an earlier batch operation. ` +
				`Re-read after the earlier edit and retry with the updated selector and checksum.`,
		);
	}
	if (currentChunk.checksum !== initialChunk.checksum) {
		throw new Error(
			`Chunk "${selector}" was changed by an earlier batch operation: checksum "${initialChunk.checksum}" is stale; ` +
				`current checksum is "${currentChunk.checksum}" and the current file span is ${currentChunk.startLine}-${currentChunk.endLine}. ` +
				`Later operations in the same batch must use the post-edit checksum and updated line span.`,
		);
	}
}

function lineColumnAtOffset(text: string, offset: number): { line: number; column: number } {
	const offsets = lineOffsets(text);
	let low = 0;
	let high = offsets.length - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const start = offsets[mid]!;
		const next = offsets[mid + 1] ?? text.length + 1;
		if (offset < start) {
			high = mid - 1;
			continue;
		}
		if (offset >= next) {
			low = mid + 1;
			continue;
		}
		return { line: mid + 1, column: offset - start + 1 };
	}
	return { line: offsets.length, column: 1 };
}

function formatParseErrorSummaries(state: MutableChunkState): string[] {
	return state.tree.chunks
		.filter(chunk => chunk.error)
		.slice(0, 3)
		.map(chunk => {
			const { line, column } = lineColumnAtOffset(state.source, chunk.startByte);
			const snippet = chunk.signature?.trim();
			return snippet && snippet.length > 0
				? `L${line}:C${column} unexpected syntax near ${JSON.stringify(snippet)}`
				: `L${line}:C${column} unexpected syntax`;
		});
}

function describeScheduledOperation(scheduled: ScheduledChunkEditOperation): string {
	return `${scheduled.operation.op}${scheduled.requestedSelector ? ` on "${scheduled.requestedSelector}"` : ""}`;
}

function normalizeInsertedContent(content: string, targetIndent: string): string {
	let normalized = normalizeToLF(content);
	normalized = stripContentPrefixes(normalized);
	if (targetIndent.length > 0) {
		normalized = reindentInsertedBlock(normalized, targetIndent);
	}
	return normalized;
}

function replaceRangeByLines(text: string, startLine: number, endLine: number, replacement: string): string {
	const offsets = lineOffsets(text);
	const startOffset = lineStartOffset(offsets, startLine, text);
	const endOffset = lineEndOffset(offsets, endLine, text);
	return `${text.slice(0, startOffset)}${replacement}${text.slice(endOffset)}`;
}

function insertAtOffset(text: string, offset: number, content: string): string {
	return `${text.slice(0, offset)}${content}${text.slice(offset)}`;
}

function rebuildChunkState(source: string, language: string): MutableChunkState {
	return { source, tree: parseChunkTree(source, language), language };
}

function findContainerDelimiterOffset(
	state: MutableChunkState,
	anchor: ChunkNode,
	placement: "prepend" | "append",
): number | undefined {
	const slice = state.source.slice(anchor.startByte, anchor.endByte);
	const openBrace = slice.indexOf("{");
	const closeBrace = slice.lastIndexOf("}");
	if (openBrace !== -1 && closeBrace !== -1 && closeBrace >= openBrace) {
		return placement === "prepend" ? anchor.startByte + openBrace + 1 : anchor.startByte + closeBrace;
	}
	return undefined;
}

function siblingIndex(state: MutableChunkState, anchor: ChunkNode): { index: number; total: number } | undefined {
	const parent = getChunk(state.tree, anchor.parentPath ?? "");
	if (!parent) return undefined;
	const index = parent.children.indexOf(anchor.path);
	if (index === -1) return undefined;
	return { index, total: parent.children.length };
}

function hasSiblingBefore(state: MutableChunkState, anchor: ChunkNode): boolean {
	const position = siblingIndex(state, anchor);
	return position !== undefined && position.index > 0;
}

function hasSiblingAfter(state: MutableChunkState, anchor: ChunkNode): boolean {
	const position = siblingIndex(state, anchor);
	return position !== undefined && position.index < position.total - 1;
}

function countTrailingNewlinesBeforeOffset(text: string, offset: number): number {
	let count = 0;
	for (let index = offset - 1; index >= 0 && text[index] === "\n"; index--) {
		count++;
	}
	return count;
}

function countLeadingNewlinesAfterOffset(text: string, offset: number): number {
	let count = 0;
	for (let index = offset; index < text.length && text[index] === "\n"; index++) {
		count++;
	}
	return count;
}

function containerHasInteriorContent(state: MutableChunkState, anchor: ChunkNode): boolean {
	if (!isContainerLikeChunk(anchor)) return false;
	return chunkSlice(state.source, anchor)
		.split("\n")
		.slice(1, -1)
		.some(line => line.trim().length > 0);
}

function computeInsertSpacing(
	state: MutableChunkState,
	anchor: ChunkNode,
	pos: InsertPosition,
): { blankLineBefore: boolean; blankLineAfter: boolean } {
	const hasInteriorContent = containerHasInteriorContent(state, anchor);
	switch (pos) {
		case "first_child":
			return { blankLineBefore: false, blankLineAfter: anchor.children.length > 0 || hasInteriorContent };
		case "last_child":
			return { blankLineBefore: anchor.children.length > 0 || hasInteriorContent, blankLineAfter: false };
		case "before":
			return { blankLineBefore: hasSiblingBefore(state, anchor), blankLineAfter: true };
		case "after":
			return { blankLineBefore: true, blankLineAfter: hasSiblingAfter(state, anchor) };
	}
}

function normalizeInsertionBoundaryContent(
	state: MutableChunkState,
	offset: number,
	content: string,
	spacing: { blankLineBefore: boolean; blankLineAfter: boolean },
): string {
	const trimmed = content.replace(/^\n+/, "").replace(/\n+$/, "");
	if (trimmed.length === 0) return content;

	const prevChar = offset > 0 ? state.source[offset - 1] : "";
	const nextChar = offset < state.source.length ? state.source[offset] : "";
	const prefixNewlines = spacing.blankLineBefore
		? Math.max(0, 2 - countTrailingNewlinesBeforeOffset(state.source, offset))
		: prevChar !== "" && prevChar !== "\n"
			? 1
			: 0;
	const suffixNewlines = spacing.blankLineAfter
		? Math.max(0, 2 - countLeadingNewlinesAfterOffset(state.source, offset))
		: nextChar !== "" && nextChar !== "\n"
			? 1
			: 0;

	return `${"\n".repeat(prefixNewlines)}${trimmed}${"\n".repeat(suffixNewlines)}`;
}

function cleanupBlankLineArtifactsAtOffset(text: string, offset: number): string {
	let runStart = Math.max(0, Math.min(offset, text.length));
	while (runStart > 0 && text[runStart - 1] === "\n") {
		runStart--;
	}

	let runEnd = Math.max(0, Math.min(offset, text.length));
	while (runEnd < text.length && text[runEnd] === "\n") {
		runEnd++;
	}

	const newlineRun = text.slice(runStart, runEnd);
	if (!/\n\n/.test(newlineRun)) return text;

	const afterRun = text.slice(runEnd);
	const beforeRun = text.slice(0, runStart);
	const trailingLine = beforeRun.split("\n").pop() ?? "";
	const afterStartsWithClose = /^[ \t]*[}\])]/.test(afterRun);
	const trailingIsOnlyClose = /^[ \t]*[}\])][ \t]*$/.test(trailingLine);
	const betweenAdjacentClosing = trailingIsOnlyClose && afterStartsWithClose;

	if (afterStartsWithClose) {
		if (/\n{3,}/.test(newlineRun)) {
			return `${text.slice(0, runStart)}${newlineRun.replace(/\n{3,}/g, "\n\n")}${afterRun}`;
		}
		if (betweenAdjacentClosing) {
			return text;
		}
		return `${text.slice(0, runStart)}\n${afterRun}`;
	}
	if (!/\n{3,}/.test(newlineRun)) return text;

	return `${text.slice(0, runStart)}${newlineRun.replace(/\n{3,}/g, "\n\n")}${afterRun}`;
}

/**
 * Go `type_*` chunks group file-scope receiver methods under the type for navigation.
 * Inserts after the last `fn_*` (or after the struct/interface block for `func …` content when only fields exist)
 * use column-0 indentation, not struct-field indentation.
 */
function goTypeAppendChildInsertionPoint(
	state: MutableChunkState,
	anchor: ChunkNode,
	insertionContent: string | undefined,
): { offset: number; indent: string } | undefined {
	if (normalizeLanguage(state.language) !== "go") return undefined;
	if (!anchor.path.startsWith("type_") || !isContainerLikeChunk(anchor)) return undefined;

	const offsets = lineOffsets(state.source);
	const chunkMap = getChunkMap(state.tree);
	const childChunks = anchor.children.map(p => chunkMap.get(p)).filter((c): c is ChunkNode => Boolean(c));
	const probe = insertionContent !== undefined ? normalizeToLF(insertionContent) : "";
	const looksLikeFileScopeFunc = /^\s*func\b/m.test(probe);

	if (childChunks.length === 0) {
		if (!looksLikeFileScopeFunc) return undefined;
		return {
			offset: lineEndOffset(offsets, anchor.endLine, state.source),
			indent: "",
		};
	}

	childChunks.sort((a, b) => a.startLine - b.startLine);
	const fnChildren = childChunks.filter(c => c.name.startsWith("fn_"));

	if (fnChildren.length > 0) {
		const lastFn = fnChildren.reduce((a, b) => (a.endLine > b.endLine ? a : b));
		return {
			offset: lineEndOffset(offsets, lastFn.endLine, state.source),
			indent: "",
		};
	}

	if (looksLikeFileScopeFunc) {
		return {
			offset: lineEndOffset(offsets, anchor.endLine, state.source),
			indent: "",
		};
	}
	return undefined;
}

function getInsertionPoint(
	state: MutableChunkState,
	anchor: ChunkNode,
	placement: "prepend" | "append",
	insertionContent?: string,
): { offset: number; indent: string; insideContainer: boolean } {
	const offsets = lineOffsets(state.source);
	const isBranch = anchor.kind === "branch";
	const isContainer = isContainerLikeChunk(anchor);

	if (placement === "prepend") {
		if (anchor.path === "") {
			return { offset: 0, indent: "", insideContainer: false };
		}
		if (isContainer) {
			// Insert as first child inside container.
			const indent = computeInsertIndent(state, anchor, true);
			if (anchor.children.length > 0) {
				const firstChild = getChunk(state.tree, anchor.children[0]!);
				if (firstChild) {
					return {
						offset: lineStartOffset(offsets, firstChild.startLine, state.source),
						indent,
						insideContainer: true,
					};
				}
			}
			const delimiterOffset = findContainerDelimiterOffset(state, anchor, "prepend");
			if (delimiterOffset !== undefined) {
				return { offset: delimiterOffset, indent, insideContainer: true };
			}
			if (isBranch) {
				return { offset: lineEndOffset(offsets, anchor.startLine, state.source), indent, insideContainer: true };
			}
			return { offset: lineEndOffset(offsets, anchor.startLine, state.source), indent, insideContainer: true };
		}
		// Leaf: insert before — use the anchor's own indent level
		const indent = (anchor.indentChar || "\t").repeat(anchor.indent);
		return { offset: lineStartOffset(offsets, anchor.startLine, state.source), indent, insideContainer: false };
	}

	// placement === "append"
	if (anchor.path === "") {
		return { offset: state.source.length, indent: "", insideContainer: false };
	}
	if (isContainer) {
		const goAppend = goTypeAppendChildInsertionPoint(state, anchor, insertionContent);
		if (goAppend !== undefined) {
			return { offset: goAppend.offset, indent: goAppend.indent, insideContainer: true };
		}
		// Match the actual insertion target (non-Go or Go interior members such as struct fields).
		if (anchor.children.length > 0) {
			const lastChild = getChunk(state.tree, anchor.children[anchor.children.length - 1]!);
			if (lastChild) {
				const indent = (lastChild.indentChar || anchor.indentChar || "\t").repeat(lastChild.indent);
				return { offset: lineEndOffset(offsets, lastChild.endLine, state.source), indent, insideContainer: true };
			}
		}
		const indent = computeInsertIndent(state, anchor, true);
		const delimiterOffset = findContainerDelimiterOffset(state, anchor, "append");
		if (delimiterOffset !== undefined) {
			return { offset: delimiterOffset, indent, insideContainer: true };
		}
		return { offset: lineStartOffset(offsets, anchor.endLine, state.source), indent, insideContainer: true };
	}
	// Leaf: insert after — use the anchor's own indent level
	const indent = (anchor.indentChar || "\t").repeat(anchor.indent);
	return { offset: lineEndOffset(offsets, anchor.endLine, state.source), indent, insideContainer: false };
}

/**
 * Map explicit insert positions to insertion points.
 * - "before"/"after" always treat the anchor as a peer (leaf-style), even for branches.
 * - "first_child"/"last_child" insert inside the container; error if anchor is a leaf.
 */
function getInsertionPointForPosition(
	state: MutableChunkState,
	anchor: ChunkNode,
	pos: InsertPosition,
	insertionContent?: string,
): { offset: number; indent: string; insideContainer: boolean } {
	const offsets = lineOffsets(state.source);

	switch (pos) {
		case "before": {
			if (anchor.path === "") {
				return { offset: 0, indent: "", insideContainer: false };
			}
			const indent = (anchor.indentChar || "\t").repeat(anchor.indent);
			return { offset: lineStartOffset(offsets, anchor.startLine, state.source), indent, insideContainer: false };
		}
		case "after": {
			if (anchor.path === "") {
				return { offset: state.source.length, indent: "", insideContainer: false };
			}
			const indent = (anchor.indentChar || "\t").repeat(anchor.indent);
			return { offset: lineEndOffset(offsets, anchor.endLine, state.source), indent, insideContainer: false };
		}
		case "first_child": {
			if (anchor.path !== "" && anchor.kind !== "branch" && !isContainerLikeChunk(anchor)) {
				throw new Error(`Cannot use prepend_child on leaf chunk ${anchor.path}`);
			}
			return getInsertionPoint(state, anchor, "prepend", insertionContent);
		}
		case "last_child": {
			if (anchor.path !== "" && anchor.kind !== "branch" && !isContainerLikeChunk(anchor)) {
				throw new Error(`Cannot use append_child on leaf chunk ${anchor.path}`);
			}
			return getInsertionPoint(state, anchor, "append", insertionContent);
		}
	}
}

/** True when the replace op targets specific lines (not a whole-chunk replace). */
function isLineScoped(
	op: ChunkEditOperation,
): op is { op: "replace"; sel?: string; crc?: string; line: number; endLine?: number; content: string } {
	return op.op === "replace" && op.line != null;
}

export function applyChunkEdits(params: {
	source: string;
	language?: string;
	cwd: string;
	filePath: string;
	operations: ChunkEditOperation[];
	defaultSelector?: string;
	defaultCrc?: string;
}): ChunkEditResult {
	const normalizedLanguage = normalizeLanguage(params.language);
	const originalText = normalizeChunkSource(params.source);
	let state = rebuildChunkState(originalText, normalizedLanguage);
	const initialParseErrors = state.tree.parseErrors;
	const touchedPaths: string[] = [];
	const warnings: string[] = [];
	let lastScheduled: ScheduledChunkEditOperation | undefined;
	const initialDefaultSelector = params.defaultSelector;
	const initialDefaultCrc = params.defaultCrc;

	const scheduledOps: ScheduledChunkEditOperation[] = params.operations.map((operation, originalIndex) => ({
		operation,
		originalIndex,
		requestedSelector: sanitizeChunkSelector(operation.sel ?? initialDefaultSelector),
		initialChunk: resolveAnchorChunk(state, operation.sel ?? initialDefaultSelector, warnings),
	}));

	for (const scheduled of scheduledOps) {
		const operation = scheduled.operation;
		if (isLineScoped(operation)) {
			const anchor = scheduled.initialChunk;
			if (!anchor) {
				throw new Error(`Chunk tree is missing an anchor for ${describeScheduledOperation(scheduled)}`);
			}
			const absEnd = operation.endLine ?? operation.line;
			validateLineRange(anchor, operation.line, absEnd);
		}
	}

	const lineScopedSortKey = (scheduled: ScheduledChunkEditOperation): number => {
		const operation = scheduled.operation;
		if (!isLineScoped(operation)) {
			return 0;
		}
		const anchor = scheduled.initialChunk;
		if (!anchor) {
			return 0;
		}
		const absEnd = operation.endLine ?? operation.line;
		if (isZeroWidthInsert(operation.line, absEnd)) {
			return zeroWidthInsertSortKey(anchor, absEnd, operation.line);
		}
		return operation.line;
	};
	const executionOps: ScheduledChunkEditOperation[] = [];
	for (let index = 0; index < scheduledOps.length; index++) {
		const scheduled = scheduledOps[index]!;
		if (!isLineScoped(scheduled.operation)) {
			executionOps.push(scheduled);
			continue;
		}

		const lineScopedBlock: ScheduledChunkEditOperation[] = [scheduled];
		while (index + 1 < scheduledOps.length && isLineScoped(scheduledOps[index + 1]!.operation)) {
			index++;
			lineScopedBlock.push(scheduledOps[index]!);
		}
		lineScopedBlock.sort((a, b) => {
			const lineDiff = lineScopedSortKey(b) - lineScopedSortKey(a);
			if (lineDiff !== 0) return lineDiff;
			return a.originalIndex - b.originalIndex;
		});
		executionOps.push(...lineScopedBlock);
	}

	const currentDefaultSelector = initialDefaultSelector;
	let currentDefaultCrc = initialDefaultCrc;
	const clearDefaultCrc = (): void => {
		currentDefaultCrc = undefined;
	};

	const totalOps = params.operations.length;
	for (const scheduled of executionOps) {
		lastScheduled = scheduled;
		const operation = scheduled.operation;
		if (operation.sel === "null" || operation.sel === "undefined") {
			(operation as Record<string, unknown>).sel = undefined;
		}
		if (operation.crc === "null" || operation.crc === "undefined") {
			(operation as Record<string, unknown>).crc = undefined;
		}
		try {
			switch (operation.op) {
				case "replace": {
					const anchorSelector = operation.sel ?? currentDefaultSelector;
					const crc = operation.crc ?? (operation.sel === undefined ? currentDefaultCrc : undefined);
					const requiresChecksum = operation.sel !== undefined || Boolean(currentDefaultCrc);
					ensureBatchOperationTargetCurrent(state, scheduled, crc, touchedPaths);
					const { chunk: anchor, crc: resolvedCrc } = resolveAnchorWithCrc(state, anchorSelector, crc, warnings);
					validateBatchCrc({ chunk: anchor, crc: resolvedCrc, required: requiresChecksum });

					// When line is provided, replace only those lines (line-scoped replace).
					// endLine defaults to line when omitted (single-line edit).
					if (operation.line != null) {
						const absEnd = operation.endLine ?? operation.line;
						validateLineRange(anchor, operation.line, absEnd);
						const offsets = lineOffsets(state.source);
						const absBeg = operation.line;
						const rangeStart = lineStartOffset(offsets, absBeg, state.source);
						const rangeEnd = lineEndOffset(offsets, absEnd, state.source);
						const replacedRange = state.source.slice(rangeStart, rangeEnd);
						const targetIndent = detectCommonIndent(replacedRange).prefix;
						let replacement = normalizeInsertedContent(operation.content, targetIndent);
						if (replacement.length > 0 && !replacement.endsWith("\n") && absEnd < state.tree.lineCount) {
							replacement += "\n";
						}
						state.source = replaceRangeByLines(state.source, absBeg, absEnd, replacement);
						if (replacement.length === 0) {
							state.source = cleanupBlankLineArtifactsAtOffset(state.source, rangeStart);
						}
						touchedPaths.push(anchor.path);
						if (operation.sel === undefined) clearDefaultCrc();
						break;
					}

					// Whole-chunk replace (no line/endLine).
					const targetIndent = (anchor.indentChar || "\t").repeat(anchor.indent);
					let replacement = normalizeInsertedContent(operation.content, targetIndent);
					if (replacement.length > 0 && !replacement.endsWith("\n") && anchor.endLine < state.tree.lineCount) {
						replacement += "\n";
					}
					const offsets = lineOffsets(state.source);
					const rangeStart = lineStartOffset(offsets, anchor.startLine, state.source);
					state.source = replaceRangeByLines(state.source, anchor.startLine, anchor.endLine, replacement);
					if (replacement.length === 0) {
						state.source = cleanupBlankLineArtifactsAtOffset(state.source, rangeStart);
					}
					touchedPaths.push(anchor.path);
					if (operation.sel === undefined) clearDefaultCrc();
					break;
				}
				case "delete": {
					const anchorSelector = operation.sel ?? currentDefaultSelector;
					const crc = operation.crc ?? (operation.sel === undefined ? currentDefaultCrc : undefined);
					const requiresChecksum = operation.sel !== undefined || Boolean(currentDefaultCrc);
					ensureBatchOperationTargetCurrent(state, scheduled, crc, touchedPaths);
					const { chunk: anchor, crc: resolvedCrc } = resolveAnchorWithCrc(state, anchorSelector, crc, warnings);
					validateBatchCrc({ chunk: anchor, crc: resolvedCrc, required: requiresChecksum });
					const offsets = lineOffsets(state.source);
					const rangeStart = lineStartOffset(offsets, anchor.startLine, state.source);
					state.source = replaceRangeByLines(state.source, anchor.startLine, anchor.endLine, "");
					state.source = cleanupBlankLineArtifactsAtOffset(state.source, rangeStart);
					touchedPaths.push(anchor.path);
					if (operation.sel === undefined) clearDefaultCrc();
					break;
				}
				case "append_child":
				case "prepend_child":
				case "append_sibling":
				case "prepend_sibling": {
					const anchorSelector = operation.sel ?? currentDefaultSelector;
					const crc = operation.crc ?? (operation.sel === undefined ? currentDefaultCrc : undefined);
					ensureBatchOperationTargetCurrent(state, scheduled, crc, touchedPaths);
					const { chunk: anchor, crc: resolvedCrc } = resolveAnchorWithCrc(state, anchorSelector, crc, warnings);
					validateBatchCrc({
						chunk: anchor,
						crc: resolvedCrc,
						required: Boolean(resolvedCrc),
					});
					const pos: InsertPosition =
						operation.op === "append_child"
							? "last_child"
							: operation.op === "prepend_child"
								? "first_child"
								: operation.op === "append_sibling"
									? "after"
									: "before";
					const point = getInsertionPointForPosition(
						state,
						anchor,
						pos,
						operation.op === "append_child" || operation.op === "prepend_child" ? operation.content : undefined,
					);
					const insertion = {
						offset: point.offset,
						indent: point.indent,
						spacing: computeInsertSpacing(state, anchor, pos),
					};
					let replacement = normalizeInsertedContent(operation.content, insertion.indent);
					replacement = normalizeInsertionBoundaryContent(state, insertion.offset, replacement, insertion.spacing);
					if (operation.op === "prepend_child") {
						const body = replacement.replace(/^\n+/, "").replace(/\n+$/, "");
						const commentOnly =
							body.length > 0 &&
							body.split("\n").every(line => {
								const trimmedLine = line.trim();
								return (
									trimmedLine.length === 0 ||
									trimmedLine.startsWith("//") ||
									trimmedLine.startsWith("///") ||
									trimmedLine.startsWith("#") ||
									trimmedLine.startsWith("/*")
								);
							});
						if (commentOnly && anchor.path === "" && anchor.children.includes("file_preamble")) {
							throw new Error(
								"Comment-only prepend_child on root is not allowed when the file has a file_preamble chunk. Use replace on the file_preamble chunk instead.",
							);
						}
						if (commentOnly && anchor.children.length > 0) {
							warnings.push(
								"Comment-only prepend_child can merge into the following chunk's first line; it is not a separate named chunk.",
							);
						}
					}
					state.source = insertAtOffset(state.source, insertion.offset, replacement);
					touchedPaths.push(anchor.path);
					if (operation.sel === undefined) clearDefaultCrc();
					break;
				}
			}

			state = rebuildChunkState(state.source, normalizedLanguage);
		} catch (err) {
			throw new Error(
				`Edit operation ${scheduled.originalIndex + 1}/${totalOps} failed (${describeScheduledOperation(scheduled)}): ${(err as Error).message}\n` +
					`No changes were saved. Fix the failing operation and retry the entire batch.`,
			);
		}
	}

	const parseValid = !chunkValidateEnabled() || state.tree.parseErrors <= initialParseErrors;
	if (!parseValid && initialParseErrors === 0) {
		const errorSummaries = formatParseErrorSummaries(state);
		const fallbackSummary =
			errorSummaries.length === 0 && lastScheduled?.initialChunk
				? [
						`L${lastScheduled.initialChunk.startLine}:C1 parse error introduced while editing ${lastScheduled.initialChunk.path}`,
					]
				: errorSummaries;
		const details =
			fallbackSummary.length > 0
				? `\nParse errors:\n${fallbackSummary.map(summary => `- ${summary}`).join("\n")}`
				: "";
		throw new Error(
			`Edit rejected: introduced ${state.tree.parseErrors} parse error(s). The file was valid before the edit but is not after. Fix the content and retry.${details}`,
		);
	}
	if (!parseValid) {
		warnings.push(`Edit introduced ${state.tree.parseErrors - initialParseErrors} new parse error(s).`);
	}

	const displayPath = displayPathForFile(params.filePath, params.cwd);
	const root = getChunk(state.tree, "");
	if (!root) {
		throw new Error("Chunk tree is missing the root chunk");
	}
	const responseText = renderChunkTree({
		tree: state.tree,
		chunkPath: root.path,
		source: maskChunkDisplaySource(state.source, normalizedLanguage),
		title: displayPath,
		languageTag: fileLanguageTag(params.filePath, normalizedLanguage),
		checksum: root.checksum,
		renderChildrenOnly: true,
		omitChecksum: false,
		showLeafPreview: true,
		tabReplacement: "    ",
	});
	return {
		diffSourceBefore: originalText,
		diffSourceAfter: state.source,
		responseText,
		changed: originalText !== state.source,
		parseValid,
		touchedPaths,
		warnings,
	};
}
