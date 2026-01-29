/**
 * Types for HTML to Markdown worker communication.
 */

export interface HtmlToMarkdownOptions {
	/** Remove navigation elements, forms, headers, footers */
	cleanContent?: boolean;
	/** Skip images during conversion */
	skipImages?: boolean;
}

export type HtmlRequest =
	| { type: "init"; id: number }
	| { type: "destroy" }
	| {
			type: "convert";
			id: number;
			html: string;
			options?: HtmlToMarkdownOptions;
	  };

export type HtmlResponse =
	| { type: "ready"; id: number }
	| { type: "error"; id: number; error: string }
	| { type: "converted"; id: number; markdown: string };
