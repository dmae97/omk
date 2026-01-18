import {
	type Component,
	Container,
	Input,
	matchesKey,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import type { HistoryEntry, HistoryStorage } from "../../../core/history-storage";
import { theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";

class HistoryResultsList implements Component {
	private results: HistoryEntry[] = [];
	private selectedIndex = 0;
	private maxVisible = 10;

	setResults(results: HistoryEntry[], selectedIndex: number): void {
		this.results = results;
		this.selectedIndex = selectedIndex;
	}

	setSelectedIndex(selectedIndex: number): void {
		this.selectedIndex = selectedIndex;
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		const lines: string[] = [];

		if (this.results.length === 0) {
			lines.push(theme.fg("muted", "  No matching history"));
			return lines;
		}

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.results.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.results.length);

		for (let i = startIndex; i < endIndex; i++) {
			const entry = this.results[i];
			const isSelected = i === this.selectedIndex;

			const cursorSymbol = `${theme.nav.cursor} `;
			const cursorWidth = visibleWidth(cursorSymbol);
			const cursor = isSelected ? theme.fg("accent", cursorSymbol) : " ".repeat(cursorWidth);
			const maxWidth = width - cursorWidth;

			const normalized = entry.prompt.replace(/\s+/g, " ").trim();
			const truncated = truncateToWidth(normalized, maxWidth, theme.format.ellipsis);
			lines.push(cursor + (isSelected ? theme.bold(truncated) : truncated));
		}

		if (startIndex > 0 || endIndex < this.results.length) {
			const scrollText = `  (${this.selectedIndex + 1}/${this.results.length})`;
			lines.push(theme.fg("muted", truncateToWidth(scrollText, width, "")));
		}

		return lines;
	}
}

export class HistorySearchComponent extends Container {
	private historyStorage: HistoryStorage;
	private searchInput: Input;
	private results: HistoryEntry[] = [];
	private selectedIndex = 0;
	private resultsList: HistoryResultsList;
	private onSelect: (prompt: string) => void;
	private onCancel: () => void;
	private resultLimit = 100;

	constructor(historyStorage: HistoryStorage, onSelect: (prompt: string) => void, onCancel: () => void) {
		super();
		this.historyStorage = historyStorage;
		this.onSelect = onSelect;
		this.onCancel = onCancel;

		this.searchInput = new Input();
		this.searchInput.onSubmit = () => {
			const selected = this.results[this.selectedIndex];
			if (selected) {
				this.onSelect(selected.prompt);
			}
		};
		this.searchInput.onEscape = () => {
			this.onCancel();
		};

		this.resultsList = new HistoryResultsList();

		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Search History (Ctrl+R)"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));
		this.addChild(this.resultsList);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", "up/down navigate  enter select  esc cancel"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateResults();
	}

	handleInput(keyData: string): void {
		if (matchesKey(keyData, "up")) {
			if (this.results.length === 0) return;
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.resultsList.setSelectedIndex(this.selectedIndex);
			return;
		}

		if (matchesKey(keyData, "down")) {
			if (this.results.length === 0) return;
			this.selectedIndex = Math.min(this.results.length - 1, this.selectedIndex + 1);
			this.resultsList.setSelectedIndex(this.selectedIndex);
			return;
		}

		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			const selected = this.results[this.selectedIndex];
			if (selected) {
				this.onSelect(selected.prompt);
			}
			return;
		}

		if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc")) {
			this.onCancel();
			return;
		}

		this.searchInput.handleInput(keyData);
		this.updateResults();
	}

	private updateResults(): void {
		const query = this.searchInput.getValue().trim();
		this.results = query
			? this.historyStorage.search(query, this.resultLimit)
			: this.historyStorage.getRecent(this.resultLimit);
		this.selectedIndex = 0;
		this.resultsList.setResults(this.results, this.selectedIndex);
	}
}
