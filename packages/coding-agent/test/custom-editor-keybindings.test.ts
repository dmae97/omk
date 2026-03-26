import { describe, expect, it, vi } from "bun:test";
import { defaultEditorTheme } from "../../tui/test/test-themes";

function ctrl(key: string): string {
	return String.fromCharCode(key.toLowerCase().charCodeAt(0) & 31);
}

async function createEditor() {
	const { CustomEditor } = await import("../src/modes/components/custom-editor");
	return new CustomEditor(defaultEditorTheme);
}

describe("CustomEditor temporary model selector keybinding", () => {
	it("triggers the temporary selector from a remapped action key instead of Alt+P", async () => {
		const editor = await createEditor();
		const onSelectModelTemporary = vi.fn();
		editor.onSelectModelTemporary = onSelectModelTemporary;
		editor.setActionKeys("app.model.selectTemporary", ["ctrl+y"]);

		editor.handleInput(ctrl("y"));
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);

		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);
	});

	it("removes the default Alt+P shortcut when the action is disabled", async () => {
		const editor = await createEditor();
		const onSelectModelTemporary = vi.fn();
		editor.onSelectModelTemporary = onSelectModelTemporary;

		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);

		editor.setActionKeys("app.model.selectTemporary", []);
		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);
	});
});
