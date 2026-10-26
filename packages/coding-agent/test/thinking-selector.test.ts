import { stripVTControlCharacters } from "node:util";
import type { ThinkingLevel } from "omk-agent-core";
import { setKeybindings } from "omk-tui";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { ThinkingSelectorComponent } from "../src/modes/interactive/components/settings-selector.ts";
import { ThinkingSelectorComponent as StandaloneThinkingSelectorComponent } from "../src/modes/interactive/components/thinking-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("thinking selector command support", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("registers /think as a built-in slash command", () => {
		expect(BUILTIN_SLASH_COMMANDS.some((command) => command.name === "think")).toBe(true);
	});

	it("selects the current thinking level", () => {
		const changes: ThinkingLevel[] = [];
		let completed: ThinkingLevel | undefined;

		const selector = new ThinkingSelectorComponent(
			{
				thinkingLevel: "medium",
				availableThinkingLevels: ["off", "medium", "high"],
			},
			{
				onThinkingLevelChange: (level) => changes.push(level),
				onSelectComplete: (level) => {
					completed = level;
				},
				onCancel: () => {},
			},
		);

		selector.handleInput("\r");

		expect(changes).toEqual(["medium"]);
		expect(completed).toBe("medium");
	});

	it("describes ultra consistently without claiming automatic delegation", () => {
		const settings = new ThinkingSelectorComponent(
			{ thinkingLevel: "ultra", availableThinkingLevels: ["ultra"] },
			{ onThinkingLevelChange: () => {}, onCancel: () => {} },
		);
		const standalone = new StandaloneThinkingSelectorComponent(
			"ultra",
			["ultra"],
			() => {},
			() => {},
		);
		for (const selector of [settings, standalone]) {
			const rendered = stripVTControlCharacters(selector.render(80).join("\n"));
			expect(rendered).toContain("Does not enable delegation; effort varies by model");
			expect(rendered).not.toContain("automatic task delegation");
		}
	});
});
