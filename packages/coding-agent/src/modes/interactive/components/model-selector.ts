import { getSupportedThinkingLevels, type Model, modelsAreEqual } from "@earendil-works/omk-ai";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	Spacer,
	Text,
	type TUI,
} from "@earendil-works/omk-tui";
import type { ModelRegistry } from "../../../core/model-registry.ts";
import type { SettingsManager } from "../../../core/settings-manager.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel?: string;
}

type ModelScope = "all" | "scoped";
export const ALL_MODEL_PROVIDER_TAB = "all" as const;

export const MODEL_PROVIDER_TAB_ORDER = [
	"anthropic",
	"deepseek",
	"google",
	"mimo",
	"minimax",
	"openai-codex",
	"openrouter",
	"zai",
] as const;

export function modelProviderTabLabel(provider: string): string {
	if (provider === "xiaomi") return "mimo";
	if (provider === "xiaomi-token-plan-cn") return "mimo-cn";
	if (provider === "xiaomi-token-plan-ams") return "mimo-ams";
	if (provider === "xiaomi-token-plan-sgp") return "mimo-sgp";
	return provider;
}

export function buildModelProviderTabs(_providerIds: readonly string[]): string[] {
	return [ALL_MODEL_PROVIDER_TAB, ...MODEL_PROVIDER_TAB_ORDER];
}

export function nextModelProviderTab(tabs: readonly string[], activeProvider: string, direction: 1 | -1 = 1): string {
	if (tabs.length === 0) return ALL_MODEL_PROVIDER_TAB;
	const currentIndex = tabs.indexOf(activeProvider);
	const safeIndex = currentIndex >= 0 ? currentIndex : 0;
	return tabs[(safeIndex + direction + tabs.length) % tabs.length] ?? ALL_MODEL_PROVIDER_TAB;
}

/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends Container implements Focusable {
	private searchInput: Input;

	// Focusable implementation - propagate to searchInput for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}
	private listContainer: Container;
	private allModels: ModelItem[] = [];
	private scopedModelItems: ModelItem[] = [];
	private activeModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private selectedIndex: number = 0;
	private currentModel?: Model<any>;
	private settingsManager: SettingsManager;
	private modelRegistry: ModelRegistry;
	private onSelectCallback: (model: Model<any>) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private tui: TUI;
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private scope: ModelScope = "all";
	private scopeText?: Text;
	private scopeHintText?: Text;
	private providerTabsText: Text;
	private providerHintText: Text;
	private providers: string[] = [];
	private activeProvider: string = ALL_MODEL_PROVIDER_TAB;
	private hasAppliedInitialProvider = false;
	private readonly initialSearchInput?: string;

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		settingsManager: SettingsManager,
		modelRegistry: ModelRegistry,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
		initialSearchInput?: string,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.settingsManager = settingsManager;
		this.modelRegistry = modelRegistry;
		this.scopedModels = scopedModels;
		this.scope = scopedModels.length > 0 ? "scoped" : "all";
		this.initialSearchInput = initialSearchInput;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add hint about model filtering
		if (scopedModels.length > 0) {
			this.scopeText = new Text(this.getScopeText(), 0, 0);
			this.addChild(this.scopeText);
			this.scopeHintText = new Text(this.getScopeHintText(), 0, 0);
			this.addChild(this.scopeHintText);
		}
		this.providerTabsText = new Text(theme.fg("muted", "Provider tabs: loading..."), 0, 0);
		this.addChild(this.providerTabsText);
		this.providerHintText = new Text(this.getProviderHintText(), 0, 0);
		this.addChild(this.providerHintText);
		this.addChild(new Spacer(1));

		// Create search input
		this.searchInput = new Input();
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
		}
		this.searchInput.onSubmit = () => {
			// Enter on search input selects the first filtered item
			if (this.filteredModels[this.selectedIndex]) {
				this.handleSelect(this.filteredModels[this.selectedIndex].model);
			}
		};
		this.addChild(this.searchInput);

		this.addChild(new Spacer(1));

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Load models and do initial render
		this.loadModels().then(() => {
			if (initialSearchInput) {
				this.filterModels(initialSearchInput);
			} else {
				this.updateList();
			}
			// Request re-render after models are loaded
			this.tui.requestRender();
		});
	}

	private async loadModels(): Promise<void> {
		let models: ModelItem[];

		// Refresh to pick up any changes to models.json
		this.modelRegistry.refresh();

		// Check for models.json errors
		const loadError = this.modelRegistry.getError();
		if (loadError) {
			this.errorMessage = loadError;
		}

		// Load available models (built-in models still work even if models.json failed)
		try {
			const availableModels = await this.modelRegistry.getAvailable();
			models = availableModels.map((model: Model<any>) => ({
				provider: model.provider,
				id: model.id,
				model,
			}));
		} catch (error) {
			this.allModels = [];
			this.scopedModelItems = [];
			this.activeModels = [];
			this.filteredModels = [];
			this.errorMessage = error instanceof Error ? error.message : String(error);
			return;
		}

		this.allModels = this.sortModels(models);
		this.scopedModels = this.scopedModels.map((scoped) => {
			const refreshed = this.modelRegistry.find(scoped.model.provider, scoped.model.id);
			return refreshed ? { ...scoped, model: refreshed } : scoped;
		});
		this.scopedModelItems = this.scopedModels.map((scoped) => ({
			provider: scoped.model.provider,
			id: scoped.model.id,
			model: scoped.model,
		}));
		this.applyScopeAndProvider();
		this.debugProviderTabs(this.initialSearchInput ? "/model explicit" : "/model");
	}

	private sortModels(models: ModelItem[]): ModelItem[] {
		const sorted = [...models];
		// Sort: current model first, then by provider
		sorted.sort((a, b) => {
			const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
			const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			return a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id);
		});
		return sorted;
	}

	private getBaseModels(): ModelItem[] {
		return this.scope === "scoped" ? this.scopedModelItems : this.allModels;
	}

	private getProviderTabs(models: ModelItem[]): string[] {
		return buildModelProviderTabs(models.map((item) => item.provider)).slice(1);
	}

	private inferInitialProvider(providerTabs: string[]): string {
		const query = this.initialSearchInput?.trim().toLowerCase();
		if (!query) return ALL_MODEL_PROVIDER_TAB;

		const slashIndex = query.indexOf("/");
		const providerQuery = slashIndex === -1 ? query : query.slice(0, slashIndex);
		const providerQueryTab = modelProviderTabLabel(providerQuery);
		const matched = providerTabs.find(
			(provider) => provider.toLowerCase() === providerQuery || provider === providerQueryTab,
		);
		return matched ?? ALL_MODEL_PROVIDER_TAB;
	}

	private getProviderLabel(provider: string): string {
		if (provider === "xiaomi") return "mimo";
		if (provider === "xiaomi-token-plan-cn") return "mimo-cn";
		if (provider === "xiaomi-token-plan-ams") return "mimo-ams";
		if (provider === "xiaomi-token-plan-sgp") return "mimo-sgp";
		return provider;
	}

	private getProviderHintText(): string {
		if (this.scopedModelItems.length > 0) {
			return theme.fg("muted", "Provider tabs reflect the current all/scoped model set.");
		}
		return keyHint("tui.input.tab", "provider") + theme.fg("muted", " (provider tab)");
	}

	private getProviderTabsText(): string {
		const labels = [ALL_MODEL_PROVIDER_TAB, ...this.providers].map((provider) => {
			const label = provider === ALL_MODEL_PROVIDER_TAB ? ALL_MODEL_PROVIDER_TAB : this.getProviderLabel(provider);
			const marker = this.activeProvider === provider ? "●" : "○";
			const tab = `[${marker} ${label}]`;
			return this.activeProvider === provider ? theme.fg("accent", tab) : theme.fg("muted", tab);
		});
		return `${theme.fg("muted", "Provider tabs: ")}${labels.join(theme.fg("muted", " "))}`;
	}

	private updateProviderTabs(): void {
		this.providerTabsText.setText(this.getProviderTabsText());
		this.providerHintText.setText(this.getProviderHintText());
	}

	private debugProviderTabs(key: string, previousActiveProvider?: string): void {
		if (process.env.OMK_DEBUG_MODEL_TABS !== "1") return;

		const baseModels = this.getBaseModels();
		const providerIds = [...new Set(baseModels.map((item) => item.provider))];
		const tabs = [ALL_MODEL_PROVIDER_TAB, ...this.providers];
		const active = previousActiveProvider ?? this.activeProvider;
		const next = previousActiveProvider ? ` next=${this.activeProvider}` : "";
		const runtimeProvider = this.currentModel ? modelProviderTabLabel(this.currentModel.provider) : "unknown";
		const runtimeModel = this.currentModel?.id ?? "unknown";
		process.stderr.write(
			`[model-tabs] providerIds=${providerIds.join(",")} tabs=${tabs.join(",")} active=${active} key=${key}${next} runtime=${runtimeProvider}/${runtimeModel} rows=${this.activeModels.length}\n`,
		);
	}

	private applyScopeAndProvider(): void {
		const baseModels = this.getBaseModels();
		this.providers = this.getProviderTabs(baseModels);

		if (!this.hasAppliedInitialProvider) {
			this.activeProvider = this.inferInitialProvider(this.providers);
			this.hasAppliedInitialProvider = true;
		}

		const tabs = [ALL_MODEL_PROVIDER_TAB, ...this.providers];
		if (!tabs.includes(this.activeProvider)) {
			this.activeProvider = ALL_MODEL_PROVIDER_TAB;
		}

		this.activeModels =
			this.activeProvider === ALL_MODEL_PROVIDER_TAB
				? baseModels
				: baseModels.filter((item) => modelProviderTabLabel(item.provider) === this.activeProvider);
		this.filteredModels = this.activeModels;
		const currentIndex = this.filteredModels.findIndex((item) => modelsAreEqual(this.currentModel, item.model));
		this.selectedIndex =
			currentIndex >= 0 ? currentIndex : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		this.updateProviderTabs();
	}

	private getScopeText(): string {
		const allText = this.scope === "all" ? theme.fg("accent", "all") : theme.fg("muted", "all");
		const scopedText = this.scope === "scoped" ? theme.fg("accent", "scoped") : theme.fg("muted", "scoped");
		return `${theme.fg("muted", "Scope: ")}${allText}${theme.fg("muted", " | ")}${scopedText}`;
	}

	private getScopeHintText(): string {
		return keyHint("tui.input.tab", "scope") + theme.fg("muted", " (all/scoped)");
	}

	private setScope(scope: ModelScope): void {
		if (this.scope === scope) return;
		this.scope = scope;
		this.activeProvider = ALL_MODEL_PROVIDER_TAB;
		this.applyScopeAndProvider();
		this.filterModels(this.searchInput.getValue());
		if (this.scopeText) {
			this.scopeText.setText(this.getScopeText());
		}
	}

	private cycleProvider(): void {
		const tabs = [ALL_MODEL_PROVIDER_TAB, ...this.providers];
		if (tabs.length <= 1) return;
		const previousActiveProvider = this.activeProvider;
		this.activeProvider = nextModelProviderTab(tabs, this.activeProvider, 1);
		this.applyScopeAndProvider();
		this.filterModels(this.searchInput.getValue());
		this.debugProviderTabs("Tab", previousActiveProvider);
	}

	private filterModels(query: string): void {
		this.filteredModels = query
			? fuzzyFilter(
					this.activeModels,
					query,
					({ id, provider }) => `${id} ${provider} ${provider}/${id} ${provider} ${id}`,
				)
			: this.activeModels;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredModels.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.filteredModels.length);

		// Show visible slice of filtered models
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredModels[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;
			const isCurrent = modelsAreEqual(this.currentModel, item.model);

			let line = "";
			const providerBadge = theme.fg("muted", `[${this.getProviderLabel(item.provider)}]`);
			const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
			const maxHint = this.getMaxThinkingVariantHint(item.model);
			if (isSelected) {
				const prefix = theme.fg("accent", "→ ");
				const modelText = `${item.id}`;
				line = `${prefix + theme.fg("accent", modelText)} ${providerBadge}${checkmark}${maxHint}`;
			} else {
				const modelText = `  ${item.id}`;
				line = `${modelText} ${providerBadge}${checkmark}${maxHint}`;
			}

			this.listContainer.addChild(new Text(line, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredModels.length})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Show error message or "no results" if empty
		if (this.errorMessage) {
			// Show error in red
			const errorLines = this.errorMessage.split("\n");
			for (const line of errorLines) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		} else if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
		} else {
			const selected = this.filteredModels[this.selectedIndex];
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(new Text(theme.fg("muted", `  Model Name: ${selected.model.name}`), 0, 0));
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  Thinking: ${getSupportedThinkingLevels(selected.model).join(" · ")}`), 0, 0),
			);
		}
	}

	private getMaxThinkingVariantHint(model: Model<any>): string {
		const levels = getSupportedThinkingLevels(model);
		if (!levels.includes("max")) return "";
		return `${theme.fg("muted", "  max:")} ${theme.fg("accent", `${model.id}:max`)}`;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.input.tab")) {
			if (this.scopedModelItems.length > 0) {
				const nextScope: ModelScope = this.scope === "all" ? "scoped" : "all";
				this.setScope(nextScope);
				if (this.scopeHintText) {
					this.scopeHintText.setText(this.getScopeHintText());
				}
			} else {
				this.cycleProvider();
			}
			return;
		}
		// Up arrow - wrap to bottom when at top
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
			this.updateList();
		}
		// Down arrow - wrap to top when at bottom
		else if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
		}
		// Enter
		else if (kb.matches(keyData, "tui.select.confirm")) {
			const selectedModel = this.filteredModels[this.selectedIndex];
			if (selectedModel) {
				this.handleSelect(selectedModel.model);
			}
		}
		// Escape or Ctrl+C
		else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		}
		// Pass everything else to search input
		else {
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}

	private handleSelect(model: Model<any>): void {
		// Save as new default
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
		this.onSelectCallback(model);
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
