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

	it("renders provider tabs and max thinking variants in the /model selector", async () => {
		const harness = await createHarness({
			models: [{ id: "faux-max", name: "Faux Max", reasoning: true }],
		});
		harnesses.push(harness);

		const baseModel = harness.models[0];
		harness.authStorage.setRuntimeApiKey("beta", "beta-key");
		harness.session.modelRegistry.registerProvider("beta", {
			baseUrl: baseModel.baseUrl,
			apiKey: "beta-key",
			api: baseModel.api,
			models: [
				{
					id: "beta-max",
					name: "Beta Max",
					api: baseModel.api,
					baseUrl: baseModel.baseUrl,
					reasoning: true,
					thinkingLevelMap: { high: "high", xhigh: "max", max: "max" },
					input: baseModel.input,
					cost: baseModel.cost,
					contextWindow: baseModel.contextWindow,
					maxTokens: baseModel.maxTokens,
				},
			],
		});

		const betaModel = harness.session.modelRegistry.find("beta", "beta-max")!;
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			betaModel,
			harness.settingsManager,
			harness.session.modelRegistry,
			[],
			() => {},
			() => {},
		);

		await waitForAsyncRender();

		const initialOutput = stripAnsi(selector.render(140).join("\n"));
		expect(initialOutput).toContain("Provider tabs:");
		expect(initialOutput).toContain("[○ all]");
		expect(initialOutput).toContain("[● beta]");
		expect(initialOutput).toContain("[○ faux]");
		expect(initialOutput).toContain("beta-max:max");
		expect(initialOutput).not.toContain("faux-max [faux]");

		selector.handleInput("\t");
		const nextProviderOutput = stripAnsi(selector.render(140).join("\n"));
		expect(nextProviderOutput).toMatch(/\[● (?!beta\])[a-z0-9-]+\]/);
		expect(nextProviderOutput).not.toContain("beta-max [beta]");
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
});
