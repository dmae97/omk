import { beforeAll, describe, expect, test, vi } from "bun:test";
import { getBundledModel } from "@oh-my-pi/pi-ai";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ModelSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/model-selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { TUI } from "@oh-my-pi/pi-tui";

function normalizeRenderedText(text: string): string {
	return (
		text
			// strip ANSI escapes
			.replace(/\x1b\[[0-9;]*m/g, "")
			// collapse whitespace
			.replace(/\s+/g, " ")
			.trim()
	);
}

describe("ModelSelector role badge thinking display", () => {
	beforeAll(() => {
		initTheme();
	});

	test("renders explicit thinking next to role badges and removes details duplication", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled model anthropic/claude-sonnet-4-5");

		const settings = Settings.isolated({
			modelRoles: {
				default: `${model.provider}/${model.id}`,
				smol: `${model.provider}/${model.id}:minimal`,
				slow: `${model.provider}/${model.id}:off`,
				commit: `${model.provider}/${model.id}:medium`,
			},
		});

		const modelRegistry = {
			getAll: () => [model],
		} as unknown as ModelRegistry;
		const ui = {
			requestRender: vi.fn(),
		} as unknown as TUI;

		const selector = new ModelSelectorComponent(
			ui,
			model,
			settings,
			modelRegistry,
			[{ model, thinkingLevel: "off" }],
			() => {},
			() => {},
		);

		await Bun.sleep(0);

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("SMOL (min)");
		expect(rendered).toContain("SLOW (off)");
		expect(rendered).toContain("COMMIT (medium)");
		expect(rendered).not.toContain("DEFAULT (");
		expect(rendered).not.toContain("Role Thinking:");
	});
});
