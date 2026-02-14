import { copyToClipboard } from "@oh-my-pi/pi-natives";
import { type Component, matchesKey, padding, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { theme } from "../modes/theme/theme";
import { replaceTabs } from "../tools/render-utils";
import { formatDebugLogExpandedLines, formatDebugLogLine, parseDebugLogTimestampMs } from "./log-formatting";

export const SESSION_BOUNDARY_WARNING = "### WARNING - Logs above are older than current session!";

type LogEntry = {
	rawLine: string;
	timestampMs: number | undefined;
};

type ViewerRow =
	| {
			kind: "warning";
	  }
	| {
			kind: "log";
			logIndex: number;
	  };

function getProcessStartMs(): number {
	return Date.now() - process.uptime() * 1000;
}

export function splitLogText(logText: string): string[] {
	return logText.split("\n").filter(line => line.length > 0);
}

export function buildLogCopyPayload(lines: string[]): string {
	return lines
		.map(line => sanitizeText(line))
		.filter(line => line.length > 0)
		.join("\n");
}

export class DebugLogViewerModel {
	#entries: LogEntry[];
	#rows: ViewerRow[];
	#visibleLogIndices: number[];
	#cursorVisibleIndex = 0;
	#selectionAnchorVisibleIndex: number | undefined;
	#expandedLogIndices = new Set<number>();
	#filterQuery = "";
	#processStartMs: number;

	constructor(logText: string, processStartMs: number = getProcessStartMs()) {
		this.#entries = splitLogText(logText).map(rawLine => ({
			rawLine,
			timestampMs: parseDebugLogTimestampMs(rawLine),
		}));
		this.#processStartMs = processStartMs;
		this.#rows = [];
		this.#visibleLogIndices = [];
		this.#rebuildRows();
	}

	get logCount(): number {
		return this.#entries.length;
	}

	get visibleLogCount(): number {
		return this.#visibleLogIndices.length;
	}

	get rows(): readonly ViewerRow[] {
		return this.#rows;
	}

	get filterQuery(): string {
		return this.#filterQuery;
	}

	get cursorLogIndex(): number {
		return this.#visibleLogIndices[this.#cursorVisibleIndex] ?? 0;
	}

	get expandedCount(): number {
		return this.#expandedLogIndices.size;
	}

	getRawLine(logIndex: number): string {
		return this.#entries[logIndex]?.rawLine ?? "";
	}

	setFilterQuery(query: string): void {
		if (query === this.#filterQuery) {
			return;
		}
		this.#filterQuery = query;
		this.#rebuildRows();
	}

	moveCursor(delta: number, extendSelection: boolean): void {
		if (this.#visibleLogIndices.length === 0) {
			return;
		}

		if (extendSelection && this.#selectionAnchorVisibleIndex === undefined) {
			this.#selectionAnchorVisibleIndex = this.#cursorVisibleIndex;
		}

		this.#cursorVisibleIndex = Math.max(
			0,
			Math.min(this.#visibleLogIndices.length - 1, this.#cursorVisibleIndex + delta),
		);

		if (!extendSelection) {
			this.#selectionAnchorVisibleIndex = undefined;
		}
	}

	getSelectedLogIndices(): number[] {
		if (this.#visibleLogIndices.length === 0) {
			return [];
		}

		if (this.#selectionAnchorVisibleIndex === undefined) {
			return [this.cursorLogIndex];
		}

		const min = Math.min(this.#selectionAnchorVisibleIndex, this.#cursorVisibleIndex);
		const max = Math.max(this.#selectionAnchorVisibleIndex, this.#cursorVisibleIndex);
		const selected: number[] = [];
		for (let i = min; i <= max; i++) {
			const logIndex = this.#visibleLogIndices[i];
			if (logIndex !== undefined) {
				selected.push(logIndex);
			}
		}
		return selected;
	}

	getSelectedCount(): number {
		return this.getSelectedLogIndices().length;
	}

	isSelected(logIndex: number): boolean {
		const selected = this.getSelectedLogIndices();
		return selected.includes(logIndex);
	}

	isExpanded(logIndex: number): boolean {
		return this.#expandedLogIndices.has(logIndex);
	}

	expandSelected(): void {
		for (const index of this.getSelectedLogIndices()) {
			this.#expandedLogIndices.add(index);
		}
	}

	collapseSelected(): void {
		for (const index of this.getSelectedLogIndices()) {
			this.#expandedLogIndices.delete(index);
		}
	}

	getSelectedRawLines(): string[] {
		const selectedIndices = this.getSelectedLogIndices();
		return selectedIndices.map(index => this.getRawLine(index));
	}

	#rebuildRows(): void {
		const previousVisible = this.#visibleLogIndices;
		const previousCursorLogIndex = previousVisible[this.#cursorVisibleIndex];
		const previousAnchorLogIndex =
			this.#selectionAnchorVisibleIndex === undefined
				? undefined
				: previousVisible[this.#selectionAnchorVisibleIndex];

		const query = this.#filterQuery.toLowerCase();
		const visible: number[] = [];
		for (let i = 0; i < this.#entries.length; i++) {
			const entry = this.#entries[i];
			if (!entry) {
				continue;
			}
			if (query.length === 0 || entry.rawLine.toLowerCase().includes(query)) {
				visible.push(i);
			}
		}
		this.#visibleLogIndices = visible;

		const rows: ViewerRow[] = [];
		let olderSeen = false;
		let warningInserted = false;
		for (const logIndex of visible) {
			const timestampMs = this.#entries[logIndex]?.timestampMs;
			if (timestampMs !== undefined) {
				if (timestampMs < this.#processStartMs) {
					olderSeen = true;
				} else if (olderSeen && !warningInserted) {
					rows.push({ kind: "warning" });
					warningInserted = true;
				}
			}
			rows.push({ kind: "log", logIndex });
		}
		this.#rows = rows;

		if (visible.length === 0) {
			this.#cursorVisibleIndex = 0;
			this.#selectionAnchorVisibleIndex = undefined;
			return;
		}

		if (previousCursorLogIndex !== undefined) {
			const cursorIndex = visible.indexOf(previousCursorLogIndex);
			if (cursorIndex >= 0) {
				this.#cursorVisibleIndex = cursorIndex;
			} else {
				this.#cursorVisibleIndex = Math.min(this.#cursorVisibleIndex, visible.length - 1);
			}
		} else {
			this.#cursorVisibleIndex = Math.min(this.#cursorVisibleIndex, visible.length - 1);
		}

		if (previousAnchorLogIndex !== undefined) {
			const anchorIndex = visible.indexOf(previousAnchorLogIndex);
			this.#selectionAnchorVisibleIndex = anchorIndex >= 0 ? anchorIndex : undefined;
		} else {
			this.#selectionAnchorVisibleIndex = undefined;
		}
	}
}

interface DebugLogViewerComponentOptions {
	logs: string;
	terminalRows: number;
	onExit: () => void;
	onStatus?: (message: string) => void;
	onError?: (message: string) => void;
	processStartMs?: number;
}

export class DebugLogViewerComponent implements Component {
	#model: DebugLogViewerModel;
	#terminalRows: number;
	#onExit: () => void;
	#onStatus?: (message: string) => void;
	#onError?: (message: string) => void;
	#lastRenderWidth = 80;
	#scrollRowOffset = 0;
	#statusMessage: string | undefined;

	constructor(options: DebugLogViewerComponentOptions) {
		this.#model = new DebugLogViewerModel(options.logs, options.processStartMs);
		this.#terminalRows = options.terminalRows;
		this.#onExit = options.onExit;
		this.#onStatus = options.onStatus;
		this.#onError = options.onError;
	}

	handleInput(keyData: string): void {
		if (matchesKey(keyData, "escape") || matchesKey(keyData, "esc")) {
			this.#onExit();
			return;
		}

		if (matchesKey(keyData, "ctrl+c")) {
			void this.#copySelected();
			return;
		}

		if (matchesKey(keyData, "shift+up")) {
			this.#statusMessage = undefined;
			this.#model.moveCursor(-1, true);
			this.#ensureCursorVisible();
			return;
		}

		if (matchesKey(keyData, "shift+down")) {
			this.#statusMessage = undefined;
			this.#model.moveCursor(1, true);
			this.#ensureCursorVisible();
			return;
		}

		if (matchesKey(keyData, "up")) {
			this.#statusMessage = undefined;
			this.#model.moveCursor(-1, false);
			this.#ensureCursorVisible();
			return;
		}

		if (matchesKey(keyData, "down")) {
			this.#statusMessage = undefined;
			this.#model.moveCursor(1, false);
			this.#ensureCursorVisible();
			return;
		}

		if (matchesKey(keyData, "right")) {
			this.#statusMessage = undefined;
			this.#model.expandSelected();
			return;
		}

		if (matchesKey(keyData, "left")) {
			this.#statusMessage = undefined;
			this.#model.collapseSelected();
			return;
		}

		if (matchesKey(keyData, "backspace")) {
			if (this.#model.filterQuery.length > 0) {
				this.#statusMessage = undefined;
				this.#model.setFilterQuery(this.#model.filterQuery.slice(0, -1));
				this.#ensureCursorVisible();
			}
			return;
		}

		const hasControlChars = [...keyData].some(ch => {
			const code = ch.charCodeAt(0);
			return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
		});
		if (!hasControlChars && keyData.length > 0) {
			this.#statusMessage = undefined;
			this.#model.setFilterQuery(this.#model.filterQuery + keyData);
			this.#ensureCursorVisible();
		}
	}

	invalidate(): void {
		// no cached child state
	}

	render(width: number): string[] {
		this.#lastRenderWidth = Math.max(20, width);
		this.#ensureCursorVisible();

		const innerWidth = Math.max(1, this.#lastRenderWidth - 2);
		const bodyHeight = Math.max(3, this.#terminalRows - 8);

		const rows = this.#renderRows(innerWidth);
		const visibleBodyLines = this.#renderVisibleBodyLines(rows, innerWidth, bodyHeight);

		return [
			this.#frameTop(innerWidth),
			this.#frameSeparator(innerWidth),
			this.#frameLine(this.#summaryText(), innerWidth),
			this.#frameSeparator(innerWidth),
			this.#frameLine(this.#filterText(), innerWidth),
			this.#frameSeparator(innerWidth),
			...visibleBodyLines,
			this.#frameLine(this.#statusText(), innerWidth),
			this.#frameBottom(innerWidth),
		];
	}

	#summaryText(): string {
		return ` # ${this.#model.visibleLogCount}/${this.#model.logCount} logs | ${this.#controlsText()}`;
	}

	#controlsText(): string {
		return "Up/Down: move  Shift+Up/Down: select range  Left/Right: collapse/expand  Ctrl+C: copy  Esc: back";
	}

	#filterText(): string {
		const sanitized = replaceTabs(sanitizeText(this.#model.filterQuery));
		const query = sanitized.length === 0 ? "" : theme.fg("accent", sanitized);
		return ` filter: ${query}`;
	}

	#statusText(): string {
		const base = ` Selected: ${this.#model.getSelectedCount()}  Expanded: ${this.#model.expandedCount}`;
		if (this.#statusMessage) {
			return `${base}  ${this.#statusMessage}`;
		}
		return base;
	}

	#renderRows(innerWidth: number): Array<{ lines: string[]; rowIndex: number }> {
		const rendered: Array<{ lines: string[]; rowIndex: number }> = [];

		for (let rowIndex = 0; rowIndex < this.#model.rows.length; rowIndex++) {
			const row = this.#model.rows[rowIndex];
			if (!row) {
				continue;
			}

			if (row.kind === "warning") {
				rendered.push({
					rowIndex,
					lines: [theme.fg("warning", truncateToWidth(SESSION_BOUNDARY_WARNING, innerWidth))],
				});
				continue;
			}

			const logIndex = row.logIndex;
			const selected = this.#model.isSelected(logIndex);
			const active = this.#model.cursorLogIndex === logIndex;
			const expanded = this.#model.isExpanded(logIndex);
			const marker = active ? theme.fg("accent", "❯") : selected ? theme.fg("accent", "•") : " ";
			const fold = expanded ? theme.fg("accent", "▾") : theme.fg("muted", "▸");
			const prefix = `${marker}${fold} `;
			const contentWidth = Math.max(1, innerWidth - visibleWidth(prefix));

			if (expanded) {
				const wrapped = formatDebugLogExpandedLines(this.#model.getRawLine(logIndex), contentWidth);
				const indent = padding(visibleWidth(prefix));
				const lines = wrapped.map((segment, index) => {
					const content = selected ? theme.bold(segment) : segment;
					return truncateToWidth(`${index === 0 ? prefix : indent}${content}`, innerWidth);
				});
				rendered.push({ rowIndex, lines });
				continue;
			}

			const preview = formatDebugLogLine(this.#model.getRawLine(logIndex), contentWidth);
			const content = selected ? theme.bold(preview) : preview;
			rendered.push({ rowIndex, lines: [truncateToWidth(`${prefix}${content}`, innerWidth)] });
		}

		return rendered;
	}

	#renderVisibleBodyLines(
		rows: Array<{ lines: string[]; rowIndex: number }>,
		innerWidth: number,
		bodyHeight: number,
	): string[] {
		const lines: string[] = [];
		if (rows.length === 0) {
			lines.push(this.#frameLine(theme.fg("muted", "no matches"), innerWidth));
		}
		for (let i = this.#scrollRowOffset; i < rows.length; i++) {
			const row = rows[i];
			if (!row) {
				continue;
			}

			for (const line of row.lines) {
				if (lines.length >= bodyHeight) {
					break;
				}
				lines.push(this.#frameLine(line, innerWidth));
			}

			if (lines.length >= bodyHeight) {
				break;
			}
		}

		while (lines.length < bodyHeight) {
			lines.push(this.#frameLine("", innerWidth));
		}

		return lines;
	}

	#ensureCursorVisible(): void {
		const cursorRowIndex = this.#model.rows.findIndex(
			row => row.kind === "log" && row.logIndex === this.#model.cursorLogIndex,
		);
		if (cursorRowIndex < 0) {
			this.#scrollRowOffset = 0;
			return;
		}

		const maxVisibleRows = Math.max(1, Math.max(3, this.#terminalRows - 8));
		if (cursorRowIndex < this.#scrollRowOffset) {
			this.#scrollRowOffset = cursorRowIndex;
			return;
		}

		const maxIndex = this.#scrollRowOffset + maxVisibleRows - 1;
		if (cursorRowIndex > maxIndex) {
			this.#scrollRowOffset = cursorRowIndex - maxVisibleRows + 1;
		}
	}

	#frameTop(innerWidth: number): string {
		return `${theme.boxSharp.topLeft}${theme.boxSharp.horizontal.repeat(innerWidth)}${theme.boxSharp.topRight}`;
	}

	#frameSeparator(innerWidth: number): string {
		return `${theme.boxSharp.teeRight}${theme.boxSharp.horizontal.repeat(innerWidth)}${theme.boxSharp.teeLeft}`;
	}

	#frameBottom(innerWidth: number): string {
		return `${theme.boxSharp.bottomLeft}${theme.boxSharp.horizontal.repeat(innerWidth)}${theme.boxSharp.bottomRight}`;
	}

	#frameLine(content: string, innerWidth: number): string {
		const truncated = truncateToWidth(content, innerWidth);
		const remaining = Math.max(0, innerWidth - visibleWidth(truncated));
		return `${theme.boxSharp.vertical}${truncated}${padding(remaining)}${theme.boxSharp.vertical}`;
	}

	async #copySelected(): Promise<void> {
		const selectedPayload = buildLogCopyPayload(this.#model.getSelectedRawLines());
		const selected = selectedPayload.length === 0 ? [] : selectedPayload.split("\n");

		if (selected.length === 0) {
			const message = "No log entry selected";
			this.#statusMessage = message;
			this.#onStatus?.(message);
			return;
		}

		try {
			await copyToClipboard(selectedPayload);
			const message = `Copied ${selected.length} log ${selected.length === 1 ? "entry" : "entries"}`;
			this.#statusMessage = message;
			this.#onStatus?.(message);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.#statusMessage = `Copy failed: ${message}`;
			this.#onError?.(`Failed to copy logs: ${message}`);
		}
	}
}
