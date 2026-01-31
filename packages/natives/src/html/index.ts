/**
 * HTML to Markdown conversion powered by WASM.
 *
 * Conversion happens in a worker thread to avoid blocking the main thread.
 */

import { type RequestOptions, WorkerPool } from "../pool";
import { resolveWorkerSpecifier } from "../worker-resolver";
import type { HtmlRequest, HtmlResponse, HtmlToMarkdownOptions } from "./types";

export type { HtmlToMarkdownOptions } from "./types";

const pool = new WorkerPool<HtmlRequest, HtmlResponse>({
	createWorker: () =>
		new Worker(
			resolveWorkerSpecifier({
				compiled: "./packages/natives/src/html/worker.ts",
				dev: new URL("./worker.ts", import.meta.url),
			}),
		),
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
export async function htmlToMarkdown(
	html: string,
	options?: HtmlToMarkdownOptions,
	req?: RequestOptions,
): Promise<string> {
	const response = await pool.request<Extract<HtmlResponse, { type: "converted" }>>(
		{
			type: "convert",
			html,
			options,
		},
		req,
	);
	return response.markdown;
}

/**
 * Terminate the HTML worker pool.
 * Call this when shutting down to clean up resources.
 */
export function terminate(): void {
	pool.terminate();
}
