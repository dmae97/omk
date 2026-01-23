import { mkdir, rm } from "node:fs/promises";
import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { ptree } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { nanoid } from "nanoid";
import { parse as parseHtml } from "node-html-parser";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import { type Theme, theme } from "$c/modes/theme/theme";
import fetchDescription from "$c/prompts/tools/fetch.md" with { type: "text" };
import type { OutputMeta } from "$c/tools/output-meta";
import { ToolAbortError } from "$c/tools/tool-errors";
import { renderOutputBlock, renderStatusLine } from "$c/tui";
import { ensureTool } from "$c/utils/tools-manager";
import { specialHandlers } from "$c/web/scrapers/index";
import type { RenderResult } from "$c/web/scrapers/types";
import { finalizeOutput, loadPage, MAX_OUTPUT_CHARS } from "$c/web/scrapers/types";
import { convertWithMarkitdown, fetchBinary } from "$c/web/scrapers/utils";
import type { ToolSession } from "./index";
import { applyListLimit } from "./list-limit";
import { formatExpandHint } from "./render-utils";
import { toolResult } from "./tool-result";

// =============================================================================
// Types and Constants
// =============================================================================

// Convertible document types (markitdown supported)
const CONVERTIBLE_MIMES = new Set([
	"application/pdf",
	"application/msword",
	"application/vnd.ms-powerpoint",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/rtf",
	"application/epub+zip",
	"application/zip",
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"audio/mpeg",
	"audio/wav",
	"audio/ogg",
]);

const CONVERTIBLE_EXTENSIONS = new Set([
	".pdf",
	".doc",
	".docx",
	".ppt",
	".pptx",
	".xls",
	".xlsx",
	".rtf",
	".epub",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".mp3",
	".wav",
	".ogg",
]);

// =============================================================================
// Utilities
// =============================================================================

/**
 * Execute a command and return stdout
 */

type WritableLike = {
	write: (chunk: string | Uint8Array) => unknown;
	flush?: () => unknown;
	end?: () => unknown;
};

const textEncoder = new TextEncoder();

async function writeStdin(handle: unknown, input: string | Buffer): Promise<void> {
	if (!handle || typeof handle === "number") return;
	if (typeof (handle as WritableStream<Uint8Array>).getWriter === "function") {
		const writer = (handle as WritableStream<Uint8Array>).getWriter();
		try {
			const chunk = typeof input === "string" ? textEncoder.encode(input) : new Uint8Array(input);
			await writer.write(chunk);
		} finally {
			await writer.close();
		}
		return;
	}

	const sink = handle as WritableLike;
	sink.write(input);
	if (sink.flush) sink.flush();
	if (sink.end) sink.end();
}

async function exec(
	cmd: string,
	args: string[],
	options?: { timeout?: number; input?: string | Buffer },
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
	const proc = ptree.cspawn([cmd, ...args], {
		stdin: options?.input ? "pipe" : null,
		timeout: options?.timeout ? options.timeout * 1000 : undefined,
	});

	if (options?.input) {
		await writeStdin(proc.stdin, options.input);
	}

	const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
	try {
		await proc.exited;
	} catch {
		// Handle non-zero exit or timeout
	}

	return {
		stdout,
		stderr,
		ok: proc.exitCode === 0,
	};
}

/**
 * Check if a command exists (cross-platform)
 */
function hasCommand(cmd: string): boolean {
	return Boolean(Bun.which(cmd));
}

/**
 * Extract origin from URL
 */
function getOrigin(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.protocol}//${parsed.host}`;
	} catch {
		return "";
	}
}

/**
 * Normalize URL (add scheme if missing)
 */
function normalizeUrl(url: string): string {
	if (!url.match(/^https?:\/\//i)) {
		return `https://${url}`;
	}
	return url;
}

/**
 * Normalize MIME type (lowercase, strip charset/params)
 */
function normalizeMime(contentType: string): string {
	return contentType.split(";")[0].trim().toLowerCase();
}

/**
 * Get extension from URL or Content-Disposition
 */
function getExtensionHint(url: string, contentDisposition?: string): string {
	// Try Content-Disposition filename first
	if (contentDisposition) {
		const match = contentDisposition.match(/filename[*]?=["']?([^"';\n]+)/i);
		if (match) {
			const ext = path.extname(match[1]).toLowerCase();
			if (ext) return ext;
		}
	}

	// Fall back to URL path
	try {
		const pathname = new URL(url).pathname;
		const ext = path.extname(pathname).toLowerCase();
		if (ext) return ext;
	} catch {}

	return "";
}

/**
 * Check if content type is convertible via markitdown
 */
function isConvertible(mime: string, extensionHint: string): boolean {
	if (CONVERTIBLE_MIMES.has(mime)) return true;
	if (mime === "application/octet-stream" && CONVERTIBLE_EXTENSIONS.has(extensionHint)) return true;
	if (CONVERTIBLE_EXTENSIONS.has(extensionHint)) return true;
	return false;
}

/**
 * Check if content looks like HTML
 */
function looksLikeHtml(content: string): boolean {
	const trimmed = content.trim().toLowerCase();
	return (
		trimmed.startsWith("<!doctype") ||
		trimmed.startsWith("<html") ||
		trimmed.startsWith("<head") ||
		trimmed.startsWith("<body")
	);
}

/**
 * Try fetching URL with .md appended (llms.txt convention)
 */
async function tryMdSuffix(url: string, timeout: number, signal?: AbortSignal): Promise<string | null> {
	const candidates: string[] = [];

	try {
		const parsed = new URL(url);
		const pathname = parsed.pathname;

		if (pathname.endsWith("/")) {
			// /foo/bar/ -> /foo/bar/index.html.md
			candidates.push(`${parsed.origin}${pathname}index.html.md`);
		} else if (pathname.includes(".")) {
			// /foo/bar.html -> /foo/bar.html.md
			candidates.push(`${parsed.origin}${pathname}.md`);
		} else {
			// /foo/bar -> /foo/bar.md
			candidates.push(`${parsed.origin}${pathname}.md`);
		}
	} catch {
		return null;
	}

	if (signal?.aborted) {
		return null;
	}

	for (const candidate of candidates) {
		if (signal?.aborted) {
			return null;
		}
		const result = await loadPage(candidate, { timeout, signal });
		if (result.ok && result.content.trim().length > 100 && !looksLikeHtml(result.content)) {
			return result.content;
		}
	}

	return null;
}

/**
 * Try to fetch LLM-friendly endpoints
 */
async function tryLlmEndpoints(origin: string, timeout: number, signal?: AbortSignal): Promise<string | null> {
	const endpoints = [`${origin}/.well-known/llms.txt`, `${origin}/llms.txt`, `${origin}/llms.md`];

	if (signal?.aborted) {
		return null;
	}

	for (const endpoint of endpoints) {
		if (signal?.aborted) {
			return null;
		}
		const result = await loadPage(endpoint, { timeout: Math.min(timeout, 5), signal });
		if (result.ok && result.content.trim().length > 100 && !looksLikeHtml(result.content)) {
			return result.content;
		}
	}
	return null;
}

/**
 * Try content negotiation for markdown/plain
 */
async function tryContentNegotiation(
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ content: string; type: string } | null> {
	if (signal?.aborted) {
		return null;
	}

	const result = await loadPage(url, {
		timeout,
		headers: { Accept: "text/markdown, text/plain;q=0.9, text/html;q=0.8" },
		signal,
	});

	if (!result.ok) return null;

	const mime = normalizeMime(result.contentType);
	if (mime.includes("markdown") || mime === "text/plain") {
		return { content: result.content, type: result.contentType };
	}

	return null;
}

/**
 * Parse alternate links from HTML head
 */
function parseAlternateLinks(html: string, pageUrl: string): string[] {
	const links: string[] = [];

	try {
		const doc = parseHtml(html.slice(0, 262144));
		const alternateLinks = doc.querySelectorAll('link[rel="alternate"]');

		for (const link of alternateLinks) {
			const href = link.getAttribute("href");
			const type = link.getAttribute("type")?.toLowerCase() ?? "";

			if (!href) continue;

			// Skip site-wide feeds
			if (
				href.includes("RecentChanges") ||
				href.includes("Special:") ||
				href.includes("/feed/") ||
				href.includes("action=feed")
			) {
				continue;
			}

			if (type.includes("markdown")) {
				links.push(href);
			} else if (
				(type.includes("rss") || type.includes("atom") || type.includes("feed")) &&
				(href.includes(new URL(pageUrl).pathname) || href.includes("comments"))
			) {
				links.push(href);
			}
		}
	} catch {}

	return links;
}

/**
 * Extract document links from HTML (for PDF/DOCX wrapper pages)
 */
function extractDocumentLinks(html: string, baseUrl: string): string[] {
	const links: string[] = [];

	try {
		const doc = parseHtml(html);
		const anchors = doc.querySelectorAll("a[href]");

		for (const anchor of anchors) {
			const href = anchor.getAttribute("href");
			if (!href) continue;

			const ext = path.extname(href).toLowerCase();
			if (CONVERTIBLE_EXTENSIONS.has(ext)) {
				const resolved = href.startsWith("http") ? href : new URL(href, baseUrl).href;
				links.push(resolved);
			}
		}
	} catch {}

	return links;
}

/**
 * Strip CDATA wrapper and clean text
 */
function cleanFeedText(text: string): string {
	return text
		.replace(/<!\[CDATA\[/g, "")
		.replace(/\]\]>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/<[^>]+>/g, "") // Strip HTML tags
		.trim();
}

/**
 * Parse RSS/Atom feed to markdown
 */
function parseFeedToMarkdown(content: string, maxItems = 10): string {
	try {
		const doc = parseHtml(content, { parseNoneClosedTags: true });

		// Try RSS
		const channel = doc.querySelector("channel");
		if (channel) {
			const title = cleanFeedText(channel.querySelector("title")?.text || "RSS Feed");
			const items = channel.querySelectorAll("item").slice(0, maxItems);

			let md = `# ${title}\n\n`;
			for (const item of items) {
				const itemTitle = cleanFeedText(item.querySelector("title")?.text || "Untitled");
				const link = cleanFeedText(item.querySelector("link")?.text || "");
				const pubDate = cleanFeedText(item.querySelector("pubDate")?.text || "");
				const desc = cleanFeedText(item.querySelector("description")?.text || "");

				md += `## ${itemTitle}\n`;
				if (pubDate) md += `*${pubDate}*\n\n`;
				if (desc) md += `${desc.slice(0, 500)}${desc.length > 500 ? "..." : ""}\n\n`;
				if (link) md += `[Read more](${link})\n\n`;
				md += "---\n\n";
			}
			return md;
		}

		// Try Atom
		const feed = doc.querySelector("feed");
		if (feed) {
			const title = cleanFeedText(feed.querySelector("title")?.text || "Atom Feed");
			const entries = feed.querySelectorAll("entry").slice(0, maxItems);

			let md = `# ${title}\n\n`;
			for (const entry of entries) {
				const entryTitle = cleanFeedText(entry.querySelector("title")?.text || "Untitled");
				const link = entry.querySelector("link")?.getAttribute("href") || "";
				const updated = cleanFeedText(entry.querySelector("updated")?.text || "");
				const summary = cleanFeedText(
					entry.querySelector("summary")?.text || entry.querySelector("content")?.text || "",
				);

				md += `## ${entryTitle}\n`;
				if (updated) md += `*${updated}*\n\n`;
				if (summary) md += `${summary.slice(0, 500)}${summary.length > 500 ? "..." : ""}\n\n`;
				if (link) md += `[Read more](${link})\n\n`;
				md += "---\n\n";
			}
			return md;
		}
	} catch {}

	return content; // Fall back to raw content
}

/**
 * Render HTML to text using lynx or html2text fallback
 */
async function renderHtmlToText(
	html: string,
	timeout: number,
	scratchDir: string,
): Promise<{ content: string; ok: boolean; method: string }> {
	await mkdir(scratchDir, { recursive: true });
	const tmpFile = path.join(scratchDir, `omp-${nanoid()}.html`);

	try {
		await Bun.write(tmpFile, html);

		// Try lynx first (can't auto-install, system package)
		const lynx = hasCommand("lynx");
		if (lynx) {
			const normalizedPath = tmpFile.replace(/\\/g, "/");
			const fileUrl = normalizedPath.startsWith("/") ? `file://${normalizedPath}` : `file:///${normalizedPath}`;
			const result = await exec("lynx", ["-dump", "-nolist", "-width", "120", fileUrl], { timeout });
			if (result.ok) {
				return { content: result.stdout, ok: true, method: "lynx" };
			}
		}

		// Fall back to html2text (auto-install via uv/pip)
		const html2text = await ensureTool("html2text", true);
		if (html2text) {
			const result = await exec(html2text, [tmpFile], { timeout });
			if (result.ok) {
				return { content: result.stdout, ok: true, method: "html2text" };
			}
		}

		return { content: "", ok: false, method: "none" };
	} finally {
		try {
			await rm(tmpFile, { force: true });
		} catch {}
	}
}

/**
 * Check if lynx output looks JS-gated or mostly navigation
 */
function isLowQualityOutput(content: string): boolean {
	const lower = content.toLowerCase();

	// JS-gated indicators
	const jsGated = [
		"enable javascript",
		"javascript required",
		"turn on javascript",
		"please enable javascript",
		"browser not supported",
	];
	if (content.length < 1024 && jsGated.some((t) => lower.includes(t))) {
		return true;
	}

	// Mostly navigation (high link/menu density)
	const lines = content.split("\n").filter((l) => l.trim());
	const shortLines = lines.filter((l) => l.trim().length < 40);
	if (lines.length > 10 && shortLines.length / lines.length > 0.7) {
		return true;
	}

	return false;
}

/**
 * Format JSON
 */
function formatJson(content: string): string {
	try {
		return JSON.stringify(JSON.parse(content), null, 2);
	} catch {
		return content;
	}
}

// =============================================================================
// Unified Special Handler Dispatch
// =============================================================================

/**
 * Try all special handlers
 */
async function handleSpecialUrls(url: string, timeout: number, signal?: AbortSignal): Promise<RenderResult | null> {
	for (const handler of specialHandlers) {
		if (signal?.aborted) {
			throw new ToolAbortError();
		}
		const result = await handler(url, timeout, signal);
		if (result) return result;
	}
	return null;
}

// =============================================================================
// Main Render Function
// =============================================================================

/**
 * Main render function implementing the full pipeline
 */
async function renderUrl(
	url: string,
	timeout: number,
	raw: boolean,
	scratchDir: string,
	signal?: AbortSignal,
): Promise<RenderResult> {
	const notes: string[] = [];
	const fetchedAt = new Date().toISOString();
	if (signal?.aborted) {
		throw new ToolAbortError();
	}

	// Handle internal protocol URLs (e.g., pi-internal://) - return empty
	if (url.startsWith("pi-internal://")) {
		return {
			url,
			finalUrl: url,
			contentType: "text/plain",
			method: "internal",
			content: "",
			fetchedAt,
			truncated: false,
			notes: ["Internal protocol URL - no external content"],
		};
	}

	// Step 0: Normalize URL (ensure scheme for special handlers)
	url = normalizeUrl(url);
	const origin = getOrigin(url);

	// Step 1: Try special handlers for known sites (unless raw mode)
	if (!raw) {
		const specialResult = await handleSpecialUrls(url, timeout, signal);
		if (specialResult) return specialResult;
	}

	// Step 2: Fetch page
	const response = await loadPage(url, { timeout, signal });
	if (signal?.aborted) {
		throw new ToolAbortError();
	}
	if (!response.ok) {
		return {
			url,
			finalUrl: url,
			contentType: "unknown",
			method: "failed",
			content: "",
			fetchedAt,
			truncated: false,
			notes: ["Failed to fetch URL"],
		};
	}

	const { finalUrl, content: rawContent } = response;
	const mime = normalizeMime(response.contentType);
	const extHint = getExtensionHint(finalUrl);

	// Step 3: Handle convertible binary files (PDF, DOCX, etc.)
	if (isConvertible(mime, extHint)) {
		const binary = await fetchBinary(finalUrl, timeout, signal);
		if (binary.ok) {
			const ext = getExtensionHint(finalUrl, binary.contentDisposition) || extHint;
			const converted = await convertWithMarkitdown(binary.buffer, ext, timeout, signal);
			if (converted.ok) {
				if (converted.content.trim().length > 50) {
					notes.push("Converted with markitdown");
					const output = finalizeOutput(converted.content);
					return {
						url,
						finalUrl,
						contentType: mime,
						method: "markitdown",
						content: output.content,
						fetchedAt,
						truncated: output.truncated,
						notes,
					};
				}
				notes.push("markitdown conversion produced no usable output");
			} else if (converted.error) {
				notes.push(`markitdown conversion failed: ${converted.error}`);
			} else {
				notes.push("markitdown conversion failed");
			}
		} else if (binary.error) {
			notes.push(`Binary fetch failed: ${binary.error}`);
		} else {
			notes.push("Binary fetch failed");
		}
	}

	// Step 4: Handle non-HTML text content
	const isHtml = mime.includes("html") || mime.includes("xhtml");
	const isJson = mime.includes("json");
	const isXml = mime.includes("xml") && !isHtml;
	const isText = mime.includes("text/plain") || mime.includes("text/markdown");
	const isFeed = mime.includes("rss") || mime.includes("atom") || mime.includes("feed");

	if (isJson) {
		const output = finalizeOutput(formatJson(rawContent));
		return {
			url,
			finalUrl,
			contentType: mime,
			method: "json",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes,
		};
	}

	if (isFeed || (isXml && (rawContent.includes("<rss") || rawContent.includes("<feed")))) {
		const parsed = parseFeedToMarkdown(rawContent);
		const output = finalizeOutput(parsed);
		return {
			url,
			finalUrl,
			contentType: mime,
			method: "feed",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes,
		};
	}

	if (isText && !looksLikeHtml(rawContent)) {
		const output = finalizeOutput(rawContent);
		return {
			url,
			finalUrl,
			contentType: mime,
			method: "text",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes,
		};
	}

	// Step 5: For HTML, try digestible formats first (unless raw mode)
	if (isHtml && !raw) {
		// 5A: Check for page-specific markdown alternate
		const alternates = parseAlternateLinks(rawContent, finalUrl);
		const markdownAlt = alternates.find((alt) => alt.endsWith(".md") || alt.includes("markdown"));
		if (markdownAlt) {
			const resolved = markdownAlt.startsWith("http") ? markdownAlt : new URL(markdownAlt, finalUrl).href;
			const altResult = await loadPage(resolved, { timeout, signal });
			if (altResult.ok && altResult.content.trim().length > 100 && !looksLikeHtml(altResult.content)) {
				notes.push(`Used markdown alternate: ${resolved}`);
				const output = finalizeOutput(altResult.content);
				return {
					url,
					finalUrl,
					contentType: "text/markdown",
					method: "alternate-markdown",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
		}

		// 5B: Try URL.md suffix (llms.txt convention)
		const mdSuffix = await tryMdSuffix(finalUrl, timeout, signal);
		if (mdSuffix) {
			notes.push("Found .md suffix version");
			const output = finalizeOutput(mdSuffix);
			return {
				url,
				finalUrl,
				contentType: "text/markdown",
				method: "md-suffix",
				content: output.content,
				fetchedAt,
				truncated: output.truncated,
				notes,
			};
		}

		// 5C: LLM-friendly endpoints
		const llmContent = await tryLlmEndpoints(origin, timeout, signal);
		if (llmContent) {
			notes.push("Found llms.txt");
			const output = finalizeOutput(llmContent);
			return {
				url,
				finalUrl,
				contentType: "text/plain",
				method: "llms.txt",
				content: output.content,
				fetchedAt,
				truncated: output.truncated,
				notes,
			};
		}

		// 5D: Content negotiation
		const negotiated = await tryContentNegotiation(url, timeout, signal);
		if (negotiated) {
			notes.push(`Content negotiation returned ${negotiated.type}`);
			const output = finalizeOutput(negotiated.content);
			return {
				url,
				finalUrl,
				contentType: normalizeMime(negotiated.type),
				method: "content-negotiation",
				content: output.content,
				fetchedAt,
				truncated: output.truncated,
				notes,
			};
		}

		// 5E: Check for feed alternates
		const feedAlternates = alternates.filter((alt) => !alt.endsWith(".md") && !alt.includes("markdown"));
		for (const altUrl of feedAlternates.slice(0, 2)) {
			const resolved = altUrl.startsWith("http") ? altUrl : new URL(altUrl, finalUrl).href;
			const altResult = await loadPage(resolved, { timeout, signal });
			if (altResult.ok && altResult.content.trim().length > 200) {
				notes.push(`Used feed alternate: ${resolved}`);
				const parsed = parseFeedToMarkdown(altResult.content);
				const output = finalizeOutput(parsed);
				return {
					url,
					finalUrl,
					contentType: "application/feed",
					method: "alternate-feed",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
		}

		if (signal?.aborted) {
			throw new ToolAbortError();
		}

		// Step 6: Render HTML with lynx or html2text
		const htmlResult = await renderHtmlToText(rawContent, timeout, scratchDir);
		if (!htmlResult.ok) {
			notes.push("html rendering failed (lynx/html2text unavailable)");
			const output = finalizeOutput(rawContent);
			return {
				url,
				finalUrl,
				contentType: mime,
				method: "raw-html",
				content: output.content,
				fetchedAt,
				truncated: output.truncated,
				notes,
			};
		}

		// Step 7: If lynx output is low quality, try extracting document links
		if (isLowQualityOutput(htmlResult.content)) {
			const docLinks = extractDocumentLinks(rawContent, finalUrl);
			if (docLinks.length > 0) {
				const docUrl = docLinks[0];
				const binary = await fetchBinary(docUrl, timeout, signal);
				if (binary.ok) {
					const ext = getExtensionHint(docUrl, binary.contentDisposition);
					const converted = await convertWithMarkitdown(binary.buffer, ext, timeout, signal);
					if (converted.ok && converted.content.trim().length > htmlResult.content.length) {
						notes.push(`Extracted and converted document: ${docUrl}`);
						const output = finalizeOutput(converted.content);
						return {
							url,
							finalUrl,
							contentType: "application/document",
							method: "extracted-document",
							content: output.content,
							fetchedAt,
							truncated: output.truncated,
							notes,
						};
					}
					if (!converted.ok && converted.error) {
						notes.push(`markitdown conversion failed: ${converted.error}`);
					}
				} else if (binary.error) {
					notes.push(`Binary fetch failed: ${binary.error}`);
				}
			}
			notes.push("Page appears to require JavaScript or is mostly navigation");
		}

		const output = finalizeOutput(htmlResult.content);
		return {
			url,
			finalUrl,
			contentType: mime,
			method: htmlResult.method,
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes,
		};
	}

	// Fallback: return raw content
	const output = finalizeOutput(rawContent);
	return {
		url,
		finalUrl,
		contentType: mime,
		method: "raw",
		content: output.content,
		fetchedAt,
		truncated: output.truncated,
		notes,
	};
}

// =============================================================================
// Tool Definition
// =============================================================================

const fetchSchema = Type.Object({
	url: Type.String({ description: "URL to fetch" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 20)" })),
	raw: Type.Optional(Type.Boolean({ description: "Return raw HTML without transforms" })),
});

export interface FetchToolDetails {
	url: string;
	finalUrl: string;
	contentType: string;
	method: string;
	truncated: boolean;
	notes: string[];
	meta?: OutputMeta;
}

export class FetchTool implements AgentTool<typeof fetchSchema, FetchToolDetails> {
	public readonly name = "fetch";
	public readonly label = "Fetch";
	public readonly description: string;
	public readonly parameters = fetchSchema;
	private readonly session: ToolSession;

	constructor(session: ToolSession) {
		this.session = session;
		this.description = renderPromptTemplate(fetchDescription);
	}

	public async execute(
		_toolCallId: string,
		params: Static<typeof fetchSchema>,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<FetchToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<FetchToolDetails>> {
		const { url, timeout: rawTimeout = 20, raw = false } = params;

		// Auto-convert milliseconds to seconds if value > 1000 (16+ min is unreasonable)
		const timeoutSec = rawTimeout > 1000 ? rawTimeout / 1000 : rawTimeout;

		// Clamp to valid range (seconds)
		const effectiveTimeout = Math.min(Math.max(timeoutSec, 1), 45);

		if (signal?.aborted) {
			throw new ToolAbortError();
		}

		const scratchDir = this.session.getArtifactsDir?.() ?? this.session.cwd;
		const result = await renderUrl(url, effectiveTimeout, raw, scratchDir, signal);

		// Format output
		let output = "";
		output += `URL: ${result.finalUrl}\n`;
		output += `Content-Type: ${result.contentType}\n`;
		output += `Method: ${result.method}\n`;
		if (result.notes.length > 0) {
			output += `Notes: ${result.notes.join("; ")}\n`;
		}
		output += `\n---\n\n`;
		output += result.content;

		const details: FetchToolDetails = {
			url: result.url,
			finalUrl: result.finalUrl,
			contentType: result.contentType,
			method: result.method,
			truncated: result.truncated,
			notes: result.notes,
		};

		const resultBuilder = toolResult(details).text(output).sourceUrl(result.finalUrl);
		if (result.truncated) {
			const outputLines = result.content.split("\n").length;
			const outputBytes = Buffer.byteLength(result.content, "utf-8");
			const totalBytes = Math.max(outputBytes + 1, MAX_OUTPUT_CHARS + 1);
			const totalLines = outputLines + 1;
			resultBuilder.truncationFromText(result.content, {
				direction: "tail",
				totalLines,
				totalBytes,
				maxBytes: MAX_OUTPUT_CHARS,
			});
		}

		return resultBuilder.done();
	}
}

// =============================================================================
// TUI Rendering
// =============================================================================

/** Truncate text to max length with ellipsis */
function truncate(text: string, maxLen: number, ellipsis: string): string {
	if (text.length <= maxLen) return text;
	const sliceLen = Math.max(0, maxLen - ellipsis.length);
	return `${text.slice(0, sliceLen)}${ellipsis}`;
}

/** Extract domain from URL */
function getDomain(url: string): string {
	try {
		const u = new URL(url);
		return u.hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

/** Count non-empty lines */
function countNonEmptyLines(text: string): number {
	return text.split("\n").filter((l) => l.trim()).length;
}

/** Render fetch call (URL preview) */
export function renderFetchCall(
	args: { url: string; timeout?: number; raw?: boolean },
	uiTheme: Theme = theme,
): Component {
	const domain = getDomain(args.url);
	const path = truncate(args.url.replace(/^https?:\/\/[^/]+/, ""), 50, uiTheme.format.ellipsis);
	const description = `${domain}${path ? ` ${path}` : ""}`.trim();
	const meta: string[] = [];
	if (args.raw) meta.push("raw");
	if (args.timeout !== undefined) meta.push(`timeout:${args.timeout}s`);
	const text = renderStatusLine({ icon: "pending", title: "Fetch", description, meta }, uiTheme);
	return new Text(text, 0, 0);
}

/** Render fetch result with tree-based layout */
export function renderFetchResult(
	result: { content: Array<{ type: string; text?: string }>; details?: FetchToolDetails },
	options: RenderResultOptions,
	uiTheme: Theme = theme,
): Component {
	const { expanded } = options;
	const details = result.details;

	if (!details) {
		return new Text(uiTheme.fg("error", "No response data"), 0, 0);
	}

	const domain = getDomain(details.finalUrl);
	const hasRedirect = details.url !== details.finalUrl;
	const hasNotes = details.notes.length > 0;
	const truncation = details.meta?.truncation;
	const truncated = Boolean(details.truncated || truncation);

	const header = renderStatusLine(
		{
			icon: truncated ? "warning" : "success",
			title: "Fetch",
			description: domain,
			meta: [details.method],
		},
		uiTheme,
	);

	const contentText = result.content[0]?.text ?? "";
	const contentBody = contentText.includes("---\n\n")
		? contentText.split("---\n\n").slice(1).join("---\n\n")
		: contentText;
	const lineCount = countNonEmptyLines(contentBody);
	const charCount = contentBody.trim().length;
	const contentLines = contentBody.split("\n").filter((l) => l.trim());

	const metadataLines: string[] = [
		`${uiTheme.fg("muted", "Content-Type:")} ${details.contentType || "unknown"}`,
		`${uiTheme.fg("muted", "Method:")} ${details.method}`,
	];
	if (hasRedirect) {
		metadataLines.push(`${uiTheme.fg("muted", "Final URL:")} ${uiTheme.fg("mdLinkUrl", details.finalUrl)}`);
	}
	const lineLabel = `${lineCount} line${lineCount === 1 ? "" : "s"}`;
	metadataLines.push(`${uiTheme.fg("muted", "Lines:")} ${lineLabel}`);
	metadataLines.push(`${uiTheme.fg("muted", "Chars:")} ${charCount}`);
	if (truncated) {
		metadataLines.push(uiTheme.fg("warning", `${uiTheme.status.warning} Output truncated`));
		if (truncation?.artifactId) {
			metadataLines.push(uiTheme.fg("warning", `Full output: artifact://${truncation.artifactId}`));
		}
	}
	if (hasNotes) {
		metadataLines.push(`${uiTheme.fg("muted", "Notes:")} ${details.notes.join("; ")}`);
	}

	const previewLimit = expanded ? 12 : 3;
	const previewList = applyListLimit(contentLines, { headLimit: previewLimit });
	const previewLines = previewList.items.map((line) => truncate(line.trim(), 120, uiTheme.format.ellipsis));
	const remaining = Math.max(0, contentLines.length - previewLines.length);
	const contentPreviewLines =
		previewLines.length > 0
			? previewLines.map((line) => uiTheme.fg("dim", line))
			: [uiTheme.fg("dim", "(no content)")];
	if (remaining > 0) {
		const hint = formatExpandHint(uiTheme, expanded, true);
		contentPreviewLines.push(
			uiTheme.fg("muted", `${uiTheme.format.ellipsis} ${remaining} more lines${hint ? ` ${hint}` : ""}`),
		);
	}

	return {
		render: (width: number) =>
			renderOutputBlock(
				{
					header,
					state: truncated ? "warning" : "success",
					sections: [
						{ label: uiTheme.fg("toolTitle", "Metadata"), lines: metadataLines },
						{ label: uiTheme.fg("toolTitle", "Content Preview"), lines: contentPreviewLines },
					],
					width,
				},
				uiTheme,
			),
		invalidate: () => {},
	};
}

export const fetchToolRenderer = {
	renderCall: renderFetchCall,
	renderResult: renderFetchResult,
};
