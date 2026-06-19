import { setKeybindings, type TUI, visibleWidth } from "@earendil-works/omk-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ALL_PROVIDER_TAB, ModelSelectorComponent } from "../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function createFakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

async function waitForAsyncRender(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function registerProviderModel(harness: Harness, provider: string, id: string, name: string): void {
	const baseModel = harness.models[0];
	harness.session.modelRegistry.registerProvider(provider, {
		baseUrl: `https://${provider}.example.test`,
		apiKey: `${provider}-key`,
		api: baseModel.api,
		models: [
			{
				id,
				name,
				reasoning: false,
				input: ["text" as const],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			},
		],
	});
}

function providerLine(selector: ModelSelectorComponent, width: number): string {
	const rendered = stripAnsi(selector.render(width).join("\n"));
	return rendered.split("\n").find((line) => line.startsWith("Provider:")) ?? "";
}

function activeProvider(selector: ModelSelectorComponent): string {
	return selector.getSemanticState().activeProvider;
}

describe("/model provider row width-aware rendering", () => {
	const harnesses: Harness[] = [];

	beforeAll(() => initTheme("dark"));
	beforeEach(() => setKeybindings(new KeybindingsManager()));
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function manyProviderSelector(): Promise<ModelSelectorComponent> {
		const harness = await createHarness({ models: [{ id: "faux-local", name: "Faux Local", reasoning: true }] });
		harnesses.push(harness);
		// Register enough known providers that the full strip overflows a narrow width.
		registerProviderModel(harness, "anthropic", "claude-haiku", "Claude Haiku");
		registerProviderModel(harness, "openai", "gpt-4o-mini", "GPT-4o mini");
		registerProviderModel(harness, "google", "gemini-flash", "Gemini Flash");
		registerProviderModel(harness, "deepseek", "deepseek-chat", "DeepSeek Chat");
		registerProviderModel(harness, "kimi", "kimi-k2", "Kimi K2");
		registerProviderModel(harness, "openrouter", "or-mix", "OR Mix");
		registerProviderModel(harness, "mistral", "mistral-small", "Mistral Small");
		registerProviderModel(harness, "xai", "grok-mini", "Grok Mini");
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			harness.getModel("faux-local"),
			harness.settingsManager,
			harness.session.modelRegistry,
			[],
			() => {},
			() => {},
		);
		await waitForAsyncRender();
		return selector;
	}

	it("fits the provider row to a narrow width without wrapping", async () => {
		const selector = await manyProviderSelector();
		for (const width of [32, 40, 56, 80]) {
			const line = providerLine(selector, width);
			expect(line.startsWith("Provider:")).toBe(true);
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(line).toContain(ALL_PROVIDER_TAB);
		}
	});

	it("keeps the active provider visible at a narrow width after cycling far right", async () => {
		const selector = await manyProviderSelector();
		// Cycle to the last provider tab.
		const tabCount = selector.getSemanticState().providerIds.length;
		for (let i = 0; i < tabCount; i++) {
			if (activeProvider(selector) === "xai") break;
			selector.handleInput("\t");
		}
		expect(activeProvider(selector)).toBe("xai");

		const width = 40;
		const line = providerLine(selector, width);
		expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		expect(line).toContain(ALL_PROVIDER_TAB); // anchor stays
		expect(line).toContain("xai"); // active stays visible
		expect(line).toContain("…"); // hidden middle tabs are elided
	});

	it("shows every provider when the width is generous", async () => {
		const selector = await manyProviderSelector();
		const line = providerLine(selector, 200);
		for (const provider of [
			"all",
			"anthropic",
			"openai",
			"google",
			"deepseek",
			"kimi",
			"openrouter",
			"mistral",
			"xai",
		]) {
			expect(line).toContain(provider);
		}
		expect(line).not.toContain("…");
	});
});
