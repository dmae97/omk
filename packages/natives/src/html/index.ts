/**
 * HTML to Markdown conversion powered by native bindings.
 */

import { native } from "../native";
import { type RequestOptions, wrapRequestOptions } from "../request-options";
import type { HtmlToMarkdownOptions } from "./types";

export type { HtmlToMarkdownOptions } from "./types";

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
	return wrapRequestOptions(() => native.htmlToMarkdown(html, options), req);
}
