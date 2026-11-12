import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "../utils.ts";

export interface EditorSuffixView {
	readonly placeholder: string;
	readonly inlineSuggestion: string;
	readonly state: {
		readonly lines: readonly string[];
		readonly cursorLine: number;
		readonly cursorCol: number;
	};
	readonly autocompleteActive: boolean;
	readonly style?: (text: string) => string;
}

export interface EditorSuffixFormatInput extends EditorSuffixView {
	readonly availableWidth: number;
}

const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;

function documentEmpty(state: EditorSuffixView["state"]): boolean {
	return state.lines.length === 1 && state.lines[0] === "";
}

/** Style a placeholder or inline suffix without changing document state. */
export function formatEditorSuffix(input: EditorSuffixFormatInput): { text: string; width: number } {
	const cursorAtDocumentEnd =
		input.state.cursorLine === input.state.lines.length - 1 &&
		input.state.cursorCol === (input.state.lines[input.state.cursorLine] ?? "").length;
	let text = input.inlineSuggestion;
	if (documentEmpty(input.state)) text = input.placeholder;
	else if (!cursorAtDocumentEnd) text = "";
	// Only the first line shares the cursor row; a placeholder's remaining lines render below it.
	text = text.split("\n", 1)[0] ?? "";
	if (text.length === 0 || input.autocompleteActive || input.availableWidth <= 0) {
		return { text: "", width: 0 };
	}
	const truncated = truncateToWidth(text, input.availableWidth, "");
	const style = input.style ?? dim;
	return { text: style(truncated), width: visibleWidth(truncated) };
}

/**
 * Rows after the first line of a multi-line placeholder, wrapped and padded to `width`.
 * Empty for a single-line placeholder, a non-empty document, or an open autocomplete, so
 * existing single-line placeholders render exactly as before. At most `maxRows` rows are
 * returned; when the text is longer the last row is `… +N` with the number of hidden rows.
 */
export function formatPlaceholderContinuation(view: EditorSuffixView, width: number, maxRows: number): string[] {
	const newline = view.placeholder.indexOf("\n");
	if (newline < 0 || width <= 0 || maxRows <= 0 || view.autocompleteActive || !documentEmpty(view.state)) return [];
	const wrapped = view.placeholder
		.slice(newline + 1)
		.split("\n")
		.flatMap((line) => wrapTextWithAnsi(line, width));
	const hidden = wrapped.length - maxRows;
	const rows = hidden > 0 ? [...wrapped.slice(0, maxRows - 1), `… +${hidden + 1}`] : wrapped;
	const style = view.style ?? dim;
	return rows.map((row) => {
		const text = truncateToWidth(row, width, "");
		return `${style(text)}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
	});
}
