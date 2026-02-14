import { copyToClipboard } from "@oh-my-pi/pi-natives";
import {
	type Component,
	isKittyProtocolActive,
	matchesKey,
	padding,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { theme } from "../modes/theme/theme";
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

function findSessionBoundaryIndex(entries: LogEntry[], processStartMs: number): number | undefined {
	let olderSeen = false;

	for (let i = 0; i < entries.length; i++) {
		const timestampMs = entries[i]?.timestampMs;
		if (timestampMs === undefined) {
			continue;
		}

		if (timestampMs < processStartMs) {
			olderSeen = true;
			continue;
		}

		if (olderSeen) {
			return i;
		}
	}

	return undefined;
}

export class DebugLogViewerModel {
	#entries: LogEntry[];
	#rows: ViewerRow[];
	#cursorLogIndex = 0;
	#selectionAnchorLogIndex: number | undefined;
	#expandedLogIndices = new Set<number>();

	constructor(logText: string, processStartMs: number = getProcessStartMs()) {
		this.#entries = splitLogText(logText).map(rawLine => ({
			rawLine,
			timestampMs: parseDebugLogTimestampMs(rawLine),
		}));

		const boundaryIndex = findSessionBoundaryIndex(this.#entries, processStartMs);
		const rows: ViewerRow[] = [];
		for (let i = 0; i < this.#entries.length; i++) {
			if (boundaryIndex !== undefined && i === boundaryIndex) {
				rows.push({ kind: "warning" });
			}
			rows.push({ kind: "log", logIndex: i });
		}
		this.#rows = rows;
	}

	get logCount(): number {
		return this.#entries.length;
	}

	get rows(): readonly ViewerRow[] {
		return this.#rows;
	}

	get cursorLogIndex(): number {
		return this.#cursorLogIndex;
	}

	get expandedCount(): number {
		return this.#expandedLogIndices.size;
	}

	getRawLine(logIndex: number): string {
		return this.#entries[logIndex]?.rawLine ?? "";
	}

	moveCursor(delta: number, extendSelection: boolean): void {
		if (this.#entries.length === 0) {
			return;
		}

		if (extendSelection && this.#selectionAnchorLogIndex === undefined) {
			this.#selectionAnchorLogIndex = this.#cursorLogIndex;
		}

		this.#cursorLogIndex = Math.max(0, Math.min(this.#entries.length - 1, this.#cursorLogIndex + delta));

		if (!extendSelection) {
			this.#selectionAnchorLogIndex = undefined;
		}
	}

	getSelectedLogIndices(): number[] {
		if (this.#entries.length === 0) {
			return [];
		}

		if (this.#selectionAnchorLogIndex === undefined) {
			return [this.#cursorLogIndex];
		}

		const min = Math.min(this.#selectionAnchorLogIndex, this.#cursorLogIndex);
		const max = Math.max(this.#selectionAnchorLogIndex, this.#cursorLogIndex);
		const selected: number[] = [];
		for (let i = min; i <= max; i++) {
			selected.push(i);
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
		}
	}

	invalidate(): void {
		// no cached child state
	}

	render(width: number): string[] {
		this.#lastRenderWidth = Math.max(20, width);
		this.#ensureCursorVisible();

		const innerWidth = Math.max(1, this.#lastRenderWidth - 2);
		const bodyHeight = Math.max(3, this.#terminalRows - 7);

		const rows = this.#renderRows(innerWidth);
		const visibleBodyLines = this.#renderVisibleBodyLines(rows, innerWidth, bodyHeight);

		return [
			this.#frameTop(innerWidth),
			this.#frameLine(` Debug Logs (${this.#model.logCount}) `, innerWidth),
			this.#frameLine(this.#helpText(), innerWidth),
			this.#frameSeparator(innerWidth),
			...visibleBodyLines,
			this.#frameLine(this.#statusText(), innerWidth),
			this.#frameBottom(innerWidth),
		];
	}

	#helpText(): string {
		const shiftHint = isKittyProtocolActive() ? "" : " (Shift+Arrows may require Kitty keyboard protocol)";
		return ` Up/Down: move  Shift+Up/Down: select range  Left/Right: collapse/expand  Ctrl+C: copy  Esc: back${shiftHint}`;
	}

	#statusText(): string {
		const base = ` Selected: ${this.#model.getSelectedCount()}  Expanded: ${this.#model.expandedCount}  Total: ${this.#model.logCount}`;
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

		const maxVisibleRows = Math.max(1, Math.max(3, this.#terminalRows - 7));
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
