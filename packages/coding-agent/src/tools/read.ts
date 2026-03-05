import * as fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { ImageContent, TextContent } from "@oh-my-pi/pi-ai";
import { glob } from "@oh-my-pi/pi-natives";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { getRemoteDir, ptree, untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { getLanguageFromPath, type Theme } from "../modes/theme/theme";
import { computeLineHash } from "../patch/hashline";
import readDescription from "../prompts/tools/read.md" with { type: "text" };
import type { ToolSession } from "../sdk";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type TruncationResult,
	truncateHead,
	truncateHeadBytes,
} from "../session/streaming-output";
import { renderCodeCell, renderStatusLine } from "../tui";
import { CachedOutputBlock } from "../tui/output-block";
import { resolveFileDisplayMode } from "../utils/file-display-mode";
import { formatDimensionNote, resizeImage } from "../utils/image-resize";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime";
import { ensureTool } from "../utils/tools-manager";
import { applyListLimit } from "./list-limit";
import { formatFullOutputReference, formatStyledTruncationWarning, type OutputMeta } from "./output-meta";
import { resolveReadPath } from "./path-utils";
import { formatAge, formatBytes, shortenPath, wrapBrackets } from "./render-utils";
import { ToolAbortError, ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";

// Document types convertible via markitdown
const CONVERTIBLE_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf", ".epub"]);

// Remote mount path prefix (sshfs mounts) - skip fuzzy matching to avoid hangs
const REMOTE_MOUNT_PREFIX = getRemoteDir() + path.sep;

function isRemoteMountPath(absolutePath: string): boolean {
	return absolutePath.startsWith(REMOTE_MOUNT_PREFIX);
}

function prependLineNumbers(text: string, startNum: number): string {
	const textLines = text.split("\n");
	const lastLineNum = startNum + textLines.length - 1;
	const padWidth = String(lastLineNum).length;
	return textLines
		.map((line, i) => {
			const lineNum = String(startNum + i).padStart(padWidth, " ");
			return `${lineNum}|${line}`;
		})
		.join("\n");
}

function prependHashLines(text: string, startNum: number): string {
	const textLines = text.split("\n");
	return textLines.map((line, i) => `${startNum + i}#${computeLineHash(startNum + i, line)}:${line}`).join("\n");
}

function formatTextWithMode(
	text: string,
	startNum: number,
	shouldAddHashLines: boolean,
	shouldAddLineNumbers: boolean,
): string {
	if (shouldAddHashLines) return prependHashLines(text, startNum);
	if (shouldAddLineNumbers) return prependLineNumbers(text, startNum);
	return text;
}

const READ_CHUNK_SIZE = 8 * 1024;

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
		const { text, bytes } = truncateHeadBytes(Buffer.concat(firstLinePreviewChunks, firstLinePreviewBytes), maxBytes);
		firstLinePreview = { text, bytes };
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
const GLOB_TIMEOUT_MS = 5000;

function isNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const code = (error as { code?: string }).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Attempt to resolve a non-existent path by finding a unique suffix match within the workspace.
 * Uses a glob suffix pattern so the native engine handles matching directly.
 * Returns null when 0 or >1 candidates match (ambiguous = no auto-resolution).
 */
async function findUniqueSuffixMatch(
	rawPath: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<{ absolutePath: string; displayPath: string } | null> {
	const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
	if (!normalized) return null;

	const timeoutSignal = AbortSignal.timeout(GLOB_TIMEOUT_MS);
	const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

	let matches: string[];
	try {
		const result = await untilAborted(combinedSignal, () =>
			glob({
				pattern: `**/${normalized}`,
				path: cwd,
				// No fileType filter: matches both files and directories
				hidden: true,
			}),
		);
		matches = result.matches.map(m => m.path);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			if (!signal?.aborted) return null; // timeout — give up silently
			throw new ToolAbortError();
		}
		return null;
	}

	if (matches.length !== 1) return null;

	return {
		absolutePath: path.resolve(cwd, matches[0]),
		displayPath: matches[0],
	};
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
});

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
	truncation?: TruncationResult;
	isDirectory?: boolean;
	resolvedPath?: string;
	suffixResolution?: { from: string; to: string };
	meta?: OutputMeta;
}

type ReadParams = ReadToolInput;

/**
 * Read tool implementation.
 *
 * Reads files with support for images, documents (via markitdown), and text.
 * Directories return a formatted listing with modification times.
 */
export class ReadTool implements AgentTool<typeof readSchema, ReadToolDetails> {
	readonly name = "read";
	readonly label = "Read";
	readonly description: string;
	readonly parameters = readSchema;
	readonly nonAbortable = true;
	readonly strict = true;

	readonly #autoResizeImages: boolean;
	readonly #defaultLimit: number;

	constructor(private readonly session: ToolSession) {
		const displayMode = resolveFileDisplayMode(session);
		this.#autoResizeImages = session.settings.get("images.autoResize");
		this.#defaultLimit = Math.max(
			1,
			Math.min(session.settings.get("read.defaultLimit") ?? DEFAULT_MAX_LINES, DEFAULT_MAX_LINES),
		);
		this.description = renderPromptTemplate(readDescription, {
			DEFAULT_LIMIT: String(this.#defaultLimit),
			DEFAULT_MAX_LINES: String(DEFAULT_MAX_LINES),
			IS_HASHLINE_MODE: displayMode.hashLines,
			IS_LINE_NUMBER_MODE: !displayMode.hashLines && displayMode.lineNumbers,
		});
	}

	async execute(
		_toolCallId: string,
		params: ReadParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ReadToolDetails>,
		_toolContext?: AgentToolContext,
	): Promise<AgentToolResult<ReadToolDetails>> {
		const { path: readPath, offset, limit } = params;

		const displayMode = resolveFileDisplayMode(this.session);

		// Handle internal URLs (agent://, artifact://, memory://, skill://, rule://, local://, mcp://)
		const internalRouter = this.session.internalRouter;
		if (internalRouter?.canHandle(readPath)) {
			return this.#handleInternalUrl(readPath, offset, limit);
		}

		let absolutePath = resolveReadPath(readPath, this.session.cwd);
		let suffixResolution: { from: string; to: string } | undefined;

		let isDirectory = false;
		let fileSize = 0;
		try {
			const stat = await Bun.file(absolutePath).stat();
			fileSize = stat.size;
			isDirectory = stat.isDirectory();
		} catch (error) {
			if (isNotFoundError(error)) {
				// Attempt unique suffix resolution before falling back to fuzzy suggestions
				if (!isRemoteMountPath(absolutePath)) {
					const suffixMatch = await findUniqueSuffixMatch(readPath, this.session.cwd, signal);
					if (suffixMatch) {
						try {
							const retryStat = await Bun.file(suffixMatch.absolutePath).stat();
							absolutePath = suffixMatch.absolutePath;
							fileSize = retryStat.size;
							isDirectory = retryStat.isDirectory();
							suffixResolution = { from: readPath, to: suffixMatch.displayPath };
						} catch {
							// Suffix match candidate no longer stats — fall through to error path
						}
					}
				}

				if (!suffixResolution) {
					throw new ToolError(`Path '${readPath}' not found`);
				}
			} else {
				throw error;
			}
		}

		if (isDirectory) {
			const dirResult = await this.#readDirectory(absolutePath, limit, signal);
			if (suffixResolution) {
				dirResult.details ??= {};
				dirResult.details.suffixResolution = suffixResolution;
			}
			return dirResult;
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
				const sizeStr = formatBytes(fileSize);
				const maxStr = formatBytes(MAX_IMAGE_SIZE);
				throw new ToolError(`Image file too large: ${sizeStr} exceeds ${maxStr} limit.`);
			} else {
				// Read as image (binary)
				const file = Bun.file(absolutePath);
				const buffer = await file.arrayBuffer();

				// Check actual buffer size after reading to prevent OOM during serialization
				if (buffer.byteLength > MAX_IMAGE_SIZE) {
					const sizeStr = formatBytes(buffer.byteLength);
					const maxStr = formatBytes(MAX_IMAGE_SIZE);
					throw new ToolError(`Image file too large: ${sizeStr} exceeds ${maxStr} limit.`);
				} else {
					const base64 = new Uint8Array(buffer).toBase64();

					if (this.#autoResizeImages) {
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

			const effectiveLimit = limit ?? this.#defaultLimit;
			const maxLinesToCollect = Math.min(effectiveLimit, DEFAULT_MAX_LINES);
			const selectedLineLimit = effectiveLimit;
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
				return toolResult<ReadToolDetails>({ resolvedPath: absolutePath, suffixResolution })
					.text(`Offset ${offset} is beyond end of file (${totalFileLines} lines total). ${suggestion}`)
					.done();
			}

			const selectedContent = collectedLines.join("\n");
			const userLimitedLines = collectedLines.length;

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

			const shouldAddHashLines = displayMode.hashLines;
			const shouldAddLineNumbers = shouldAddHashLines ? false : displayMode.lineNumbers;
			const formatText = (text: string, startNum: number): string => {
				return formatTextWithMode(text, startNum, shouldAddHashLines, shouldAddLineNumbers);
			};

			let outputText: string;

			if (truncation.firstLineExceedsLimit) {
				const firstLineBytes = firstLineByteLength ?? 0;
				const snippet = firstLinePreview ?? { text: "", bytes: 0 };

				if (shouldAddHashLines) {
					outputText = `[Line ${startLineDisplay} is ${formatBytes(
						firstLineBytes,
					)}, exceeds ${formatBytes(DEFAULT_MAX_BYTES)} limit. Hashline output requires full lines; cannot compute hashes for a truncated preview.]`;
				} else {
					outputText = formatText(snippet.text, startLineDisplay);
				}
				if (snippet.text.length === 0) {
					outputText = `[Line ${startLineDisplay} is ${formatBytes(
						firstLineBytes,
					)}, exceeds ${formatBytes(DEFAULT_MAX_BYTES)} limit. Unable to display a valid UTF-8 snippet.]`;
				}
				details = { truncation };
				sourcePath = absolutePath;
				truncationInfo = {
					result: truncation,
					options: { direction: "head", startLine: startLineDisplay, totalFileLines },
				};
			} else if (truncation.truncated) {
				outputText = formatText(truncation.content, startLineDisplay);
				details = { truncation };
				sourcePath = absolutePath;
				truncationInfo = {
					result: truncation,
					options: { direction: "head", startLine: startLineDisplay, totalFileLines },
				};
			} else if (startLine + userLimitedLines < totalFileLines) {
				const remaining = totalFileLines - (startLine + userLimitedLines);
				const nextOffset = startLine + userLimitedLines + 1;

				outputText = formatText(truncation.content, startLineDisplay);
				outputText += `\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue]`;
				details = {};
				sourcePath = absolutePath;
			} else {
				// No truncation, no user limit exceeded
				outputText = formatText(truncation.content, startLineDisplay);
				details = {};
				sourcePath = absolutePath;
			}

			content = [{ type: "text", text: outputText }];
		}

		if (suffixResolution) {
			details.suffixResolution = suffixResolution;
			// Inline resolution notice into first text block so the model sees the actual path
			const notice = `[Path '${suffixResolution.from}' not found; resolved to '${suffixResolution.to}' via suffix match]`;
			const firstText = content.find((c): c is TextContent => c.type === "text");
			if (firstText) {
				firstText.text = `${notice}\n${firstText.text}`;
			} else {
				content = [{ type: "text", text: notice }, ...content];
			}
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
	 * Handle internal URLs (agent://, artifact://, memory://, skill://, rule://, local://, mcp://).
	 * Supports pagination via offset/limit but rejects them when query extraction is used.
	 */
	async #handleInternalUrl(url: string, offset?: number, limit?: number): Promise<AgentToolResult<ReadToolDetails>> {
		const internalRouter = this.session.internalRouter!;

		const displayMode = resolveFileDisplayMode(this.session);

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
		const hasQueryExtraction = scheme === "agent" && queryParam !== null && queryParam !== "";
		const hasExtraction = scheme === "agent" && (hasPathExtraction || hasQueryExtraction);

		// Reject offset/limit with query extraction
		if (hasExtraction && (offset !== undefined || limit !== undefined)) {
			throw new ToolError("Cannot combine query extraction with offset/limit");
		}

		// Resolve the internal URL
		const resource = await internalRouter.resolve(url);
		const details: ReadToolDetails = { resolvedPath: resource.sourcePath };

		// If extraction was used, return directly (no pagination)
		if (hasExtraction) {
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
			return toolResult<ReadToolDetails>(details)
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

		const shouldAddHashLines = displayMode.hashLines;
		const shouldAddLineNumbers = shouldAddHashLines ? false : displayMode.lineNumbers;
		const formatText = (text: string, startNum: number): string => {
			return formatTextWithMode(text, startNum, shouldAddHashLines, shouldAddLineNumbers);
		};

		let outputText: string;
		let truncationInfo:
			| { result: TruncationResult; options: { direction: "head"; startLine?: number; totalFileLines?: number } }
			| undefined;

		if (truncation.firstLineExceedsLimit) {
			const firstLine = allLines[startLine] ?? "";
			const firstLineBytes = Buffer.byteLength(firstLine, "utf-8");
			const snippet = truncateHeadBytes(firstLine, DEFAULT_MAX_BYTES);

			if (shouldAddHashLines) {
				outputText = `[Line ${startLineDisplay} is ${formatBytes(
					firstLineBytes,
				)}, exceeds ${formatBytes(DEFAULT_MAX_BYTES)} limit. Hashline output requires full lines; cannot compute hashes for a truncated preview.]`;
			} else {
				outputText = formatText(snippet.text, startLineDisplay);
			}
			if (snippet.text.length === 0) {
				outputText = `[Line ${startLineDisplay} is ${formatBytes(
					firstLineBytes,
				)}, exceeds ${formatBytes(DEFAULT_MAX_BYTES)} limit. Unable to display a valid UTF-8 snippet.]`;
			}
			details.truncation = truncation;
			truncationInfo = {
				result: truncation,
				options: { direction: "head", startLine: startLineDisplay, totalFileLines: totalLines },
			};
		} else if (truncation.truncated) {
			outputText = formatText(truncation.content, startLineDisplay);
			details.truncation = truncation;
			truncationInfo = {
				result: truncation,
				options: { direction: "head", startLine: startLineDisplay, totalFileLines: totalLines },
			};
		} else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
			const remaining = allLines.length - (startLine + userLimitedLines);
			const nextOffset = startLine + userLimitedLines + 1;

			outputText = formatText(truncation.content, startLineDisplay);
			outputText += `\n\n[${remaining} more lines in resource. Use offset=${nextOffset} to continue]`;
			details.truncation = truncation;
		} else {
			outputText = formatText(truncation.content, startLineDisplay);
		}

		const resultBuilder = toolResult(details).text(outputText).sourceInternal(url);
		if (truncationInfo) {
			resultBuilder.truncation(truncationInfo.result, truncationInfo.options);
		}
		return resultBuilder.done();
	}

	/** Read directory contents as a formatted listing */
	async #readDirectory(
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
	renderCall(args: ReadRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
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
			if (fallback?.firstLineExceedsLimit) {
				let warning = `First line exceeds ${formatBytes(fallback.maxBytes ?? DEFAULT_MAX_BYTES)} limit`;
				if (truncation.artifactId) {
					warning += `. ${formatFullOutputReference(truncation.artifactId)}`;
				}
				warningLines.push(uiTheme.fg("warning", wrapBrackets(warning, uiTheme)));
			} else {
				const warning = formatStyledTruncationWarning(details?.meta, uiTheme);
				if (warning) warningLines.push(warning);
			}
		}

		if (imageContent) {
			const suffix = details?.suffixResolution;
			const displayPath = suffix ? shortenPath(suffix.to) : filePath || rawPath || "image";
			const correction = suffix ? ` ${uiTheme.fg("dim", `(corrected from ${shortenPath(suffix.from)})`)}` : "";
			const header = renderStatusLine(
				{ icon: suffix ? "warning" : "success", title: "Read", description: `${displayPath}${correction}` },
				uiTheme,
			);
			const detailLines = contentText ? contentText.split("\n").map(line => uiTheme.fg("toolOutput", line)) : [];
			const lines = [...detailLines, ...warningLines];
			const outputBlock = new CachedOutputBlock();
			return {
				render: (width: number) =>
					outputBlock.render(
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
				invalidate: () => outputBlock.invalidate(),
			};
		}

		const suffix = details?.suffixResolution;
		const displayPath = suffix ? shortenPath(suffix.to) : filePath;
		const correction = suffix ? ` ${uiTheme.fg("dim", `(corrected from ${shortenPath(suffix.from)})`)}` : "";
		let title = displayPath ? `Read ${displayPath}${correction}` : "Read";
		if (args?.offset !== undefined || args?.limit !== undefined) {
			const startLine = args.offset ?? 1;
			const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
			title += `:${startLine}${endLine ? `-${endLine}` : ""}`;
		}
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		return {
			render: (width: number) => {
				if (cachedLines && cachedWidth === width) return cachedLines;
				cachedLines = renderCodeCell(
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
				);
				cachedWidth = width;
				return cachedLines;
			},
			invalidate: () => {
				cachedWidth = undefined;
				cachedLines = undefined;
			},
		};
	},
	mergeCallAndResult: true,
};
