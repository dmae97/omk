/**
 * Shared types and utilities for web-fetch handlers
 */

import { ToolAbortError } from "$c/tools/tool-errors";

export interface RenderResult {
	url: string;
	finalUrl: string;
	contentType: string;
	method: string;
	content: string;
	fetchedAt: string;
	truncated: boolean;
	notes: string[];
}

export type SpecialHandler = (url: string, timeout: number, signal?: AbortSignal) => Promise<RenderResult | null>;

export const MAX_OUTPUT_CHARS = 500_000;
const MAX_BYTES = 50 * 1024 * 1024;

const USER_AGENTS = [
	"curl/8.0",
	"Mozilla/5.0 (compatible; TextBot/1.0)",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

export interface RequestSignal {
	signal: AbortSignal;
	cleanup: () => void;
}

export function createRequestSignal(timeoutMs: number, signal?: AbortSignal): RequestSignal {
	const controller = new AbortController();
	let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), timeoutMs);
	const abortHandler = () => controller.abort();

	if (signal) {
		if (signal.aborted) {
			clearTimeout(timeoutId);
			timeoutId = undefined;
			controller.abort();
		} else {
			signal.addEventListener("abort", abortHandler, { once: true });
		}
	}

	const cleanup = () => {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
			timeoutId = undefined;
		}
		if (signal) {
			signal.removeEventListener("abort", abortHandler);
		}
	};

	return { signal: controller.signal, cleanup };
}

function isBotBlocked(status: number, content: string): boolean {
	if (status === 403 || status === 503) {
		const lower = content.toLowerCase();
		return (
			lower.includes("cloudflare") ||
			lower.includes("captcha") ||
			lower.includes("challenge") ||
			lower.includes("blocked") ||
			lower.includes("access denied") ||
			lower.includes("bot detection")
		);
	}
	return false;
}

/**
 * Truncate and cleanup output
 */
export function finalizeOutput(content: string): { content: string; truncated: boolean } {
	const cleaned = content.replace(/\n{3,}/g, "\n\n").trim();
	const truncated = cleaned.length > MAX_OUTPUT_CHARS;
	return {
		content: cleaned.slice(0, MAX_OUTPUT_CHARS),
		truncated,
	};
}

export interface LoadPageOptions {
	timeout?: number;
	headers?: Record<string, string>;
	method?: string;
	body?: string;
	maxBytes?: number;
	signal?: AbortSignal;
}

export interface LoadPageResult {
	content: string;
	contentType: string;
	finalUrl: string;
	ok: boolean;
	status?: number;
}

/**
 * Fetch a page with timeout and size limit
 */
export async function loadPage(url: string, options: LoadPageOptions = {}): Promise<LoadPageResult> {
	const { timeout = 20, headers = {}, maxBytes = MAX_BYTES, signal, method = "GET", body } = options;

	for (let attempt = 0; attempt < USER_AGENTS.length; attempt++) {
		if (signal?.aborted) {
			throw new ToolAbortError();
		}

		const userAgent = USER_AGENTS[attempt];
		const { signal: requestSignal, cleanup } = createRequestSignal(timeout * 1000, signal);

		try {
			const requestInit: RequestInit = {
				signal: requestSignal,
				method,
				headers: {
					"User-Agent": userAgent,
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"Accept-Language": "en-US,en;q=0.5",
					...headers,
				},
				redirect: "follow",
			};

			if (body !== undefined) {
				requestInit.body = body;
			}

			const response = await fetch(url, requestInit);

			const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
			const finalUrl = response.url;

			const reader = response.body?.getReader();
			if (!reader) {
				return { content: "", contentType, finalUrl, ok: false, status: response.status };
			}

			const chunks: Uint8Array[] = [];
			let totalSize = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				chunks.push(value);
				totalSize += value.length;

				if (totalSize > maxBytes) {
					reader.cancel();
					break;
				}
			}

			const content = Buffer.concat(chunks).toString("utf-8");
			if (isBotBlocked(response.status, content) && attempt < USER_AGENTS.length - 1) {
				continue;
			}

			if (!response.ok) {
				return { content, contentType, finalUrl, ok: false, status: response.status };
			}

			return { content, contentType, finalUrl, ok: true, status: response.status };
		} catch {
			if (signal?.aborted) {
				throw new ToolAbortError();
			}
			if (attempt === USER_AGENTS.length - 1) {
				return { content: "", contentType: "", finalUrl: url, ok: false };
			}
		} finally {
			cleanup();
		}
	}

	return { content: "", contentType: "", finalUrl: url, ok: false };
}

/**
 * Format large numbers (1000 -> 1K, 1000000 -> 1M)
 */
export function formatCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

/**
 * Convert basic HTML to markdown
 */
export function htmlToBasicMarkdown(html: string): string {
	return html
		.replace(/<pre><code[^>]*>/g, "\n```\n")
		.replace(/<\/code><\/pre>/g, "\n```\n")
		.replace(/<code>/g, "`")
		.replace(/<\/code>/g, "`")
		.replace(/<strong>/g, "**")
		.replace(/<\/strong>/g, "**")
		.replace(/<b>/g, "**")
		.replace(/<\/b>/g, "**")
		.replace(/<em>/g, "*")
		.replace(/<\/em>/g, "*")
		.replace(/<i>/g, "*")
		.replace(/<\/i>/g, "*")
		.replace(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g, "[$2]($1)")
		.replace(/<p>/g, "\n\n")
		.replace(/<\/p>/g, "")
		.replace(/<br\s*\/?>/g, "\n")
		.replace(/<li>/g, "- ")
		.replace(/<\/li>/g, "\n")
		.replace(/<\/?[uo]l>/g, "\n")
		.replace(/<h(\d)>/g, (_, n) => `\n${"#".repeat(parseInt(n, 10))} `)
		.replace(/<\/h\d>/g, "\n")
		.replace(/<blockquote>/g, "\n> ")
		.replace(/<\/blockquote>/g, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
