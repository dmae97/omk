export interface SuggestionEditorPort {
	getText(): string;
	setText(text: string): void;
	setPlaceholder(text: string): void;
	isShowingAutocomplete(): boolean;
	onBeforeInput?: (data: string) => boolean;
}

/** An editor interactive mode can swap at runtime; extensions may install their own. */
export type ActiveEditor = Pick<SuggestionEditorPort, "getText" | "setText"> &
	Partial<Pick<SuggestionEditorPort, "setPlaceholder" | "isShowingAutocomplete" | "onBeforeInput">>;

/**
 * Port over whichever editor is active when it is used. An extension that swaps in its own
 * editor (pi-powerline-footer does at session start) otherwise leaves the suggestion on the
 * hidden default editor, and Tab never reaches the key hook. The hook is attached lazily to
 * the active editor and never replaces a hook another owner already installed.
 */
export function followActiveEditor(getEditor: () => ActiveEditor, basePlaceholder: string): SuggestionEditorPort {
	let hook: ((data: string) => boolean) | undefined;
	let shownOn: ActiveEditor | undefined;
	const attached = new Set<ActiveEditor>();
	const current = (): ActiveEditor => {
		const editor = getEditor();
		if (hook && editor.onBeforeInput === undefined) {
			editor.onBeforeInput = hook;
			attached.add(editor);
		}
		return editor;
	};
	return {
		getText: () => current().getText(),
		setText: (text) => current().setText(text),
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
