import { describe, expect, it } from "bun:test";
import { KeybindingsManager } from "../src/config/keybindings";

describe("KeybindingsManager.getDisplayString", () => {
	it("formats a single binding as a human-readable key hint", () => {
		const keybindings = KeybindingsManager.inMemory({
			dequeue: "alt+up",
		});

		expect(keybindings.getDisplayString("dequeue")).toBe("Alt+Up");
	});

	it("formats multiple bindings with the existing separator", () => {
		const keybindings = KeybindingsManager.inMemory({
			copyPrompt: ["alt+shift+c", "ctrl+shift+c"],
		});

		expect(keybindings.getDisplayString("copyPrompt")).toBe("Alt+Shift+C/Ctrl+Shift+C");
	});

	it("returns an empty string when the action has no binding", () => {
		const keybindings = KeybindingsManager.inMemory({
			copyPrompt: [],
		});

		expect(keybindings.getDisplayString("copyPrompt")).toBe("");
	});
});
