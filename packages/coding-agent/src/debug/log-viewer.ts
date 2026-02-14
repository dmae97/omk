import { copyToClipboard } from "@oh-my-pi/pi-natives";
import { type Component, matchesKey, padding, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { theme } from "../modes/theme/theme";
import { replaceTabs } from "../tools/render-utils";
import {
	formatDebugLogExpandedLines,
	formatDebugLogLine,
	parseDebugLogPid,
	parseDebugLogTimestampMs,
} from "./log-formatting";

export const SESSION_BOUNDARY_WARNING = "### WARNING - Logs above are older than current session!";
export const LOAD_OLDER_LABEL = "### LOAD UP TO 50 OLDER ENTRIES";

const INITIAL_LOG_CHUNK = 50;
const LOAD_OLDER_CHUNK = 50;

type LogEntry = {
	rawLine: string;
	timestampMs: number | undefined;
	pid: number | undefined;
};

type ViewerRow =
	| {
			kind: "warning";
	  }
	| {
			kind: "load-older";
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
	#selectableRowIndices: number[];
	#cursorSelectableIndex = 0;
	#selectionAnchorSelectableIndex: number | undefined;
	#expandedLogIndices = new Set<number>();
	#filterQuery = "";
	#processStartMs: number;
	#loadedStartIndex: number;
	#processFilterEnabled = false;
	#processPid: number;

	constructor(logText: string, processStartMs: number = getProcessStartMs(), processPid: number = process.pid) {
		this.#entries = splitLogText(logText).map(rawLine => ({
			rawLine,
			timestampMs: parseDebugLogTimestampMs(rawLine),
			pid: parseDebugLogPid(rawLine),
		}));
		this.#processStartMs = processStartMs;
		this.#processPid = processPid;
		this.#loadedStartIndex = Math.max(0, this.#entries.length - INITIAL_LOG_CHUNK);
		this.#rows = [];
		this.#visibleLogIndices = [];
		this.#selectableRowIndices = [];
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

	get cursorRowIndex(): number | undefined {
		return this.#selectableRowIndices[this.#cursorSelectableIndex];
	}

	get cursorLogIndex(): number | undefined {
		const row = this.#getCursorRow();
		return row?.kind === "log" ? row.logIndex : undefined;
	}

	get filterQuery(): string {
		return this.#filterQuery;
	}

	get cursorRowKind(): ViewerRow["kind"] | undefined {
		return this.#getCursorRow()?.kind;
	}

	get expandedCount(): number {
		return this.#expandedLogIndices.size;
	}

	isProcessFilterEnabled(): boolean {
		return this.#processFilterEnabled;
	}

	isCursorAtFirstSelectableRow(): boolean {
		return this.#cursorSelectableIndex === 0;
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

	toggleProcessFilter(): void {
		this.#processFilterEnabled = !this.#processFilterEnabled;
		this.#rebuildRows();
	}

	moveCursor(delta: number, extendSelection: boolean): void {
		if (this.#selectableRowIndices.length === 0) {
			return;
		}

		if (extendSelection && this.#selectionAnchorSelectableIndex === undefined) {
			const row = this.#getCursorRow();
			if (row?.kind === "log") {
				this.#selectionAnchorSelectableIndex = this.#cursorSelectableIndex;
			}
		}

		this.#cursorSelectableIndex = Math.max(
			0,
			Math.min(this.#selectableRowIndices.length - 1, this.#cursorSelectableIndex + delta),
		);

		if (!extendSelection) {
			this.#selectionAnchorSelectableIndex = undefined;
		}

		if (this.#getCursorRow()?.kind !== "log" && !extendSelection) {
			this.#selectionAnchorSelectableIndex = undefined;
		}
	}

	getSelectedLogIndices(): number[] {
		if (this.#selectableRowIndices.length === 0) {
			return [];
		}

		const cursorRow = this.#getCursorRow();
		if (this.#selectionAnchorSelectableIndex === undefined) {
			if (cursorRow?.kind !== "log") {
				return [];
			}
			return [cursorRow.logIndex];
		}

		const min = Math.min(this.#selectionAnchorSelectableIndex, this.#cursorSelectableIndex);
		const max = Math.max(this.#selectionAnchorSelectableIndex, this.#cursorSelectableIndex);
		const selected: number[] = [];
		for (let i = min; i <= max; i++) {
			const rowIndex = this.#selectableRowIndices[i];
			const row = rowIndex === undefined ? undefined : this.#rows[rowIndex];
			if (row?.kind === "log") {
				selected.push(row.logIndex);
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

	selectAllVisible(): void {
		if (this.#selectableRowIndices.length === 0) {
			return;
		}

		let firstLogIndex: number | undefined;
		let lastLogIndex: number | undefined;
		for (let i = 0; i < this.#selectableRowIndices.length; i++) {
			const rowIndex = this.#selectableRowIndices[i];
			const row = rowIndex === undefined ? undefined : this.#rows[rowIndex];
			if (row?.kind === "log") {
				if (firstLogIndex === undefined) {
					firstLogIndex = i;
				}
				lastLogIndex = i;
			}
		}

		if (firstLogIndex === undefined || lastLogIndex === undefined) {
			return;
		}

		this.#selectionAnchorSelectableIndex = firstLogIndex;
		this.#cursorSelectableIndex = lastLogIndex;
	}

	canLoadOlder(): boolean {
		return this.#loadedStartIndex > 0;
	}

	loadOlder(additionalCount: number = LOAD_OLDER_CHUNK): void {
		if (!this.canLoadOlder()) {
			return;
		}

		const requested = Math.max(1, additionalCount);
		const nextStart = Math.max(0, this.#loadedStartIndex - requested);
		if (nextStart === this.#loadedStartIndex) {
			return;
		}

		this.#loadedStartIndex = nextStart;
		this.#rebuildRows();
	}

	#rebuildRows(): void {
		const previousCursor = this.#getCursorToken();
		const previousAnchorLogIndex = this.#getAnchorLogIndex();

		const query = this.#filterQuery.toLowerCase();
		const visible: number[] = [];
		for (let i = this.#loadedStartIndex; i < this.#entries.length; i++) {
			const entry = this.#entries[i];
			if (!entry) {
				continue;
			}
			if (this.#matchesFilters(entry, query)) {
				visible.push(i);
			}
		}
		this.#visibleLogIndices = visible;

		const rows: ViewerRow[] = [];
		if (this.#hasOlderEntries(query)) {
			rows.push({ kind: "load-older" });
		}
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
		this.#selectableRowIndices = rows
			.map((row, index) => (row.kind === "warning" ? undefined : index))
			.filter((index): index is number => index !== undefined);

		if (this.#selectableRowIndices.length === 0) {
			this.#cursorSelectableIndex = 0;
			this.#selectionAnchorSelectableIndex = undefined;
			return;
		}

		if (previousCursor?.kind === "log") {
			const rowIndex = this.#rows.findIndex(row => row.kind === "log" && row.logIndex === previousCursor.logIndex);
			const selectableIndex = this.#selectableRowIndices.indexOf(rowIndex);
			if (selectableIndex >= 0) {
				this.#cursorSelectableIndex = selectableIndex;
			} else {
				this.#cursorSelectableIndex = this.#selectableRowIndices.length - 1;
			}
		} else if (previousCursor?.kind === "load-older") {
			const rowIndex = this.#rows.findIndex(row => row.kind === "load-older");
			const selectableIndex = this.#selectableRowIndices.indexOf(rowIndex);
			this.#cursorSelectableIndex = selectableIndex >= 0 ? selectableIndex : this.#selectableRowIndices.length - 1;
		} else {
			this.#cursorSelectableIndex = this.#selectableRowIndices.length - 1;
		}

		if (previousAnchorLogIndex !== undefined) {
			const rowIndex = this.#rows.findIndex(row => row.kind === "log" && row.logIndex === previousAnchorLogIndex);
			const selectableIndex = this.#selectableRowIndices.indexOf(rowIndex);
			this.#selectionAnchorSelectableIndex = selectableIndex >= 0 ? selectableIndex : undefined;
		} else {
			this.#selectionAnchorSelectableIndex = undefined;
		}
	}

	#matchesFilters(entry: LogEntry, query: string): boolean {
		if (query.length > 0 && !entry.rawLine.toLowerCase().includes(query)) {
			return false;
		}
		if (!this.#processFilterEnabled) {
			return true;
		}
		return entry.pid === this.#processPid;
	}

	#hasOlderEntries(query: string): boolean {
		if (this.#loadedStartIndex === 0) {
			return false;
		}
		for (let i = 0; i < this.#loadedStartIndex; i++) {
			const entry = this.#entries[i];
			if (entry && this.#matchesFilters(entry, query)) {
				return true;
			}
		}
		return false;
	}

	#getCursorRow(): ViewerRow | undefined {
		const rowIndex = this.cursorRowIndex;
		return rowIndex === undefined ? undefined : this.#rows[rowIndex];
	}

	#getCursorToken(): { kind: "log"; logIndex: number } | { kind: "load-older" } | undefined {
		const row = this.#getCursorRow();
		if (!row) {
			return undefined;
		}
		if (row.kind === "log") {
			return { kind: "log", logIndex: row.logIndex };
		}
		if (row.kind === "load-older") {
			return { kind: "load-older" };
		}
		return undefined;
	}

	#getAnchorLogIndex(): number | undefined {
		if (this.#selectionAnchorSelectableIndex === undefined) {
			return undefined;
		}
		const rowIndex = this.#selectableRowIndices[this.#selectionAnchorSelectableIndex];
		const row = rowIndex === undefined ? undefined : this.#rows[rowIndex];
		return row?.kind === "log" ? row.logIndex : undefined;
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

		if (matchesKey(keyData, "ctrl+p")) {
			this.#statusMessage = undefined;
			this.#model.toggleProcessFilter();
			this.#ensureCursorVisible();
			return;
		}

		if (matchesKey(keyData, "ctrl+a")) {
			this.#statusMessage = undefined;
			this.#model.selectAllVisible();
			this.#ensureCursorVisible();
			return;
		}

		if (matchesKey(keyData, "ctrl+o")) {
			this.#statusMessage = undefined;
			this.#model.loadOlder(this.#bodyHeight() + 1);
			this.#ensureCursorVisible();
			return;
		}

		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return")) {
			if (this.#model.cursorRowKind === "load-older") {
				this.#statusMessage = undefined;
				this.#model.loadOlder();
				this.#ensureCursorVisible();
			}
			return;
		}

		if (matchesKey(keyData, "shift+up")) {
			this.#statusMessage = undefined;
			if (this.#maybeLoadOlderOnUp(true)) {
				return;
			}
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
			if (this.#maybeLoadOlderOnUp(false)) {
				return;
			}
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
			if (this.#model.cursorRowKind === "load-older") {
				this.#model.loadOlder();
				this.#ensureCursorVisible();
				return;
			}
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
		const bodyHeight = this.#bodyHeight();

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
		return "Up/Down: move  Shift+Up/Down: select range  Left/Right: collapse/expand  Ctrl+A: select all  Ctrl+P: pid filter  Ctrl+O: load older  Ctrl+C: copy  Esc: back";
	}

	#filterText(): string {
		const sanitized = replaceTabs(sanitizeText(this.#model.filterQuery));
		const query = sanitized.length === 0 ? "" : theme.fg("accent", sanitized);
		const pidStatus = this.#model.isProcessFilterEnabled()
			? theme.fg("success", "pid:on")
			: theme.fg("muted", "pid:off");
		return ` filter: ${query}  ${pidStatus}`;
	}

	#statusText(): string {
		const base = ` Selected: ${this.#model.getSelectedCount()}  Expanded: ${this.#model.expandedCount}`;
		if (this.#statusMessage) {
			return `${base}  ${this.#statusMessage}`;
		}
		return base;
	}

	#bodyHeight(): number {
		return Math.max(3, this.#terminalRows - 8);
	}

	#maybeLoadOlderOnUp(extendSelection: boolean): boolean {
		if (this.#model.cursorRowKind === "load-older") {
			this.#model.loadOlder();
			this.#ensureCursorVisible();
			return true;
		}

		if (!this.#model.canLoadOlder() || !this.#model.isCursorAtFirstSelectableRow()) {
			return false;
		}

		this.#model.loadOlder();
		this.#model.moveCursor(-1, extendSelection);
		this.#ensureCursorVisible();
		return true;
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
					lines: [theme.fg("muted", truncateToWidth(SESSION_BOUNDARY_WARNING, innerWidth))],
				});
				continue;
			}

			if (row.kind === "load-older") {
				const active = this.#model.cursorRowIndex === rowIndex;
				const marker = active ? theme.fg("accent", "❯") : " ";
				const prefix = `${marker}  `;
				const contentWidth = Math.max(1, innerWidth - visibleWidth(prefix));
				const label = truncateToWidth(LOAD_OLDER_LABEL, contentWidth);
				rendered.push({
					rowIndex,
					lines: [truncateToWidth(`${prefix}${theme.fg("muted", label)}`, innerWidth)],
				});
				continue;
			}

			const logIndex = row.logIndex;
			const selected = this.#model.isSelected(logIndex);
			const cursorLogIndex = this.#model.cursorLogIndex;
			const active = cursorLogIndex !== undefined && cursorLogIndex === logIndex;
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
		const cursorRowIndex = this.#model.cursorRowIndex;
		if (cursorRowIndex === undefined) {
			this.#scrollRowOffset = 0;
			return;
		}

		const maxVisibleRows = Math.max(1, this.#bodyHeight());
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
