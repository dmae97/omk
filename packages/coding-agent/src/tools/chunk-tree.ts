import * as path from "node:path";
import {
	ChunkAnchorStyle,
	ChunkEditOp,
	type ChunkInfo,
	ChunkReadStatus,
	type ChunkReadTarget,
	ChunkState,
	type EditOperation as NativeEditOperation,
} from "@oh-my-pi/pi-natives";
import { LRUCache } from "lru-cache";
import type { Settings } from "../config/settings";
import { HASHLINE_NIBBLE_ALPHABET } from "../patch/hashline";
import { normalizeToLF, stripBom } from "../patch/normalize";

export type { ChunkReadTarget };

const validAnchorStyles: Record<string, ChunkAnchorStyle> = {
	full: ChunkAnchorStyle.Full,
	kind: ChunkAnchorStyle.Kind,
	bare: ChunkAnchorStyle.Bare,
};

export function resolveAnchorStyle(settings?: Settings): ChunkAnchorStyle {
	const envStyle = Bun.env.PI_ANCHOR_STYLE;
	return (
		(envStyle && validAnchorStyles[envStyle]) ||
		(settings?.get("read.anchorstyle") as ChunkAnchorStyle | undefined) ||
		ChunkAnchorStyle.Full
	);
}

const readEnvInt = (name: string, defaultValue: number): number => {
	const v = Bun.env[name];
	if (!v) return defaultValue;
	const n = Number.parseInt(v, 10);
	if (Number.isNaN(n) || n <= 0) return defaultValue;
	return n;
};

const CACHE_MAX_ENTRIES = readEnvInt("PI_CHUNK_CACHE_MAX_ENTRIES", 200);
const CHECKSUM_SUFFIX_RE = new RegExp(`^(.*?)(?:\\s+)?#([${HASHLINE_NIBBLE_ALPHABET}]{4})$`, "i");

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

export type ParsedChunkReadPath = {
	filePath: string;
	selector?: string;
};

type ChunkCacheEntry = {
	mtimeMs: number;
	size: number;
	source: string;
	state: ChunkState;
};

const chunkStateCache = new LRUCache<string, ChunkCacheEntry>({
	max: CACHE_MAX_ENTRIES,
});

export function invalidateChunkTreeCache(filePath: string): void {
	chunkStateCache.delete(filePath);
}

function normalizeLanguage(language: string | undefined): string {
	return language?.trim().toLowerCase() || "";
}

function normalizeChunkSource(text: string): string {
	return normalizeToLF(stripBom(text).text);
}

function displayPathForFile(filePath: string, cwd: string): string {
	const relative = path.relative(cwd, filePath).replace(/\\/g, "/");
	return relative && !relative.startsWith("..") ? relative : filePath.replace(/\\/g, "/");
}

function fileLanguageTag(filePath: string, language?: string): string | undefined {
	const normalizedLanguage = normalizeLanguage(language);
	if (normalizedLanguage.length > 0) return normalizedLanguage;
	const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
	return ext.length > 0 ? ext : undefined;
}

function chunkReadPathSeparatorIndex(readPath: string): number {
	if (/^[a-zA-Z]:[/\\]/.test(readPath)) {
		return readPath.indexOf(":", 2);
	}
	return readPath.indexOf(":");
}

export function parseChunkSelector(selector: string | undefined): { selector?: string; crc?: string } {
	if (!selector || selector.length === 0) {
		return {};
	}
	const match = CHECKSUM_SUFFIX_RE.exec(selector);
	if (!match) return { selector };
	const normalizedSelector = match[1] ?? "";
	const crc = match[2]?.toUpperCase();
	// If the CRC was stripped from the path (e.g. "fn_foo#ABCD" → "fn_foo"),
	// return both. If the path part is empty, the input was just a bare CRC
	// token — keep the original as the selector.
	if (normalizedSelector.length > 0) {
		return { selector: normalizedSelector, crc };
	}
	return { selector };
}

export function parseChunkReadPath(readPath: string): ParsedChunkReadPath {
	const colonIndex = chunkReadPathSeparatorIndex(readPath);
	if (colonIndex === -1) {
		return { filePath: readPath };
	}
	return {
		filePath: readPath.slice(0, colonIndex),
		selector: parseChunkSelector(readPath.slice(colonIndex + 1) || undefined).selector,
	};
}

export function isChunkReadablePath(readPath: string): boolean {
	return parseChunkReadPath(readPath).selector !== undefined;
}

export async function loadChunkStateForFile(filePath: string, language: string | undefined): Promise<ChunkCacheEntry> {
	const file = Bun.file(filePath);
	const stat = await file.stat();
	const cached = chunkStateCache.get(filePath);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
		return cached;
	}

	const source = normalizeChunkSource(await file.text());
	const state = ChunkState.parse(source, normalizeLanguage(language));
	const entry = { mtimeMs: stat.mtimeMs, size: stat.size, source, state };
	chunkStateCache.set(filePath, entry);
	return entry;
}

export async function formatChunkedRead(params: {
	filePath: string;
	readPath: string;
	cwd: string;
	language?: string;
	omitChecksum?: boolean;
	anchorStyle?: ChunkAnchorStyle;
	absoluteLineRange?: { startLine: number; endLine?: number };
}): Promise<{ text: string; resolvedPath?: string; chunk?: ChunkReadTarget }> {
	const { filePath, readPath, cwd, language, omitChecksum = false, anchorStyle, absoluteLineRange } = params;
	const normalizedLanguage = normalizeLanguage(language);
	const { state } = await loadChunkStateForFile(filePath, normalizedLanguage);
	const displayPath = displayPathForFile(filePath, cwd);
	const result = state.renderRead({
		readPath,
		displayPath,
		languageTag: fileLanguageTag(filePath, normalizedLanguage),
		omitChecksum,
		anchorStyle,
		absoluteLineRange: absoluteLineRange
			? { startLine: absoluteLineRange.startLine, endLine: absoluteLineRange.endLine ?? absoluteLineRange.startLine }
			: undefined,
		tabReplacement: "    ",
	});
	return { text: result.text, resolvedPath: filePath, chunk: result.chunk };
}

export async function formatChunkedGrepLine(params: {
	filePath: string;
	lineNumber: number;
	line: string;
	cwd: string;
	language?: string;
}): Promise<string> {
	const { filePath, lineNumber, line, cwd, language } = params;
	const { state } = await loadChunkStateForFile(filePath, language);
	return state.formatGrepLine(displayPathForFile(filePath, cwd), lineNumber, line);
}

function toNativeEditOperation(operation: ChunkEditOperation): NativeEditOperation {
	switch (operation.op) {
		case "replace":
			return {
				op: ChunkEditOp.Replace,
				sel: operation.sel,
				crc: operation.crc,
				content: operation.content,
				line: operation.line,
				endLine: operation.endLine,
			};
		case "delete":
			return {
				op: ChunkEditOp.Delete,
				sel: operation.sel,
				crc: operation.crc,
			};
		case "append_child":
			return { op: ChunkEditOp.AppendChild, sel: operation.sel, crc: operation.crc, content: operation.content };
		case "prepend_child":
			return { op: ChunkEditOp.PrependChild, sel: operation.sel, crc: operation.crc, content: operation.content };
		case "append_sibling":
			return { op: ChunkEditOp.AppendSibling, sel: operation.sel, crc: operation.crc, content: operation.content };
		case "prepend_sibling":
			return { op: ChunkEditOp.PrependSibling, sel: operation.sel, crc: operation.crc, content: operation.content };
		default: {
			const exhaustive: never = operation;
			return exhaustive;
		}
	}
}

export function applyChunkEdits(params: {
	source: string;
	language?: string;
	cwd: string;
	filePath: string;
	operations: ChunkEditOperation[];
	defaultSelector?: string;
	defaultCrc?: string;
	anchorStyle?: ChunkAnchorStyle;
}): ChunkEditResult {
	const normalizedSource = normalizeChunkSource(params.source);
	const state = ChunkState.parse(normalizedSource, normalizeLanguage(params.language));
	const result = state.applyEdits({
		operations: params.operations.map(toNativeEditOperation),
		defaultSelector: params.defaultSelector,
		defaultCrc: params.defaultCrc,
		anchorStyle: params.anchorStyle,
		cwd: params.cwd,
		filePath: params.filePath,
	});

	return {
		diffSourceBefore: result.diffBefore,
		diffSourceAfter: result.diffAfter,
		responseText: result.responseText,
		changed: result.changed,
		parseValid: result.parseValid,
		touchedPaths: result.touchedPaths,
		warnings: result.warnings,
	};
}

export async function getChunkInfoForFile(
	filePath: string,
	language: string | undefined,
	chunkPath: string,
): Promise<ChunkInfo | undefined> {
	const { state } = await loadChunkStateForFile(filePath, language);
	return state.chunk(chunkPath) ?? undefined;
}

export function missingChunkReadTarget(selector: string): ChunkReadTarget {
	return { status: ChunkReadStatus.NotFound, selector };
}
