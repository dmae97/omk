import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Editor } from "../src/components/editor.ts";
import { TUI } from "../src/tui.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function editor(): Editor {
	return new Editor(new TUI(new VirtualTerminal(80, 24)), defaultEditorTheme);
}

function rendered(instance: Editor): string {
	return stripVTControlCharacters(instance.render(80).join("\n"));
}

describe("Editor inline suggestion", () => {
	it("renders only at the document end and clears when the owner clears it", () => {
		const instance = editor();
		instance.setText("Run");
		instance.setInlineSuggestion(" the tests");
		assert.match(rendered(instance), /Run\s+the tests/);

		instance.handleInput("\x1b[D");
		assert.doesNotMatch(rendered(instance), /Run\s+the tests/);
		instance.handleInput("\x1b[C");
		instance.handleInput("x");
		assert.equal(instance.getText(), "Runx");
		instance.setInlineSuggestion("");
		assert.doesNotMatch(rendered(instance), /the tests/);
	});

	it("inserts programmatic suffixes as one undo unit and clears stale ghost text", () => {
		const instance = editor();
		instance.setText("Run");
		instance.insertTextAtCursor(" the tests");
		assert.equal(instance.getText(), "Run the tests");
		instance.handleInput("\x1b[45;5u");
		assert.equal(instance.getText(), "Run");

		instance.setInlineSuggestion(" again");
		instance.setText("Other");
		assert.doesNotMatch(rendered(instance), /again/);
	});
});
