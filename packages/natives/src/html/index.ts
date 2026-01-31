/**
 * HTML to Markdown conversion powered by native bindings.
 */

import { native } from "../native";
import type { RequestOptions } from "../request-options";
import type { HtmlToMarkdownOptions } from "./types";

export type { HtmlToMarkdownOptions } from "./types";

function assertRequest(req?: RequestOptions): void {
	req?.signal?.throwIfAborted();
}

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
	assertRequest(req);
	return native.htmlToMarkdown(html, options);
}

/**
 * Terminate HTML resources (no-op for native bindings).
 */
export function terminate(): void {}
