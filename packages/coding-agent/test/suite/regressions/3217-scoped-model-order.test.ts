import { setKeybindings, type TUI } from "@earendil-works/omk-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../../../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../../../src/modes/interactive/components/model-selector.ts";
import { ScopedModelsSelectorComponent } from "../../../src/modes/interactive/components/scoped-models-selector.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";
import { createHarness, type Harness } from "../harness.ts";

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
	} as unknown as TUI;
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

describe("issue #3217 scoped model ordering", () => {
	const harnesses: Harness[] = [];

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		// Ensure test isolation: keybindings are a global singleton
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("propagates reordered scoped models back to the session state", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "One", reasoning: true },
				{ id: "faux-2", name: "Two", reasoning: true },
				{ id: "faux-3", name: "Three", reasoning: true },
			],
		});
		harnesses.push(harness);

		const orderedIds = harness.models.map((model) => `${model.provider}/${model.id}`);
		const changes: Array<string[] | null> = [];
		const selector = new ScopedModelsSelectorComponent(
			{
				allModels: [...harness.models],
				enabledModelIds: orderedIds,
			},
			{
				onChange: (enabledModelIds) => {
					changes.push(enabledModelIds);
				},
				onPersist: () => {},
				onCancel: () => {},
			},
		);

		selector.handleInput("\x1b[1;3B");

		expect(changes).toEqual([[orderedIds[1], orderedIds[0], orderedIds[2]]]);
	});

	it("preserves scoped model order in the /model scoped tab", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "One", reasoning: true },
				{ id: "faux-2", name: "Two", reasoning: true },
				{ id: "faux-3", name: "Three", reasoning: true },
			],
		});
		harnesses.push(harness);

		const modelOne = harness.getModel("faux-1")!;
		const modelTwo = harness.getModel("faux-2")!;
		const modelThree = harness.getModel("faux-3")!;
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			modelOne,
			harness.settingsManager,
			harness.session.modelRegistry,
			[{ model: modelTwo }, { model: modelOne }, { model: modelThree }],
			() => {},
			() => {},
		);

		await waitForAsyncRender();

		const renderedLines = stripAnsi(selector.render(120).join("\n"))
			.split("\n")
			.filter((line) => line.includes(`[${modelOne.provider}]`));
		const orderedIds = renderedLines.slice(0, 3).map((line) => {
			const [modelId] = line.trim().replace(/^→\s*/, "").split(" [");
			return modelId?.trim() ?? "";
		});

		expect(orderedIds).toEqual([modelTwo.id, modelOne.id, modelThree.id]);
	});

	it("filters available models by provider tabs", async () => {
		const harness = await createHarness({
			models: [{ id: "faux-local", name: "Faux Local", reasoning: true }],
		});
		harnesses.push(harness);
		registerProviderModel(harness, "anthropic", "claude-haiku", "Claude Haiku");
		registerProviderModel(harness, "openai", "gpt-4o-mini", "GPT-4o mini");

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

		let rendered = stripAnsi(selector.render(120).join("\n"));
		expect(rendered).toContain("Provider: all | anthropic | openai");

		selector.handleInput("\t");
		rendered = stripAnsi(selector.render(120).join("\n"));

		expect(rendered).toContain("Provider: all | anthropic | openai");
		expect(rendered).toContain("claude-haiku [anthropic]");
		expect(rendered).not.toContain("[openai]");
	});
});
