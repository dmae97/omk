import { type Model, modelsAreEqual } from "@oh-my-pi/pi-ai";
import {
	Container,
	Input,
	matchesKey,
	Spacer,
	type Tab,
	TabBar,
	type TabBarTheme,
	Text,
	type TUI,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { MODEL_ROLE_IDS, MODEL_ROLES, type ModelRegistry, type ModelRole } from "../../config/model-registry";
import { parseModelString } from "../../config/model-resolver";
import type { Settings } from "../../config/settings";
import { type ThemeColor, theme } from "../../modes/theme/theme";
import { fuzzyFilter } from "../../utils/fuzzy";
import { DynamicBorder } from "./dynamic-border";

function makeInvertedBadge(label: string, color: ThemeColor): string {
	const fgAnsi = theme.getFgAnsi(color);
	const bgAnsi = fgAnsi.replace(/\x1b\[38;/g, "\x1b[48;");
	return `${bgAnsi}\x1b[30m ${label} \x1b[39m\x1b[49m`;
}

interface ModelItem {
	provider: string;
	id: string;
	model: Model;
}

interface ScopedModelItem {
	model: Model;
	thinkingLevel: string;
}

interface MenuAction {
	label: string;
	role: ModelRole;
}

const MENU_ACTIONS: MenuAction[] = MODEL_ROLE_IDS.map(role => ({ label: `Set as ${MODEL_ROLES[role].name}`, role }));

const ALL_TAB = "ALL";

function getTabBarTheme(): TabBarTheme {
	return {
		label: (text: string) => theme.bold(theme.fg("accent", text)),
		activeTab: (text: string) => theme.bold(theme.bg("selectedBg", theme.fg("text", text))),
		inactiveTab: (text: string) => theme.fg("muted", text),
		hint: (text: string) => theme.fg("dim", text),
	};
}

/**
 * Component that renders a model selector with provider tabs and context menu.
 * - Tab/Arrow Left/Right: Switch between provider tabs
 * - Arrow Up/Down: Navigate model list
 * - Enter: Open context menu to select action
 * - Escape: Close menu or selector
 */
export class ModelSelectorComponent extends Container {
	private searchInput: Input;
	private headerContainer: Container;
	private tabBar: TabBar | null = null;
	private listContainer: Container;
	private menuContainer: Container;
	private allModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private selectedIndex: number = 0;
	private roles: { [key in ModelRole]?: Model } = {};
	private settings: Settings;
	private modelRegistry: ModelRegistry;
	private onSelectCallback: (model: Model, role: ModelRole | null) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private tui: TUI;
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private temporaryOnly: boolean;

	// Tab state
	private providers: string[] = [ALL_TAB];
	private activeTabIndex: number = 0;

	// Context menu state
	private isMenuOpen: boolean = false;
	private menuSelectedIndex: number = 0;

	constructor(
		tui: TUI,
		_currentModel: Model | undefined,
		settings: Settings,
		modelRegistry: ModelRegistry,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model, role: ModelRole | null) => void,
		onCancel: () => void,
		options?: { temporaryOnly?: boolean; initialSearchInput?: string },
	) {
		super();

		this.tui = tui;
		this.settings = settings;
		this.modelRegistry = modelRegistry;
		this.scopedModels = scopedModels;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;
		this.temporaryOnly = options?.temporaryOnly ?? false;
		const initialSearchInput = options?.initialSearchInput;

		// Load current role assignments from settings
		this._loadRoleModels();

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add hint about model filtering
		const hintText =
			scopedModels.length > 0
				? "Showing models from --models scope"
				: "Only showing models with configured API keys (see README for details)";
		this.addChild(new Text(theme.fg("warning", hintText), 0, 0));
		this.addChild(new Spacer(1));

		// Create header container for tab bar
		this.headerContainer = new Container();
		this.addChild(this.headerContainer);

		this.addChild(new Spacer(1));

		// Create search input
		this.searchInput = new Input();
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
		}
		this.searchInput.onSubmit = () => {
			// Enter on search input opens menu if we have a selection
			if (this.filteredModels[this.selectedIndex]) {
				this.openMenu();
			}
		};
		this.addChild(this.searchInput);

		this.addChild(new Spacer(1));

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		// Create menu container (hidden by default)
		this.menuContainer = new Container();
		this.addChild(this.menuContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Load models and do initial render
		this.loadModels().then(() => {
			this.buildProviderTabs();
			this.updateTabBar();
			if (initialSearchInput) {
				this.filterModels(initialSearchInput);
			} else {
				this.updateList();
			}
			// Request re-render after models are loaded
			this.tui.requestRender();
		});
	}

	private _loadRoleModels(): void {
		const allModels = this.modelRegistry.getAll();
		for (const role of MODEL_ROLE_IDS) {
			const modelId = this.settings.getModelRole(role);
			if (!modelId) continue;
			const parsed = parseModelString(modelId);
			if (parsed) {
				const model = allModels.find(m => m.provider === parsed.provider && m.id === parsed.id);
				if (model) {
					this.roles[role] = model;
				}
			}
		}
	}

	private sortModels(models: ModelItem[]): void {
		// Sort: tagged models (default/smol/slow/plan) first, then MRU, then alphabetical
		const mruOrder = this.settings.getStorage()?.getModelUsageOrder() ?? [];
		const mruIndex = new Map(mruOrder.map((key, i) => [key, i]));

		const modelRank = (model: ModelItem) => {
			let i = 0;
			while (i < MODEL_ROLE_IDS.length) {
				const role = MODEL_ROLE_IDS[i];
				if (this.roles[role] && modelsAreEqual(this.roles[role], model.model)) {
					break;
				}
				i++;
			}
			return i;
		};

		models.sort((a, b) => {
			const aKey = `${a.provider}/${a.id}`;
			const bKey = `${b.provider}/${b.id}`;

			const aRank = modelRank(a);
			const bRank = modelRank(b);
			if (aRank !== bRank) return aRank - bRank;

			// Then MRU order (models in mruIndex come before those not in it)
			const aMru = mruIndex.get(aKey) ?? Number.MAX_SAFE_INTEGER;
			const bMru = mruIndex.get(bKey) ?? Number.MAX_SAFE_INTEGER;
			if (aMru !== bMru) return aMru - bMru;

			// Finally alphabetical by provider, then id
			const providerCmp = a.provider.localeCompare(b.provider);
			if (providerCmp !== 0) return providerCmp;
			return a.id.localeCompare(b.id);
		});
	}

	private async loadModels(): Promise<void> {
		let models: ModelItem[];

		// Use scoped models if provided via --models flag
		if (this.scopedModels.length > 0) {
			models = this.scopedModels.map(scoped => ({
				provider: scoped.model.provider,
				id: scoped.model.id,
				model: scoped.model,
			}));
		} else {
			// Refresh to pick up any changes to models.json
			await this.modelRegistry.refresh();

			// Check for models.json errors
			const loadError = this.modelRegistry.getError();
			if (loadError) {
				this.errorMessage = loadError;
			}

			// Load available models (built-in models still work even if models.json failed)
			try {
				const availableModels = this.modelRegistry.getAvailable();
				models = availableModels.map((model: Model) => ({
					provider: model.provider,
					id: model.id,
					model,
				}));
			} catch (error) {
				this.allModels = [];
				this.filteredModels = [];
				this.errorMessage = error instanceof Error ? error.message : String(error);
				return;
			}
		}

		this.sortModels(models);

		this.allModels = models;
		this.filteredModels = models;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, models.length - 1));
	}

	private buildProviderTabs(): void {
		// Extract unique providers from models
		const providerSet = new Set<string>();
		for (const item of this.allModels) {
			providerSet.add(item.provider.toUpperCase());
		}
		// Sort providers alphabetically
		const sortedProviders = Array.from(providerSet).sort();
		this.providers = [ALL_TAB, ...sortedProviders];
	}

	private updateTabBar(): void {
		this.headerContainer.clear();

		const tabs: Tab[] = this.providers.map(provider => ({ id: provider, label: provider }));
		const tabBar = new TabBar("Models", tabs, getTabBarTheme(), this.activeTabIndex);
		tabBar.onTabChange = (_tab, index) => {
			this.activeTabIndex = index;
			this.selectedIndex = 0;
			this.applyTabFilter();
		};
		this.tabBar = tabBar;
		this.headerContainer.addChild(tabBar);
	}

	private getActiveProvider(): string {
		return this.providers[this.activeTabIndex] ?? ALL_TAB;
	}

	private filterModels(query: string): void {
		const activeProvider = this.getActiveProvider();

		// Start with all models or filter by provider
		let baseModels = this.allModels;
		if (activeProvider !== ALL_TAB) {
			baseModels = this.allModels.filter(m => m.provider.toUpperCase() === activeProvider);
		}

		// Apply fuzzy filter if query is present
		if (query.trim()) {
			// If user is searching, auto-switch to ALL tab to show global results
			if (activeProvider !== ALL_TAB) {
				this.activeTabIndex = 0;
				if (this.tabBar && this.tabBar.getActiveIndex() !== 0) {
					this.tabBar.setActiveIndex(0);
					return;
				}
				this.updateTabBar();
				baseModels = this.allModels;
			}
			const fuzzyMatches = fuzzyFilter(baseModels, query, ({ id, provider }) => `${id} ${provider}`);
			this.sortModels(fuzzyMatches);
			this.filteredModels = fuzzyMatches;
		} else {
			this.filteredModels = baseModels;
		}

		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		this.updateList();
	}

	private applyTabFilter(): void {
		const query = this.searchInput.getValue();
		this.filterModels(query);
	}

	private updateList(): void {
		this.listContainer.clear();

		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredModels.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.filteredModels.length);

		const activeProvider = this.getActiveProvider();
		const showProvider = activeProvider === ALL_TAB;

		// Show visible slice of filtered models
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredModels[i];
			if (!item) continue;

			const isSelected = i === this.selectedIndex;

			// Build role badges (inverted: color as background, black text)
			const badges: string[] = [];
			for (const role of MODEL_ROLE_IDS) {
				const { tag, color } = MODEL_ROLES[role];
				if (tag && modelsAreEqual(this.roles[role], item.model)) {
					badges.push(makeInvertedBadge(tag, color ?? "success"));
				}
			}
			const badgeText = badges.length > 0 ? ` ${badges.join(" ")}` : "";

			let line = "";
			if (isSelected) {
				const prefix = theme.fg("accent", `${theme.nav.cursor} `);
				if (showProvider) {
					const providerPrefix = theme.fg("dim", `${item.provider}/`);
					line = `${prefix}${providerPrefix}${theme.fg("accent", item.id)}${badgeText}`;
				} else {
					line = `${prefix}${theme.fg("accent", item.id)}${badgeText}`;
				}
			} else {
				const prefix = "  ";
				if (showProvider) {
					const providerPrefix = theme.fg("dim", `${item.provider}/`);
					line = `${prefix}${providerPrefix}${item.id}${badgeText}`;
				} else {
					line = `${prefix}${item.id}${badgeText}`;
				}
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
			const errorLines = this.errorMessage.split("\n");
			for (const line of errorLines) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		} else if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
		}
	}

	private openMenu(): void {
		if (this.filteredModels.length === 0) return;

		this.isMenuOpen = true;
		this.menuSelectedIndex = 0;
		this.updateMenu();
	}

	private closeMenu(): void {
		this.isMenuOpen = false;
		this.menuContainer.clear();
	}

	private updateMenu(): void {
		this.menuContainer.clear();

		const selectedModel = this.filteredModels[this.selectedIndex];
		if (!selectedModel) return;

		const headerText = `  Action for: ${selectedModel.id}`;
		const hintText = "  Enter: confirm  Esc: cancel";
		const actionLines = MENU_ACTIONS.map((action, index) => {
			const prefix = index === this.menuSelectedIndex ? `  ${theme.nav.cursor} ` : "    ";
			return `${prefix}${action.label}`;
		});
		const menuWidth = Math.max(
			visibleWidth(headerText),
			visibleWidth(hintText),
			...actionLines.map(line => visibleWidth(line)),
		);

		// Menu header
		this.menuContainer.addChild(new Spacer(1));
		this.menuContainer.addChild(new Text(theme.fg("border", theme.boxSharp.horizontal.repeat(menuWidth)), 0, 0));
		this.menuContainer.addChild(new Text(theme.fg("text", `  Action for: ${theme.bold(selectedModel.id)}`), 0, 0));
		this.menuContainer.addChild(new Spacer(1));

		// Menu options
		for (let i = 0; i < MENU_ACTIONS.length; i++) {
			const action = MENU_ACTIONS[i]!;
			const isSelected = i === this.menuSelectedIndex;

			let line: string;
			if (isSelected) {
				line = theme.fg("accent", `  ${theme.nav.cursor} ${action.label}`);
			} else {
				line = theme.fg("muted", `    ${action.label}`);
			}
			this.menuContainer.addChild(new Text(line, 0, 0));
		}

		this.menuContainer.addChild(new Spacer(1));
		this.menuContainer.addChild(new Text(theme.fg("dim", hintText), 0, 0));
		this.menuContainer.addChild(new Text(theme.fg("border", theme.boxSharp.horizontal.repeat(menuWidth)), 0, 0));
	}

	handleInput(keyData: string): void {
		if (this.isMenuOpen) {
			this.handleMenuInput(keyData);
			return;
		}

		// Tab bar navigation
		if (this.tabBar?.handleInput(keyData)) {
			return;
		}

		// Up arrow - navigate list (wrap to bottom when at top)
		if (matchesKey(keyData, "up")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}

		// Down arrow - navigate list (wrap to top when at bottom)
		if (matchesKey(keyData, "down")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}

		// Enter - open context menu or select directly in temporary mode
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			const selectedModel = this.filteredModels[this.selectedIndex];
			if (selectedModel) {
				if (this.temporaryOnly) {
					// In temporary mode, skip menu and select directly
					this.handleSelect(selectedModel.model, null);
				} else {
					this.openMenu();
				}
			}
			return;
		}

		// Escape or Ctrl+C - close selector
		if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc") || matchesKey(keyData, "ctrl+c")) {
			this.onCancelCallback();
			return;
		}

		// Pass everything else to search input
		this.searchInput.handleInput(keyData);
		this.filterModels(this.searchInput.getValue());
	}

	private handleMenuInput(keyData: string): void {
		// Up arrow - navigate menu
		if (matchesKey(keyData, "up")) {
			this.menuSelectedIndex = (this.menuSelectedIndex - 1 + MENU_ACTIONS.length) % MENU_ACTIONS.length;
			this.updateMenu();
			return;
		}

		// Down arrow - navigate menu
		if (matchesKey(keyData, "down")) {
			this.menuSelectedIndex = (this.menuSelectedIndex + 1) % MENU_ACTIONS.length;
			this.updateMenu();
			return;
		}

		// Enter - confirm selection
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			const selectedModel = this.filteredModels[this.selectedIndex];
			const action = MENU_ACTIONS[this.menuSelectedIndex];
			if (selectedModel && action) {
				this.handleSelect(selectedModel.model, action.role);
				this.closeMenu();
			}
			return;
		}

		// Escape or Ctrl+C - close menu only
		if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc") || matchesKey(keyData, "ctrl+c")) {
			this.closeMenu();
			return;
		}
	}

	private handleSelect(model: Model, role: ModelRole | null): void {
		// For temporary role, don't save to settings - just notify caller
		if (role === null) {
			this.onSelectCallback(model, null);
			return;
		}

		// Save to settings
		this.settings.setModelRole(role, `${model.provider}/${model.id}`);

		// Update local state for UI
		this.roles[role] = model;

		// Notify caller (for updating agent state if needed)
		this.onSelectCallback(model, role);

		// Update list to show new badges
		this.updateList();
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
