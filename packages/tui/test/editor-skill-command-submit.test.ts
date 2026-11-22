import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { TUI } from "../src/tui.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function editorWithCommands() {
	const editor = new Editor(new TUI(new VirtualTerminal(80, 24)), defaultEditorTheme);
	editor.setAutocompleteProvider(
		new CombinedAutocompleteProvider([{ name: "skill:programming" }, { name: "help" }], process.cwd()),
	);
	const submitted: string[] = [];
	editor.onSubmit = (text) => submitted.push(text);
	return { editor, submitted };
}

async function flushAutocomplete() {
	await Promise.resolve();
	await new Promise((resolve) => setImmediate(resolve));
}

describe("skill selection does not submit the prompt", () => {
	for (const prefix of ["/prog", "/skill:prog", "!prog"]) {
		it(`keeps ${prefix} in the editor until the request is written`, async () => {
			const { editor, submitted } = editorWithCommands();
			editor.handleInput(prefix);
			await flushAutocomplete();
			assert.equal(editor.isShowingAutocomplete(), true);
			editor.handleInput("\r");
			assert.deepEqual(submitted, []);
			const invocation = prefix.startsWith("!") ? "!skill:programming " : "/skill:programming ";
			assert.equal(editor.getText(), invocation);
			editor.handleInput("Keep this request intact.");
			await flushAutocomplete();
			editor.handleInput("\r");
			assert.deepEqual(submitted, [`${invocation}Keep this request intact.`]);
		});
	}

	it("keeps an existing request when selecting a mid-message slash skill", async () => {
		const { editor, submitted } = editorWithCommands();
		editor.handleInput("Keep this request /prog");
		await flushAutocomplete();
		assert.equal(editor.isShowingAutocomplete(), true);
		editor.handleInput("\r");
		assert.deepEqual(submitted, []);
		assert.equal(editor.getText(), "!skill:programming Keep this request");
		editor.handleInput("\r");
		assert.deepEqual(submitted, ["!skill:programming Keep this request"]);
	});

	it("still submits ordinary slash commands on selection", async () => {
		const { editor, submitted } = editorWithCommands();
		editor.handleInput("/hel");
		await flushAutocomplete();
		editor.handleInput("\r");
		assert.deepEqual(submitted, ["/help"]);
	});

	it("keeps Tab completion without submitting", async () => {
		const { editor, submitted } = editorWithCommands();
		editor.handleInput("/prog");
		await flushAutocomplete();
		editor.handleInput("\t");
		assert.deepEqual(submitted, []);
		assert.equal(editor.getText(), "/skill:programming ");
	});
});
