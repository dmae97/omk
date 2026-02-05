import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { ImageContent, TextContent } from "@oh-my-pi/pi-ai";
import { FileType, glob } from "@oh-my-pi/pi-natives";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { ptree, untilAborted } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import { CONFIG_DIR_NAME } from "../config";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { getLanguageFromPath, type Theme } from "../modes/theme/theme";
import readDescription from "../prompts/tools/read.md" with { type: "text" };
import type { ToolSession } from "../sdk";
import { renderCodeCell, renderOutputBlock, renderStatusLine } from "../tui";
import { formatDimensionNote, resizeImage } from "../utils/image-resize";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime";
import { ensureTool } from "../utils/tools-manager";
import { applyListLimit } from "./list-limit";
import type { OutputMeta } from "./output-meta";
import { resolveReadPath, resolveToCwd } from "./path-utils";
import { formatAge, shortenPath, wrapBrackets } from "./render-utils";
import { ToolAbortError, ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateHead,
	truncateStringToBytesFromStart,
} from "./truncate";

// Document types convertible via markitdown
const CONVERTIBLE_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf", ".epub"]);

// Remote mount path prefix (sshfs mounts) - skip fuzzy matching to avoid hangs
const REMOTE_MOUNT_PREFIX = path.join(os.homedir(), CONFIG_DIR_NAME, "remote") + path.sep;

function isRemoteMountPath(absolutePath: string): boolean {
	return absolutePath.startsWith(REMOTE_MOUNT_PREFIX);
}

const READ_CHUNK_SIZE = 64 * 1024;

async function streamLinesFromFile(
	filePath: string,
	startLine: number,
	maxLinesToCollect: number,
	maxBytes: number,
	selectedLineLimit: number | null,
	signal?: AbortSignal,
): Promise<{
	lines: string[];
	totalFileLines: number;
	collectedBytes: number;
	stoppedByByteLimit: boolean;
	firstLinePreview?: { text: string; bytes: number };
	firstLineByteLength?: number;
	selectedBytesTotal: number;
}> {
	const bufferChunk = Buffer.allocUnsafe(READ_CHUNK_SIZE);
	const collectedLines: string[] = [];
	let lineIndex = 0;
	let collectedBytes = 0;
	let stoppedByByteLimit = false;
	let doneCollecting = false;
	let fileHandle: fs.FileHandle | null = null;
	let currentLineLength = 0;
	let currentLineChunks: Buffer[] = [];
	let sawAnyByte = false;
	let endedWithNewline = false;
	let firstLinePreviewBytes = 0;
	const firstLinePreviewChunks: Buffer[] = [];
	let firstLineByteLength: number | undefined;
	let selectedBytesTotal = 0;
	let selectedLinesSeen = 0;
	let captureLine = false;
	let discardLineChunks = false;
	let lineCaptureLimit = 0;

	const setupLineState = () => {
		captureLine = !doneCollecting && lineIndex >= startLine;
		discardLineChunks = !captureLine;
		if (captureLine) {
			const separatorBytes = collectedLines.length > 0 ? 1 : 0;
			lineCaptureLimit = maxBytes - collectedBytes - separatorBytes;
			if (lineCaptureLimit <= 0) {
				discardLineChunks = true;
			}
		} else {
			lineCaptureLimit = 0;
		}
	};

	const decodeLine = (): string => {
		if (currentLineLength === 0) return "";
		if (currentLineChunks.length === 1 && currentLineChunks[0]?.length === currentLineLength) {
			return currentLineChunks[0].toString("utf-8");
		}
		return Buffer.concat(currentLineChunks, currentLineLength).toString("utf-8");
	};

	const maybeCapturePreview = (segment: Uint8Array) => {
		if (doneCollecting || lineIndex < startLine || collectedLines.length !== 0) return;
		if (firstLinePreviewBytes >= maxBytes || segment.length === 0) return;
		const remaining = maxBytes - firstLinePreviewBytes;
		const slice = segment.length > remaining ? segment.subarray(0, remaining) : segment;
		if (slice.length === 0) return;
		firstLinePreviewChunks.push(Buffer.from(slice));
		firstLinePreviewBytes += slice.length;
	};

	const appendSegment = (segment: Uint8Array) => {
		currentLineLength += segment.length;
		maybeCapturePreview(segment);
		if (!captureLine || discardLineChunks || segment.length === 0) return;
		if (currentLineLength <= lineCaptureLimit) {
			currentLineChunks.push(Buffer.from(segment));
		} else {
			discardLineChunks = true;
		}
	};

	const finalizeLine = () => {
		if (lineIndex >= startLine && (selectedLineLimit === null || selectedLinesSeen < selectedLineLimit)) {
			selectedBytesTotal += currentLineLength + (selectedLinesSeen > 0 ? 1 : 0);
			selectedLinesSeen++;
		}

		if (!doneCollecting && lineIndex >= startLine) {
			const separatorBytes = collectedLines.length > 0 ? 1 : 0;
			if (collectedLines.length >= maxLinesToCollect) {
				doneCollecting = true;
			} else if (collectedLines.length === 0 && currentLineLength > maxBytes) {
				stoppedByByteLimit = true;
				doneCollecting = true;
				if (firstLineByteLength === undefined) {
					firstLineByteLength = currentLineLength;
				}
			} else if (collectedLines.length > 0 && collectedBytes + separatorBytes + currentLineLength > maxBytes) {
				stoppedByByteLimit = true;
				doneCollecting = true;
			} else {
				const lineText = decodeLine();
				collectedLines.push(lineText);
				collectedBytes += separatorBytes + currentLineLength;
				if (firstLineByteLength === undefined) {
					firstLineByteLength = currentLineLength;
				}
				if (collectedBytes > maxBytes) {
					stoppedByByteLimit = true;
					doneCollecting = true;
				} else if (collectedLines.length >= maxLinesToCollect) {
					doneCollecting = true;
				}
			}
		} else if (lineIndex >= startLine && firstLineByteLength === undefined) {
			firstLineByteLength = currentLineLength;
		}

		lineIndex++;
		currentLineLength = 0;
		currentLineChunks = [];
		setupLineState();
	};

	setupLineState();

	try {
		fileHandle = await fs.open(filePath, "r");

		while (true) {
			throwIfAborted(signal);
			const { bytesRead } = await fileHandle.read(bufferChunk, 0, bufferChunk.length, null);
			if (bytesRead === 0) break;

			sawAnyByte = true;
			const chunk = bufferChunk.subarray(0, bytesRead);
			endedWithNewline = chunk[bytesRead - 1] === 0x0a;

			let start = 0;
			for (let i = 0; i < chunk.length; i++) {
				if (chunk[i] === 0x0a) {
					const segment = chunk.subarray(start, i);
					if (segment.length > 0) {
						appendSegment(segment);
					}
					finalizeLine();
					start = i + 1;
				}
			}

			if (start < chunk.length) {
				appendSegment(chunk.subarray(start));
			}
		}
	} finally {
		if (fileHandle) {
			await fileHandle.close();
		}
	}

	if (endedWithNewline || currentLineLength > 0 || !sawAnyByte) {
		finalizeLine();
	}

	let firstLinePreview: { text: string; bytes: number } | undefined;
	if (firstLinePreviewBytes > 0) {
		const buf = Buffer.concat(firstLinePreviewChunks, firstLinePreviewBytes);
		let end = Math.min(buf.length, maxBytes);
		while (end > 0 && (buf[end] & 0xc0) === 0x80) {
			end--;
		}
		if (end > 0) {
			const text = buf.slice(0, end).toString("utf-8");
			firstLinePreview = { text, bytes: Buffer.byteLength(text, "utf-8") };
		} else {
			firstLinePreview = { text: "", bytes: 0 };
		}
	}

	return {
		lines: collectedLines,
		totalFileLines: lineIndex,
		collectedBytes,
		stoppedByByteLimit,
		firstLinePreview,
		firstLineByteLength,
		selectedBytesTotal,
	};
}

// Maximum image file size (20MB) - larger images will be rejected to prevent OOM during serialization
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_FUZZY_RESULTS = 5;
const MAX_FUZZY_CANDIDATES = 20000;
const MIN_BASE_SIMILARITY = 0.5;
const MIN_FULL_SIMILARITY = 0.6;
const GLOB_TIMEOUT_MS = 5000;

function normalizePathForMatch(value: string): string {
	return value
		.replace(/\\/g, "/")
		.replace(/^\.\/+/, "")
		.replace(/\/+$/, "")
		.toLowerCase();
}

function isNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const code = (error as { code?: string }).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

function isPathWithin(basePath: string, targetPath: string): boolean {
	const relativePath = path.relative(basePath, targetPath);
	return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function findExistingDirectory(startDir: string, signal?: AbortSignal): Promise<string | null> {
	let current = startDir;
	const root = path.parse(startDir).root;

	while (true) {
		throwIfAborted(signal);
		try {
			const stat = await Bun.file(current).stat();
			if (stat.isDirectory()) {
				return current;
			}
		} catch {
			// Keep walking up.
		}

		if (current === root) {
			break;
		}
		current = path.dirname(current);
	}

	return null;
}

function formatScopeLabel(searchRoot: string, cwd: string): string {
	const relative = path.relative(cwd, searchRoot).replace(/\\/g, "/");
	if (relative === "" || relative === ".") {
		return ".";
	}
	if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
		return relative;
	}
	return searchRoot;
}

function buildDisplayPath(searchRoot: string, cwd: string, relativePath: string): string {
	const scopeLabel = formatScopeLabel(searchRoot, cwd);
	const normalized = relativePath.replace(/\\/g, "/");
	if (scopeLabel === ".") {
		return normalized;
	}
	if (scopeLabel.startsWith("..") || path.isAbsolute(scopeLabel)) {
		return path.join(searchRoot, normalized).replace(/\\/g, "/");
	}
	return `${scopeLabel}/${normalized}`;
}

function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	const aLen = a.length;
	const bLen = b.length;
	if (aLen === 0) return bLen;
	if (bLen === 0) return aLen;

	let prev = new Array<number>(bLen + 1);
	let curr = new Array<number>(bLen + 1);
	for (let j = 0; j <= bLen; j++) {
		prev[j] = j;
	}

	for (let i = 1; i <= aLen; i++) {
		curr[0] = i;
		const aCode = a.charCodeAt(i - 1);
		for (let j = 1; j <= bLen; j++) {
			const cost = aCode === b.charCodeAt(j - 1) ? 0 : 1;
			const deletion = prev[j] + 1;
			const insertion = curr[j - 1] + 1;
			const substitution = prev[j - 1] + cost;
			curr[j] = Math.min(deletion, insertion, substitution);
		}
		const tmp = prev;
		prev = curr;
		curr = tmp;
	}

	return prev[bLen];
}

function similarityScore(a: string, b: string): number {
	if (a.length === 0 && b.length === 0) {
		return 1;
	}
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) {
		return 1;
	}
	const distance = levenshteinDistance(a, b);
	return 1 - distance / maxLen;
}

async function listCandidateFiles(
	searchRoot: string,
	signal?: AbortSignal,
	_notify?: (message: string) => void,
): Promise<{ files: string[]; truncated: boolean; error?: string }> {
	let files: string[];
	const timeoutSignal = AbortSignal.timeout(GLOB_TIMEOUT_MS);
	const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
	try {
		const result = await untilAborted(combinedSignal, () =>
			glob({
				pattern: "**/*",
				path: searchRoot,
				fileType: FileType.File,
				hidden: true,
			}),
		);
		files = result.matches.map(match => match.path);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			if (timeoutSignal.aborted && !signal?.aborted) {
				const timeoutSeconds = Math.max(1, Math.round(GLOB_TIMEOUT_MS / 1000));
				return { files: [], truncated: false, error: `find timed out after ${timeoutSeconds}s` };
			}
			throw new ToolAbortError();
		}
		const message = error instanceof Error ? error.message : String(error);
		return { files: [], truncated: false, error: message };
	}

	const normalizedFiles = files.filter(line => line.length > 0);
	const truncated = normalizedFiles.length > MAX_FUZZY_CANDIDATES;
	const limited = truncated ? normalizedFiles.slice(0, MAX_FUZZY_CANDIDATES) : normalizedFiles;

	return { files: limited, truncated };
}

async function findReadPathSuggestions(
	rawPath: string,
	cwd: string,
	signal?: AbortSignal,
	notify?: (message: string) => void,
): Promise<{ suggestions: string[]; scopeLabel?: string; truncated?: boolean; error?: string } | null> {
	const resolvedPath = resolveToCwd(rawPath, cwd);
	const searchRoot = await findExistingDirectory(path.dirname(resolvedPath), signal);
	if (!searchRoot) {
		return null;
	}

	if (!isPathWithin(cwd, resolvedPath)) {
		const root = path.parse(searchRoot).root;
		if (searchRoot === root) {
			return null;
		}
	}

	const { files, truncated, error } = await listCandidateFiles(searchRoot, signal, notify);
	const scopeLabel = formatScopeLabel(searchRoot, cwd);

	if (error && files.length === 0) {
		return { suggestions: [], scopeLabel, truncated, error };
	}

	if (files.length === 0) {
		return null;
	}

	const queryPath = (() => {
		if (path.isAbsolute(rawPath)) {
			const relative = path.relative(cwd, resolvedPath).replace(/\\/g, "/");
			if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
				return normalizePathForMatch(relative);
			}
		}
		return normalizePathForMatch(rawPath);
	})();
	const baseQuery = path.posix.basename(queryPath);

	const matches: Array<{ path: string; score: number; baseScore: number; fullScore: number }> = [];
	const seen = new Set<string>();

	for (const file of files) {
		throwIfAborted(signal);
		const cleaned = file.replace(/\r$/, "").trim();
		if (!cleaned) continue;

		const relativePath = cleaned;

		if (!relativePath || relativePath.startsWith("..")) {
			continue;
		}

		const displayPath = buildDisplayPath(searchRoot, cwd, relativePath);
		if (seen.has(displayPath)) {
			continue;
		}
		seen.add(displayPath);

		const normalizedDisplay = normalizePathForMatch(displayPath);
		const baseCandidate = path.posix.basename(normalizedDisplay);

		const fullScore = similarityScore(queryPath, normalizedDisplay);
		const baseScore = baseQuery ? similarityScore(baseQuery, baseCandidate) : 0;

		if (baseQuery) {
			if (baseScore < MIN_BASE_SIMILARITY && fullScore < MIN_FULL_SIMILARITY) {
				continue;
			}
		} else if (fullScore < MIN_FULL_SIMILARITY) {
			continue;
		}

		const score = baseQuery ? baseScore * 0.75 + fullScore * 0.25 : fullScore;
		matches.push({ path: displayPath, score, baseScore, fullScore });
	}

	if (matches.length === 0) {
		return { suggestions: [], scopeLabel, truncated };
	}

	matches.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (b.baseScore !== a.baseScore) return b.baseScore - a.baseScore;
		return a.path.localeCompare(b.path);
	});

	const listLimit = applyListLimit(matches, { limit: MAX_FUZZY_RESULTS });
	const suggestions = listLimit.items.map(match => match.path);

	return { suggestions, scopeLabel, truncated };
}

async function convertWithMarkitdown(
	filePath: string,
	signal?: AbortSignal,
): Promise<{ content: string; ok: boolean; error?: string }> {
	const cmd = await ensureTool("markitdown", { signal, silent: true });
	if (!cmd) {
		return { content: "", ok: false, error: "markitdown not found (uv/pip unavailable)" };
	}

	const result = await ptree.exec([cmd, filePath], {
		signal,
		allowNonZero: true,
		allowAbort: true,
		stderr: "buffer",
	});

	if (result.exitError?.aborted) {
		throw new ToolAbortError();
	}

	if (result.exitCode === 0 && result.stdout.length > 0) {
		return { content: result.stdout, ok: true };
	}

	return { content: "", ok: false, error: result.stderr.trim() || "Conversion failed" };
}

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
	lines: Type.Optional(Type.Boolean({ description: "Prepend line numbers to output (default: false)" })),
});

export interface ReadToolDetails {
	truncation?: TruncationResult;
	isDirectory?: boolean;
	resolvedPath?: string;
	meta?: OutputMeta;
}

type ReadParams = { path: string; offset?: number; limit?: number; lines?: boolean };

/**
 * Read tool implementation.
 *
 * Reads files with support for images, documents (via markitdown), and text.
 * Directories return a formatted listing with modification times.
 */
export class ReadTool implements AgentTool<typeof readSchema, ReadToolDetails> {
	public readonly name = "read";
	public readonly label = "Read";
	public readonly description: string;
	public readonly parameters = readSchema;
	public readonly nonAbortable = true;

	private readonly autoResizeImages: boolean;
	private readonly defaultLineNumbers: boolean;

	constructor(private readonly session: ToolSession) {
		this.autoResizeImages = session.settings.get("images.autoResize");
		this.defaultLineNumbers = session.settings.get("readLineNumbers");
		this.description = renderPromptTemplate(readDescription, {
			DEFAULT_MAX_LINES: String(DEFAULT_MAX_LINES),
		});
	}

	public async execute(
		_toolCallId: string,
		params: ReadParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ReadToolDetails>,
		toolContext?: AgentToolContext,
	): Promise<AgentToolResult<ReadToolDetails>> {
		const { path: readPath, offset, limit, lines } = params;

		// Handle internal URLs (agent://, skill://)
		const internalRouter = this.session.internalRouter;
		if (internalRouter?.canHandle(readPath)) {
			return this.handleInternalUrl(readPath, offset, limit, lines);
		}

		const absolutePath = resolveReadPath(readPath, this.session.cwd);

		let isDirectory = false;
		let fileSize = 0;
		try {
			const stat = await Bun.file(absolutePath).stat();
			fileSize = stat.size;
			isDirectory = stat.isDirectory();
		} catch (error) {
			if (isNotFoundError(error)) {
				let message = `File not found: ${readPath}`;

				// Skip fuzzy matching for remote mounts (sshfs) to avoid hangs
				if (!isRemoteMountPath(absolutePath)) {
					const suggestions = await findReadPathSuggestions(readPath, this.session.cwd, signal, message =>
						toolContext?.ui?.notify(message, "info"),
					);

					if (suggestions?.suggestions.length) {
						const scopeLabel = suggestions.scopeLabel ? ` in ${suggestions.scopeLabel}` : "";
						message += `\n\nClosest matches${scopeLabel}:\n${suggestions.suggestions.map(match => `- ${match}`).join("\n")}`;
						if (suggestions.truncated) {
							message += `\n[Search truncated to first ${MAX_FUZZY_CANDIDATES} paths. Refine the path if the match isn't listed.]`;
						}
					} else if (suggestions?.error) {
						message += `\n\nFuzzy match failed: ${suggestions.error}`;
					} else if (suggestions?.scopeLabel) {
						message += `\n\nNo similar paths found in ${suggestions.scopeLabel}.`;
					}
				}

				throw new ToolError(message);
			}
			throw error;
		}

		if (isDirectory) {
			return this.readDirectory(absolutePath, limit, signal);
		}

		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);
		const ext = path.extname(absolutePath).toLowerCase();

		// Read the file based on type
		let content: (TextContent | ImageContent)[];
		let details: ReadToolDetails = {};
		let sourcePath: string | undefined;
		let truncationInfo:
			| { result: TruncationResult; options: { direction: "head"; startLine?: number; totalFileLines?: number } }
			| undefined;

		if (mimeType) {
			if (fileSize > MAX_IMAGE_SIZE) {
				const sizeStr = formatSize(fileSize);
				const maxStr = formatSize(MAX_IMAGE_SIZE);
				throw new ToolError(`Image file too large: ${sizeStr} exceeds ${maxStr} limit.`);
			} else {
				// Read as image (binary)
				const file = Bun.file(absolutePath);
				const buffer = await file.arrayBuffer();

				// Check actual buffer size after reading to prevent OOM during serialization
				if (buffer.byteLength > MAX_IMAGE_SIZE) {
					const sizeStr = formatSize(buffer.byteLength);
					const maxStr = formatSize(MAX_IMAGE_SIZE);
					throw new ToolError(`Image file too large: ${sizeStr} exceeds ${maxStr} limit.`);
				} else {
					const base64 = new Uint8Array(buffer).toBase64();

					if (this.autoResizeImages) {
						// Resize image if needed - catch errors from Photon
						try {
							const resized = await resizeImage({ type: "image", data: base64, mimeType });
							const dimensionNote = formatDimensionNote(resized);

							let textNote = `Read image file [${resized.mimeType}]`;
							if (dimensionNote) {
								textNote += `\n${dimensionNote}`;
							}

							content = [
								{ type: "text", text: textNote },
								{ type: "image", data: resized.data, mimeType: resized.mimeType },
							];
							details = {};
							sourcePath = absolutePath;
						} catch {
							// Fall back to original image on resize failure
							content = [
								{ type: "text", text: `Read image file [${mimeType}]` },
								{ type: "image", data: base64, mimeType },
							];
							details = {};
							sourcePath = absolutePath;
						}
					} else {
						content = [
							{ type: "text", text: `Read image file [${mimeType}]` },
							{ type: "image", data: base64, mimeType },
						];
						details = {};
						sourcePath = absolutePath;
					}
				}
			}
		} else if (CONVERTIBLE_EXTENSIONS.has(ext)) {
			// Convert document via markitdown
			const result = await convertWithMarkitdown(absolutePath, signal);
			if (result.ok) {
				// Apply truncation to converted content
				const truncation = truncateHead(result.content);
				const outputText = truncation.content;

				details = { truncation };
				sourcePath = absolutePath;
				truncationInfo = { result: truncation, options: { direction: "head", startLine: 1 } };

				content = [{ type: "text", text: outputText }];
			} else if (result.error) {
				// markitdown not available or failed
				const errorMsg =
					result.error === "markitdown not found"
						? `markitdown not installed. Install with: pip install markitdown`
						: result.error || "conversion failed";
				content = [{ type: "text", text: `[Cannot read ${ext} file: ${errorMsg}]` }];
			} else {
				content = [{ type: "text", text: `[Cannot read ${ext} file: conversion failed]` }];
			}
		} else {
			// Read as text using streaming to avoid loading huge files into memory
			const startLine = offset ? Math.max(0, offset - 1) : 0;
			const startLineDisplay = startLine + 1; // For display (1-indexed)

			const maxLinesToCollect = limit !== undefined ? Math.min(limit, DEFAULT_MAX_LINES) : DEFAULT_MAX_LINES;
			const selectedLineLimit = limit ?? null;
			const streamResult = await streamLinesFromFile(
				absolutePath,
				startLine,
				maxLinesToCollect,
				DEFAULT_MAX_BYTES,
				selectedLineLimit,
				signal,
			);

			const {
				lines: collectedLines,
				totalFileLines,
				collectedBytes,
				stoppedByByteLimit,
				firstLinePreview,
				firstLineByteLength,
			} = streamResult;

			// Check if offset is out of bounds - return graceful message instead of throwing
			if (startLine >= totalFileLines) {
				const suggestion =
					totalFileLines === 0
						? "The file is empty."
						: `Use offset=1 to read from the start, or offset=${totalFileLines} to read the last line.`;
				return toolResult<ReadToolDetails>()
					.text(`Offset ${offset} is beyond end of file (${totalFileLines} lines total). ${suggestion}`)
					.done();
			}

			const selectedContent = collectedLines.join("\n");
			const userLimitedLines = limit !== undefined ? collectedLines.length : undefined;

			const totalSelectedLines = totalFileLines - startLine;
			const totalSelectedBytes = collectedBytes;
			const wasTruncated = collectedLines.length < totalSelectedLines || stoppedByByteLimit;
			const firstLineExceedsLimit = firstLineByteLength !== undefined && firstLineByteLength > DEFAULT_MAX_BYTES;

			const truncation: TruncationResult = {
				content: selectedContent,
				truncated: wasTruncated,
				truncatedBy: stoppedByByteLimit ? "bytes" : wasTruncated ? "lines" : null,
				totalLines: totalSelectedLines,
				totalBytes: totalSelectedBytes,
				outputLines: collectedLines.length,
				outputBytes: collectedBytes,
				lastLinePartial: false,
				firstLineExceedsLimit,
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			};

			// Add line numbers if requested (uses setting default if not specified)
			const shouldAddLineNumbers = lines ?? this.defaultLineNumbers;
			const prependLineNumbers = (text: string, startNum: number): string => {
				const textLines = text.split("\n");
				const lastLineNum = startNum + textLines.length - 1;
				const padWidth = String(lastLineNum).length;
				return textLines
					.map((line, i) => {
						const lineNum = String(startNum + i).padStart(padWidth, " ");
						return `${lineNum}\t${line}`;
					})
					.join("\n");
			};

			let outputText: string;

			if (truncation.firstLineExceedsLimit) {
				const firstLineBytes = firstLineByteLength ?? 0;
				const snippet = firstLinePreview ?? { text: "", bytes: 0 };

				outputText = shouldAddLineNumbers ? prependLineNumbers(snippet.text, startLineDisplay) : snippet.text;
				if (snippet.text.length === 0) {
					outputText = `[Line ${startLineDisplay} is ${formatSize(
						firstLineBytes,
					)}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Unable to display a valid UTF-8 snippet.]`;
				}
				details = { truncation };
				sourcePath = absolutePath;
				truncationInfo = {
					result: truncation,
					options: { direction: "head", startLine: startLineDisplay, totalFileLines },
				};
			} else if (truncation.truncated) {
				outputText = shouldAddLineNumbers
					? prependLineNumbers(truncation.content, startLineDisplay)
					: truncation.content;
				details = { truncation };
				sourcePath = absolutePath;
				truncationInfo = {
					result: truncation,
					options: { direction: "head", startLine: startLineDisplay, totalFileLines },
				};
			} else if (userLimitedLines !== undefined && startLine + userLimitedLines < totalFileLines) {
				const remaining = totalFileLines - (startLine + userLimitedLines);
				const nextOffset = startLine + userLimitedLines + 1;

				outputText = shouldAddLineNumbers
					? prependLineNumbers(truncation.content, startLineDisplay)
					: truncation.content;
				outputText += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue]`;
				details = {};
				sourcePath = absolutePath;
			} else {
				// No truncation, no user limit exceeded
				outputText = shouldAddLineNumbers
					? prependLineNumbers(truncation.content, startLineDisplay)
					: truncation.content;
				details = {};
				sourcePath = absolutePath;
			}

			content = [{ type: "text", text: outputText }];
		}

		const resultBuilder = toolResult(details).content(content);
		if (sourcePath) {
			resultBuilder.sourcePath(sourcePath);
		}
		if (truncationInfo) {
			resultBuilder.truncation(truncationInfo.result, truncationInfo.options);
		}
		return resultBuilder.done();
	}

	/**
	 * Handle internal URLs (agent://, skill://).
	 * Supports pagination via offset/limit but rejects them when query extraction is used.
	 */
	private async handleInternalUrl(
		url: string,
		offset?: number,
		limit?: number,
		lines?: boolean,
	): Promise<AgentToolResult<ReadToolDetails>> {
		const internalRouter = this.session.internalRouter!;

		// Check if URL has query extraction (agent:// only)
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new ToolError(`Invalid URL: ${url}`);
		}
		const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
		const hasPathExtraction = parsed.pathname && parsed.pathname !== "/" && parsed.pathname !== "";
		const queryParam = parsed.searchParams.get("q");
		const hasQueryExtraction = queryParam !== null && queryParam !== "";
		const hasExtraction = scheme === "agent" && (hasPathExtraction || hasQueryExtraction);

		if (scheme !== "agent" && hasQueryExtraction) {
			throw new ToolError("Only agent:// URLs support ?q= query extraction");
		}

		// Reject offset/limit with query extraction
		if (hasExtraction && (offset !== undefined || limit !== undefined)) {
			throw new ToolError("Cannot combine query extraction with offset/limit");
		}

		// Resolve the internal URL
		const resource = await internalRouter.resolve(url);

		// If extraction was used, return directly (no pagination)
		if (hasExtraction) {
			const details: ReadToolDetails = {};
			if (resource.sourcePath) {
				details.resolvedPath = resource.sourcePath;
			}
			return toolResult(details).text(resource.content).sourceInternal(url).done();
		}

		// Apply pagination similar to file reading
		const allLines = resource.content.split("\n");
		const totalLines = allLines.length;

		const startLine = offset ? Math.max(0, offset - 1) : 0;
		const startLineDisplay = startLine + 1;

		if (startLine >= allLines.length) {
			const suggestion =
				allLines.length === 0
					? "The resource is empty."
					: `Use offset=1 to read from the start, or offset=${allLines.length} to read the last line.`;
			return toolResult<ReadToolDetails>()
				.text(`Offset ${offset} is beyond end of resource (${allLines.length} lines total). ${suggestion}`)
				.done();
		}

		let selectedContent: string;
		let userLimitedLines: number | undefined;
		if (limit !== undefined) {
			const endLine = Math.min(startLine + limit, allLines.length);
			selectedContent = allLines.slice(startLine, endLine).join("\n");
			userLimitedLines = endLine - startLine;
		} else {
			selectedContent = allLines.slice(startLine).join("\n");
		}

		// Apply truncation
		const truncation = truncateHead(selectedContent);

		// Add line numbers if requested
		const shouldAddLineNumbers = lines ?? this.defaultLineNumbers;
		const prependLineNumbers = (text: string, startNum: number): string => {
			const textLines = text.split("\n");
			const lastLineNum = startNum + textLines.length - 1;
			const padWidth = String(lastLineNum).length;
			return textLines
				.map((line, i) => {
					const lineNum = String(startNum + i).padStart(padWidth, " ");
					return `${lineNum}\t${line}`;
				})
				.join("\n");
		};

		let outputText: string;
		let details: ReadToolDetails = {};
		let truncationInfo:
			| { result: TruncationResult; options: { direction: "head"; startLine?: number; totalFileLines?: number } }
			| undefined;

		if (truncation.firstLineExceedsLimit) {
			const firstLine = allLines[startLine] ?? "";
			const firstLineBytes = Buffer.byteLength(firstLine, "utf-8");
			const snippet = truncateStringToBytesFromStart(firstLine, DEFAULT_MAX_BYTES);

			outputText = shouldAddLineNumbers ? prependLineNumbers(snippet.text, startLineDisplay) : snippet.text;
			if (snippet.text.length === 0) {
				outputText = `[Line ${startLineDisplay} is ${formatSize(
					firstLineBytes,
				)}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Unable to display a valid UTF-8 snippet.]`;
			}
			details = { truncation };
			truncationInfo = {
				result: truncation,
				options: { direction: "head", startLine: startLineDisplay, totalFileLines: totalLines },
			};
		} else if (truncation.truncated) {
			outputText = shouldAddLineNumbers
				? prependLineNumbers(truncation.content, startLineDisplay)
				: truncation.content;
			details = { truncation };
			truncationInfo = {
				result: truncation,
				options: { direction: "head", startLine: startLineDisplay, totalFileLines: totalLines },
			};
		} else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
			const remaining = allLines.length - (startLine + userLimitedLines);
			const nextOffset = startLine + userLimitedLines + 1;

			outputText = shouldAddLineNumbers
				? prependLineNumbers(truncation.content, startLineDisplay)
				: truncation.content;
			outputText += `\n\n[${remaining} more lines in resource. Use offset=${nextOffset} to continue]`;
			details = {};
		} else {
			outputText = shouldAddLineNumbers
				? prependLineNumbers(truncation.content, startLineDisplay)
				: truncation.content;
			details = {};
		}

		if (resource.sourcePath) {
			details.resolvedPath = resource.sourcePath;
		}

		const resultBuilder = toolResult(details).text(outputText).sourceInternal(url);
		if (truncationInfo) {
			resultBuilder.truncation(truncationInfo.result, truncationInfo.options);
		}
		return resultBuilder.done();
	}

	/** Read directory contents as a formatted listing */
	private async readDirectory(
		absolutePath: string,
		limit: number | undefined,
		signal?: AbortSignal,
	): Promise<AgentToolResult<ReadToolDetails>> {
		const DEFAULT_LIMIT = 500;
		const effectiveLimit = limit ?? DEFAULT_LIMIT;

		let entries: string[];
		try {
			entries = await fs.readdir(absolutePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ToolError(`Cannot read directory: ${message}`);
		}

		// Sort alphabetically (case-insensitive)
		entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

		const listLimit = applyListLimit(entries, { limit: effectiveLimit });
		const limitedEntries = listLimit.items;
		const limitMeta = listLimit.meta;

		// Format entries with directory indicators and ages
		const results: string[] = [];

		for (const entry of limitedEntries) {
			throwIfAborted(signal);
			const fullPath = path.join(absolutePath, entry);
			let suffix = "";
			let age = "";

			try {
				const entryStat = await fs.stat(fullPath);
				suffix = entryStat.isDirectory() ? "/" : "";
				const ageSeconds = Math.floor((Date.now() - entryStat.mtimeMs) / 1000);
				age = formatAge(ageSeconds);
			} catch {
				// Skip entries we can't stat
				continue;
			}

			const line = age ? `${entry}${suffix} (${age})` : entry + suffix;
			results.push(line);
		}

		if (results.length === 0) {
			return { content: [{ type: "text", text: "(empty directory)" }], details: {} };
		}

		const output = results.join("\n");
		const truncation = truncateHead(output, { maxLines: Number.MAX_SAFE_INTEGER });

		const details: ReadToolDetails = {
			isDirectory: true,
		};

		const resultBuilder = toolResult(details)
			.text(truncation.content)
			.limits({ resultLimit: limitMeta.resultLimit?.reached });
		if (truncation.truncated) {
			resultBuilder.truncation(truncation, { direction: "head" });
			details.truncation = truncation;
		}

		return resultBuilder.done();
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface ReadRenderArgs {
	path?: string;
	file_path?: string;
	offset?: number;
	limit?: number;
}

export const readToolRenderer = {
	renderCall(args: ReadRenderArgs, uiTheme: Theme): Component {
		const rawPath = args.file_path || args.path || "";
		const filePath = shortenPath(rawPath);
		const offset = args.offset;
		const limit = args.limit;

		let pathDisplay = filePath || "…";
		if (offset !== undefined || limit !== undefined) {
			const startLine = offset ?? 1;
			const endLine = limit !== undefined ? startLine + limit - 1 : "";
			pathDisplay += `:${startLine}${endLine ? `-${endLine}` : ""}`;
		}

		const text = renderStatusLine({ icon: "pending", title: "Read", description: pathDisplay }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: ReadToolDetails },
		_options: RenderResultOptions,
		uiTheme: Theme,
		args?: ReadRenderArgs,
	): Component {
		const details = result.details;
		const contentText = result.content?.find(c => c.type === "text")?.text ?? "";
		const imageContent = result.content?.find(c => c.type === "image");
		const rawPath = args?.file_path || args?.path || "";
		const filePath = shortenPath(rawPath);
		const lang = getLanguageFromPath(rawPath);

		const warningLines: string[] = [];
		const truncation = details?.meta?.truncation;
		const fallback = details?.truncation;
		if (details?.resolvedPath) {
			warningLines.push(uiTheme.fg("dim", wrapBrackets(`Resolved path: ${details.resolvedPath}`, uiTheme)));
		}
		if (truncation) {
			let warning: string;
			if (fallback?.firstLineExceedsLimit) {
				warning = `First line exceeds ${formatSize(fallback.maxBytes ?? DEFAULT_MAX_BYTES)} limit`;
			} else if (truncation.truncatedBy === "lines") {
				warning = `Truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${DEFAULT_MAX_LINES} line limit)`;
			} else {
				const maxBytes = fallback?.maxBytes ?? DEFAULT_MAX_BYTES;
				warning = `Truncated: ${truncation.outputLines} lines (${formatSize(maxBytes)} limit)`;
			}
			if (truncation.artifactId) {
				warning += `. Full output: artifact://${truncation.artifactId}`;
			}
			warningLines.push(uiTheme.fg("warning", wrapBrackets(warning, uiTheme)));
		}

		if (imageContent) {
			const header = renderStatusLine(
				{ icon: "success", title: "Read", description: filePath || rawPath || "image" },
				uiTheme,
			);
			const detailLines = contentText ? contentText.split("\n").map(line => uiTheme.fg("toolOutput", line)) : [];
			const lines = [...detailLines, ...warningLines];
			return {
				render: (width: number) =>
					renderOutputBlock(
						{
							header,
							state: "success",
							sections: [
								{
									label: uiTheme.fg("toolTitle", "Details"),
									lines: lines.length > 0 ? lines : [uiTheme.fg("dim", "(image)")],
								},
							],
							width,
						},
						uiTheme,
					),
				invalidate: () => {},
			};
		}

		let title = filePath ? `Read ${filePath}` : "Read";
		if (args?.offset !== undefined || args?.limit !== undefined) {
			const startLine = args.offset ?? 1;
			const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
			title += `:${startLine}${endLine ? `-${endLine}` : ""}`;
		}
		return {
			render: (width: number) =>
				renderCodeCell(
					{
						code: contentText,
						language: lang,
						title,
						status: "complete",
						output: warningLines.length > 0 ? warningLines.join("\n") : undefined,
						expanded: true,
						width,
					},
					uiTheme,
				),
			invalidate: () => {},
		};
	},
	mergeCallAndResult: true,
};
