/**
 * Web Search TUI Rendering
 *
 * Tree-based rendering with collapsed/expanded states for web search results.
 */

import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import type { Theme } from "$c/modes/theme/theme";
import {
	formatAge,
	formatCount,
	formatExpandHint,
	formatMoreItems,
	formatStatusIcon,
	getDomain,
	getPreviewLines,
	PREVIEW_LIMITS,
	TRUNCATE_LENGTHS,
	truncate,
} from "$c/tools/render-utils";
import type { WebSearchResponse } from "./types";

const MAX_COLLAPSED_ANSWER_LINES = PREVIEW_LIMITS.COLLAPSED_LINES;
const MAX_EXPANDED_ANSWER_LINES = PREVIEW_LIMITS.EXPANDED_LINES;
const MAX_ANSWER_LINE_LEN = TRUNCATE_LENGTHS.LINE;
const MAX_SNIPPET_LINES = 2;
const MAX_SNIPPET_LINE_LEN = TRUNCATE_LENGTHS.LINE;
const MAX_RELATED_QUESTIONS = 6;
const MAX_QUERY_PREVIEW = 2;
const MAX_QUERY_LEN = 90;
const MAX_REQUEST_ID_LEN = 36;

function renderFallbackText(contentText: string, expanded: boolean, theme: Theme): Component {
	const lines = contentText.split("\n").filter((line) => line.trim());
	const maxLines = expanded ? lines.length : 6;
	const displayLines = lines.slice(0, maxLines).map((line) => truncate(line.trim(), 110, theme.format.ellipsis));
	const remaining = lines.length - displayLines.length;

	const headerIcon = formatStatusIcon("warning", theme);
	const expandHint = formatExpandHint(theme, expanded, remaining > 0);
	let text = `${headerIcon} ${theme.fg("dim", "Response")}${expandHint}`;

	if (displayLines.length === 0) {
		text += `\n ${theme.fg("dim", theme.tree.last)} ${theme.fg("muted", "No response data")}`;
		return new Text(text, 0, 0);
	}

	for (let i = 0; i < displayLines.length; i++) {
		const isLast = i === displayLines.length - 1 && remaining === 0;
		const branch = isLast ? theme.tree.last : theme.tree.branch;
		text += `\n ${theme.fg("dim", branch)} ${theme.fg("dim", displayLines[i])}`;
	}

	if (!expanded && remaining > 0) {
		text += `\n ${theme.fg("dim", theme.tree.last)} ${theme.fg("muted", formatMoreItems(remaining, "line", theme))}`;
	}

	return new Text(text, 0, 0);
}

export interface WebSearchRenderDetails {
	response: WebSearchResponse;
	error?: string;
}

/** Render web search result with tree-based layout */
export function renderWebSearchResult(
	result: { content: Array<{ type: string; text?: string }>; details?: WebSearchRenderDetails },
	options: RenderResultOptions,
	theme: Theme,
): Component {
	const { expanded } = options;
	const details = result.details;

	// Handle error case
	if (details?.error) {
		return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
	}

	const rawText = result.content?.find((block) => block.type === "text")?.text?.trim() ?? "";
	const response = details?.response;
	if (!response) {
		return renderFallbackText(rawText, expanded, theme);
	}

	const sources = Array.isArray(response.sources) ? response.sources : [];
	const sourceCount = sources.length;
	const citations = Array.isArray(response.citations) ? response.citations : [];
	const citationCount = citations.length;
	const related = Array.isArray(response.relatedQuestions)
		? response.relatedQuestions.filter((item) => typeof item === "string")
		: [];
	const relatedCount = related.length;
	const searchQueries = Array.isArray(response.searchQueries)
		? response.searchQueries.filter((item) => typeof item === "string")
		: [];
	const provider = response.provider;

	// Get answer text
	const answerText = typeof response.answer === "string" ? response.answer.trim() : "";
	const contentText = answerText || rawText;
	const totalAnswerLines = contentText ? contentText.split("\n").filter((l) => l.trim()).length : 0;
	const answerLimit = expanded ? MAX_EXPANDED_ANSWER_LINES : MAX_COLLAPSED_ANSWER_LINES;
	const answerPreview = contentText
		? getPreviewLines(contentText, answerLimit, MAX_ANSWER_LINE_LEN, theme.format.ellipsis)
		: [];

	// Build header: status icon Web Search (provider) · counts
	const providerLabel =
		provider === "anthropic"
			? "Anthropic"
			: provider === "perplexity"
				? "Perplexity"
				: provider === "exa"
					? "Exa"
					: "Unknown";
	const headerIcon = formatStatusIcon(sourceCount > 0 ? "success" : "warning", theme);
	const hasMore =
		totalAnswerLines > answerPreview.length ||
		sourceCount > 0 ||
		citationCount > 0 ||
		relatedCount > 0 ||
		searchQueries.length > 0;
	const expandHint = formatExpandHint(theme, expanded, hasMore);
	let text = `${headerIcon} ${theme.fg("dim", `(${providerLabel})`)}${theme.sep.dot}${theme.fg(
		"dim",
		formatCount("source", sourceCount),
	)}${expandHint}`;

	if (!expanded) {
		const answerTitle = `${theme.fg("accent", theme.status.info)} ${theme.fg("accent", "Answer")}`;
		text += `\n ${theme.fg("dim", theme.tree.branch)} ${answerTitle}`;

		const remaining = totalAnswerLines - answerPreview.length;
		const allLines: Array<{ text: string; style: "dim" | "muted" }> = [];

		if (answerPreview.length === 0) {
			allLines.push({ text: "No answer text returned", style: "muted" });
		} else {
			for (const line of answerPreview) {
				allLines.push({ text: line, style: "dim" });
			}
		}
		if (remaining > 0) {
			allLines.push({ text: formatMoreItems(remaining, "line", theme), style: "muted" });
		}

		for (let i = 0; i < allLines.length; i++) {
			const { text: lineText, style } = allLines[i];
			const isLastLine = i === allLines.length - 1;
			const lineBranch = isLastLine ? theme.tree.last : theme.tree.branch;
			text += `\n ${theme.fg("dim", theme.tree.vertical)} ${theme.fg("dim", lineBranch)} ${theme.fg(style, lineText)}`;
		}

		const summary = [
			formatCount("source", sourceCount),
			formatCount("citation", citationCount),
			formatCount("related question", relatedCount),
		].join(theme.sep.dot);
		text += `\n ${theme.fg("dim", theme.tree.last)} ${theme.fg("muted", summary)}`;
		return new Text(text, 0, 0);
	}

	const answerLines = answerPreview.length > 0 ? answerPreview : ["No answer text returned"];
	const answerSectionLines = answerLines.map((line) =>
		line === "No answer text returned" ? theme.fg("muted", line) : theme.fg("text", line),
	);
	const remainingAnswer = totalAnswerLines - answerPreview.length;
	if (remainingAnswer > 0) {
		answerSectionLines.push(theme.fg("muted", formatMoreItems(remainingAnswer, "line", theme)));
	}

	const sourceLines: string[] = [];
	if (sourceCount === 0) {
		sourceLines.push(theme.fg("muted", "No sources returned"));
	} else {
		for (const src of sources) {
			const titleText =
				typeof src.title === "string" && src.title.trim()
					? src.title
					: typeof src.url === "string" && src.url.trim()
						? src.url
						: "Untitled";
			const title = truncate(titleText, 70, theme.format.ellipsis);
			const url = typeof src.url === "string" ? src.url : "";
			const domain = url ? getDomain(url) : "";
			const age = formatAge(src.ageSeconds) || (typeof src.publishedDate === "string" ? src.publishedDate : "");
			const metaParts: string[] = [];
			if (domain) {
				metaParts.push(theme.fg("dim", `(${domain})`));
			}
			if (typeof src.author === "string" && src.author.trim()) {
				metaParts.push(theme.fg("muted", src.author));
			}
			if (age) {
				metaParts.push(theme.fg("muted", age));
			}
			const metaSep = theme.fg("dim", theme.sep.dot);
			const metaSuffix = metaParts.length > 0 ? ` ${metaParts.join(metaSep)}` : "";
			sourceLines.push(`${theme.fg("accent", title)}${metaSuffix}`);

			const snippetText = typeof src.snippet === "string" ? src.snippet : "";
			if (snippetText.trim()) {
				const snippetLines = getPreviewLines(
					snippetText,
					MAX_SNIPPET_LINES,
					MAX_SNIPPET_LINE_LEN,
					theme.format.ellipsis,
				);
				for (const snippetLine of snippetLines) {
					sourceLines.push(theme.fg("muted", `${theme.format.dash} ${snippetLine}`));
				}
			}

			if (url) {
				sourceLines.push(theme.fg("mdLinkUrl", url));
			}
		}
	}

	const relatedLines: string[] = [];
	if (relatedCount === 0) {
		relatedLines.push(theme.fg("muted", "No related questions"));
	} else {
		const maxRelated = Math.min(MAX_RELATED_QUESTIONS, related.length);
		for (let i = 0; i < maxRelated; i++) {
			relatedLines.push(theme.fg("muted", `${theme.format.dash} ${related[i]}`));
		}
		if (relatedCount > maxRelated) {
			relatedLines.push(theme.fg("muted", formatMoreItems(relatedCount - maxRelated, "question", theme)));
		}
	}

	const metaLines: string[] = [];
	metaLines.push(`${theme.fg("muted", "Provider:")} ${theme.fg("text", providerLabel)}`);
	if (response.model) {
		metaLines.push(`${theme.fg("muted", "Model:")} ${theme.fg("text", response.model)}`);
	}
	metaLines.push(`${theme.fg("muted", "Sources:")} ${theme.fg("text", String(sourceCount))}`);
	if (citationCount > 0) {
		metaLines.push(`${theme.fg("muted", "Citations:")} ${theme.fg("text", String(citationCount))}`);
	}
	if (relatedCount > 0) {
		metaLines.push(`${theme.fg("muted", "Related:")} ${theme.fg("text", String(relatedCount))}`);
	}
	if (response.usage) {
		const usageParts: string[] = [];
		if (response.usage.inputTokens !== undefined) usageParts.push(`in ${response.usage.inputTokens}`);
		if (response.usage.outputTokens !== undefined) usageParts.push(`out ${response.usage.outputTokens}`);
		if (response.usage.totalTokens !== undefined) usageParts.push(`total ${response.usage.totalTokens}`);
		if (response.usage.searchRequests !== undefined) usageParts.push(`search ${response.usage.searchRequests}`);
		if (usageParts.length > 0) {
			metaLines.push(`${theme.fg("muted", "Usage:")} ${theme.fg("text", usageParts.join(theme.sep.dot))}`);
		}
	}
	if (response.requestId) {
		metaLines.push(
			`${theme.fg("muted", "Request:")} ${theme.fg(
				"text",
				truncate(response.requestId, MAX_REQUEST_ID_LEN, theme.format.ellipsis),
			)}`,
		);
	}
	if (searchQueries.length > 0) {
		metaLines.push(`${theme.fg("muted", "Search queries:")} ${theme.fg("text", String(searchQueries.length))}`);
		const queryPreview = searchQueries.slice(0, MAX_QUERY_PREVIEW);
		for (const q of queryPreview) {
			metaLines.push(theme.fg("muted", `${theme.format.dash} ${truncate(q, MAX_QUERY_LEN, theme.format.ellipsis)}`));
		}
		if (searchQueries.length > MAX_QUERY_PREVIEW) {
			metaLines.push(theme.fg("muted", formatMoreItems(searchQueries.length - MAX_QUERY_PREVIEW, "query", theme)));
		}
	}

	const sections: Array<{ title: string; icon: string; lines: string[] }> = [
		{
			title: "Answer",
			icon: formatStatusIcon("info", theme),
			lines: answerSectionLines,
		},
		{
			title: "Sources",
			icon: formatStatusIcon(sourceCount > 0 ? "success" : "warning", theme),
			lines: sourceLines,
		},
		{
			title: "Related",
			icon: formatStatusIcon(relatedCount > 0 ? "info" : "warning", theme),
			lines: relatedLines,
		},
		{
			title: "Meta",
			icon: formatStatusIcon("info", theme),
			lines: metaLines,
		},
	];

	for (let i = 0; i < sections.length; i++) {
		const section = sections[i];
		const isLast = i === sections.length - 1;
		const branch = isLast ? theme.tree.last : theme.tree.branch;
		const indent = isLast ? "  " : `${theme.tree.vertical} `;

		text += `\n ${theme.fg("dim", branch)} ${section.icon} ${theme.fg("accent", section.title)}`;
		for (let j = 0; j < section.lines.length; j++) {
			const line = section.lines[j];
			const isLastLine = j === section.lines.length - 1;
			const lineBranch = isLastLine ? theme.tree.last : theme.tree.branch;
			text += `\n ${theme.fg("dim", indent)}${theme.fg("dim", lineBranch)} ${line}`;
		}
	}

	return new Text(text, 0, 0);
}

/** Render web search call (query preview) */
export function renderWebSearchCall(
	args: { query: string; provider?: string; [key: string]: unknown },
	theme: Theme,
): Component {
	const provider = args.provider ?? "auto";
	const query = truncate(args.query, 80, theme.format.ellipsis);
	const text = `${theme.fg("toolTitle", "Web Search")} ${theme.fg("dim", `(${provider})`)} ${theme.fg("muted", query)}`;
	return new Text(text, 0, 0);
}

export const webSearchToolRenderer = {
	renderCall: renderWebSearchCall,
	renderResult: renderWebSearchResult,
};
