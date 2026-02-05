import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import {
	Container,
	matchesKey,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	Spacer,
	type Tab,
	TabBar,
	type TabBarTheme,
	Text,
} from "@oh-my-pi/pi-tui";
import { type SettingPath, settings } from "../../config/settings";
import type {
	SettingTab,
	StatusLinePreset,
	StatusLineSegmentId,
	StatusLineSeparatorStyle,
} from "../../config/settings-schema";
import { SETTING_TABS, TAB_METADATA } from "../../config/settings-schema";
import { getSelectListTheme, getSettingsListTheme, theme } from "../../modes/theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { PluginSettingsComponent } from "./plugin-settings";
import { getSettingsForTab, type SettingDef } from "./settings-defs";
import { getPreset } from "./status-line/presets";

function getTabBarTheme(): TabBarTheme {
	return {
		label: text => theme.bold(theme.fg("accent", text)),
		activeTab: text => theme.bold(theme.bg("selectedBg", theme.fg("text", text))),
		inactiveTab: text => theme.fg("muted", text),
		hint: text => theme.fg("dim", text),
	};
}

/**
 * A submenu component for selecting from a list of options.
 */
class SelectSubmenu extends Container {
	private selectList: SelectList;
	private previewText: Text | null = null;

	constructor(
		title: string,
		description: string,
		options: ReadonlyArray<SelectItem>,
		currentValue: string,
		onSelect: (value: string) => void,
		onCancel: () => void,
		onSelectionChange?: (value: string) => void,
		private readonly getPreview?: () => string,
	) {
		super();

		// Title
		this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));

		// Description
		if (description) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", description), 0, 0));
		}

		// Preview (if provided)
		if (getPreview) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", "Preview:"), 0, 0));
			this.previewText = new Text(getPreview(), 0, 0);
			this.addChild(this.previewText);
		}

		// Spacer
		this.addChild(new Spacer(1));

		// Select list
		this.selectList = new SelectList(options, Math.min(options.length, 10), getSelectListTheme());

		// Pre-select current value
		const currentIndex = options.findIndex(o => o.value === currentValue);
		if (currentIndex !== -1) {
			this.selectList.setSelectedIndex(currentIndex);
		}

		this.selectList.onSelect = item => {
			onSelect(item.value);
		};

		this.selectList.onCancel = onCancel;

		if (onSelectionChange) {
			this.selectList.onSelectionChange = item => {
				onSelectionChange(item.value);
				// Update preview after the preview callback has applied changes
				this.updatePreview();
			};
		}

		this.addChild(this.selectList);

		// Hint
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "  Enter to select · Esc to go back"), 0, 0));
	}

	private updatePreview(): void {
		if (this.previewText && this.getPreview) {
			this.previewText.setText(this.getPreview());
		}
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}
}

function getSettingsTabs(): Tab[] {
	return [
		...SETTING_TABS.map(id => {
			const meta = TAB_METADATA[id];
			const icon = theme.symbol(meta.icon as Parameters<typeof theme.symbol>[0]);
			return { id, label: `${icon} ${meta.label}` };
		}),
		{ id: "plugins", label: `${theme.icon.package} Plugins` },
	];
}

/**
 * Dynamic context for settings that need runtime data.
 * Some settings (like thinking level) are managed by the session, not Settings.
 */
export interface SettingsRuntimeContext {
	/** Available thinking levels (from session) */
	availableThinkingLevels: ThinkingLevel[];
	/** Current thinking level (from session) */
	thinkingLevel: ThinkingLevel;
	/** Available themes */
	availableThemes: string[];
	/** Working directory for plugins tab */
	cwd: string;
}

/** Status line settings subset for preview */
export interface StatusLinePreviewSettings {
	preset?: StatusLinePreset;
	leftSegments?: StatusLineSegmentId[];
	rightSegments?: StatusLineSegmentId[];
	separator?: StatusLineSeparatorStyle;
}

export interface SettingsCallbacks {
	/** Called when any setting value changes */
	onChange: (path: SettingPath, newValue: unknown) => void;
	/** Called for theme preview while browsing */
	onThemePreview?: (theme: string) => void;
	/** Called for status line preview while configuring */
	onStatusLinePreview?: (settings: StatusLinePreviewSettings) => void;
	/** Get current rendered status line for inline preview */
	getStatusLinePreview?: () => string;
	/** Called when plugins change */
	onPluginsChanged?: () => void;
	/** Called when settings panel is closed */
	onCancel: () => void;
}

/**
 * Main tabbed settings selector component.
 * Uses declarative settings definitions from settings-defs.ts.
 */
export class SettingsSelectorComponent extends Container {
	private tabBar: TabBar;
	private currentList: SettingsList | null = null;
	private currentSubmenu: Container | null = null;
	private pluginComponent: PluginSettingsComponent | null = null;
	private statusPreviewContainer: Container | null = null;
	private statusPreviewText: Text | null = null;
	private currentTabId: SettingTab | "plugins" = "display";

	constructor(
		private readonly context: SettingsRuntimeContext,
		private readonly callbacks: SettingsCallbacks,
	) {
		super();

		// Add top border
		this.addChild(new DynamicBorder());

		// Tab bar
		this.tabBar = new TabBar("Settings", getSettingsTabs(), getTabBarTheme());
		this.tabBar.onTabChange = () => {
			this.switchToTab(this.tabBar.getActiveTab().id as SettingTab | "plugins");
		};
		this.addChild(this.tabBar);

		// Spacer after tab bar
		this.addChild(new Spacer(1));

		// Initialize with first tab
		this.switchToTab("display");

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	private switchToTab(tabId: SettingTab | "plugins"): void {
		this.currentTabId = tabId;

		// Remove current content
		if (this.currentList) {
			this.removeChild(this.currentList);
			this.currentList = null;
		}
		if (this.pluginComponent) {
			this.removeChild(this.pluginComponent);
			this.pluginComponent = null;
		}
		if (this.statusPreviewContainer) {
			this.removeChild(this.statusPreviewContainer);
			this.statusPreviewContainer = null;
			this.statusPreviewText = null;
		}

		// Remove bottom border temporarily
		const bottomBorder = this.children[this.children.length - 1];
		this.removeChild(bottomBorder);

		if (tabId === "plugins") {
			this.showPluginsTab();
		} else {
			this.showSettingsTab(tabId);
		}

		// Re-add bottom border
		this.addChild(bottomBorder);
	}

	/**
	 * Convert a setting definition to a SettingItem for the UI.
	 */
	private defToItem(def: SettingDef): SettingItem | null {
		// Check condition
		if (def.type === "boolean" && def.condition && !def.condition()) {
			return null;
		}

		const currentValue = this.getCurrentValue(def);

		switch (def.type) {
			case "boolean":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: currentValue ? "true" : "false",
					values: ["true", "false"],
				};

			case "enum":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: currentValue as string,
					values: [...def.values],
				};

			case "submenu":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: String(currentValue ?? ""),
					submenu: (cv, done) => this.createSubmenu(def, cv, done),
				};
		}
	}

	/**
	 * Get the current value for a setting.
	 */
	private getCurrentValue(def: SettingDef): unknown {
		return settings.get(def.path);
	}

	/**
	 * Create a submenu for a submenu-type setting.
	 */
	private createSubmenu(
		def: SettingDef & { type: "submenu" },
		currentValue: string,
		done: (value?: string) => void,
	): Container {
		let options = def.options;

		// Special case: inject runtime options for thinking level
		if (def.path === "defaultThinkingLevel") {
			options = this.context.availableThinkingLevels.map(level => {
				const baseOpt = options.find(o => o.value === level);
				return baseOpt || { value: level, label: level };
			});
		} else if (def.path === "theme") {
			options = this.context.availableThemes.map(t => ({ value: t, label: t }));
		}

		// Preview handlers
		let onPreview: ((value: string) => void) | undefined;
		let onPreviewCancel: (() => void) | undefined;

		if (def.path === "theme") {
			onPreview = this.callbacks.onThemePreview;
			onPreviewCancel = () => this.callbacks.onThemePreview?.(currentValue);
		} else if (def.path === "statusLine.preset") {
			onPreview = value => {
				const presetDef = getPreset(
					value as "default" | "minimal" | "compact" | "full" | "nerd" | "ascii" | "custom",
				);
				this.callbacks.onStatusLinePreview?.({
					preset: value as StatusLinePreset,
					leftSegments: presetDef.leftSegments,
					rightSegments: presetDef.rightSegments,
					separator: presetDef.separator,
				});
				this.updateStatusPreview();
			};
			onPreviewCancel = () => {
				const currentPreset = settings.get("statusLine.preset");
				const presetDef = getPreset(currentPreset);
				this.callbacks.onStatusLinePreview?.({
					preset: currentPreset,
					leftSegments: presetDef.leftSegments,
					rightSegments: presetDef.rightSegments,
					separator: presetDef.separator,
				});
				this.updateStatusPreview();
			};
		} else if (def.path === "statusLine.separator") {
			onPreview = value => {
				this.callbacks.onStatusLinePreview?.({ separator: value as StatusLineSeparatorStyle });
				this.updateStatusPreview();
			};
			onPreviewCancel = () => {
				const separator = settings.get("statusLine.separator");
				this.callbacks.onStatusLinePreview?.({ separator });
				this.updateStatusPreview();
			};
		}

		// Provide status line preview for theme selection
		const getPreview = def.path === "theme" ? this.callbacks.getStatusLinePreview : undefined;

		return new SelectSubmenu(
			def.label,
			def.description,
			options,
			currentValue,
			value => {
				// Persist
				this.setSettingValue(def.path, value);
				// Notify
				this.callbacks.onChange(def.path, value);
				done(value);
			},
			() => {
				onPreviewCancel?.();
				done();
			},
			onPreview,
			getPreview,
		);
	}

	/**
	 * Set a setting value, handling type conversion.
	 */
	private setSettingValue(path: SettingPath, value: string): void {
		// Handle number conversions
		const currentValue = settings.get(path);
		if (typeof currentValue === "number") {
			settings.set(path, Number(value) as never);
		} else if (typeof currentValue === "boolean") {
			settings.set(path, (value === "true") as never);
		} else {
			settings.set(path, value as never);
		}
	}

	/**
	 * Show a settings tab using definitions.
	 */
	private showSettingsTab(tabId: SettingTab): void {
		const defs = getSettingsForTab(tabId);
		const items: SettingItem[] = [];

		for (const def of defs) {
			const item = this.defToItem(def);
			if (item) {
				items.push(item);
			}
		}

		// Add status line preview for status tab
		if (tabId === "status") {
			this.statusPreviewContainer = new Container();
			this.statusPreviewContainer.addChild(new Spacer(1));
			this.statusPreviewContainer.addChild(new Text(theme.fg("muted", "Preview:"), 0, 0));
			this.statusPreviewText = new Text(this.getStatusPreviewString(), 0, 0);
			this.statusPreviewContainer.addChild(this.statusPreviewText);
			this.statusPreviewContainer.addChild(new Spacer(1));
			this.addChild(this.statusPreviewContainer);
		}

		this.currentList = new SettingsList(
			items,
			10,
			getSettingsListTheme(),
			(id, newValue) => {
				const def = defs.find(d => d.path === id);
				if (!def) return;

				const path = def.path;

				if (def.type === "boolean") {
					const boolValue = newValue === "true";
					settings.set(path, boolValue as never);
					this.callbacks.onChange(path, boolValue);

					if (tabId === "status") {
						this.triggerStatusLinePreview();
					}
				} else if (def.type === "enum") {
					settings.set(path, newValue as never);
					this.callbacks.onChange(path, newValue);
				}
				// Submenu types are handled in createSubmenu
			},
			() => this.callbacks.onCancel(),
		);

		this.addChild(this.currentList);
	}

	/**
	 * Get the status line preview string.
	 */
	private getStatusPreviewString(): string {
		if (this.callbacks.getStatusLinePreview) {
			return this.callbacks.getStatusLinePreview();
		}
		return theme.fg("dim", "(preview not available)");
	}

	/**
	 * Trigger status line preview with current settings.
	 */
	private triggerStatusLinePreview(): void {
		const statusLineSettings: StatusLinePreviewSettings = {
			preset: settings.get("statusLine.preset"),
			leftSegments: settings.get("statusLine.leftSegments"),
			rightSegments: settings.get("statusLine.rightSegments"),
			separator: settings.get("statusLine.separator"),
		};
		this.callbacks.onStatusLinePreview?.(statusLineSettings);
		this.updateStatusPreview();
	}

	/**
	 * Update the inline status preview text.
	 */
	private updateStatusPreview(): void {
		if (this.statusPreviewText && this.currentTabId === "status") {
			this.statusPreviewText.setText(this.getStatusPreviewString());
		}
	}

	private showPluginsTab(): void {
		this.pluginComponent = new PluginSettingsComponent(this.context.cwd, {
			onClose: () => this.callbacks.onCancel(),
			onPluginChanged: () => this.callbacks.onPluginsChanged?.(),
		});
		this.addChild(this.pluginComponent);
	}

	getFocusComponent(): SettingsList | PluginSettingsComponent {
		// Return the current focusable component - one of these will always be set
		return (this.currentList || this.pluginComponent)!;
	}

	handleInput(data: string): void {
		// Handle tab switching first (tab, shift+tab, or left/right arrows)
		if (
			matchesKey(data, "tab") ||
			matchesKey(data, "shift+tab") ||
			matchesKey(data, "left") ||
			matchesKey(data, "right")
		) {
			this.tabBar.handleInput(data);
			return;
		}

		// Escape at top level cancels
		if ((matchesKey(data, "escape") || matchesKey(data, "esc")) && !this.currentSubmenu) {
			this.callbacks.onCancel();
			return;
		}

		// Pass to current content
		if (this.currentList) {
			this.currentList.handleInput(data);
		} else if (this.pluginComponent) {
			this.pluginComponent.handleInput(data);
		}
	}
}
