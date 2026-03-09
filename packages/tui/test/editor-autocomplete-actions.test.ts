import { describe, expect, it } from "bun:test";
import type { AutocompleteItem, AutocompleteProvider } from "@oh-my-pi/pi-tui/autocomplete";
import { Editor } from "@oh-my-pi/pi-tui/components/editor";
import { defaultEditorTheme } from "./test-themes";

class HashActionProvider implements AutocompleteProvider {
	async getSuggestions(
		lines: string[],
		_cursorLine: number,
		cursorCol: number,
	): Promise<{ items: AutocompleteItem[]; prefix: string } | null> {
		const prefix = (lines[0] || "").slice(0, cursorCol);
		if (prefix !== "#") {
			return null;
		}

		return {
			prefix,
			items: [{ value: "action", label: "Do action" }],
		};
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		_item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number; onApplied?: () => void } {
		const line = lines[cursorLine] || "";
		return {
			lines: [line.slice(0, cursorCol - prefix.length) + line.slice(cursorCol)],
			cursorLine,
			cursorCol: cursorCol - prefix.length,
			onApplied: () => {
				this.calls += 1;
			},
		};
	}

	calls = 0;
}

describe("Editor hash autocomplete actions", () => {
	it("auto-triggers # suggestions and runs autocomplete callbacks on selection", async () => {
		const provider = new HashActionProvider();
		const editor = new Editor(defaultEditorTheme);
		editor.setAutocompleteProvider(provider);

		editor.handleInput("#");
		await Bun.sleep(0);
		editor.handleInput("\r");

		expect(editor.getText()).toBe("");
		expect(provider.calls).toBe(1);
	});
});
