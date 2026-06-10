import type { Model } from "@earendil-works/omk-ai";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	buildModelProviderTabs,
	ModelSelectorComponent,
	nextModelProviderTab,
} from "../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function stripAnsi(text: string): string {
	return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function createModel(provider: string, id: string): Model<any> {
	return {
		provider,
		id,
		name: id,
		reasoning: false,
	} as Model<any>;
}

function createSelector(options: { currentModel?: Model<any>; models: Model<any>[]; initialSearchInput?: string }) {
	const tui = { requestRender: vi.fn() };
	const modelRegistry = {
		refresh: vi.fn(),
		getError: vi.fn(() => undefined),
		getAvailable: vi.fn(async () => options.models),
		find: vi.fn((provider: string, id: string) =>
			options.models.find((model) => model.provider === provider && model.id === id),
		),
	};
	const settingsManager = { setDefaultModelAndProvider: vi.fn() };

	const selector = new ModelSelectorComponent(
		tui as never,
		options.currentModel,
		settingsManager as never,
		modelRegistry as never,
		[],
		() => {},
		() => {},
		options.initialSearchInput,
	);

	return { selector, tui, modelRegistry, settingsManager };
}

beforeAll(() => {
	initTheme("dark", false);
});
async function flushModelLoad(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
	delete process.env.OMK_DEBUG_MODEL_TABS;
	vi.restoreAllMocks();
});

describe("model selector provider tabs", () => {
	it("builds canonical full provider tab order starting at all and ignores non-tab provider ids", () => {
		expect(buildModelProviderTabs(["openai-codex", "openrouter", "zai", "openai", "mimo-coding-plan"])).toEqual([
			"all",
			"anthropic",
			"deepseek",
			"google",
			"mimo",
			"minimax",
			"openai-codex",
			"openrouter",
			"zai",
		]);
	});

	it("cycles through the full provider tab array", () => {
		const tabs = buildModelProviderTabs(["openai-codex", "openrouter", "zai"]);
		const sequence = ["all"];
		let active = "all";
		for (let i = 0; i < 9; i += 1) {
			active = nextModelProviderTab(tabs, active);
			sequence.push(active);
		}

		expect(sequence).toEqual([
			"all",
			"anthropic",
			"deepseek",
			"google",
			"mimo",
			"minimax",
			"openai-codex",
			"openrouter",
			"zai",
			"all",
		]);
	});

	it("opens /model on all even when the current model provider is openai-codex", async () => {
		const currentModel = createModel("openai-codex", "gpt-5.5");
		const { selector } = createSelector({
			currentModel,
			models: [currentModel, createModel("openrouter", "anthropic/claude-sonnet-4"), createModel("zai", "glm-5")],
		});
		await flushModelLoad();

		expect((selector as unknown as { activeProvider: string }).activeProvider).toBe("all");
		const text = stripAnsi(selector.render(140).join("\n"));
		expect(text).toContain(
			"Provider tabs: [● all] [○ anthropic] [○ deepseek] [○ google] [○ mimo] [○ minimax] [○ openai-codex] [○ openrouter] [○ zai]",
		);
		expect(text).toContain("gpt-5.5 [openai-codex] ✓");
	});

	it("Tab from /model walks all canonical tabs instead of the openai-codex subset", async () => {
		const currentModel = createModel("openai-codex", "gpt-5.5");
		const { selector } = createSelector({
			currentModel,
			models: [currentModel, createModel("openrouter", "anthropic/claude-sonnet-4"), createModel("zai", "glm-5")],
		});
		await flushModelLoad();

		const state = selector as unknown as { activeProvider: string };
		const sequence = [state.activeProvider];
		for (let i = 0; i < 9; i += 1) {
			selector.handleInput("\t");
			sequence.push(state.activeProvider);
		}

		expect(sequence).toEqual([
			"all",
			"anthropic",
			"deepseek",
			"google",
			"mimo",
			"minimax",
			"openai-codex",
			"openrouter",
			"zai",
			"all",
		]);
	});

	it("writes full tab debug logs for initial /model and Tab", async () => {
		process.env.OMK_DEBUG_MODEL_TABS = "1";
		const writes: string[] = [];
		vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		});
		const currentModel = createModel("openai-codex", "gpt-5.5");
		const { selector } = createSelector({
			currentModel,
			models: [currentModel, createModel("openrouter", "anthropic/claude-sonnet-4"), createModel("zai", "glm-5")],
		});
		await flushModelLoad();
		selector.handleInput("\t");

		const log = writes.join("");
		expect(log).toContain(
			"tabs=all,anthropic,deepseek,google,mimo,minimax,openai-codex,openrouter,zai active=all key=/model runtime=openai-codex/gpt-5.5",
		);
		expect(log).toContain("active=all key=Tab next=anthropic runtime=openai-codex/gpt-5.5");
	});
});
