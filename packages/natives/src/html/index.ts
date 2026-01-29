/**
 * HTML to Markdown conversion powered by WASM.
 *
 * Conversion happens in a worker thread to avoid blocking the main thread.
 */

import { WorkerPool } from "../pool";
import type { HtmlRequest, HtmlResponse, HtmlToMarkdownOptions } from "./types";

export type { HtmlToMarkdownOptions } from "./types";

const pool = new WorkerPool<HtmlRequest, HtmlResponse>({
	workerUrl: new URL("./worker.ts", import.meta.url).href,
	maxWorkers: 2,
	idleTimeoutMs: 30_000,
});

/**
 * Convert HTML to Markdown.
 *
 * @param html - HTML content to convert
 * @param options - Conversion options
 * @returns Markdown text
 */
export async function htmlToMarkdown(html: string, options?: HtmlToMarkdownOptions): Promise<string> {
	const response = await pool.request<Extract<HtmlResponse, { type: "converted" }>>({
		type: "convert",
		html,
		options,
	});
	return response.markdown;
}

/**
 * Terminate the HTML worker pool.
 * Call this when shutting down to clean up resources.
 */
export function terminate(): void {
	pool.terminate();
}
