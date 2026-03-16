import { describe, expect, it } from "bun:test";
import { buildHotkeysMarkdown } from "../../../src/modes/utils/hotkeys-markdown";

describe("buildHotkeysMarkdown", () => {
	it("emits flush-left markdown so headings and tables are parsed instead of treated as indented text", () => {
		const markdown = buildHotkeysMarkdown({
			expandToolsKey: "Ctrl+O",
			planModeKey: "Alt+M",
			sttKey: "Alt+H",
			copyLineKey: "Alt+Shift+L",
			copyPromptKey: "Ctrl+Shift+P",
		});

		const lines = markdown.split("\n");
		expect(lines[0]).toBe("**Navigation**");
		expect(markdown).toContain("| `Ctrl+Shift+P` | Copy whole prompt |");
		expect(markdown).toContain("| `Alt+M` | Toggle plan mode |");
		expect(markdown).toContain("| `#` | Open prompt actions |");
		for (const line of lines) {
			if (line.length === 0) continue;
			expect(line.startsWith(" ")).toBe(false);
			expect(line.startsWith("\t")).toBe(false);
		}
	});
});
