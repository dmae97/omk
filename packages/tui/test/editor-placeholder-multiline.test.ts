import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Editor } from "../src/components/editor.ts";
import { formatPlaceholderContinuation } from "../src/components/editor-inline-suggestion.ts";
import { TUI } from "../src/tui.ts";
import { visibleWidth } from "../src/utils.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const plain = (lines: readonly string[]) => lines.map((line) => stripVTControlCharacters(line).trimEnd());

describe("multi-line editor placeholder", () => {
	it("leaves a single-line placeholder at exactly one editor row", () => {
		const editor = new Editor(new TUI(new VirtualTerminal(60, 30)), defaultEditorTheme);
		const empty = editor.render(60).length;
		editor.setPlaceholder("Ask anything");
		assert.strictEqual(editor.render(60).length, empty);
	});

	it("renders every line below the cursor row, in order, within the width, and hides it once typing starts", () => {
		const editor = new Editor(new TUI(new VirtualTerminal(40, 40)), defaultEditorTheme);
		editor.setPlaceholder(
			"Title line\n## Input\n- a fairly long item that has to wrap across rows\n## Result\n- done",
		);
		const lines = editor.render(40);
		for (const line of lines) assert.ok(visibleWidth(line) <= 40, JSON.stringify(line));
		const text = plain(lines);
		const at = (needle: string) => text.findIndex((line) => line.includes(needle));
		assert.ok(at("Title line") > 0);
		assert.ok(
			at("Title line") < at("## Input") && at("## Input") < at("## Result") && at("## Result") < at("- done"),
		);
		assert.ok(!text.some((line) => line.includes("Title line") && line.includes("## Input")));
		editor.handleInput("x");
		assert.ok(!plain(editor.render(40)).some((line) => line.includes("## Input")));
	});

	it("caps the continuation and reports the hidden rows", () => {
		const view = {
			placeholder: ["title", ...Array.from({ length: 10 }, (_, index) => `row ${index}`)].join("\n"),
			inlineSuggestion: "",
			state: { lines: [""], cursorLine: 0, cursorCol: 0 },
			autocompleteActive: false,
			style: (text: string) => text,
		};
		const rows = formatPlaceholderContinuation(view, 20, 4).map((row) => row.trimEnd());
		assert.deepStrictEqual(rows, ["row 0", "row 1", "row 2", "… +7"]);
		assert.deepStrictEqual(formatPlaceholderContinuation({ ...view, autocompleteActive: true }, 20, 4), []);
		assert.deepStrictEqual(
			formatPlaceholderContinuation({ ...view, state: { lines: ["x"], cursorLine: 0, cursorCol: 1 } }, 20, 4),
			[],
		);
	});
});
