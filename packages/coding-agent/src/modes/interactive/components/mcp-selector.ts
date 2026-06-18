/**
 * MCP inventory selector.
 *
 * Renders the merged inventory produced by `loadMcpInventory`. Read-only: env
 * values are never displayed, only key names. Adds fuzzy search input + counter.
 */

import { Container, type Focusable, fuzzyFilter, getKeybindings, Input, Spacer, Text } from "@earendil-works/omk-tui";
import type { McpInventory, McpServerEntry } from "../../../core/mcp-inventory.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

export class McpSelectorComponent extends Container implements Focusable {
	private allEntries: McpServerEntry[];
	private filteredEntries: McpServerEntry[];
	private selectedIndex = 0;
	private listContainer: Container;
	private detailContainer: Container;
	private counterText: Text;
	private searchInput: Input;
	private onCancelCallback: () => void;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(inventory: McpInventory, onCancel: () => void) {
		super();

		this.allEntries = inventory.entries;
		this.filteredEntries = inventory.entries;
		this.onCancelCallback = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		this.addChild(new Text(theme.fg("accent", theme.bold("MCP servers (read-only inventory)")), 1, 0));
		this.addChild(new Spacer(1));

		for (const src of inventory.sources) {
			const status = src.exists ? theme.fg("muted", `${src.serverCount} server(s)`) : theme.fg("dim", "missing");
			this.addChild(new Text(`  ${theme.fg("muted", src.path)}  ·  ${status}`, 1, 0));
		}
		for (const err of inventory.errors) {
			this.addChild(new Text(theme.fg("error", `  parse error: ${err.path}: ${err.message}`), 1, 0));
		}
		this.addChild(new Spacer(1));

		this.counterText = new Text(this.getCounterText(), 1, 0);
		this.addChild(this.counterText);

		this.searchInput = new Input();
		this.searchInput.onSubmit = () => this.updateDetail();
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));

		this.detailContainer = new Container();
		this.addChild(this.detailContainer);
		this.addChild(new Spacer(1));

		this.addChild(
			new Text(
				rawKeyHint("↑↓", "navigate") +
					"  " +
					keyHint("tui.select.cancel", "close") +
					theme.fg("muted", "  (read-only · env values hidden)"),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateList();
		this.updateDetail();
	}

	private getCounterText(): string {
		const total = this.allEntries.length;
		const matched = this.filteredEntries.length;
		return theme.fg("muted", `  matched ${matched} / total ${total}`);
	}

	private applyFilter(query: string): void {
		this.filteredEntries = query
			? fuzzyFilter(this.allEntries, query, (e) => `${e.name} ${e.commandSummary} ${e.source}`)
			: this.allEntries;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredEntries.length - 1));
		this.counterText.setText(this.getCounterText());
		this.updateList();
		this.updateDetail();
	}

	private updateList(): void {
		this.listContainer.clear();
		if (this.filteredEntries.length === 0) {
			const msg = this.allEntries.length === 0 ? "  No MCP servers configured." : "  No entries match the search.";
			this.listContainer.addChild(new Text(theme.fg("muted", msg), 1, 0));
			return;
		}
		for (let i = 0; i < this.filteredEntries.length; i++) {
			const entry = this.filteredEntries[i];
			const isSelected = i === this.selectedIndex;
			const name = isSelected ? theme.fg("accent", `→ ${entry.name}`) : `  ${entry.name}`;
			const meta = theme.fg(
				"muted",
				` · ${entry.commandSummary} · ${entry.envKeys.length} env · ${entry.argsCount} args`,
			);
			const overridden = entry.overriddenBy ? theme.fg("warning", " (overrides earlier source)") : "";
			this.listContainer.addChild(new Text(`${name}${meta}${overridden}`, 1, 0));
		}
	}

	private updateDetail(): void {
		this.detailContainer.clear();
		const entry = this.filteredEntries[this.selectedIndex];
		if (!entry) return;

		this.detailContainer.addChild(new Text(theme.fg("muted", `  source:   ${entry.source}`), 1, 0));
		this.detailContainer.addChild(new Text(theme.fg("muted", `  command:  ${entry.commandSummary}`), 1, 0));
		const envSummary =
			entry.envKeys.length === 0 ? theme.fg("dim", "(none)") : theme.fg("muted", entry.envKeys.join(", "));
		this.detailContainer.addChild(new Text(`  env keys: ${envSummary}`, 1, 0));
		if (typeof entry.startupTimeoutSec === "number") {
			this.detailContainer.addChild(new Text(theme.fg("muted", `  timeout:  ${entry.startupTimeoutSec}s`), 1, 0));
		}
		if (entry.autoApproveCount > 0) {
			this.detailContainer.addChild(
				new Text(theme.fg("muted", `  autoApprove entries: ${entry.autoApproveCount}`), 1, 0),
			);
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredEntries.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredEntries.length - 1 : this.selectedIndex - 1;
			this.updateList();
			this.updateDetail();
			return;
		}
		if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredEntries.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredEntries.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			this.updateDetail();
			return;
		}
		if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
			return;
		}
		this.searchInput.handleInput(keyData);
		this.applyFilter(this.searchInput.getValue());
	}
}
