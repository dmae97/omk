/**
 * Session observer overlay component.
 *
 * Picker mode: lists main + active subagent sessions with live status.
 * Viewer mode: renders a scrollable, interactive transcript of the selected subagent's session
 *   by reading its JSONL session file — shows thinking, text, tool calls, results
 *   with expand/collapse per entry and breadcrumb navigation for nested sub-agents.
 *
 * Lifecycle:
 *   - shortcut opens picker
 *   - Enter on a subagent -> viewer
 *   - shortcut while in viewer -> back to picker (or pop breadcrumb)
 *   - Esc from viewer -> back to picker (or pop breadcrumb)
 *   - Esc from picker -> close overlay
 *   - Enter on main session -> close overlay (jump back)
 */
import type { ToolResultMessage } from "@oh-my-pi/pi-ai";
import {
	Container,
	Markdown,
	type MarkdownTheme,
	matchesKey,
	type SelectItem,
	SelectList,
	Spacer,
	Text,
} from "@oh-my-pi/pi-tui";
import { formatDuration, formatNumber, logger } from "@oh-my-pi/pi-utils";
import type { KeyId } from "../../config/keybindings";
import type { SessionMessageEntry } from "../../session/session-manager";
import { parseSessionEntries } from "../../session/session-manager";
import { replaceTabs, truncateToWidth } from "../../tools/render-utils";
import type { ObservableSession, SessionObserverRegistry } from "../session-observer-registry";
import { getMarkdownTheme, getSelectListTheme, theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";

type Mode = "picker" | "viewer";

/** Max thinking characters in collapsed state */
const MAX_THINKING_CHARS_COLLAPSED = 200;
/** Max thinking characters in expanded state */
const MAX_THINKING_CHARS_EXPANDED = 4000;
/** Max tool args characters to display */
const MAX_TOOL_ARGS_CHARS = 500;
/** Max tool result lines in collapsed state */
const MAX_TOOL_RESULT_LINES_COLLAPSED = 3;
/** Max tool result lines in expanded state */
const MAX_TOOL_RESULT_LINES_EXPANDED = 30;
/** Lines per page for PageUp/PageDown */
const PAGE_SIZE = 15;
/** Left indent for content under entry headers */
const INDENT = "    ";

/** Represents a rendered entry in the viewer for selection/expand tracking */
interface ViewerEntry {
	lineStart: number;
	lineCount: number;
	kind: "thinking" | "text" | "toolCall" | "user";
}

/** Breadcrumb item for nested session navigation */
interface BreadcrumbItem {
	sessionId: string;
	label: string;
	sessionFile: string;
}

export class SessionObserverOverlayComponent extends Container {
	#registry: SessionObserverRegistry;
	#onDone: () => void;
	#mode: Mode = "picker";
	#selectList: SelectList;
	#selectedSessionId?: string;
	#observeKeys: KeyId[];
	#transcriptCache?: { path: string; bytesRead: number; entries: SessionMessageEntry[] };

	// Scroll state
	#scrollOffset = 0;
	#renderedLines: string[] = [];
	#viewportHeight = 20;
	#wasAtBottom = true;

	// Entry selection & expand/collapse
	#viewerEntries: ViewerEntry[] = [];
	#selectedEntryIndex = 0;
	#expandedEntries = new Set<number>();

	// Breadcrumb navigation
	#navigationStack: BreadcrumbItem[] = [];

	// Cached header/footer for viewer (rebuilt on refresh)
	#viewerHeaderLines: string[] = [];
	#viewerFooterLines: string[] = [];
	// Markdown rendering
	#mdTheme: MarkdownTheme = getMarkdownTheme();

	constructor(registry: SessionObserverRegistry, onDone: () => void, observeKeys: KeyId[]) {
		super();
		this.#registry = registry;
		this.#onDone = onDone;
		this.#observeKeys = observeKeys;
		this.#selectList = new SelectList([], 0, getSelectListTheme());
		this.#setupPicker();
	}

	// --- Override render to implement viewport scrolling in viewer mode ---
	override render(width: number): string[] {
		if (this.#mode === "picker") {
			return super.render(width);
		}
		// Viewer mode: build all lines, then slice to viewport
		return this.#renderViewer(width);
	}

	#setupPicker(): void {
		this.#mode = "picker";
		this.children = [];
		this.#navigationStack = [];
		this.#scrollOffset = 0;
		this.#selectedEntryIndex = 0;
		this.#expandedEntries.clear();

		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.bold(theme.fg("accent", "Session Observer")), 1, 0));
		this.addChild(new Spacer(1));

		const items = this.#buildPickerItems();
		this.#selectList = new SelectList(items, Math.min(items.length, 12), getSelectListTheme());

		this.#selectList.onSelect = item => {
			if (item.value === "main") {
				this.#onDone();
				return;
			}
			this.#selectedSessionId = item.value;
			this.#setupViewer();
		};

		this.#selectList.onCancel = () => {
			this.#onDone();
		};

		this.addChild(this.#selectList);
		this.addChild(new DynamicBorder());
	}

	#setupViewer(): void {
		this.#mode = "viewer";
		this.children = [];
		this.#scrollOffset = 0;
		this.#selectedEntryIndex = 0;
		this.#expandedEntries.clear();
		this.#wasAtBottom = true;
		this.#rebuildViewerContent();
		// Auto-select first non-user entry (skip prompt) and scroll to latest for active sessions
		const firstNonUser = this.#viewerEntries.findIndex(e => e.kind !== "user");
		if (firstNonUser >= 0) {
			this.#selectedEntryIndex = firstNonUser;
			this.#rebuildViewerContent();
			this.#scrollToSelectedEntry();
		}
	}

	/** Rebuild content from live registry data */
	refreshFromRegistry(): void {
		if (this.#mode === "picker") {
			this.#refreshPickerItems();
		} else if (this.#mode === "viewer" && this.#selectedSessionId) {
			const totalLines = this.#renderedLines.length;
			this.#wasAtBottom = this.#scrollOffset >= totalLines - this.#viewportHeight;
			this.#rebuildViewerContent();
		}
	}

	#refreshPickerItems(): void {
		const previousValue = this.#selectList.getSelectedItem()?.value;
		const items = this.#buildPickerItems();
		const newList = new SelectList(items, Math.min(items.length, 12), getSelectListTheme());
		newList.onSelect = this.#selectList.onSelect;
		newList.onCancel = this.#selectList.onCancel;
		if (previousValue) {
			const newIndex = items.findIndex(i => i.value === previousValue);
			if (newIndex >= 0) newList.setSelectedIndex(newIndex);
		}
		const idx = this.children.indexOf(this.#selectList);
		if (idx >= 0) this.children[idx] = newList;
		this.#selectList = newList;
	}

	/** Rebuild the transcript content lines (called on setup and refresh) */
	#rebuildViewerContent(): void {
		const sessions = this.#registry.getSessions();
		const session = sessions.find(s => s.id === this.#selectedSessionId);

		// Header
		this.#viewerHeaderLines = [];
		const breadcrumb = this.#buildBreadcrumb(session);
		this.#viewerHeaderLines.push(theme.fg("accent", breadcrumb));
		if (session) {
			const statusColor = session.status === "active" ? "success" : session.status === "failed" ? "error" : "dim";
			const statusText = theme.fg(statusColor, `[${session.status}]`);
			const agentTag = session.agent ? theme.fg("dim", ` ${session.agent}`) : "";
			this.#viewerHeaderLines.push(`${theme.bold(session.label)} ${statusText}${agentTag}`);
		}

		// Content
		const contentLines: string[] = [];
		this.#viewerEntries = [];

		if (!session) {
			contentLines.push(theme.fg("dim", "Session no longer available."));
		} else if (!session.sessionFile) {
			contentLines.push(theme.fg("dim", "No session file available yet."));
		} else {
			const messageEntries = this.#loadTranscript(session.sessionFile);
			if (!messageEntries) {
				contentLines.push(theme.fg("dim", "Unable to read session file."));
			} else if (messageEntries.length === 0) {
				contentLines.push(theme.fg("dim", "No messages yet."));
			} else {
				this.#buildTranscriptLines(messageEntries, contentLines);
			}
		}

		this.#renderedLines = contentLines;

		// Footer
		this.#viewerFooterLines = [];
		const statsLine = this.#buildStatsLine(session);
		if (statsLine) this.#viewerFooterLines.push(statsLine);
		this.#viewerFooterLines.push(
			theme.fg("dim", "j/k:navigate  Enter:expand/collapse  Esc:back  PgUp/PgDn:page  g/G:top/bottom"),
		);

		// Auto-scroll to bottom if we were at bottom
		if (this.#wasAtBottom) {
			this.#scrollOffset = Math.max(0, contentLines.length - this.#viewportHeight);
		}
	}

	/** Produce the final viewer output for the overlay system */
	#renderViewer(width: number): string[] {
		const termHeight = process.stdout.rows || 40;

		// Compute viewport: total height minus header chrome and footer chrome
		// Header: border(1) + headerLines + border(1) = headerLines.length + 2
		// Footer: spacer(1) + scrollInfo(1) + footerLines + border(1) = footerLines.length + 2
		const headerChrome = this.#viewerHeaderLines.length + 2;
		const footerChrome = this.#viewerFooterLines.length + 2;
		this.#viewportHeight = Math.max(5, termHeight - headerChrome - footerChrome);

		// Clamp scroll offset
		const maxScroll = Math.max(0, this.#renderedLines.length - this.#viewportHeight);
		this.#scrollOffset = Math.max(0, Math.min(this.#scrollOffset, maxScroll));

		const lines: string[] = [];

		// --- Header ---
		lines.push(...new DynamicBorder().render(width));
		for (const hl of this.#viewerHeaderLines) {
			lines.push(` ${hl}`);
		}
		lines.push(...new DynamicBorder().render(width));

		// --- Scrolled content viewport ---
		const visibleLines = this.#renderedLines.slice(this.#scrollOffset, this.#scrollOffset + this.#viewportHeight);
		for (const vl of visibleLines) {
			lines.push(` ${vl}`);
		}
		// Pad to fill viewport if content is shorter
		const pad = this.#viewportHeight - visibleLines.length;
		for (let i = 0; i < pad; i++) {
			lines.push("");
		}

		// --- Footer ---
		const scrollInfo =
			this.#renderedLines.length > this.#viewportHeight
				? ` ${theme.fg("dim", `[${this.#scrollOffset + 1}-${Math.min(this.#scrollOffset + this.#viewportHeight, this.#renderedLines.length)}/${this.#renderedLines.length}]`)}`
				: "";
		lines.push("");
		lines.push(` ${this.#viewerFooterLines[0] ?? ""}${scrollInfo}`);
		for (let i = 1; i < this.#viewerFooterLines.length; i++) {
			lines.push(` ${this.#viewerFooterLines[i]}`);
		}
		lines.push(...new DynamicBorder().render(width));

		return lines;
	}

	#buildBreadcrumb(session: ObservableSession | undefined): string {
		const parts: string[] = ["Session Observer"];
		for (const item of this.#navigationStack) {
			parts.push(item.label);
		}
		if (session) parts.push(session.label);
		return parts.join(" > ");
	}

	#buildStatsLine(session: ObservableSession | undefined): string {
		const progress = session?.progress;
		if (!progress) return "";
		const stats: string[] = [];
		if (progress.toolCount > 0) stats.push(`${formatNumber(progress.toolCount)} tools`);
		if (progress.tokens > 0) stats.push(`${formatNumber(progress.tokens)} tokens`);
		if (progress.durationMs > 0) stats.push(formatDuration(progress.durationMs));
		return stats.length > 0 ? theme.fg("dim", stats.join(theme.sep.dot)) : "";
	}

	#buildTranscriptLines(messageEntries: SessionMessageEntry[], lines: string[]): void {
		// Build a tool call ID -> tool result map
		const toolResults = new Map<string, ToolResultMessage>();
		for (const entry of messageEntries) {
			if (entry.message.role === "toolResult") {
				toolResults.set(entry.message.toolCallId, entry.message);
			}
		}

		let entryIndex = 0;
		for (const entry of messageEntries) {
			const msg = entry.message;

			if (msg.role === "assistant") {
				for (const content of msg.content) {
					if (content.type === "thinking" && content.thinking.trim()) {
						const startLine = lines.length;
						const isExpanded = this.#expandedEntries.has(entryIndex);
						const isSelected = entryIndex === this.#selectedEntryIndex;
						this.#renderThinkingLines(lines, content.thinking.trim(), isExpanded, isSelected);
						this.#viewerEntries.push({
							lineStart: startLine,
							lineCount: lines.length - startLine,
							kind: "thinking",
						});
						entryIndex++;
					} else if (content.type === "text" && content.text.trim()) {
						const startLine = lines.length;
						const isExpanded = this.#expandedEntries.has(entryIndex);
						const isSelected = entryIndex === this.#selectedEntryIndex;
						this.#renderTextLines(lines, content.text.trim(), isExpanded, isSelected);
						this.#viewerEntries.push({ lineStart: startLine, lineCount: lines.length - startLine, kind: "text" });
						entryIndex++;
					} else if (content.type === "toolCall") {
						const startLine = lines.length;
						const isExpanded = this.#expandedEntries.has(entryIndex);
						const isSelected = entryIndex === this.#selectedEntryIndex;
						const result = toolResults.get(content.id);
						this.#renderToolCallLines(lines, content, result, isExpanded, isSelected);
						this.#viewerEntries.push({
							lineStart: startLine,
							lineCount: lines.length - startLine,
							kind: "toolCall",
						});
						entryIndex++;
					}
				}
			} else if (msg.role === "user" || msg.role === "developer") {
				const text =
					typeof msg.content === "string"
						? msg.content
						: msg.content
								.filter((b): b is { type: "text"; text: string } => b.type === "text")
								.map(b => b.text)
								.join("\n");
				if (text.trim()) {
					const startLine = lines.length;
					const isSelected = entryIndex === this.#selectedEntryIndex;
					const isExpanded = this.#expandedEntries.has(entryIndex);
					const label = msg.role === "developer" ? "System" : "User";
					const cursor = isSelected ? theme.fg("accent", "▶") : " ";
					lines.push("");
					if (isExpanded) {
						lines.push(`${cursor} ${theme.fg("dim", `[${label}]`)}`);
						const mdLines = this.#renderMarkdownToLines(text.trim());
						for (const ml of mdLines) {
							lines.push(ml);
						}
					} else {
						const firstLine = text.trim().split("\n")[0];
						const totalLines = text.trim().split("\n").length;
						const hint = totalLines > 1 ? theme.fg("dim", ` (${totalLines} lines)`) : "";
						lines.push(
							`${cursor} ${theme.fg("dim", `[${label}]`)} ${theme.fg("muted", truncateToWidth(firstLine, 60))}${hint}`,
						);
					}
					this.#viewerEntries.push({ lineStart: startLine, lineCount: lines.length - startLine, kind: "user" });
					entryIndex++;
				}
			}
		}
	}

	/** Render markdown text into indented lines using the theme's markdown renderer */
	#renderMarkdownToLines(text: string, indent: string = INDENT): string[] {
		const width = Math.max(40, (process.stdout.columns || 80) - indent.length - 4);
		const md = new Markdown(text, 0, 0, this.#mdTheme);
		const rendered = md.render(width);
		return rendered.map(line => `${indent}${line.trimEnd()}`);
	}

	#renderThinkingLines(lines: string[], thinking: string, expanded: boolean, selected: boolean): void {
		const cursor = selected ? theme.fg("accent", "▶") : " ";
		const maxChars = expanded ? MAX_THINKING_CHARS_EXPANDED : MAX_THINKING_CHARS_COLLAPSED;
		const truncated = thinking.length > maxChars;
		const expandLabel = !expanded && truncated ? theme.fg("dim", " ↵") : "";

		lines.push("");
		lines.push(`${cursor} ${theme.fg("dim", "💭 Thinking")}${expandLabel}`);

		const displayText = truncated ? `${thinking.slice(0, maxChars)}...` : thinking;
		if (expanded) {
			// Expanded thinking: render as markdown for readable formatting
			const mdLines = this.#renderMarkdownToLines(displayText);
			const maxLines = 100;
			for (let i = 0; i < Math.min(mdLines.length, maxLines); i++) {
				lines.push(mdLines[i]);
			}
			if (mdLines.length > maxLines) {
				lines.push(`${INDENT}${theme.fg("dim", `... ${mdLines.length - maxLines} more lines`)}`);
			}
		} else {
			// Collapsed thinking: brief italic preview
			const thinkingLines = displayText.split("\n");
			const maxLines = 4;
			for (let i = 0; i < Math.min(thinkingLines.length, maxLines); i++) {
				lines.push(`${INDENT}${theme.fg("thinkingText", replaceTabs(thinkingLines[i]))}`);
			}
			if (thinkingLines.length > maxLines) {
				lines.push(`${INDENT}${theme.fg("dim", `... ${thinkingLines.length - maxLines} more lines`)}`);
			}
		}
	}

	#renderTextLines(lines: string[], text: string, expanded: boolean, selected: boolean): void {
		const cursor = selected ? theme.fg("accent", "▶") : " ";

		lines.push("");
		lines.push(`${cursor} ${theme.fg("muted", "Response")}`);

		if (expanded) {
			// Expanded: full markdown rendering
			const mdLines = this.#renderMarkdownToLines(text);
			for (const ml of mdLines) {
				lines.push(ml);
			}
		} else {
			// Collapsed: first few lines as plain text
			const textLines = text.split("\n");
			const maxLines = 5;
			for (let i = 0; i < Math.min(textLines.length, maxLines); i++) {
				lines.push(`${INDENT}${textLines[i]}`);
			}
			if (textLines.length > maxLines) {
				lines.push(`${INDENT}${theme.fg("dim", `... ${textLines.length - maxLines} more lines`)}`);
			}
		}
	}

	#renderToolCallLines(
		lines: string[],
		call: { id: string; name: string; arguments: Record<string, unknown>; intent?: string },
		result: ToolResultMessage | undefined,
		expanded: boolean,
		selected: boolean,
	): void {
		const cursor = selected ? theme.fg("accent", "▶") : " ";
		lines.push("");

		// Tool call header
		const intentStr = call.intent ? theme.fg("dim", ` ${call.intent}`) : "";
		lines.push(`${cursor} ${theme.fg("accent", "▸")} ${theme.bold(theme.fg("muted", call.name))}${intentStr}`);

		// Key arguments
		const argSummary = this.#formatToolArgs(call.name, call.arguments);
		if (argSummary) {
			lines.push(`${INDENT}${theme.fg("dim", argSummary)}`);
		}

		// Tool result
		if (result) {
			this.#renderToolResultLines(lines, result, expanded);
		}
	}

	#renderToolResultLines(lines: string[], result: ToolResultMessage, expanded: boolean): void {
		const textParts = result.content
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map(p => p.text);
		const text = textParts.join("\n").trim();

		if (result.isError) {
			const errorLines = text.split("\n");
			const maxErrorLines = expanded ? 15 : 2;
			lines.push(`${INDENT}${theme.fg("error", `✗ ${replaceTabs(errorLines[0] || "Error")}`)}`);
			for (let i = 1; i < Math.min(errorLines.length, maxErrorLines); i++) {
				lines.push(`${INDENT}  ${theme.fg("error", replaceTabs(errorLines[i]))}`);
			}
			if (errorLines.length > maxErrorLines) {
				lines.push(`${INDENT}  ${theme.fg("dim", `... ${errorLines.length - maxErrorLines} more lines`)}`);
			}
			return;
		}

		if (!text) {
			lines.push(`${INDENT}${theme.fg("dim", "✓ done")}`);
			return;
		}

		const resultLines = text.split("\n");
		const maxLines = expanded ? MAX_TOOL_RESULT_LINES_EXPANDED : MAX_TOOL_RESULT_LINES_COLLAPSED;

		// Status line
		const statusPrefix = `${INDENT}${theme.fg("success", "✓")}`;

		if (resultLines.length === 1 && text.length < 100) {
			lines.push(`${statusPrefix} ${theme.fg("dim", replaceTabs(text))}`);
			return;
		}

		lines.push(`${statusPrefix} ${theme.fg("dim", `${resultLines.length} lines`)}`);
		const displayLines = resultLines.slice(0, maxLines);
		for (const rl of displayLines) {
			lines.push(`${INDENT}  ${theme.fg("dim", replaceTabs(rl))}`);
		}
		if (resultLines.length > maxLines) {
			lines.push(`${INDENT}  ${theme.fg("dim", `... ${resultLines.length - maxLines} more`)}`);
		}
	}

	#formatToolArgs(toolName: string, args: Record<string, unknown>): string {
		switch (toolName) {
			case "read":
			case "write":
			case "edit":
				return args.path ? `path: ${args.path}` : "";
			case "grep":
				return [args.pattern ? `pattern: ${args.pattern}` : "", args.path ? `path: ${args.path}` : ""]
					.filter(Boolean)
					.join(", ");
			case "find":
				return args.pattern ? `pattern: ${args.pattern}` : "";
			case "bash": {
				const cmd = args.command;
				return typeof cmd === "string" ? replaceTabs(cmd) : "";
			}
			case "lsp":
				return [args.action, args.file, args.symbol].filter(Boolean).join(" ");
			case "ast_grep":
			case "ast_edit":
				return args.path ? `path: ${args.path}` : "";
			case "task": {
				const tasks = args.tasks;
				return Array.isArray(tasks) ? `${tasks.length} task(s)` : "";
			}
			default: {
				const parts: string[] = [];
				let total = 0;
				for (const [key, value] of Object.entries(args)) {
					if (key.startsWith("_")) continue;
					const v = typeof value === "string" ? value : JSON.stringify(value);
					const entry = `${key}: ${replaceTabs(v ?? "")}`;
					if (total + entry.length > MAX_TOOL_ARGS_CHARS) break;
					parts.push(entry);
					total += entry.length;
				}
				return parts.join(", ");
			}
		}
	}

	#loadTranscript(sessionFile: string): SessionMessageEntry[] | null {
		if (this.#transcriptCache && this.#transcriptCache.path !== sessionFile) {
			this.#transcriptCache = undefined;
		}

		const fromByte = this.#transcriptCache?.bytesRead ?? 0;
		const result = readFileIncremental(sessionFile, fromByte);
		if (!result) {
			logger.debug("Session observer: failed to read session file", { path: sessionFile });
			return this.#transcriptCache?.entries ?? null;
		}

		if (result.newSize < fromByte) {
			this.#transcriptCache = undefined;
			return this.#loadTranscript(sessionFile);
		}

		if (!this.#transcriptCache) {
			this.#transcriptCache = { path: sessionFile, bytesRead: 0, entries: [] };
		}

		if (result.text.length > 0) {
			const lastNewline = result.text.lastIndexOf("\n");
			if (lastNewline >= 0) {
				const completeChunk = result.text.slice(0, lastNewline + 1);
				const newEntries = parseSessionEntries(completeChunk);
				for (const entry of newEntries) {
					if (entry.type === "message") {
						this.#transcriptCache.entries.push(entry as SessionMessageEntry);
					}
				}
				this.#transcriptCache.bytesRead = fromByte + Buffer.byteLength(completeChunk, "utf-8");
			}
		}
		return this.#transcriptCache.entries;
	}

	#navigateBack(): boolean {
		if (this.#navigationStack.length === 0) return false;
		const prev = this.#navigationStack.pop()!;
		this.#selectedSessionId = prev.sessionId;
		this.#transcriptCache = undefined;
		this.#scrollOffset = 0;
		this.#selectedEntryIndex = 0;
		this.#expandedEntries.clear();
		this.#rebuildViewerContent();
		return true;
	}

	#buildPickerItems(): SelectItem[] {
		const sessions = this.#registry.getSessions();
		return sessions.map(s => {
			const statusIcon =
				s.status === "active" ? "●" : s.status === "completed" ? "✓" : s.status === "failed" ? "✗" : "○";
			const statusColor = s.status === "active" ? "success" : s.status === "failed" ? "error" : "dim";
			const prefix = theme.fg(statusColor, statusIcon);
			const agentSuffix = s.agent ? theme.fg("dim", ` [${s.agent}]`) : "";
			const label = s.kind === "main" ? `${prefix} ${s.label} (return)` : `${prefix} ${s.label}${agentSuffix}`;

			let description = s.description;
			if (s.progress?.currentTool) {
				const intent = s.progress.lastIntent;
				description = intent ? `${s.progress.currentTool}: ${truncateToWidth(intent, 40)}` : s.progress.currentTool;
			}

			return { value: s.id, label, description };
		});
	}

	handleInput(keyData: string): void {
		for (const key of this.#observeKeys) {
			if (matchesKey(keyData, key)) {
				if (this.#mode === "viewer") {
					this.#setupPicker();
					return;
				}
				this.#onDone();
				return;
			}
		}

		if (this.#mode === "picker") {
			this.#selectList.handleInput(keyData);
		} else if (this.#mode === "viewer") {
			this.#handleViewerInput(keyData);
		}
	}

	#handleViewerInput(keyData: string): void {
		const entryCount = this.#viewerEntries.length;

		// Escape — pop navigation or go to picker
		if (matchesKey(keyData, "escape")) {
			if (!this.#navigateBack()) {
				this.#setupPicker();
			}
			return;
		}

		// j / down — move selection down
		if (keyData === "j" || matchesKey(keyData, "down")) {
			if (entryCount > 0) {
				this.#selectedEntryIndex = Math.min(this.#selectedEntryIndex + 1, entryCount - 1);
			}
			this.#rebuildAndScroll();
			return;
		}

		// k / up — move selection up
		if (keyData === "k" || matchesKey(keyData, "up")) {
			if (entryCount > 0) {
				this.#selectedEntryIndex = Math.max(this.#selectedEntryIndex - 1, 0);
			}
			this.#rebuildAndScroll();
			return;
		}

		// Page Down
		if (matchesKey(keyData, "pageDown")) {
			if (entryCount > 0) {
				this.#selectedEntryIndex = Math.min(this.#selectedEntryIndex + 5, entryCount - 1);
			} else {
				this.#scrollOffset = Math.min(
					this.#scrollOffset + PAGE_SIZE,
					Math.max(0, this.#renderedLines.length - this.#viewportHeight),
				);
			}
			this.#rebuildAndScroll();
			return;
		}

		// Page Up
		if (matchesKey(keyData, "pageUp")) {
			if (entryCount > 0) {
				this.#selectedEntryIndex = Math.max(this.#selectedEntryIndex - 5, 0);
			} else {
				this.#scrollOffset = Math.max(this.#scrollOffset - PAGE_SIZE, 0);
			}
			this.#rebuildAndScroll();
			return;
		}

		// Enter — toggle expand/collapse, or dive into nested session
		if (matchesKey(keyData, "enter") || keyData === "\r" || keyData === "\n") {
			if (entryCount > 0 && this.#selectedEntryIndex < entryCount) {
				// Toggle expand/collapse
				if (this.#expandedEntries.has(this.#selectedEntryIndex)) {
					this.#expandedEntries.delete(this.#selectedEntryIndex);
				} else {
					this.#expandedEntries.add(this.#selectedEntryIndex);
				}
				this.#rebuildAndScroll();
			}
			return;
		}

		// G — jump to bottom
		if (keyData === "G") {
			if (entryCount > 0) this.#selectedEntryIndex = entryCount - 1;
			this.#scrollOffset = Math.max(0, this.#renderedLines.length - this.#viewportHeight);
			this.#rebuildAndScroll();
			return;
		}

		// g — jump to top
		if (keyData === "g") {
			this.#selectedEntryIndex = 0;
			this.#scrollOffset = 0;
			this.#rebuildAndScroll();
			return;
		}
	}

	/** Rebuild transcript lines (which depend on selectedEntryIndex/expandedEntries) and scroll to selection */
	#rebuildAndScroll(): void {
		this.#wasAtBottom = false;
		this.#rebuildViewerContent();
		this.#scrollToSelectedEntry();
	}

	#scrollToSelectedEntry(): void {
		if (this.#viewerEntries.length === 0) return;
		const entry = this.#viewerEntries[this.#selectedEntryIndex];
		if (!entry) return;

		const entryTop = entry.lineStart;
		const entryBottom = entry.lineStart + entry.lineCount;

		if (entryTop < this.#scrollOffset) {
			this.#scrollOffset = Math.max(0, entryTop - 1);
		}
		if (entryBottom > this.#scrollOffset + this.#viewportHeight) {
			this.#scrollOffset = Math.max(0, entryBottom - this.#viewportHeight + 1);
		}
	}
}

// Sync helpers for render path
import * as fs from "node:fs";

function readFileIncremental(filePath: string, fromByte: number): { text: string; newSize: number } | null {
	try {
		const stat = fs.statSync(filePath);
		if (stat.size <= fromByte) return { text: "", newSize: stat.size };
		const buf = Buffer.alloc(stat.size - fromByte);
		const fd = fs.openSync(filePath, "r");
		try {
			fs.readSync(fd, buf, 0, buf.length, fromByte);
		} finally {
			fs.closeSync(fd);
		}
		return { text: buf.toString("utf-8"), newSize: stat.size };
	} catch {
		return null;
	}
}
