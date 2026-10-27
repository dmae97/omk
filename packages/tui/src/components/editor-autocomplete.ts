import { SelectList, type SelectListLayoutOptions, type SelectListTheme } from "./select-list.ts";

const SLASH_COMMAND_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 32,
};
const ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS = 20;

export interface AutocompleteSnapshot {
	readonly text: string;
	readonly line: number;
	readonly col: number;
	readonly requestId: number;
}

/** Display and final acceptance use the same text/cursor/request identity check. */
export function autocompleteSnapshotMatches(snapshot: AutocompleteSnapshot, current: AutocompleteSnapshot): boolean {
	return (
		snapshot.requestId === current.requestId &&
		snapshot.text === current.text &&
		snapshot.line === current.line &&
		snapshot.col === current.col
	);
}

/** Create the list and select the exact or first prefix match without mutating the editor. */
export function buildAutocompleteList(
	prefix: string,
	items: Array<{ value: string; label: string; description?: string }>,
	maxVisible: number,
	theme: SelectListTheme,
): SelectList {
	const list = new SelectList(
		items,
		maxVisible,
		theme,
		prefix.startsWith("/") ? SLASH_COMMAND_SELECT_LIST_LAYOUT : undefined,
	);
	const bestMatchIndex = bestAutocompleteMatchIndex(items, prefix);
	if (bestMatchIndex >= 0) list.setSelectedIndex(bestMatchIndex);
	return list;
}

export function autocompleteDebounceMs(
	options: { readonly force: boolean; readonly explicitTab: boolean },
	textBeforeCursor: string,
): number {
	if (options.explicitTab || options.force) return 0;
	return /(?:^|[ \t])(?:@(?:"[^"]*"|[^\s]*)|#[^\s]*)$/.test(textBeforeCursor)
		? ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS
		: 0;
}

export function bestAutocompleteMatchIndex(items: Array<{ value: string; label: string }>, prefix: string): number {
	if (!prefix) return -1;
	let firstPrefixIndex = -1;
	for (let index = 0; index < items.length; index++) {
		const value = items[index]?.value;
		if (value === prefix) return index;
		if (firstPrefixIndex === -1 && value?.startsWith(prefix)) firstPrefixIndex = index;
	}
	return firstPrefixIndex;
}
