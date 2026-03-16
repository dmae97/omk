import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EditorKeybindingsManager, setEditorKeybindings } from "../../tui/src/keybindings";
import { KeybindingsManager } from "../src/config/keybindings";
import { createPromptActionAutocompleteProvider } from "../src/modes/prompt-action-autocomplete";

describe("prompt action autocomplete", () => {
	beforeEach(() => {
		setEditorKeybindings(
			new EditorKeybindingsManager({
				cursorLineStart: ["home", "f6"],
				cursorLineEnd: "f7",
				undo: "f8",
			}),
		);
	});

	afterEach(() => {
		setEditorKeybindings(new EditorKeybindingsManager());
	});

	it("shows prompt actions with configured shortcut hints", async () => {
		const provider = createPromptActionAutocompleteProvider({
			commands: [],
			basePath: "/tmp",
			keybindings: KeybindingsManager.inMemory({
				copyLine: "ctrl+shift+l",
				copyPrompt: ["alt+shift+c", "ctrl+shift+c"],
			}),
			copyCurrentLine: () => {},
			copyPrompt: () => {},
			undo: () => {},
			moveCursorToMessageEnd: () => {},
			moveCursorToMessageStart: () => {},
			moveCursorToLineStart: () => {},
			moveCursorToLineEnd: () => {},
		});

		const suggestions = await provider.getSuggestions(["#"], 0, 1);
		expect(suggestions).not.toBeNull();
		expect(suggestions?.prefix).toBe("#");
		expect(suggestions?.items.map(item => item.label)).toEqual([
			"Copy current line",
			"Copy whole prompt",
			"Undo",
			"Move cursor to end of message",
			"Move cursor to beginning of message",
			"Move cursor to beginning of line",
			"Move cursor to end of line",
		]);
		expect(suggestions?.items.find(item => item.label === "Copy current line")?.description).toBe("Ctrl+Shift+L");
		expect(suggestions?.items.find(item => item.label === "Copy whole prompt")?.description).toBe(
			"Alt+Shift+C/Ctrl+Shift+C",
		);
		expect(suggestions?.items.find(item => item.label === "Move cursor to beginning of line")?.description).toBe(
			"Home/F6",
		);
		expect(suggestions?.items.find(item => item.label === "Move cursor to end of line")?.description).toBe("F7");
		expect(suggestions?.items.find(item => item.label === "Undo")?.description).toBe("F8");
	});

	it("passes the typed trigger to undo and leaves text removal to the editor", async () => {
		let undoCalls = 0;
		let undoPrefix = "";
		const provider = createPromptActionAutocompleteProvider({
			commands: [],
			basePath: "/tmp",
			keybindings: KeybindingsManager.inMemory(),
			copyCurrentLine: () => {},
			copyPrompt: () => {},
			undo: prefix => {
				undoCalls += 1;
				undoPrefix = prefix;
			},
			moveCursorToMessageEnd: () => {},
			moveCursorToMessageStart: () => {},
			moveCursorToLineStart: () => {},
			moveCursorToLineEnd: () => {},
		});

		const suggestions = await provider.getSuggestions(["hello #undo"], 0, 11);
		const item = suggestions?.items.find(entry => entry.label === "Undo");
		expect(item).toBeDefined();
		if (!item || !suggestions) {
			throw new Error("expected undo suggestion");
		}

		const result = provider.applyCompletion(["hello #undo"], 0, 11, item, suggestions.prefix);
		expect(result.lines).toEqual(["hello #undo"]);
		expect(result.cursorLine).toBe(0);
		expect(result.cursorCol).toBe(11);
		result.onApplied?.();
		expect(undoCalls).toBe(1);
		expect(undoPrefix).toBe("#undo");
	});

	it("falls back to normal typing for literal hashtags with no matching action", async () => {
		const provider = createPromptActionAutocompleteProvider({
			commands: [],
			basePath: "/tmp",
			keybindings: KeybindingsManager.inMemory(),
			copyCurrentLine: () => {},
			copyPrompt: () => {},
			undo: () => {},
			moveCursorToMessageEnd: () => {},
			moveCursorToMessageStart: () => {},
			moveCursorToLineStart: () => {},
			moveCursorToLineEnd: () => {},
		});

		const suggestions = await provider.getSuggestions(["release #v1"], 0, 11);
		expect(suggestions).toBeNull();
	});
});
