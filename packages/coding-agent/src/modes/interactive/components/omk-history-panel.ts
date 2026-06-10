/**
 * OMK History Panel — work history sidebar view.
 *
 * Shows recent assistant messages, tool calls, and bash executions
 * so the operator can review what's been done without scrolling
 * the main chat view.
 */

import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/omk-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { theme } from "../theme/theme.ts";

export interface HistoryEntry {
	type: "assistant" | "tool" | "bash" | "user";
	timestamp: number;
	summary: string;
	toolName?: string;
	status?: "ok" | "error" | "running" | "pending";
}

const HISTORY_MIN_WIDTH = 30;
const MAX_ENTRIES = 25;

function formatTimestamp(ms: number): string {
	const now = Date.now();
	const diff = now - ms;
	if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
	return new Date(ms).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

function entryGlyph(entry: HistoryEntry): string {
	switch (entry.type) {
		case "assistant":
			return theme.fg("accent", "◈");
		case "tool":
			return theme.fg("warning", "⚙");
		case "bash":
			return theme.fg("success", "▸");
		case "user":
			return theme.fg("text", "›");
	}
}

function statusGlyph(entry: HistoryEntry): string {
	switch (entry.status) {
		case "ok":
			return theme.fg("success", " ✓");
		case "error":
			return theme.fg("error", " ✕");
		case "running":
			return theme.fg("warning", " ●");
		case "pending":
			return theme.fg("dim", " ○");
		default:
			return "";
	}
}

function fitToWidth(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = visibleWidth(text) > width ? truncateToWidth(text, width, "") : text;
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export class OmkHistoryPanel implements Component {
	private entries: HistoryEntry[] = [];
	private scrollOffset = 0;

	invalidate(): void {
		// Re-read entries from session on each render
	}

	/** Feed entries from session. Call before render. */
	feedSession(session: AgentSession): void {
		this.entries = [];
		const sessionEntries = session.sessionManager.getEntries();
		for (const entry of sessionEntries) {
			if (this.entries.length >= MAX_ENTRIES) break;

			if (entry.type === "message") {
				const msg = entry.message;
				if (msg.role === "assistant") {
					const text = typeof msg.content === "string" ? msg.content : "";
					const summary = text.slice(0, 80).replace(/\n/g, " ").trim() || "(thinking)";
					this.entries.push({
						type: "assistant",
						timestamp: msg.timestamp ?? Date.now(),
						summary,
						status: "ok",
					});
				} else if (msg.role === "user") {
					const text = typeof msg.content === "string" ? msg.content : "";
					const summary = text.slice(0, 80).replace(/\n/g, " ").trim();
					this.entries.push({
						type: "user",
						timestamp: msg.timestamp ?? Date.now(),
						summary,
						status: "ok",
					});
				} else if (msg.role === "toolResult") {
					const toolName = (msg as any).toolName ?? "tool";
					const details = (msg as any).details;
					const summary = typeof details === "string" ? details.slice(0, 60) : `${toolName} completed`;
					const isError = typeof details === "string" && details.toLowerCase().includes("error");
					this.entries.push({
						type: "tool",
						timestamp: msg.timestamp ?? Date.now(),
						summary: summary.replace(/\n/g, " "),
						toolName,
						status: isError ? "error" : "ok",
					});
				}
			} else if (entry.type === "custom" && entry.customType === "bash") {
				const data = (entry as any).data ?? {};
				const cmd = typeof data.command === "string" ? data.command : "bash";
				const exitCode = typeof data.exitCode === "number" ? data.exitCode : undefined;
				this.entries.push({
					type: "bash",
					timestamp: data.timestamp ?? Date.now(),
					summary: cmd.slice(0, 60),
					status: exitCode === 0 ? "ok" : exitCode !== undefined ? "error" : "pending",
				});
			}
		}

		// Reverse so most recent is at top
		this.entries.reverse();
	}

	scrollUp(): void {
		this.scrollOffset = Math.min(this.scrollOffset + 5, Math.max(0, this.entries.length - 5));
	}

	scrollDown(): void {
		this.scrollOffset = Math.max(0, this.scrollOffset - 5);
	}

	render(width: number, height?: number): string[] {
		if (width < HISTORY_MIN_WIDTH) return [];

		const w = Math.max(HISTORY_MIN_WIDTH, width);
		const maxVisible = height !== undefined ? Math.max(1, height - 6) : Math.max(5, this.entries.length);
		const visible = this.entries.slice(this.scrollOffset, this.scrollOffset + maxVisible);
		const lines: string[] = [];

		// Header
		lines.push(theme.fg("borderAccent", `╭${"─".repeat(Math.max(0, w - 2))}╮`));
		lines.push(
			`${theme.fg("border", "│")}${fitToWidth(
				theme.bold(theme.fg("accent", " HISTORY // WORK LOG")),
				w - 2,
			)}${theme.fg("border", "│")}`,
		);
		lines.push(
			`${theme.fg("border", "│")}${fitToWidth(
				theme.fg("dim", `${this.entries.length} entries · ${formatTimestamp(Date.now() - 1000)}`),
				w - 2,
			)}${theme.fg("border", "│")}`,
		);

		// Scroll hint
		if (this.scrollOffset > 0) {
			lines.push(
				`${theme.fg("border", "│")}${fitToWidth(
					theme.fg("dim", `▲ ${this.scrollOffset} earlier`),
					w - 2,
				)}${theme.fg("border", "│")}`,
			);
		}

		if (visible.length === 0) {
			lines.push(
				`${theme.fg("border", "│")}${fitToWidth(theme.fg("dim", " (no history yet)"), w - 2)}${theme.fg("border", "│")}`,
			);
		} else {
			for (const entry of visible) {
				const glyph = entryGlyph(entry);
				const status = statusGlyph(entry);
				const time = theme.fg("dim", formatTimestamp(entry.timestamp));
				const availableWidth = w - 18; // 2 border + glyph + status + time
				const summary = truncateToWidth(entry.summary, Math.max(1, availableWidth), "…");
				lines.push(
					`${theme.fg("border", "│")} ${glyph}${status} ${theme.fg("muted", summary)}${" ".repeat(Math.max(0, availableWidth - visibleWidth(summary)))}${time} ${theme.fg("border", "│")}`,
				);
			}
		}

		// More entries below
		const remaining = this.entries.length - this.scrollOffset - maxVisible;
		if (remaining > 0) {
			lines.push(
				`${theme.fg("border", "│")}${fitToWidth(
					theme.fg("dim", `▼ ${remaining} more entries`),
					w - 2,
				)}${theme.fg("border", "│")}`,
			);
		}

		lines.push(theme.fg("borderAccent", `╰${"─".repeat(Math.max(0, w - 2))}╯`));

		return lines;
	}
}
