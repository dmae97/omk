import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Component, Container, setKeybindings, type TUI } from "@earendil-works/omk-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import type { ModelRegistry } from "../../src/core/model-registry.ts";
import type { SettingsManager } from "../../src/core/settings-manager.ts";
import { ALL_PROVIDER_TAB, ModelSelectorComponent } from "../../src/modes/interactive/components/model-selector.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, type Harness } from "../suite/harness.ts";

const SHIFT_TAB = "\x1b[Z";
const CTRL_P = "\x10";

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
		setFocus: () => {},
	} as unknown as TUI;
}

async function waitForAsyncRender(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function renderPlain(selector: ModelSelectorComponent, width: number): string {
	return stripAnsi(selector.render(width).join("\n"));
}

function getProviderLine(rendered: string): string {
	const line = rendered.split("\n").find((candidate) => candidate.startsWith("Provider:"));
	expect(line).toBeDefined();
	return line ?? "";
}

function extractProviderNames(providerLine: string): string[] {
	return providerLine
		.replace(/^Provider:\s*/, "")
		.split("|")
		.map((part) => part.trim().replace(/\s+[✓✗]$/, ""))
		.filter(Boolean);
}

function activeProvider(selector: ModelSelectorComponent): string {
	return (selector as unknown as { activeProviderTab: string }).activeProviderTab;
}

function expectProvidersInOrder(providers: readonly string[], expectedOrder: readonly string[]): void {
	let previousIndex = -1;
	for (const provider of expectedOrder) {
		const index = providers.indexOf(provider);
		expect(index, `provider ${provider} should be present in ${providers.join(", ")}`).toBeGreaterThan(previousIndex);
		previousIndex = index;
	}
}

function cycleToProvider(selector: ModelSelectorComponent, provider: string): void {
	for (let i = 0; i < 32 && activeProvider(selector) !== provider; i++) {
		selector.handleInput("\t");
	}
	expect(activeProvider(selector)).toBe(provider);
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

async function createSelectorHarness(): Promise<Harness> {
	const harness = await createHarness({
		models: [{ id: "faux-local", name: "Faux Local", reasoning: true }],
	});
	registerProviderModel(harness, "anthropic", "claude-haiku", "Claude Haiku");
	registerProviderModel(harness, "openai", "gpt-4o-mini", "GPT-4o mini");
	registerProviderModel(harness, "kimi", "kimi-k2", "Kimi K2");
	registerProviderModel(harness, "custom-provider", "custom-sonic", "Custom Sonic");
	return harness;
}

function makeSelector(
	harness: Harness,
	scopedModels: ConstructorParameters<typeof ModelSelectorComponent>[4] = [],
): ModelSelectorComponent {
	return new ModelSelectorComponent(
		createFakeTui(),
		harness.getModel("faux-local"),
		harness.settingsManager,
		harness.session.modelRegistry,
		scopedModels,
		() => {},
		() => {},
	);
}

class EmptyComponent implements Component {
	render(): string[] {
		return [];
	}

	invalidate(): void {}
}

function openModelSelectorThroughInteractiveMode(fakeThis: InteractiveModeFake): ModelSelectorComponent {
	(
		InteractiveMode as unknown as { prototype: { showModelSelector: (input?: string) => void } }
	).prototype.showModelSelector.call(fakeThis);
	const selector = fakeThis.editorContainer.children[0];
	expect(selector).toBeInstanceOf(ModelSelectorComponent);
	return selector as ModelSelectorComponent;
}

type InteractiveModeFake = {
	ui: TUI;
	session: {
		model: Harness["models"][number] | undefined;
		modelRegistry: ModelRegistry;
		scopedModels: [];
	};
	settingsManager: SettingsManager;
	editorContainer: Container;
	editor: Component;
	lastModelProviderTab?: string;
	showModelThinkingTransaction: (model: unknown) => void;
	showSelector: (create: (done: () => void) => { component: Component; focus: Component }) => void;
};

describe("OMK CLI Contract v1 /model provider tabs", () => {
	const harnesses: Harness[] = [];

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("matches the provider-tab compatibility manifest", () => {
		const manifestPath = fileURLToPath(new URL("./model-selector-contract.v1.json", import.meta.url));
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			schemaVersion: string;
			modelSelector: Record<string, unknown>;
		};

		expect(manifest.schemaVersion).toBe("omk.cli-contract.v1");
		expect(manifest.modelSelector).toMatchObject({
			providerTabsRequired: true,
			allTabRequired: true,
			nextProviderKey: "tab",
			previousProviderKey: "shift+tab",
			scopeForwardKey: "ctrl+p",
			scopeBackwardKey: "shift+ctrl+p",
			retainProviderWithinSession: true,
			fallbackToAllWhenUnavailable: true,
			customProvidersAfterPredefinedOrder: true,
			hideProviderTabsDuringSearch: false,
			tabKeyReservedForProviderNext: true,
		});
	});

	it("renders required provider tabs in stable order, including custom providers", async () => {
		const harness = await createSelectorHarness();
		harnesses.push(harness);
		const selector = makeSelector(harness);
		await waitForAsyncRender();

		const providers = extractProviderNames(getProviderLine(renderPlain(selector, 120)));
		expectProvidersInOrder(providers, ["all", "anthropic", "openai", "google", "deepseek", "kimi"]);
		expectProvidersInOrder(providers, ["kimi", "custom-provider"]);
	});

	it("keeps Tab and Shift+Tab dedicated to provider navigation", async () => {
		const harness = await createSelectorHarness();
		harnesses.push(harness);
		const selector = makeSelector(harness);
		await waitForAsyncRender();

		expect(activeProvider(selector)).toBe(ALL_PROVIDER_TAB);
		selector.handleInput("\t");
		expect(activeProvider(selector)).toBe("anthropic");

		const anthropicRendered = renderPlain(selector, 120);
		expect(anthropicRendered).toMatch(/claude-haiku \[anthropic/);
		expect(anthropicRendered).not.toMatch(/gpt-4o-mini \[openai/);
		expect(anthropicRendered).not.toMatch(/kimi-k2 \[kimi/);

		selector.handleInput(SHIFT_TAB);
		expect(activeProvider(selector)).toBe(ALL_PROVIDER_TAB);
	});

	it("retains provider tab across real InteractiveMode /model reopen and falls back when unavailable", async () => {
		const harness = await createSelectorHarness();
		harnesses.push(harness);
		const fakeThis: InteractiveModeFake = {
			ui: createFakeTui(),
			session: {
				model: harness.getModel("faux-local"),
				modelRegistry: harness.session.modelRegistry,
				scopedModels: [],
			},
			settingsManager: harness.settingsManager,
			editorContainer: new Container(),
			editor: new EmptyComponent(),
			showModelThinkingTransaction: vi.fn(),
			showSelector: (InteractiveMode as unknown as { prototype: InteractiveModeFake }).prototype.showSelector,
		};

		let selector = openModelSelectorThroughInteractiveMode(fakeThis);
		await waitForAsyncRender();
		cycleToProvider(selector, "kimi");
		expect(fakeThis.lastModelProviderTab).toBe("kimi");

		selector = openModelSelectorThroughInteractiveMode(fakeThis);
		await waitForAsyncRender();
		expect(activeProvider(selector)).toBe("kimi");

		harness.session.modelRegistry.unregisterProvider("kimi");
		selector = openModelSelectorThroughInteractiveMode(fakeThis);
		await waitForAsyncRender();
		expect(activeProvider(selector)).toBe(ALL_PROVIDER_TAB);
		expect(fakeThis.lastModelProviderTab).toBeUndefined();
	});

	it("searches only inside the active provider and never hides provider tabs", async () => {
		const harness = await createSelectorHarness();
		harnesses.push(harness);
		const selector = makeSelector(harness);
		await waitForAsyncRender();

		selector.handleInput("\t");
		expect(activeProvider(selector)).toBe("anthropic");
		for (const key of "gpt") selector.handleInput(key);

		const rendered = renderPlain(selector, 120);
		const providers = extractProviderNames(getProviderLine(rendered));
		expectProvidersInOrder(providers, ["all", "anthropic", "openai", "google", "deepseek", "kimi"]);
		expectProvidersInOrder(providers, ["kimi", "custom-provider"]);
		expect(rendered).toContain("No matching models");
		expect(rendered).not.toMatch(/gpt-4o-mini \[openai/);
	});

	it("keeps provider tabs after Ctrl+P scope changes", async () => {
		const harness = await createSelectorHarness();
		harnesses.push(harness);
		const anthropic = harness.session.modelRegistry.find("anthropic", "claude-haiku");
		const kimi = harness.session.modelRegistry.find("kimi", "kimi-k2");
		expect(anthropic).toBeDefined();
		expect(kimi).toBeDefined();
		const selector = makeSelector(harness, [{ model: anthropic! }, { model: kimi! }]);
		await waitForAsyncRender();

		let providers = extractProviderNames(getProviderLine(renderPlain(selector, 120)));
		expect(providers).toEqual(["all", "anthropic", "kimi"]);

		selector.handleInput(CTRL_P);
		providers = extractProviderNames(getProviderLine(renderPlain(selector, 120)));
		expectProvidersInOrder(providers, ["all", "anthropic", "openai", "google", "deepseek", "kimi"]);
		expectProvidersInOrder(providers, ["kimi", "custom-provider"]);
	});

	it("keeps provider tabs renderable across release-gate width and color-mode matrix", async () => {
		const harness = await createSelectorHarness();
		harnesses.push(harness);
		const selector = makeSelector(harness);
		await waitForAsyncRender();

		const originalEnv = {
			TERM: process.env.TERM,
			COLORTERM: process.env.COLORTERM,
			NO_COLOR: process.env.NO_COLOR,
		};
		const matrix = [
			{ TERM: "xterm-truecolor", COLORTERM: "truecolor", NO_COLOR: undefined },
			{ TERM: "xterm-256color", COLORTERM: undefined, NO_COLOR: undefined },
			{ TERM: "dumb", COLORTERM: undefined, NO_COLOR: "1" },
		];
		try {
			for (const env of matrix) {
				process.env.TERM = env.TERM;
				if (env.COLORTERM === undefined) delete process.env.COLORTERM;
				else process.env.COLORTERM = env.COLORTERM;
				if (env.NO_COLOR === undefined) delete process.env.NO_COLOR;
				else process.env.NO_COLOR = env.NO_COLOR;

				for (const width of [48, 80, 120, 200]) {
					const providers = extractProviderNames(getProviderLine(renderPlain(selector, width)));
					expect(providers[0]).toBe("all");
					expect(providers).toContain("anthropic");
					if (width >= 120) {
						expectProvidersInOrder(providers, ["all", "anthropic", "openai", "google", "deepseek", "kimi"]);
						expectProvidersInOrder(providers, ["kimi", "custom-provider"]);
					}
				}
			}
		} finally {
			if (originalEnv.TERM === undefined) delete process.env.TERM;
			else process.env.TERM = originalEnv.TERM;
			if (originalEnv.COLORTERM === undefined) delete process.env.COLORTERM;
			else process.env.COLORTERM = originalEnv.COLORTERM;
			if (originalEnv.NO_COLOR === undefined) delete process.env.NO_COLOR;
			else process.env.NO_COLOR = originalEnv.NO_COLOR;
		}
	});
});
