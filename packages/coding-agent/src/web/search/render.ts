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
import { renderOutputBlock, renderStatusLine, renderTreeList } from "$c/tui";
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

	const providerLabel =
		provider === "anthropic"
			? "Anthropic"
			: provider === "perplexity"
				? "Perplexity"
				: provider === "exa"
					? "Exa"
					: "Unknown";
	const header = renderStatusLine(
		{
			icon: sourceCount > 0 ? "success" : "warning",
			title: "Web Search",
			description: providerLabel,
			meta: [formatCount("source", sourceCount)],
		},
		theme,
	);

	const remainingAnswer = totalAnswerLines - answerPreview.length;
	const answerLines = answerPreview.length > 0 ? answerPreview : ["No answer text returned"];
	const answerTree = renderTreeList(
		{
			items: answerLines,
			expanded: true,
			maxCollapsed: answerLines.length,
			itemType: "line",
			renderItem: (line) => (line === "No answer text returned" ? theme.fg("muted", line) : theme.fg("dim", line)),
		},
		theme,
	);
	if (remainingAnswer > 0) {
		answerTree.push(theme.fg("muted", formatMoreItems(remainingAnswer, "line", theme)));
	}

	const sourceTree = renderTreeList(
		{
			items: sources,
			expanded,
			maxCollapsed: MAX_RELATED_QUESTIONS,
			itemType: "source",
			renderItem: (src) => {
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
				if (domain) metaParts.push(theme.fg("dim", `(${domain})`));
				if (typeof src.author === "string" && src.author.trim()) metaParts.push(theme.fg("muted", src.author));
				if (age) metaParts.push(theme.fg("muted", age));
				const metaSep = theme.fg("dim", theme.sep.dot);
				const metaSuffix = metaParts.length > 0 ? ` ${metaParts.join(metaSep)}` : "";
				const lines: string[] = [`${theme.fg("accent", title)}${metaSuffix}`];
				const snippetText = typeof src.snippet === "string" ? src.snippet : "";
				if (snippetText.trim()) {
					const snippetLines = getPreviewLines(
						snippetText,
						MAX_SNIPPET_LINES,
						MAX_SNIPPET_LINE_LEN,
						theme.format.ellipsis,
					);
					for (const snippetLine of snippetLines) {
						lines.push(theme.fg("muted", `${theme.format.dash} ${snippetLine}`));
					}
				}
				if (url) lines.push(theme.fg("mdLinkUrl", url));
				return lines;
			},
		},
		theme,
	);

	const relatedLines = related.length > 0 ? related : ["No related questions"];
	const relatedTree = renderTreeList(
		{
			items: relatedLines,
			expanded: true,
			maxCollapsed: MAX_RELATED_QUESTIONS,
			itemType: "question",
			renderItem: (line) =>
				theme.fg("muted", line === "No related questions" ? line : `${theme.format.dash} ${line}`),
		},
		theme,
	);
	if (relatedCount > MAX_RELATED_QUESTIONS) {
		relatedTree.push(theme.fg("muted", formatMoreItems(relatedCount - MAX_RELATED_QUESTIONS, "question", theme)));
	}

	const metaLines: string[] = [];
	metaLines.push(`${theme.fg("muted", "Provider:")} ${theme.fg("text", providerLabel)}`);
	if (response.model) metaLines.push(`${theme.fg("muted", "Model:")} ${theme.fg("text", response.model)}`);
	metaLines.push(`${theme.fg("muted", "Sources:")} ${theme.fg("text", String(sourceCount))}`);
	if (citationCount > 0)
		metaLines.push(`${theme.fg("muted", "Citations:")} ${theme.fg("text", String(citationCount))}`);
	if (relatedCount > 0) metaLines.push(`${theme.fg("muted", "Related:")} ${theme.fg("text", String(relatedCount))}`);
	if (response.usage) {
		const usageParts: string[] = [];
		if (response.usage.inputTokens !== undefined) usageParts.push(`in ${response.usage.inputTokens}`);
		if (response.usage.outputTokens !== undefined) usageParts.push(`out ${response.usage.outputTokens}`);
		if (response.usage.totalTokens !== undefined) usageParts.push(`total ${response.usage.totalTokens}`);
		if (response.usage.searchRequests !== undefined) usageParts.push(`search ${response.usage.searchRequests}`);
		if (usageParts.length > 0)
			metaLines.push(`${theme.fg("muted", "Usage:")} ${theme.fg("text", usageParts.join(theme.sep.dot))}`);
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
		const queriesPreview = searchQueries.slice(0, MAX_QUERY_PREVIEW);
		const queryList = queriesPreview.map((q) => truncate(q, MAX_QUERY_LEN, theme.format.ellipsis));
		const suffix = searchQueries.length > queriesPreview.length ? theme.format.ellipsis : "";
		metaLines.push(`${theme.fg("muted", "Queries:")} ${theme.fg("text", queryList.join("; "))}${suffix}`);
	}

	const sections = [
		{ label: theme.fg("toolTitle", "Answer"), lines: answerTree },
		{
			label: theme.fg("toolTitle", "Sources"),
			lines: sourceTree.length > 0 ? sourceTree : [theme.fg("muted", "No sources returned")],
		},
		{ label: theme.fg("toolTitle", "Related"), lines: relatedTree },
		{ label: theme.fg("toolTitle", "Metadata"), lines: metaLines },
	];

	return {
		render: (width: number) =>
			renderOutputBlock(
				{
					header,
					state: sourceCount > 0 ? "success" : "warning",
					sections,
					width,
				},
				theme,
			),
		invalidate: () => {},
	};
}

/** Render web search call (query preview) */
export function renderWebSearchCall(
	args: { query: string; provider?: string; [key: string]: unknown },
	theme: Theme,
): Component {
	const provider = args.provider ?? "auto";
	const query = truncate(args.query, 80, theme.format.ellipsis);
	const text = renderStatusLine({ icon: "pending", title: "Web Search", description: query, meta: [provider] }, theme);
	return new Text(text, 0, 0);
}

export const webSearchToolRenderer = {
	renderCall: renderWebSearchCall,
	renderResult: renderWebSearchResult,
};
