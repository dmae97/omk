/**
 * Types for HTML to Markdown conversion.
 */

/** Options controlling HTML preprocessing and output. */
export interface HtmlToMarkdownOptions {
	/** Remove navigation elements, forms, headers, and footers. */
	cleanContent?: boolean;
	/** Skip images during conversion. */
	skipImages?: boolean;
}

declare module "../bindings" {
	/** Native HTML utilities exposed by the Rust bindings. */
	interface NativeBindings {
		/**
		 * Convert HTML to Markdown.
		 * @param html HTML source to convert.
		 * @param options Optional conversion settings.
		 * @returns Markdown output.
		 */
		htmlToMarkdown(html: string, options?: HtmlToMarkdownOptions | null): Promise<string>;
	}
}
