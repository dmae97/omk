import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { type Model, modelsAreEqual, supportsXhigh } from "@oh-my-pi/pi-ai";
import { Container, Input, matchesKey, Spacer, type Tab, TabBar, Text, type TUI, visibleWidth } from "@oh-my-pi/pi-tui";
import { MODEL_ROLE_IDS, MODEL_ROLES, type ModelRegistry, type ModelRole } from "../../config/model-registry";
import { resolveModelRoleValue } from "../../config/model-resolver";
import type { Settings } from "../../config/settings";
import { type ThemeColor, theme } from "../../modes/theme/theme";
import { fuzzyFilter } from "../../utils/fuzzy";
import { formatThinkingEffortLabel } from "../../utils/thinking-effort-label";
import { getTabBarTheme } from "../shared";
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

type RoleThinkingMode = "default" | ThinkingLevel;

interface RoleAssignment {
	model: Model;
	thinkingMode: RoleThinkingMode;
}

type RoleSelectCallback = (model: Model, role: ModelRole | null, thinkingMode?: RoleThinkingMode) => void;
type CancelCallback = () => void;
interface MenuRoleAction {
	label: string;
	role: ModelRole;
}

const MENU_ROLE_ACTIONS: MenuRoleAction[] = MODEL_ROLE_IDS.map(role => ({
	label: `Set as ${MODEL_ROLES[role].name}`,
	role,
}));

const THINKING_MODE_OPTIONS: RoleThinkingMode[] = ["default", "off", "minimal", "low", "medium", "high"];
const ALL_TAB = "ALL";

/**
 * Component that renders a model selector with provider tabs and context menu.
 * - Tab/Arrow Left/Right: Switch between provider tabs
 * - Arrow Up/Down: Navigate model list
 * - Enter: Open context menu to select action
 * - Escape: Close menu or selector
 */
export class ModelSelectorComponent extends Container {
	#searchInput: Input;
	#headerContainer: Container;
	#tabBar: TabBar | null = null;
	#listContainer: Container;
	#menuContainer: Container;
	#allModels: ModelItem[] = [];
	#filteredModels: ModelItem[] = [];
	#selectedIndex: number = 0;
	#roles = {} as Record<ModelRole, RoleAssignment | undefined>;
	#settings = null as unknown as Settings;
	#modelRegistry = null as unknown as ModelRegistry;
	#onSelectCallback = (() => {}) as RoleSelectCallback;
	#onCancelCallback = (() => {}) as CancelCallback;
	#errorMessage?: unknown;
	#tui: TUI;
	#scopedModels: ReadonlyArray<ScopedModelItem>;
	#temporaryOnly: boolean;

	// Tab state
	#providers: string[] = [ALL_TAB];
	#activeTabIndex: number = 0;

	// Context menu state
	#isMenuOpen: boolean = false;
	#menuSelectedIndex: number = 0;
	#menuStep: "role" | "thinking" = "role";
	#menuSelectedRole: ModelRole | null = null;

	constructor(
		tui: TUI,
		_currentModel: Model | undefined,
		settings: Settings,
		modelRegistry: ModelRegistry,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model, role: ModelRole | null, thinkingMode?: RoleThinkingMode) => void,
		onCancel: () => void,
		options?: { temporaryOnly?: boolean; initialSearchInput?: string },
	) {
		super();

		this.#tui = tui;
		this.#settings = settings;
		this.#modelRegistry = modelRegistry;
		this.#scopedModels = scopedModels;
		this.#onSelectCallback = onSelect;
		this.#onCancelCallback = onCancel;
		this.#temporaryOnly = options?.temporaryOnly ?? false;
		const initialSearchInput = options?.initialSearchInput;

		// Load current role assignments from settings
		this.#loadRoleModels();

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
		this.#headerContainer = new Container();
		this.addChild(this.#headerContainer);

		this.addChild(new Spacer(1));

		// Create search input
		this.#searchInput = new Input();
		if (initialSearchInput) {
			this.#searchInput.setValue(initialSearchInput);
		}
		this.#searchInput.onSubmit = () => {
			// Enter on search input opens menu if we have a selection
			if (this.#filteredModels[this.#selectedIndex]) {
				this.#openMenu();
			}
		};
		this.addChild(this.#searchInput);

		this.addChild(new Spacer(1));

		// Create list container
		this.#listContainer = new Container();
		this.addChild(this.#listContainer);

		// Create menu container (hidden by default)
		this.#menuContainer = new Container();
		this.addChild(this.#menuContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Load models and do initial render
		this.#loadModels().then(() => {
			this.#buildProviderTabs();
			this.#updateTabBar();
			// Always apply the current search query — the user may have typed
			// while models were loading asynchronously.
			const currentQuery = this.#searchInput.getValue();
			if (currentQuery) {
				this.#filterModels(currentQuery);
			} else {
				this.#updateList();
			}
			// Request re-render after models are loaded
			this.#tui.requestRender();
		});
	}

	#loadRoleModels(): void {
		const allModels = this.#modelRegistry.getAll();
		const matchPreferences = { usageOrder: this.#settings.getStorage()?.getModelUsageOrder() };
		for (const role of MODEL_ROLE_IDS) {
			const roleValue = this.#settings.getModelRole(role);
			if (!roleValue) continue;

			const { model, thinkingLevel, explicitThinkingLevel } = resolveModelRoleValue(roleValue, allModels, {
				settings: this.#settings,
				matchPreferences,
			});
			if (model) {
				this.#roles[role] = {
					model,
					thinkingMode: explicitThinkingLevel && thinkingLevel !== undefined ? thinkingLevel : "default",
				};
			}
		}
	}

	#sortModels(models: ModelItem[]): void {
		// Sort: tagged models (default/smol/slow/plan) first, then MRU, then alphabetical
		const mruOrder = this.#settings.getStorage()?.getModelUsageOrder() ?? [];
		const mruIndex = new Map(mruOrder.map((key, i) => [key, i]));

		const modelRank = (model: ModelItem) => {
			let i = 0;
			while (i < MODEL_ROLE_IDS.length) {
				const role = MODEL_ROLE_IDS[i];
				const assigned = this.#roles[role];
				if (assigned && modelsAreEqual(assigned.model, model.model)) {
					break;
				}
				i++;
			}
			return i;
		};

		const dateRe = /-(\d{8})$/;
		const latestRe = /-latest$/;

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

			// By provider, then recency within provider
			const providerCmp = a.provider.localeCompare(b.provider);
			if (providerCmp !== 0) return providerCmp;

			// Priority field (lower = better, e.g. Codex priority values)
			const aPri = a.model.priority ?? Number.MAX_SAFE_INTEGER;
			const bPri = b.model.priority ?? Number.MAX_SAFE_INTEGER;
			if (aPri !== bPri) return aPri - bPri;

			// Version number descending (higher version = better model)
			const aVer = extractVersionNumber(a.id);
			const bVer = extractVersionNumber(b.id);
			if (aVer !== bVer) return bVer - aVer;

			const aIsLatest = latestRe.test(a.id);
			const bIsLatest = latestRe.test(b.id);
			const aDate = a.id.match(dateRe)?.[1] ?? "";
			const bDate = b.id.match(dateRe)?.[1] ?? "";

			// Both have dates or latest tags — sort by recency
			const aHasRecency = aIsLatest || aDate !== "";
			const bHasRecency = bIsLatest || bDate !== "";

			// Models with recency info come before those without
			if (aHasRecency !== bHasRecency) return aHasRecency ? -1 : 1;

			// If neither has recency info, fall back to alphabetical
			if (!aHasRecency) return a.id.localeCompare(b.id);

			// -latest always sorts first within recency group
			if (aIsLatest !== bIsLatest) return aIsLatest ? -1 : 1;

			// Both have dates — descending (newest first)
			if (aDate && bDate) return bDate.localeCompare(aDate);

			// One has date, other is latest — latest first
			return aIsLatest ? -1 : bIsLatest ? 1 : a.id.localeCompare(b.id);
		});
	}

	async #loadModels(): Promise<void> {
		let models: ModelItem[];

		// Use scoped models if provided via --models flag
		if (this.#scopedModels.length > 0) {
			models = this.#scopedModels.map(scoped => ({
				provider: scoped.model.provider,
				id: scoped.model.id,
				model: scoped.model,
			}));
		} else {
			// Refresh to pick up any changes to models.json
			await this.#modelRegistry.refresh();

			// Check for models.json errors
			const loadError = this.#modelRegistry.getError();
			if (loadError) {
				this.#errorMessage = loadError;
			}

			// Load available models (built-in models still work even if models.json failed)
			try {
				const availableModels = this.#modelRegistry.getAvailable();
				models = availableModels.map((model: Model) => ({
					provider: model.provider,
					id: model.id,
					model,
				}));
			} catch (error) {
				this.#allModels = [];
				this.#filteredModels = [];
				this.#errorMessage = error instanceof Error ? error.message : String(error);
				return;
			}
		}

		this.#sortModels(models);

		this.#allModels = models;
		this.#filteredModels = models;
		this.#selectedIndex = Math.min(this.#selectedIndex, Math.max(0, models.length - 1));
	}

	#buildProviderTabs(): void {
		// Extract unique providers from models
		const providerSet = new Set<string>();
		for (const item of this.#allModels) {
			providerSet.add(item.provider.toUpperCase());
		}
		// Sort providers alphabetically
		const sortedProviders = Array.from(providerSet).sort();
		this.#providers = [ALL_TAB, ...sortedProviders];
	}

	#updateTabBar(): void {
		this.#headerContainer.clear();

		const tabs: Tab[] = this.#providers.map(provider => ({ id: provider, label: provider }));
		const tabBar = new TabBar("Models", tabs, getTabBarTheme(), this.#activeTabIndex);
		tabBar.onTabChange = (_tab, index) => {
			this.#activeTabIndex = index;
			this.#selectedIndex = 0;
			this.#applyTabFilter();
		};
		this.#tabBar = tabBar;
		this.#headerContainer.addChild(tabBar);
	}

	#getActiveProvider(): string {
		return this.#providers[this.#activeTabIndex] ?? ALL_TAB;
	}

	#filterModels(query: string): void {
		const activeProvider = this.#getActiveProvider();

		// Start with all models or filter by provider
		let baseModels = this.#allModels;
		if (activeProvider !== ALL_TAB) {
			baseModels = this.#allModels.filter(m => m.provider.toUpperCase() === activeProvider);
		}

		// Apply fuzzy filter if query is present
		if (query.trim()) {
			// If user is searching, auto-switch to ALL tab to show global results
			if (activeProvider !== ALL_TAB) {
				this.#activeTabIndex = 0;
				if (this.#tabBar && this.#tabBar.getActiveIndex() !== 0) {
					this.#tabBar.setActiveIndex(0);
					return;
				}
				this.#updateTabBar();
				baseModels = this.#allModels;
			}
			const fuzzyMatches = fuzzyFilter(baseModels, query, ({ id, provider }) => `${id} ${provider}`);
			this.#sortModels(fuzzyMatches);
			this.#filteredModels = fuzzyMatches;
		} else {
			this.#filteredModels = baseModels;
		}

		this.#selectedIndex = Math.min(this.#selectedIndex, Math.max(0, this.#filteredModels.length - 1));
		this.#updateList();
	}

	#applyTabFilter(): void {
		const query = this.#searchInput.getValue();
		this.#filterModels(query);
	}

	#updateList(): void {
		this.#listContainer.clear();

		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(this.#selectedIndex - Math.floor(maxVisible / 2), this.#filteredModels.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.#filteredModels.length);

		const activeProvider = this.#getActiveProvider();
		const showProvider = activeProvider === ALL_TAB;

		// Show visible slice of filtered models
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.#filteredModels[i];
			if (!item) continue;

			const isSelected = i === this.#selectedIndex;

			// Build role badges (inverted: color as background, black text)
			const roleBadgeTokens: string[] = [];
			for (const role of MODEL_ROLE_IDS) {
				const { tag, color } = MODEL_ROLES[role];
				const assigned = this.#roles[role];
				if (!tag || !assigned || !modelsAreEqual(assigned.model, item.model)) continue;

				const badge = makeInvertedBadge(tag, color ?? "success");
				if (assigned.thinkingMode === "default") {
					roleBadgeTokens.push(badge);
					continue;
				}

				const thinkingLabel = formatThinkingEffortLabel(assigned.thinkingMode);
				roleBadgeTokens.push(`${badge} ${theme.fg("dim", `(${thinkingLabel})`)}`);
			}
			const badgeText = roleBadgeTokens.length > 0 ? ` ${roleBadgeTokens.join(" ")}` : "";

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

			this.#listContainer.addChild(new Text(line, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.#filteredModels.length) {
			const scrollInfo = theme.fg("muted", `  (${this.#selectedIndex + 1}/${this.#filteredModels.length})`);
			this.#listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Show error message or "no results" if empty
		if (this.#errorMessage) {
			const errorLines = String(this.#errorMessage).split("\n");
			for (const line of errorLines) {
				this.#listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		} else if (this.#filteredModels.length === 0) {
			this.#listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
		} else {
			const selected = this.#filteredModels[this.#selectedIndex];
			this.#listContainer.addChild(new Spacer(1));
			this.#listContainer.addChild(new Text(theme.fg("muted", `  Model Name: ${selected.model.name}`), 0, 0));
		}
	}
	#getThinkingModesForModel(model: Model): RoleThinkingMode[] {
		const thinkingModes = [...THINKING_MODE_OPTIONS];
		if (supportsXhigh(model)) {
			thinkingModes.push("xhigh");
		}
		return thinkingModes;
	}

	#getCurrentRoleThinkingMode(role: ModelRole): RoleThinkingMode {
		return this.#roles[role]?.thinkingMode ?? "default";
	}

	#getThinkingPreselectIndex(role: ModelRole, model: Model): number {
		const options = this.#getThinkingModesForModel(model);
		const currentMode = this.#getCurrentRoleThinkingMode(role);
		const preferredMode = currentMode === "xhigh" && !options.includes("xhigh") ? "high" : currentMode;
		const foundIndex = options.indexOf(preferredMode);
		return foundIndex >= 0 ? foundIndex : 0;
	}

	#openMenu(): void {
		if (this.#filteredModels.length === 0) return;

		this.#isMenuOpen = true;
		this.#menuStep = "role";
		this.#menuSelectedRole = null;
		this.#menuSelectedIndex = 0;
		this.#updateMenu();
	}

	#closeMenu(): void {
		this.#isMenuOpen = false;
		this.#menuStep = "role";
		this.#menuSelectedRole = null;
		this.#menuContainer.clear();
	}

	#updateMenu(): void {
		this.#menuContainer.clear();

		const selectedModel = this.#filteredModels[this.#selectedIndex];
		if (!selectedModel) return;

		const showingThinking = this.#menuStep === "thinking" && this.#menuSelectedRole !== null;
		const thinkingOptions = showingThinking ? this.#getThinkingModesForModel(selectedModel.model) : [];
		const optionLines = showingThinking
			? thinkingOptions.map((thinkingMode, index) => {
					const prefix = index === this.#menuSelectedIndex ? `  ${theme.nav.cursor} ` : "    ";
					return `${prefix}${thinkingMode}`;
				})
			: MENU_ROLE_ACTIONS.map((action, index) => {
					const prefix = index === this.#menuSelectedIndex ? `  ${theme.nav.cursor} ` : "    ";
					return `${prefix}${action.label}`;
				});

		const selectedRoleName = this.#menuSelectedRole ? MODEL_ROLES[this.#menuSelectedRole].name : "";
		const headerText = showingThinking ? `  Thinking for: ${selectedRoleName}` : `  Action for: ${selectedModel.id}`;
		const hintText = showingThinking ? "  Enter: confirm  Esc: back" : "  Enter: continue  Esc: cancel";
		const menuWidth = Math.max(
			visibleWidth(headerText),
			visibleWidth(hintText),
			...optionLines.map(line => visibleWidth(line)),
		);

		this.#menuContainer.addChild(new Spacer(1));
		this.#menuContainer.addChild(new Text(theme.fg("border", theme.boxSharp.horizontal.repeat(menuWidth)), 0, 0));
		if (showingThinking && this.#menuSelectedRole) {
			const roleName = MODEL_ROLES[this.#menuSelectedRole].name;
			this.#menuContainer.addChild(
				new Text(
					theme.fg("text", `  Thinking for: ${theme.bold(roleName)} (${theme.bold(selectedModel.id)})`),
					0,
					0,
				),
			);
		} else {
			this.#menuContainer.addChild(
				new Text(theme.fg("text", `  Action for: ${theme.bold(selectedModel.id)}`), 0, 0),
			);
		}
		this.#menuContainer.addChild(new Spacer(1));

		for (let i = 0; i < optionLines.length; i++) {
			const lineText = optionLines[i];
			if (!lineText) continue;
			const isSelected = i === this.#menuSelectedIndex;
			const line = isSelected ? theme.fg("accent", lineText) : theme.fg("muted", lineText);
			this.#menuContainer.addChild(new Text(line, 0, 0));
		}

		this.#menuContainer.addChild(new Spacer(1));
		this.#menuContainer.addChild(new Text(theme.fg("dim", hintText), 0, 0));
		this.#menuContainer.addChild(new Text(theme.fg("border", theme.boxSharp.horizontal.repeat(menuWidth)), 0, 0));
	}

	handleInput(keyData: string): void {
		if (this.#isMenuOpen) {
			this.#handleMenuInput(keyData);
			return;
		}

		// Tab bar navigation
		if (this.#tabBar?.handleInput(keyData)) {
			return;
		}

		// Up arrow - navigate list (wrap to bottom when at top)
		if (matchesKey(keyData, "up")) {
			if (this.#filteredModels.length === 0) return;
			this.#selectedIndex = this.#selectedIndex === 0 ? this.#filteredModels.length - 1 : this.#selectedIndex - 1;
			this.#updateList();
			return;
		}

		// Down arrow - navigate list (wrap to top when at bottom)
		if (matchesKey(keyData, "down")) {
			if (this.#filteredModels.length === 0) return;
			this.#selectedIndex = this.#selectedIndex === this.#filteredModels.length - 1 ? 0 : this.#selectedIndex + 1;
			this.#updateList();
			return;
		}

		// Enter - open context menu or select directly in temporary mode
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			const selectedModel = this.#filteredModels[this.#selectedIndex];
			if (selectedModel) {
				if (this.#temporaryOnly) {
					// In temporary mode, skip menu and select directly
					this.#handleSelect(selectedModel.model, null);
				} else {
					this.#openMenu();
				}
			}
			return;
		}

		// Escape or Ctrl+C - close selector
		if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc") || matchesKey(keyData, "ctrl+c")) {
			this.#onCancelCallback();
			return;
		}

		// Pass everything else to search input
		this.#searchInput.handleInput(keyData);
		this.#filterModels(this.#searchInput.getValue());
	}
	#handleMenuInput(keyData: string): void {
		const selectedModel = this.#filteredModels[this.#selectedIndex];
		if (!selectedModel) return;

		const optionCount =
			this.#menuStep === "thinking" && this.#menuSelectedRole !== null
				? this.#getThinkingModesForModel(selectedModel.model).length
				: MENU_ROLE_ACTIONS.length;
		if (optionCount === 0) return;

		if (matchesKey(keyData, "up")) {
			this.#menuSelectedIndex = (this.#menuSelectedIndex - 1 + optionCount) % optionCount;
			this.#updateMenu();
			return;
		}

		if (matchesKey(keyData, "down")) {
			this.#menuSelectedIndex = (this.#menuSelectedIndex + 1) % optionCount;
			this.#updateMenu();
			return;
		}

		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			if (this.#menuStep === "role") {
				const action = MENU_ROLE_ACTIONS[this.#menuSelectedIndex];
				if (!action) return;
				this.#menuSelectedRole = action.role;
				this.#menuStep = "thinking";
				this.#menuSelectedIndex = this.#getThinkingPreselectIndex(action.role, selectedModel.model);
				this.#updateMenu();
				return;
			}

			if (!this.#menuSelectedRole) return;
			const thinkingOptions = this.#getThinkingModesForModel(selectedModel.model);
			const thinkingMode = thinkingOptions[this.#menuSelectedIndex];
			if (!thinkingMode) return;
			this.#handleSelect(selectedModel.model, this.#menuSelectedRole, thinkingMode);
			this.#closeMenu();
			return;
		}

		if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc") || matchesKey(keyData, "ctrl+c")) {
			if (this.#menuStep === "thinking" && this.#menuSelectedRole !== null) {
				this.#menuStep = "role";
				const roleIndex = MENU_ROLE_ACTIONS.findIndex(action => action.role === this.#menuSelectedRole);
				this.#menuSelectedRole = null;
				this.#menuSelectedIndex = roleIndex >= 0 ? roleIndex : 0;
				this.#updateMenu();
				return;
			}
			this.#closeMenu();
			return;
		}
	}

	#formatRoleModelValue(model: Model, thinkingMode: RoleThinkingMode): string {
		const modelKey = `${model.provider}/${model.id}`;
		if (thinkingMode === "default") return modelKey;
		return `${modelKey}:${thinkingMode}`;
	}
	#handleSelect(model: Model, role: ModelRole | null, thinkingMode?: RoleThinkingMode): void {
		// For temporary role, don't save to settings - just notify caller
		if (role === null) {
			this.#onSelectCallback(model, null);
			return;
		}

		const selectedThinkingMode = thinkingMode ?? this.#getCurrentRoleThinkingMode(role);

		// Save to settings
		this.#settings.setModelRole(role, this.#formatRoleModelValue(model, selectedThinkingMode));

		// Update local state for UI
		this.#roles[role] = { model, thinkingMode: selectedThinkingMode };

		// Notify caller (for updating agent state if needed)
		this.#onSelectCallback(model, role, selectedThinkingMode);

		// Update list to show new badges
		this.#updateList();
	}

	getSearchInput(): Input {
		return this.#searchInput;
	}
}

/** Extract the first version number from a model ID (e.g. "gemini-2.5-pro" → 2.5, "claude-sonnet-4-6" → 4.6). */
function extractVersionNumber(id: string): number {
	// Dot-separated version: "gemini-2.5-pro" → 2.5
	const dotMatch = id.match(/(?:^|[-_])(\d+\.\d+)/);
	if (dotMatch) return Number.parseFloat(dotMatch[1]);
	// Dash-separated short segments: "claude-sonnet-4-6" → 4.6, "llama-3-1-8b" → 3.1
	const dashMatch = id.match(/(?:^|[-_])(\d{1,2})-(\d{1,2})(?=-|$)/);
	if (dashMatch) return Number.parseFloat(`${dashMatch[1]}.${dashMatch[2]}`);
	// Single number after separator: "gpt-4o" → 4
	const singleMatch = id.match(/(?:^|[-_])(\d+)/);
	if (singleMatch) return Number.parseFloat(singleMatch[1]);
	return 0;
}
