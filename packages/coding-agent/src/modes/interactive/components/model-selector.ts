import { getSupportedThinkingLevels, type Model, modelsAreEqual } from "@earendil-works/omk-ai";
import {
	Container,
	type Focusable,
	getKeybindings,
	Input,
	Spacer,
	Text,
	type TUI,
	visibleWidth,
} from "@earendil-works/omk-tui";
import type { ModelRegistry } from "../../../core/model-registry.ts";
import type { SettingsManager } from "../../../core/settings-manager.ts";

function formatThinkingBadge(model: Model<any>): string {
	const levels = getSupportedThinkingLevels(model) as string[];
	if (!levels || levels.length === 0) return "think:-";
	if (levels.length === 1) return `think:${levels[0]}`;
	return `think:${levels[0]}…${levels[levels.length - 1]}`;
}

function providerAuthGlyph(authConfigured: boolean): string {
	return authConfigured ? "✓" : "✗";
}

import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";
import {
	ALL_PROVIDER_TAB,
	createInitialModelSelectorState,
	fitProviderStrip,
	type ModelScope,
	type ModelSelectorAction,
	type ModelSelectorModel,
	type ModelSelectorState,
	modelSelectorModelKey,
	modelSelectorReducer,
	type ProviderTab,
	selectedModelKey,
} from "./model-selector-state.ts";

export { ALL_PROVIDER_TAB };
export type { ModelScope, ProviderTab };

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel?: string;
}

export interface ModelSelectorSemanticState {
	readonly scope: ModelScope;
	readonly activeProvider: ProviderTab;
	readonly providerIds: readonly ProviderTab[];
	readonly query: string;
	readonly selectedIndex: number;
	readonly selectedModelKey?: string;
	readonly visibleModelKeys: readonly string[];
}

function toSelectorModel(item: ModelItem): ModelSelectorModel {
	return { provider: item.provider, id: item.id, name: item.model.name };
}

/**
 * Component that renders a model selector with search and provider tabs.
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
	private filteredModels: ModelItem[] = [];
	private selectedIndex: number = 0;
	private currentModel?: Model<any>;
	private currentModelKey?: string;
	private itemsByKey = new Map<string, ModelItem>();
	private state: ModelSelectorState = createInitialModelSelectorState();
	private modelRegistry: ModelRegistry;
	private onSelectCallback: (model: Model<any>) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private tui: TUI;
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private scope: ModelScope = "all";
	private providerTabs: ProviderTab[] = [ALL_PROVIDER_TAB];
	private activeProviderTab: ProviderTab = ALL_PROVIDER_TAB;
	private providerText: Text;
	private providerHintText: Text;
	private scopeText?: Text;
	private scopeHintText?: Text;

	onProviderTabChange?: (tab: ProviderTab) => void;

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		_settingsManager: SettingsManager,
		modelRegistry: ModelRegistry,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
		initialSearchInput?: string,
		initialProviderTab?: ProviderTab,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.modelRegistry = modelRegistry;
		this.scopedModels = scopedModels;
		this.scope = scopedModels.length > 0 ? "scoped" : "all";
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		if (initialProviderTab) {
			// Restored across showModelSelector() invocations so the user does not
			// lose the provider tab they picked last time. REFRESH_MODELS will
			// downgrade this to ALL_PROVIDER_TAB if the tab no longer exists after
			// models are loaded (e.g. provider deauthenticated or scoped).
			this.activeProviderTab = initialProviderTab;
		}
		this.state = createInitialModelSelectorState({ scope: this.scope, activeProvider: this.activeProviderTab });

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		this.providerText = new Text(this.getProviderText(), 0, 0);
		this.addChild(this.providerText);
		this.providerHintText = new Text(this.getProviderHintText(), 0, 0);
		this.addChild(this.providerHintText);

		// Add hint about model filtering
		if (scopedModels.length > 0) {
			this.scopeText = new Text(this.getScopeText(), 0, 0);
			this.addChild(this.scopeText);
			this.scopeHintText = new Text(this.getScopeHintText(), 0, 0);
			this.addChild(this.scopeHintText);
		} else {
			const hintText = "Only showing models from configured providers. Use /login to add providers.";
			this.addChild(new Text(theme.fg("warning", hintText), 0, 0));
		}
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
				this.applyAction({ type: "SEARCH", query: initialSearchInput });
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
			this.errorMessage = error instanceof Error ? error.message : String(error);
			this.itemsByKey.clear();
			this.currentModelKey = undefined;
			this.applyAction({ type: "REFRESH_MODELS", allModels: [], scopedModels: [], currentModelKey: undefined });
			return;
		}

		const allItems = this.sortModels(models);
		this.scopedModels = this.scopedModels.map((scoped) => {
			const refreshed = this.modelRegistry.find(scoped.model.provider, scoped.model.id);
			return refreshed ? { ...scoped, model: refreshed } : scoped;
		});
		const scopedItems: ModelItem[] = this.scopedModels.map((scoped) => ({
			provider: scoped.model.provider,
			id: scoped.model.id,
			model: scoped.model,
		}));

		this.itemsByKey.clear();
		for (const item of allItems) {
			this.itemsByKey.set(modelSelectorModelKey(item), item);
		}
		for (const item of scopedItems) {
			this.itemsByKey.set(modelSelectorModelKey(item), item);
		}

		this.currentModelKey = this.resolveCurrentModelKey(allItems, scopedItems);
		this.applyAction({
			type: "REFRESH_MODELS",
			allModels: allItems.map(toSelectorModel),
			scopedModels: scopedItems.map(toSelectorModel),
			currentModelKey: this.currentModelKey,
		});
	}

	private resolveCurrentModelKey(
		allItems: readonly ModelItem[],
		scopedItems: readonly ModelItem[],
	): string | undefined {
		if (!this.currentModel) return undefined;
		const match =
			allItems.find((item) => modelsAreEqual(this.currentModel, item.model)) ??
			scopedItems.find((item) => modelsAreEqual(this.currentModel, item.model));
		return match ? modelSelectorModelKey(match) : undefined;
	}

	private sortModels(models: ModelItem[]): ModelItem[] {
		const sorted = [...models];
		// Sort: current model first, then by provider
		sorted.sort((a, b) => {
			const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
			const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			return a.provider.localeCompare(b.provider);
		});
		return sorted;
	}

	private isProviderAuthenticated(provider: string): boolean {
		if (provider === ALL_PROVIDER_TAB) return true;
		const status = this.modelRegistry.authStorage.getAuthStatus(provider);
		return status.configured || status.source !== undefined;
	}

	private providerTabLabel(provider: ProviderTab): string {
		const auth = this.isProviderAuthenticated(provider);
		const glyph = provider === ALL_PROVIDER_TAB ? "" : ` ${providerAuthGlyph(auth)}`;
		return `${provider}${glyph}`;
	}

	private themedProviderTab(provider: ProviderTab): string {
		const label = this.providerTabLabel(provider);
		if (provider === this.activeProviderTab) return theme.fg("accent", label);
		return this.isProviderAuthenticated(provider) ? theme.fg("muted", label) : theme.fg("dim", label);
	}

	/**
	 * Build the provider tab row. When a render width is supplied, the strip is
	 * windowed with fitProviderStrip() so it always fits the terminal while keeping
	 * the "all" anchor and the active tab visible; otherwise every tab is shown
	 * (used for non-render measurement contexts).
	 */
	private getProviderText(width?: number): string {
		const prefix = theme.fg("muted", "Provider: ");
		if (this.providerTabs.length === 0) return prefix;
		const separator = theme.fg("dim", " | ");
		const ellipsis = theme.fg("dim", "…");

		let indices: readonly number[];
		let leadingEllipsis = false;
		let trailingEllipsis = false;
		if (width === undefined) {
			indices = this.providerTabs.map((_, index) => index);
		} else {
			const budget = Math.max(0, width - visibleWidth("Provider: "));
			const tabWidths = this.providerTabs.map((provider) => visibleWidth(this.providerTabLabel(provider)));
			const activeIndex = Math.max(0, this.providerTabs.indexOf(this.activeProviderTab));
			const layout = fitProviderStrip(tabWidths, activeIndex, budget, visibleWidth(" | "), visibleWidth("…"));
			indices = layout.indices;
			leadingEllipsis = layout.ellipsisAfterFirst;
			trailingEllipsis = layout.trailingEllipsis;
		}

		const segments: string[] = [];
		for (let position = 0; position < indices.length; position++) {
			if (position === 1 && leadingEllipsis) segments.push(ellipsis);
			const tabIndex = indices[position];
			if (tabIndex === undefined) continue;
			const provider = this.providerTabs[tabIndex];
			if (provider !== undefined) segments.push(this.themedProviderTab(provider));
		}
		if (trailingEllipsis) segments.push(ellipsis);
		return `${prefix}${segments.join(separator)}`;
	}

	private getProviderHintText(): string {
		return (
			keyHint("tui.input.tab", "provider") +
			theme.fg("muted", " · ") +
			keyHint("app.model.providerPrevious", "previous provider")
		);
	}

	private getScopeText(): string {
		const allText = this.scope === "all" ? theme.fg("accent", "all") : theme.fg("muted", "all");
		const scopedText = this.scope === "scoped" ? theme.fg("accent", "scoped") : theme.fg("muted", "scoped");
		return `${theme.fg("muted", "Scope: ")}${allText}${theme.fg("muted", " | ")}${scopedText}`;
	}

	private getScopeHintText(): string {
		return keyHint("app.model.cycleForward", "scope") + theme.fg("muted", " (all/scoped)");
	}

	private applyAction(action: ModelSelectorAction): void {
		const previousProvider = this.state.activeProvider;
		this.state = modelSelectorReducer(this.state, action);
		this.syncRenderState();
		this.updateList();
		if (this.state.activeProvider !== previousProvider) {
			this.onProviderTabChange?.(this.state.activeProvider);
		}
	}

	/**
	 * Mirror the reducer's semantic state into the fields the renderer reads.
	 * The reducer is the single source of truth; these fields are a derived view
	 * kept in sync after every transition.
	 */
	private syncRenderState(): void {
		this.scope = this.state.scope;
		this.activeProviderTab = this.state.activeProvider;
		this.providerTabs = [...this.state.providerIds];
		this.selectedIndex = this.state.selectedIndex;

		const visibleItems: ModelItem[] = [];
		for (const modelKey of this.state.visibleModelKeys) {
			const item = this.itemsByKey.get(modelKey);
			if (item) visibleItems.push(item);
		}
		this.filteredModels = visibleItems;

		this.providerText.setText(this.getProviderText());
		this.providerHintText.setText(this.getProviderHintText());
		if (this.scopeText) {
			this.scopeText.setText(this.getScopeText());
		}
		if (this.scopeHintText) {
			this.scopeHintText.setText(this.getScopeHintText());
		}
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
			const providerAuthed = this.isProviderAuthenticated(item.provider);
			const providerLabel = `[${item.provider}${providerAuthed ? "" : " no-auth"}]`;
			const providerBadge = providerAuthed ? theme.fg("muted", providerLabel) : theme.fg("warning", providerLabel);
			const thinkingBadge = theme.fg("dim", ` · ${formatThinkingBadge(item.model)}`);
			const checkmark = isCurrent ? theme.fg("success", " ✓") : "";

			let line = "";
			if (isSelected) {
				const prefix = theme.fg("accent", "→ ");
				line = `${prefix + theme.fg("accent", item.id)} ${providerBadge}${thinkingBadge}${checkmark}`;
			} else {
				line = `  ${item.id} ${providerBadge}${thinkingBadge}${checkmark}`;
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
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.input.tab")) {
			this.applyAction({ type: "NEXT_PROVIDER" });
			return;
		}
		if (kb.matches(keyData, "app.model.providerPrevious")) {
			this.applyAction({ type: "PREVIOUS_PROVIDER" });
			return;
		}
		if (this.state.scopedModels.length > 0) {
			if (kb.matches(keyData, "app.model.cycleForward")) {
				this.applyAction({ type: "TOGGLE_SCOPE_FORWARD" });
				return;
			}
			if (kb.matches(keyData, "app.model.cycleBackward")) {
				this.applyAction({ type: "TOGGLE_SCOPE_BACKWARD" });
				return;
			}
		}
		// Up arrow - wrap to bottom when at top
		if (kb.matches(keyData, "tui.select.up")) {
			this.applyAction({ type: "MOVE_SELECTION", delta: -1 });
		}
		// Down arrow - wrap to top when at bottom
		else if (kb.matches(keyData, "tui.select.down")) {
			this.applyAction({ type: "MOVE_SELECTION", delta: 1 });
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
			this.applyAction({ type: "SEARCH", query: this.searchInput.getValue() });
		}
	}

	private handleSelect(model: Model<any>): void {
		this.onSelectCallback(model);
	}

	/**
	 * Structured /model contract state. Tests and future reducer/property
	 * harnesses should assert this semantic snapshot instead of parsing themed
	 * presentation text or reaching into private fields.
	 */
	getSemanticState(): ModelSelectorSemanticState {
		return {
			scope: this.state.scope,
			activeProvider: this.state.activeProvider,
			providerIds: [...this.state.providerIds],
			query: this.state.query,
			selectedIndex: this.state.selectedIndex,
			selectedModelKey: selectedModelKey(this.state),
			visibleModelKeys: [...this.state.visibleModelKeys],
		};
	}

	/**
	 * Width-aware render: recompute the provider row for the actual terminal width
	 * so the strip fits without wrapping, then delegate to the container renderer.
	 */
	render(width: number): string[] {
		this.providerText.setText(this.getProviderText(width));
		return super.render(width);
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
