export type PromptRenderPhase = "pre-render" | "post-render";

export interface PromptFormatOptions {
	renderPhase?: PromptRenderPhase;
	replaceAsciiSymbols?: boolean;
	boldRfc2119Keywords?: boolean;
}

// Opening XML tag (not self-closing, not closing)
const OPENING_XML = /^<([a-z_-]+)(?:\s+[^>]*)?>$/;
// Closing XML tag
const CLOSING_XML = /^<\/([a-z_-]+)>$/;
// Handlebars block start: {{#if}}, {{#has}}, {{#list}}, etc.
const OPENING_HBS = /^\{\{#/;
// Handlebars block end: {{/if}}, {{/has}}, {{/list}}, etc.
const CLOSING_HBS = /^\{\{\//;
// List item (- or * or 1.)
const LIST_ITEM = /^(?:[-*]\s|\d+\.\s)/;
// Code fence
const CODE_FENCE = /^```/;
// Table row
const TABLE_ROW = /^\|.*\|$/;
// Table separator (|---|---|)
const TABLE_SEP = /^\|[-:\s|]+\|$/;

/** RFC 2119 keywords used in prompts. */
const RFC2119_KEYWORDS = /\b(?:MUST NOT|SHOULD NOT|SHALL NOT|RECOMMENDED|REQUIRED|OPTIONAL|SHOULD|SHALL|MUST|MAY)\b/g;

function boldRfc2119Keywords(line: string): string {
	return line.replace(RFC2119_KEYWORDS, (match, offset, source) => {
		const isAlreadyBold =
			source[offset - 2] === "*" &&
			source[offset - 1] === "*" &&
			source[offset + match.length] === "*" &&
			source[offset + match.length + 1] === "*";
		if (isAlreadyBold) {
			return match;
		}
		return `**${match}**`;
	});
}

/** Compact a table row by trimming cell padding */
function compactTableRow(line: string): string {
	const cells = line.split("|");
	return cells.map(c => c.trim()).join("|");
}

/** Compact a table separator row */
function compactTableSep(line: string): string {
	const cells = line.split("|").filter(c => c.trim());
	const normalized = cells.map(c => {
		const trimmed = c.trim();
		const left = trimmed.startsWith(":");
		const right = trimmed.endsWith(":");
		if (left && right) return ":---:";
		if (left) return ":---";
		if (right) return "---:";
		return "---";
	});
	return `|${normalized.join("|")}|`;
}

function replaceCommonAsciiSymbols(line: string): string {
	return line
		.replace(/\.{3}/g, "…")
		.replace(/<->/g, "↔")
		.replace(/->/g, "→")
		.replace(/<-/g, "←")
		.replace(/!=/g, "≠")
		.replace(/<=/g, "≤")
		.replace(/>=/g, "≥");
}

export function formatPromptContent(content: string, options: PromptFormatOptions = {}): string {
	const {
		renderPhase = "post-render",
		replaceAsciiSymbols = false,
		boldRfc2119Keywords: shouldBoldRfc2119 = false,
	} = options;
	const isPreRender = renderPhase === "pre-render";
	const lines = content.split("\n");
	const result: string[] = [];
	let inCodeBlock = false;
	const topLevelTags: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		let line = lines[i].trimEnd();
		let trimmedStart = line.trimStart();
		if (CODE_FENCE.test(trimmedStart)) {
			inCodeBlock = !inCodeBlock;
			result.push(line);
			continue;
		}

		if (inCodeBlock) {
			result.push(line);
			continue;
		}

		if (replaceAsciiSymbols) {
			line = replaceCommonAsciiSymbols(line);
		}
		trimmedStart = line.trimStart();
		const trimmed = line.trim();

		const isOpeningXml = OPENING_XML.test(trimmedStart) && !trimmedStart.endsWith("/>");
		if (isOpeningXml && line.length === trimmedStart.length) {
			const match = OPENING_XML.exec(trimmedStart);
			if (match) topLevelTags.push(match[1]);
		}

		const closingMatch = CLOSING_XML.exec(trimmedStart);
		if (closingMatch) {
			const tagName = closingMatch[1];
			if (topLevelTags.length > 0 && topLevelTags[topLevelTags.length - 1] === tagName) {
				topLevelTags.pop();
			}
		} else if (isPreRender && trimmedStart.startsWith("{{")) {
			/* keep indentation as-is in pre-render for Handlebars markers */
		} else if (TABLE_SEP.test(trimmedStart)) {
			const leadingWhitespace = line.slice(0, line.length - trimmedStart.length);
			line = `${leadingWhitespace}${compactTableSep(trimmedStart)}`;
		} else if (TABLE_ROW.test(trimmedStart)) {
			const leadingWhitespace = line.slice(0, line.length - trimmedStart.length);
			line = `${leadingWhitespace}${compactTableRow(trimmedStart)}`;
		}

		if (shouldBoldRfc2119) {
			line = boldRfc2119Keywords(line);
		}

		const isBlank = trimmed === "";
		if (isBlank) {
			const prevLine = result[result.length - 1]?.trim() ?? "";
			const nextLine = lines[i + 1]?.trim() ?? "";

			if (LIST_ITEM.test(nextLine)) {
				continue;
			}

			if (OPENING_XML.test(prevLine) || (isPreRender && OPENING_HBS.test(prevLine))) {
				continue;
			}

			if (CLOSING_XML.test(nextLine) || (isPreRender && CLOSING_HBS.test(nextLine))) {
				continue;
			}

			const prevIsBlank = prevLine === "";
			if (prevIsBlank) {
				continue;
			}
		}

		if (CLOSING_XML.test(trimmed) || (isPreRender && CLOSING_HBS.test(trimmed))) {
			while (result.length > 0 && result[result.length - 1].trim() === "") {
				result.pop();
			}
		}

		result.push(line);
	}

	while (result.length > 0 && result[result.length - 1].trim() === "") {
		result.pop();
	}

	return result.join("\n");
}
