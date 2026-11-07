import { truncateToWidth, visibleWidth } from "../utils.ts";

export interface EditorSuffixFormatInput {
	readonly placeholder: string;
	readonly inlineSuggestion: string;
	readonly state: {
		readonly lines: readonly string[];
		readonly cursorLine: number;
		readonly cursorCol: number;
	};
	readonly autocompleteActive: boolean;
	readonly availableWidth: number;
	readonly style?: (text: string) => string;
}

/** Style a placeholder or inline suffix without changing document state. */
export function formatEditorSuffix(input: EditorSuffixFormatInput): { text: string; width: number } {
	const documentEmpty = input.state.lines.length === 1 && input.state.lines[0] === "";
	const cursorAtDocumentEnd =
		input.state.cursorLine === input.state.lines.length - 1 &&
		input.state.cursorCol === (input.state.lines[input.state.cursorLine] ?? "").length;
	let text = input.inlineSuggestion;
	if (documentEmpty) text = input.placeholder;
	else if (!cursorAtDocumentEnd) text = "";
	if (text.length === 0 || input.autocompleteActive || input.availableWidth <= 0) {
		return { text: "", width: 0 };
	}
	const truncated = truncateToWidth(text, input.availableWidth, "");
	const style = input.style ?? ((text: string) => `\x1b[2m${text}\x1b[22m`);
	return { text: style(truncated), width: visibleWidth(truncated) };
}
