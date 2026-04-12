import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-coding-agent";
import {
	ChunkAnchorStyle,
	ChunkEditOp,
	type ChunkInfo,
	ChunkReadStatus,
	type ChunkReadTarget,
	ChunkRegion,
	ChunkState,
	type EditOperation as NativeEditOperation,
} from "@oh-my-pi/pi-natives";
import { $envpos } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import type { BunFile } from "bun";
import { LRUCache } from "lru-cache";
import type { Settings } from "../../config/settings";
import type { WritethroughCallback, WritethroughDeferredHandle } from "../../lsp";
import { getLanguageFromPath } from "../../modes/theme/theme";
import type { ToolSession } from "../../tools";
import { assertEditableFileContent } from "../../tools/auto-generated-guard";
import { invalidateFsScanAfterWrite } from "../../tools/fs-cache-invalidation";
import { outputMeta } from "../../tools/output-meta";
import { enforcePlanModeWrite, resolvePlanPath } from "../../tools/plan-mode-guard";
import { generateUnifiedDiffString } from "../diff";
import { detectLineEnding, normalizeToLF, restoreLineEndings, stripBom } from "../normalize";
import type { EditToolDetails, LspBatchRequest } from "../renderer";

export type { ChunkReadTarget };

export type ChunkEditOperation =
	| { op: "replace"; sel?: string; content: string }
	| { op: "before"; sel?: string; content: string }
	| { op: "after"; sel?: string; content: string }
	| { op: "prepend"; sel?: string; content: string }
	| { op: "append"; sel?: string; content: string };

type ChunkEditResult = {
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

const validAnchorStyles: Record<string, ChunkAnchorStyle> = {
	full: ChunkAnchorStyle.Full,
	kind: ChunkAnchorStyle.Kind,
	bare: ChunkAnchorStyle.Bare,
};

export function resolveChunkAutoIndent(rawValue = Bun.env.PI_CHUNK_AUTOINDENT): boolean {
	if (!rawValue) return true;
	const normalized = rawValue.trim().toLowerCase();
	switch (normalized) {
		case "1":
		case "true":
		case "yes":
		case "on":
			return true;
		case "0":
		case "false":
		case "no":
		case "off":
			return false;
		default:
			throw new Error(`Invalid PI_CHUNK_AUTOINDENT: ${rawValue}`);
	}
}

function getChunkRenderIndentOptions(): {
	normalizeIndent: boolean;
	tabReplacement: string;
} {
	return resolveChunkAutoIndent()
		? { normalizeIndent: true, tabReplacement: "    " }
		: { normalizeIndent: false, tabReplacement: "\t" };
}

export function resolveAnchorStyle(settings?: Settings): ChunkAnchorStyle {
	const envStyle = Bun.env.PI_ANCHOR_STYLE;
	return (
		(envStyle && validAnchorStyles[envStyle]) ||
		(settings?.get("read.anchorstyle") as ChunkAnchorStyle | undefined) ||
		ChunkAnchorStyle.Full
	);
}

const chunkStateCache = new LRUCache<string, ChunkCacheEntry>({
	max: $envpos("PI_CHUNK_CACHE_MAX_ENTRIES", 200),
});

export function invalidateChunkCache(filePath: string): void {
	chunkStateCache.delete(filePath);
}

type ChunkSourceContext = {
	resolvedPath: string;
	sourceFile: BunFile;
	sourceExists: boolean;
	rawContent: string;
	chunkLanguage: string | undefined;
};

function normalizeLanguage(language: string | undefined): string {
	return language?.trim().toLowerCase() || "";
}

function normalizeChunkSource(text: string): string {
	return normalizeToLF(stripBom(text).text);
}

function displayPathForFile(filePath: string, cwd: string): string {
	const relative = nodePath.relative(cwd, filePath).replace(/\\/g, "/");
	return relative && !relative.startsWith("..") ? relative : filePath.replace(/\\/g, "/");
}

function fileLanguageTag(filePath: string, language?: string): string | undefined {
	const normalizedLanguage = normalizeLanguage(language);
	if (normalizedLanguage.length > 0) return normalizedLanguage;
	const ext = nodePath.extname(filePath).replace(/^\./, "").toLowerCase();
	return ext.length > 0 ? ext : undefined;
}

async function resolveChunkSourceContext(session: ToolSession, path: string): Promise<ChunkSourceContext> {
	const resolvedPath = resolvePlanPath(session, path);
	const sourceFile = Bun.file(resolvedPath);
	const sourceExists = await sourceFile.exists();
	enforcePlanModeWrite(session, path, { op: sourceExists ? "update" : "create" });

	let rawContent = "";
	if (sourceExists) {
		rawContent = await sourceFile.text();
		assertEditableFileContent(rawContent, path);
	}

	return {
		resolvedPath,
		sourceFile,
		sourceExists,
		rawContent,
		chunkLanguage: getLanguageFromPath(resolvedPath),
	};
}

function normalizeChunkRegionSyntax(text: string): string {
	return text.replaceAll("@body", "~").replaceAll("@head", "^");
}

function buildChunkEditResult(result: {
	diffBefore: string;
	diffAfter: string;
	responseText: string;
	changed: boolean;
	parseValid: boolean;
	touchedPaths: string[];
	warnings: string[];
}): ChunkEditResult {
	return {
		diffSourceBefore: result.diffBefore,
		diffSourceAfter: result.diffAfter,
		responseText: result.responseText,
		changed: result.changed,
		parseValid: result.parseValid,
		touchedPaths: result.touchedPaths,
		warnings: result.warnings.map(normalizeChunkRegionSyntax),
	};
}

function chunkReadPathSeparatorIndex(readPath: string): number {
	if (/^[a-zA-Z]:[/\\]/.test(readPath)) {
		return readPath.indexOf(":", 2);
	}
	return readPath.indexOf(":");
}

export function parseChunkSelector(selector: string | undefined): { selector?: string } {
	if (!selector || selector.length === 0) {
		return {};
	}
	return { selector };
}

export function parseChunkReadPath(readPath: string): ParsedChunkReadPath {
	const colonIndex = chunkReadPathSeparatorIndex(readPath);
	if (colonIndex === -1) {
		return { filePath: readPath };
	}
	const parsedSelector = parseChunkSelector(readPath.slice(colonIndex + 1) || undefined);
	return {
		filePath: readPath.slice(0, colonIndex),
		selector: parsedSelector.selector,
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
	const renderIndentOptions = getChunkRenderIndentOptions();
	const result = state.renderRead({
		readPath,
		displayPath,
		languageTag: fileLanguageTag(filePath, normalizedLanguage),
		omitChecksum,
		anchorStyle,
		absoluteLineRange: absoluteLineRange
			? { startLine: absoluteLineRange.startLine, endLine: absoluteLineRange.endLine ?? absoluteLineRange.startLine }
			: undefined,
		tabReplacement: renderIndentOptions.tabReplacement,
		normalizeIndent: renderIndentOptions.normalizeIndent,
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

const CHUNK_CHECKSUM_ALPHABET = "ZPMQVRWSNKTXJBYH";
type NativeChunkRegion = "head" | "body";

function isChunkChecksumToken(value: string): boolean {
	return value.length === 4 && Array.from(value).every(ch => CHUNK_CHECKSUM_ALPHABET.includes(ch.toUpperCase()));
}

function parseChunkEditSelector(selector: string | undefined): {
	selector?: string;
	crc?: string;
	region?: NativeChunkRegion;
} {
	if (!selector) {
		return {};
	}

	let trimmed = selector.trim();
	if (trimmed.length === 0) {
		return {};
	}

	let region: NativeChunkRegion | undefined;
	const suffix = trimmed.at(-1);
	if (suffix === "~" || suffix === "^") {
		region = suffix === "~" ? "body" : "head";
		trimmed = trimmed.slice(0, -1).trimEnd();
	}

	let selectorPart = trimmed;
	let crc: string | undefined;
	const hashIndex = selectorPart.lastIndexOf("#");
	if (hashIndex >= 0) {
		const suffix = selectorPart.slice(hashIndex + 1).trim();
		if (isChunkChecksumToken(suffix)) {
			crc = suffix.toUpperCase();
			selectorPart = selectorPart.slice(0, hashIndex).trimEnd();
		}
	} else if (isChunkChecksumToken(selectorPart)) {
		crc = selectorPart.toUpperCase();
		selectorPart = "";
	}

	return { selector: selectorPart || undefined, crc, region };
}

type NativeChunkRegionEncoding = "named" | "symbolic";

function toNativeEditRegion(
	region: NativeChunkRegion | undefined,
	encoding: NativeChunkRegionEncoding,
): NativeEditOperation["region"] | undefined {
	if (!region) {
		return undefined;
	}
	if (encoding === "symbolic") {
		return region === "body" ? ChunkRegion.Body : ChunkRegion.Head;
	}
	return region as unknown as NativeEditOperation["region"] | undefined;
}

function toNativeEditOperation(
	operation: ChunkEditOperation,
	defaultRegion: NativeChunkRegion | undefined,
	encoding: NativeChunkRegionEncoding,
): NativeEditOperation {
	const { selector, crc, region } = parseChunkEditSelector(operation.sel);
	const nativeRegion = toNativeEditRegion(operation.sel === undefined ? (region ?? defaultRegion) : region, encoding);
	switch (operation.op) {
		case "replace":
			return {
				op: ChunkEditOp.Replace,
				sel: selector,
				crc,
				region: nativeRegion,
				content: operation.content,
			};
		case "before":
			return { op: ChunkEditOp.Before, sel: selector, crc, region: nativeRegion, content: operation.content };
		case "after":
			return { op: ChunkEditOp.After, sel: selector, crc, region: nativeRegion, content: operation.content };
		case "prepend":
			return { op: ChunkEditOp.Prepend, sel: selector, crc, region: nativeRegion, content: operation.content };
		case "append":
			return { op: ChunkEditOp.Append, sel: selector, crc, region: nativeRegion, content: operation.content };
		default: {
			const exhaustive: never = operation;
			return exhaustive;
		}
	}
}

function buildNativeChunkEditRequest(
	params: { defaultSelector?: string; defaultCrc?: string; operations: ChunkEditOperation[] },
	encoding: NativeChunkRegionEncoding,
): Pick<Parameters<ChunkState["applyEdits"]>[0], "operations" | "defaultSelector" | "defaultCrc"> {
	const parsedDefaultSelector = parseChunkEditSelector(params.defaultSelector);
	const operations = params.operations.map(operation =>
		toNativeEditOperation(operation, parsedDefaultSelector.region, encoding),
	);
	return {
		operations,
		defaultSelector: parsedDefaultSelector.selector,
		defaultCrc: params.defaultCrc ?? parsedDefaultSelector.crc,
	};
}

function isChunkRegionEncodingError(error: unknown): error is Error {
	return (
		error instanceof Error &&
		/value `"(body|head|~|\^)"` does not match any variant of enum `ChunkRegion`/.test(error.message)
	);
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
	const applyNativeEdits = (encoding: NativeChunkRegionEncoding): ChunkEditResult => {
		const request = buildNativeChunkEditRequest(params, encoding);
		const state = ChunkState.parse(normalizedSource, normalizeLanguage(params.language));
		return buildChunkEditResult(
			state.applyEdits({
				operations: request.operations,
				normalizeIndent: resolveChunkAutoIndent(),
				defaultSelector: request.defaultSelector,
				defaultCrc: request.defaultCrc,
				anchorStyle: params.anchorStyle,
				cwd: params.cwd,
				filePath: params.filePath,
			}),
		);
	};

	try {
		return applyNativeEdits("named");
	} catch (error) {
		if (isChunkRegionEncodingError(error)) {
			try {
				return applyNativeEdits("symbolic");
			} catch (fallbackError) {
				if (fallbackError instanceof Error) {
					throw new Error(normalizeChunkRegionSyntax(fallbackError.message));
				}
				throw fallbackError;
			}
		}
		if (error instanceof Error) {
			throw new Error(normalizeChunkRegionSyntax(error.message));
		}
		throw error;
	}
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

const CHUNK_OP_VALUES = ["replace", "after", "before", "prepend", "append"] as const;

export const chunkToolEditSchema = Type.Object({
	op: StringEnum(CHUNK_OP_VALUES),
	sel: Type.String({
		description:
			"Chunk selector. Use 'path~' or 'path^' for insertions, 'path#CRC~' or 'path#CRC^' for replace, or omit the suffix to target the full chunk.",
	}),
	content: Type.String({
		description:
			"New content. Write indentation relative to the targeted region as described in the tool prompt. Do NOT include the chunk's base padding.",
	}),
});
export const chunkEditParamsSchema = Type.Object(
	{
		path: Type.String({ description: "File path" }),
		edits: Type.Array(chunkToolEditSchema, {
			description: "Chunk edits",
			minItems: 1,
		}),
	},
	{ additionalProperties: false },
);

export type ChunkToolEdit = Static<typeof chunkToolEditSchema>;
export type ChunkParams = Static<typeof chunkEditParamsSchema>;

interface ExecuteChunkModeOptions {
	session: ToolSession;
	params: ChunkParams;
	signal?: AbortSignal;
	batchRequest?: LspBatchRequest;
	writethrough: WritethroughCallback;
	beginDeferredDiagnosticsForPath: (path: string) => WritethroughDeferredHandle;
}

export function isChunkParams(params: unknown): params is ChunkParams {
	return (
		typeof params === "object" &&
		params !== null &&
		"edits" in params &&
		Array.isArray(params.edits) &&
		params.edits.length > 0 &&
		typeof params.edits[0] === "object" &&
		params.edits[0] !== null &&
		"sel" in params.edits[0]
	);
}

function normalizeChunkEditOperations(edits: ChunkToolEdit[]): ChunkEditOperation[] {
	return edits as ChunkEditOperation[];
}

async function writeChunkResult(params: {
	result: ChunkEditResult;
	resolvedPath: string;
	sourceFile: BunFile;
	sourceText: string;
	sourceExists: boolean;
	signal?: AbortSignal;
	batchRequest?: LspBatchRequest;
	writethrough: WritethroughCallback;
	beginDeferredDiagnosticsForPath: (path: string) => WritethroughDeferredHandle;
}): Promise<AgentToolResult<EditToolDetails, typeof chunkEditParamsSchema>> {
	const {
		result,
		resolvedPath,
		sourceFile,
		sourceText,
		sourceExists,
		signal,
		batchRequest,
		writethrough,
		beginDeferredDiagnosticsForPath,
	} = params;

	const { bom, text } = stripBom(sourceText);
	const originalEnding = detectLineEnding(text);
	const finalContent = bom + restoreLineEndings(result.diffSourceAfter, originalEnding);
	const diagnostics = await writethrough(resolvedPath, finalContent, signal, sourceFile, batchRequest, dst =>
		dst === resolvedPath ? beginDeferredDiagnosticsForPath(resolvedPath) : undefined,
	);
	invalidateFsScanAfterWrite(resolvedPath);

	const diffResult = generateUnifiedDiffString(result.diffSourceBefore, result.diffSourceAfter);
	const warningsBlock = result.warnings.length > 0 ? `\n\nWarnings:\n${result.warnings.join("\n")}` : "";
	const meta = outputMeta()
		.diagnostics(diagnostics?.summary ?? "", diagnostics?.messages ?? [])
		.get();

	return {
		content: [{ type: "text", text: `${result.responseText}${warningsBlock}` }],
		details: {
			diff: diffResult.diff,
			firstChangedLine: diffResult.firstChangedLine,
			diagnostics,
			op: sourceExists ? "update" : "create",
			meta,
		},
	};
}

export async function executeChunkMode(
	options: ExecuteChunkModeOptions,
): Promise<AgentToolResult<EditToolDetails, typeof chunkEditParamsSchema>> {
	const { session, params, signal, batchRequest, writethrough, beginDeferredDiagnosticsForPath } = options;
	const { path, edits } = params;
	const { resolvedPath, sourceFile, sourceExists, rawContent, chunkLanguage } = await resolveChunkSourceContext(
		session,
		path,
	);
	const parentDir = nodePath.dirname(resolvedPath);
	if (parentDir && parentDir !== ".") {
		await fs.mkdir(parentDir, { recursive: true });
	}
	const normalizedOperations = normalizeChunkEditOperations(edits);

	if (!sourceExists && normalizedOperations.some(op => op.sel)) {
		throw new Error(
			`File does not exist: ${path}. Cannot resolve chunk selectors on a non-existent file. Use the write tool to create a new file, or check the path for typos.`,
		);
	}

	const chunkResult = applyChunkEdits({
		source: rawContent,
		language: chunkLanguage,
		cwd: session.cwd,
		filePath: resolvedPath,
		operations: normalizedOperations,
		anchorStyle: resolveAnchorStyle(session.settings),
	});

	if (!chunkResult.changed) {
		return {
			content: [{ type: "text", text: "[No changes needed \u2014 content already matches.]" }],
			details: {
				diff: "",
				op: sourceExists ? "update" : "create",
				meta: outputMeta().get(),
			},
		};
	}

	return writeChunkResult({
		result: chunkResult,
		resolvedPath,
		sourceFile,
		sourceText: rawContent,
		sourceExists,
		signal,
		batchRequest,
		writethrough,
		beginDeferredDiagnosticsForPath,
	});
}
