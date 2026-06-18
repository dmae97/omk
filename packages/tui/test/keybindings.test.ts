import assert from "node:assert";
import { describe, it } from "node:test";
import { KeybindingScopeStack, KeybindingsManager, TUI_KEYBINDINGS } from "../src/keybindings.ts";

describe("KeybindingsManager", () => {
	it("does not evict selector confirm when input submit is rebound", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.input.submit": ["enter", "ctrl+enter"],
		});

		assert.deepStrictEqual(keybindings.getKeys("tui.input.submit"), ["enter", "ctrl+enter"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.select.confirm"), ["enter"]);
	});

	it("does not evict cursor bindings when another action reuses the same key", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.select.up": ["up", "ctrl+p"],
		});

		assert.deepStrictEqual(keybindings.getKeys("tui.select.up"), ["up", "ctrl+p"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.cursorUp"), ["up"]);
	});

	it("still reports direct user binding conflicts without evicting defaults", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.input.submit": "ctrl+x",
			"tui.select.confirm": "ctrl+x",
		});

		assert.deepStrictEqual(keybindings.getConflicts(), [
			{
				key: "ctrl+x",
				keybindings: ["tui.input.submit", "tui.select.confirm"],
			},
		]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.cursorLeft"), ["left", "ctrl+b"]);
	});

	it("resolves only unambiguous matches inside an explicit scope", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.input.submit": "ctrl+x",
			"tui.select.confirm": "ctrl+x",
		});

		assert.deepStrictEqual(keybindings.matchInScope("\u0018", ["tui.input.submit"]), {
			keybinding: "tui.input.submit",
			conflicts: [],
		});
		assert.deepStrictEqual(keybindings.matchInScope("\u0018", ["tui.input.submit", "tui.select.confirm"]), {
			keybinding: undefined,
			conflicts: [
				{
					key: "ctrl+x",
					keybindings: ["tui.input.submit", "tui.select.confirm"],
				},
			],
		});
		assert.deepStrictEqual(keybindings.getConflictsForScope(["tui.input.submit", "tui.select.confirm"]), [
			{
				key: "ctrl+x",
				keybindings: ["tui.input.submit", "tui.select.confirm"],
			},
		]);
	});

	it("uses the active keybinding scope stack for dispatch", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
		const scopes = new KeybindingScopeStack();

		scopes.push("input", ["tui.input.submit"]);
		assert.deepStrictEqual(scopes.match("\r", keybindings), {
			keybinding: "tui.input.submit",
			conflicts: [],
		});

		scopes.push("selector", ["tui.select.confirm"]);
		assert.deepStrictEqual(scopes.match("\r", keybindings), {
			keybinding: "tui.select.confirm",
			conflicts: [],
		});

		assert.deepStrictEqual(scopes.pop("selector"), {
			id: "selector",
			keybindings: ["tui.select.confirm"],
		});
		assert.deepStrictEqual(scopes.match("\r", keybindings), {
			keybinding: "tui.input.submit",
			conflicts: [],
		});
	});
});
