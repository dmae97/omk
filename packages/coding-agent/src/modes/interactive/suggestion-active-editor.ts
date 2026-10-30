export interface SuggestionEditorCursor {
	readonly line: number;
	readonly col: number;
}

export interface SuggestionEditorPort {
	getText(): string;
	setText(text: string): void;
	setPlaceholder(text: string): void;
	setInlineSuggestion?(text: string): void;
	getCursor?(): SuggestionEditorCursor | undefined;
	insertTextAtCursor?(text: string): void;
	isShowingAutocomplete(): boolean;
	onBeforeInput?: (data: string) => boolean;
}

/** An editor interactive mode can swap at runtime; extensions may install their own. */
export type ActiveEditor = Pick<SuggestionEditorPort, "getText" | "setText"> &
	Partial<
		Pick<
			SuggestionEditorPort,
			| "setPlaceholder"
			| "setInlineSuggestion"
			| "getCursor"
			| "insertTextAtCursor"
			| "isShowingAutocomplete"
			| "onBeforeInput"
		>
	>;

/**
 * Port over whichever editor is active when it is used. An extension that swaps in its own
 * editor (pi-powerline-footer does at session start) otherwise leaves the suggestion on the
 * hidden default editor, and Tab never reaches the key hook. The hook is attached lazily to
 * the active editor and never replaces a hook another owner already installed.
 */
export function followActiveEditor(getEditor: () => ActiveEditor, basePlaceholder: string): SuggestionEditorPort {
	let hook: ((data: string) => boolean) | undefined;
	let shownOn: ActiveEditor | undefined;
	let inlineShownOn: ActiveEditor | undefined;
	const attached = new Set<ActiveEditor>();
	const current = (): ActiveEditor => {
		const editor = getEditor();
		if (inlineShownOn && inlineShownOn !== editor) {
			inlineShownOn.setInlineSuggestion?.("");
			inlineShownOn = undefined;
		}
		if (hook && editor.onBeforeInput === undefined) {
			editor.onBeforeInput = hook;
			attached.add(editor);
		}
		return editor;
	};
	return {
		getText: () => current().getText(),
		setText: (text) => {
			if (inlineShownOn) {
				inlineShownOn.setInlineSuggestion?.("");
				inlineShownOn = undefined;
			}
			current().setText(text);
		},
		getCursor: () => current().getCursor?.(),
		insertTextAtCursor: (text) => {
			const editor = current();
			if (editor.insertTextAtCursor) editor.insertTextAtCursor(text);
			else editor.setText(editor.getText() + text);
		},
		setInlineSuggestion: (text) => {
			const editor = current();
			if (inlineShownOn && inlineShownOn !== editor) inlineShownOn.setInlineSuggestion?.("");
			editor.setInlineSuggestion?.(text);
			inlineShownOn = text.length > 0 ? editor : undefined;
		},
		isShowingAutocomplete: () => current().isShowingAutocomplete?.() ?? false,
		setPlaceholder: (text) => {
			const editor = current();
			if (shownOn && shownOn !== editor) shownOn.setPlaceholder?.(basePlaceholder);
			editor.setPlaceholder?.(text);
			shownOn = text === basePlaceholder ? undefined : editor;
		},
		get onBeforeInput() {
			return hook;
		},
		set onBeforeInput(next) {
			for (const editor of attached) {
				if (editor.onBeforeInput === hook) editor.onBeforeInput = next;
			}
			if (!next) attached.clear();
			hook = next;
			if (next) current();
		},
	};
}
