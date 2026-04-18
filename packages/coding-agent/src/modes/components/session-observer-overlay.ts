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
 *   - shortcut while in viewer -> back to picker
 *   - Esc from viewer -> back to picker (or pop breadcrumb)
 *   - Esc from picker -> close overlay
 *   - Enter on main session -> close overlay (jump back)
 */
import type { ToolResultMessage } from "@oh-my-pi/pi-ai";
import { Container, matchesKey, type SelectItem, SelectList, Spacer, Text } from "@oh-my-pi/pi-tui";
import { formatDuration, formatNumber, logger } from "@oh-my-pi/pi-utils";
import type { KeyId } from "../../config/keybindings";
import type { SessionMessageEntry } from "../../session/session-manager";
import { parseSessionEntries } from "../../session/session-manager";
import { replaceTabs, truncateToWidth } from "../../tools/render-utils";
import type { ObservableSession, SessionObserverRegistry } from "../session-observer-registry";
import { getSelectListTheme, theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";

type Mode = "picker" | "viewer";

/** Max thinking characters to show in collapsed state */
const MAX_THINKING_CHARS_COLLAPSED = 200;
/** Max thinking characters to show in expanded state */
const MAX_THINKING_CHARS_EXPANDED = 2000;
/** Max tool args characters to display */
const MAX_TOOL_ARGS_CHARS = 500;
/** Max tool result text in collapsed state */
const MAX_TOOL_RESULT_LINES_COLLAPSED = 3;
/** Max tool result text in expanded state */
const MAX_TOOL_RESULT_LINES_EXPANDED = 20;
/** Max line width for tool results */
const MAX_TOOL_RESULT_LINE_WIDTH = 90;
/** Lines per page for PageUp/PageDown */
const PAGE_SIZE = 15;

/** Represents a rendered entry in the viewer for selection/expand tracking */
interface ViewerEntry {
	/** Index in the rendered lines array where this entry starts */
	lineStart: number;
	/** Number of lines this entry occupies */
	lineCount: number;
	/** Type of entry for rendering decisions */
	kind: "thinking" | "text" | "toolCall" | "user";
	/** Original data for re-rendering on expand/collapse */
	data: unknown;
}

/** Breadcrumb item for nested session navigation */
interface BreadcrumbItem {
	sessionId: string;
	label: string;
	/** Session file path to restore when navigating back */
	sessionFile: string;
}

export class SessionObserverOverlayComponent extends Container {
	#registry: SessionObserverRegistry;
	#onDone: () => void;
	#mode: Mode = "picker";
	#selectList: SelectList;
	#viewerContainer: Container;
	#selectedSessionId?: string;
	#observeKeys: KeyId[];
	/** Cached parsed transcript per session file to avoid reparsing on every refresh */
	#transcriptCache?: { path: string; bytesRead: number; entries: SessionMessageEntry[] };

	// --- Scroll state (Bead 3) ---
	#scrollOffset = 0;
	#renderedLines: string[] = [];
	#viewportHeight = 20;
	/** Whether we were at the bottom before the last content update (for auto-scroll) */
	#wasAtBottom = true;

	// --- Entry selection & expand/collapse (Bead 4) ---
	#viewerEntries: ViewerEntry[] = [];
	#selectedEntryIndex = 0;
	#expandedEntries = new Set<number>();

	// --- Breadcrumb navigation (Bead 6) ---
	#navigationStack: BreadcrumbItem[] = [];

	constructor(registry: SessionObserverRegistry, onDone: () => void, observeKeys: KeyId[]) {
		super();
		this.#registry = registry;
		this.#onDone = onDone;
		this.#observeKeys = observeKeys;
		this.#selectList = new SelectList([], 0, getSelectListTheme());
		this.#viewerContainer = new Container();

		this.#setupPicker();
	}

	#setupPicker(): void {
		this.#mode = "picker";
		this.children = [];
		// Reset viewer state
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
		this.#viewerContainer = new Container();
		this.#wasAtBottom = true;
		this.#refreshViewer();
	}

	/** Rebuild content from live registry data */
	refreshFromRegistry(): void {
		if (this.#mode === "picker") {
			this.#refreshPickerItems();
		} else if (this.#mode === "viewer" && this.#selectedSessionId) {
			// Check if we were at bottom before refresh for auto-scroll
			const totalLines = this.#renderedLines.length;
			this.#wasAtBottom = this.#scrollOffset >= totalLines - this.#viewportHeight;
			this.#refreshViewer();
		}
	}

	#refreshPickerItems(): void {
		// Preserve selection across refresh by matching on value
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
		if (idx >= 0) {
			this.children[idx] = newList;
		}
		this.#selectList = newList;
	}

	#refreshViewer(): void {
		this.#viewerContainer.clear();
		this.children = [];

		const sessions = this.#registry.getSessions();
		const session = sessions.find(s => s.id === this.#selectedSessionId);

		// Build header
		const headerLines: string[] = [];

		// Breadcrumb header (Bead 5 + 6)
		const breadcrumb = this.#buildBreadcrumb(session);
		headerLines.push(theme.fg("accent", breadcrumb));

		if (session) {
			const statusColor = session.status === "active" ? "success" : session.status === "failed" ? "error" : "dim";
			const statusText = theme.fg(statusColor, `[${session.status}]`);
			const agentTag = session.agent ? theme.fg("dim", ` ${session.agent}`) : "";
			headerLines.push(`${theme.bold(session.label)} ${statusText}${agentTag}`);
		}

		// Build transcript content
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

		// Build stats footer
		const statsLine = this.#buildStatsLine(session);

		// Build footer with key hints
		const footerHints = theme.fg("dim", "j/k:scroll  Enter:expand  Esc:back  PgUp/PgDn:page");

		// Compute viewport: terminal height minus header, borders, footer
		const termRows = process.stdout.rows || 40;
		const headerHeight = headerLines.length + 2; // +2 for border + spacer
		const footerHeight = 3; // stats + hints + border
		this.#viewportHeight = Math.max(5, termRows - headerHeight - footerHeight);

		// Store all content lines for scrolling
		this.#renderedLines = contentLines;

		// Auto-scroll to bottom if we were at bottom
		if (this.#wasAtBottom) {
			this.#scrollOffset = Math.max(0, contentLines.length - this.#viewportHeight);
		}
		// Clamp scroll offset
		this.#scrollOffset = Math.max(
			0,
			Math.min(this.#scrollOffset, Math.max(0, contentLines.length - this.#viewportHeight)),
		);

		// Build final display
		this.addChild(new DynamicBorder());

		// Header
		for (const line of headerLines) {
			this.addChild(new Text(line, 1, 0));
		}
		this.addChild(new DynamicBorder());

		// Scrolled content viewport
		const visibleLines = contentLines.slice(this.#scrollOffset, this.#scrollOffset + this.#viewportHeight);
		for (const line of visibleLines) {
			this.addChild(new Text(line, 1, 0));
		}

		// Scroll indicator
		const scrollInfo =
			contentLines.length > this.#viewportHeight
				? theme.fg(
						"dim",
						` [${this.#scrollOffset + 1}-${Math.min(this.#scrollOffset + this.#viewportHeight, contentLines.length)}/${contentLines.length}]`,
					)
				: "";

		this.addChild(new Spacer(1));
		this.addChild(new Text(`${statsLine}${scrollInfo}`, 1, 0));
		this.addChild(new Text(footerHints, 1, 0));
		this.addChild(new DynamicBorder());
	}

	#buildBreadcrumb(session: ObservableSession | undefined): string {
		const parts: string[] = ["Session Observer"];
		for (const item of this.#navigationStack) {
			parts.push(item.label);
		}
		if (session) {
			parts.push(session.label);
		}
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
		// Build a tool call ID -> tool result map for matching
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
							data: content,
						});
						entryIndex++;
					} else if (content.type === "text" && content.text.trim()) {
						const startLine = lines.length;
						const isSelected = entryIndex === this.#selectedEntryIndex;
						lines.push("");
						const prefix = isSelected ? theme.fg("accent", "▶ ") : "  ";
						const textLines = content.text.trim().split("\n").slice(0, 5);
						for (const tl of textLines) {
							lines.push(`${prefix}${tl}`);
						}
						if (content.text.trim().split("\n").length > 5) {
							lines.push(`  ${theme.fg("dim", `... ${content.text.trim().split("\n").length - 5} more lines`)}`);
						}
						this.#viewerEntries.push({
							lineStart: startLine,
							lineCount: lines.length - startLine,
							kind: "text",
							data: content,
						});
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
							data: { call: content, result },
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
					const label = msg.role === "developer" ? "System" : "User";
					const prefix = isSelected ? theme.fg("accent", "▶ ") : "  ";
					lines.push("");
					lines.push(
						`${prefix}${theme.fg("dim", `[${label}]`)} ${theme.fg("muted", truncateToWidth(text.trim(), 80))}`,
					);
					this.#viewerEntries.push({
						lineStart: startLine,
						lineCount: lines.length - startLine,
						kind: "user",
						data: msg,
					});
					entryIndex++;
				}
			}
			// toolResult entries are rendered inline with their tool calls above
		}
	}

	#renderThinkingLines(lines: string[], thinking: string, expanded: boolean, selected: boolean): void {
		const prefix = selected ? theme.fg("accent", "▶ ") : "  ";
		const maxChars = expanded ? MAX_THINKING_CHARS_EXPANDED : MAX_THINKING_CHARS_COLLAPSED;
		const expandHint =
			!expanded && thinking.length > MAX_THINKING_CHARS_COLLAPSED ? theme.fg("dim", " [Enter to expand]") : "";

		lines.push("");
		lines.push(`${prefix}${theme.fg("dim", "💭 Thinking")}${expandHint}`);

		const displayText = thinking.length > maxChars ? `${thinking.slice(0, maxChars)}...` : thinking;

		const thinkingLines = displayText.split("\n");
		const maxLines = expanded ? 50 : 4;
		for (let i = 0; i < Math.min(thinkingLines.length, maxLines); i++) {
			lines.push(
				`    ${theme.fg("thinkingText", truncateToWidth(replaceTabs(thinkingLines[i]), MAX_TOOL_RESULT_LINE_WIDTH))}`,
			);
		}
		if (thinkingLines.length > maxLines) {
			lines.push(`    ${theme.fg("dim", `... ${thinkingLines.length - maxLines} more lines`)}`);
		}
	}

	#renderToolCallLines(
		lines: string[],
		call: { id: string; name: string; arguments: Record<string, unknown>; intent?: string },
		result: ToolResultMessage | undefined,
		expanded: boolean,
		selected: boolean,
	): void {
		const prefix = selected ? theme.fg("accent", "▶ ") : "  ";
		lines.push("");

		// Tool call header with intent
		const intentStr = call.intent ? theme.fg("dim", ` ${truncateToWidth(call.intent, 50)}`) : "";
		lines.push(`${prefix}${theme.fg("accent", "▸")} ${theme.bold(theme.fg("muted", call.name))}${intentStr}`);

		// Key arguments
		const argSummary = this.#formatToolArgs(call.name, call.arguments);
		if (argSummary) {
			lines.push(`    ${theme.fg("dim", argSummary)}`);
		}

		// Tool result
		if (result) {
			this.#renderToolResultLines(lines, call.name, result, expanded);
		}
	}

	/** Rich tool result rendering (Bead 2) — per-tool-type display */
	#renderToolResultLines(lines: string[], toolName: string, result: ToolResultMessage, expanded: boolean): void {
		const textParts = result.content
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map(p => p.text);
		const text = textParts.join("\n").trim();

		if (result.isError) {
			const errorLines = text.split("\n");
			const maxErrorLines = expanded ? 10 : 2;
			lines.push(
				`    ${theme.fg("error", `✗ ${truncateToWidth(replaceTabs(errorLines[0] || "Error"), MAX_TOOL_RESULT_LINE_WIDTH)}`)}`,
			);
			for (let i = 1; i < Math.min(errorLines.length, maxErrorLines); i++) {
				lines.push(
					`      ${theme.fg("error", truncateToWidth(replaceTabs(errorLines[i]), MAX_TOOL_RESULT_LINE_WIDTH))}`,
				);
			}
			if (errorLines.length > maxErrorLines) {
				lines.push(`      ${theme.fg("dim", `... ${errorLines.length - maxErrorLines} more lines`)}`);
			}
			return;
		}

		if (!text) {
			lines.push(`    ${theme.fg("dim", "✓ done")}`);
			return;
		}

		const resultLines = text.split("\n");
		const maxLines = expanded ? MAX_TOOL_RESULT_LINES_EXPANDED : MAX_TOOL_RESULT_LINES_COLLAPSED;

		// Per-tool-type rendering
		switch (toolName) {
			case "bash":
			case "python": {
				// Show command output with line preview
				const displayLines = resultLines.slice(0, maxLines);
				lines.push(`    ${theme.fg("success", "✓")} ${theme.fg("dim", `${resultLines.length} lines`)}`);
				for (const rl of displayLines) {
					lines.push(`      ${theme.fg("dim", truncateToWidth(replaceTabs(rl), MAX_TOOL_RESULT_LINE_WIDTH))}`);
				}
				if (resultLines.length > maxLines) {
					lines.push(`      ${theme.fg("dim", `... ${resultLines.length - maxLines} more`)}`);
				}
				break;
			}
			case "read":
			case "grep":
			case "find":
			case "ast_grep": {
				// Show search/read results
				const displayLines = resultLines.slice(0, maxLines);
				lines.push(`    ${theme.fg("success", "✓")} ${theme.fg("dim", `${resultLines.length} lines`)}`);
				for (const rl of displayLines) {
					lines.push(`      ${theme.fg("dim", truncateToWidth(replaceTabs(rl), MAX_TOOL_RESULT_LINE_WIDTH))}`);
				}
				if (resultLines.length > maxLines) {
					lines.push(`      ${theme.fg("dim", `... ${resultLines.length - maxLines} more`)}`);
				}
				break;
			}
			case "edit":
			case "write":
			case "ast_edit": {
				// Show file path + brief summary
				if (resultLines.length === 1) {
					lines.push(
						`    ${theme.fg("success", "✓")} ${theme.fg("dim", truncateToWidth(replaceTabs(resultLines[0]), MAX_TOOL_RESULT_LINE_WIDTH))}`,
					);
				} else {
					lines.push(`    ${theme.fg("success", "✓")} ${theme.fg("dim", `${resultLines.length} lines`)}`);
					const displayLines = resultLines.slice(0, expanded ? 8 : 2);
					for (const rl of displayLines) {
						lines.push(`      ${theme.fg("dim", truncateToWidth(replaceTabs(rl), MAX_TOOL_RESULT_LINE_WIDTH))}`);
					}
					if (resultLines.length > displayLines.length) {
						lines.push(`      ${theme.fg("dim", `... ${resultLines.length - displayLines.length} more`)}`);
					}
				}
				break;
			}
			case "task": {
				// Show task result - detect nested sessions for breadcrumb nav (Bead 6)
				lines.push(`    ${theme.fg("success", "✓")} ${theme.fg("dim", "task completed")}`);
				const displayLines = resultLines.slice(0, maxLines);
				for (const rl of displayLines) {
					lines.push(`      ${theme.fg("dim", truncateToWidth(replaceTabs(rl), MAX_TOOL_RESULT_LINE_WIDTH))}`);
				}
				if (resultLines.length > maxLines) {
					lines.push(`      ${theme.fg("dim", `... ${resultLines.length - maxLines} more`)}`);
				}
				break;
			}
			default: {
				// Generic rendering
				if (resultLines.length === 1 && text.length < 80) {
					lines.push(
						`    ${theme.fg("success", "✓")} ${theme.fg("dim", truncateToWidth(replaceTabs(text), MAX_TOOL_RESULT_LINE_WIDTH))}`,
					);
				} else {
					lines.push(`    ${theme.fg("success", "✓")} ${theme.fg("dim", `${resultLines.length} lines`)}`);
					const displayLines = resultLines.slice(0, maxLines);
					for (const rl of displayLines) {
						lines.push(`      ${theme.fg("dim", truncateToWidth(replaceTabs(rl), MAX_TOOL_RESULT_LINE_WIDTH))}`);
					}
					if (resultLines.length > maxLines) {
						lines.push(`      ${theme.fg("dim", `... ${resultLines.length - maxLines} more`)}`);
					}
				}
				break;
			}
		}
	}

	#formatToolArgs(toolName: string, args: Record<string, unknown>): string {
		// Show the most relevant arg for common tools
		switch (toolName) {
			case "read":
				return args.path ? `path: ${args.path}` : "";
			case "write":
				return args.path ? `path: ${args.path}` : "";
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
				if (typeof cmd === "string") {
					return truncateToWidth(replaceTabs(cmd), 80);
				}
				return "";
			}
			case "lsp":
				return [args.action, args.file, args.symbol].filter(Boolean).join(" ");
			case "ast_grep":
			case "ast_edit":
				return args.path ? `path: ${args.path}` : "";
			case "task": {
				const tasks = args.tasks;
				if (Array.isArray(tasks)) {
					return `${tasks.length} task(s)`;
				}
				return "";
			}
			default: {
				// Generic: show first few args truncated
				const parts: string[] = [];
				let total = 0;
				for (const [key, value] of Object.entries(args)) {
					if (key.startsWith("_")) continue;
					const v = typeof value === "string" ? value : JSON.stringify(value);
					const entry = `${key}: ${truncateToWidth(replaceTabs(v ?? ""), 50)}`;
					if (total + entry.length > MAX_TOOL_ARGS_CHARS) break;
					parts.push(entry);
					total += entry.length;
				}
				return parts.join(", ");
			}
		}
	}

	/** Incrementally read and parse the session JSONL, caching already-parsed entries. */
	#loadTranscript(sessionFile: string): SessionMessageEntry[] | null {
		// Invalidate cache if session file changed (e.g. switched to different subagent)
		if (this.#transcriptCache && this.#transcriptCache.path !== sessionFile) {
			this.#transcriptCache = undefined;
		}

		const fromByte = this.#transcriptCache?.bytesRead ?? 0;
		const result = readFileIncremental(sessionFile, fromByte);
		if (!result) {
			logger.debug("Session observer: failed to read session file", { path: sessionFile });
			return this.#transcriptCache?.entries ?? null;
		}

		// File shrank (compaction or pruning rewrote it) — invalidate and re-read from scratch
		if (result.newSize < fromByte) {
			this.#transcriptCache = undefined;
			return this.#loadTranscript(sessionFile);
		}

		if (!this.#transcriptCache) {
			this.#transcriptCache = { path: sessionFile, bytesRead: 0, entries: [] };
		}

		// Parse only new bytes, but only up to the last complete line.
		// A partial trailing record (mid-write) must not be consumed —
		// we leave those bytes for the next refresh.
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
			// If no newline found, the entire chunk is partial — leave bytesRead unchanged
		}
		return this.#transcriptCache.entries;
	}

	/** Try to detect nested sub-agent session files from a task tool call's result */
	#detectNestedSessionFile(
		call: { name: string; arguments: Record<string, unknown> },
		result: ToolResultMessage | undefined,
	): string | undefined {
		if (call.name !== "task") return undefined;
		if (!result) return undefined;

		// Look for agent:// URLs or session file paths in the result text
		const textParts = result.content
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map(p => p.text);
		const text = textParts.join("\n");

		// Check result details for session file references
		const details = (result as any).details;
		if (details?.sessionFile && typeof details.sessionFile === "string") {
			return details.sessionFile;
		}

		// Try to find .jsonl file paths in output
		const jsonlMatch = text.match(/([^\s"']+\.jsonl)/);
		if (jsonlMatch) {
			return jsonlMatch[1];
		}

		return undefined;
	}

	/** Navigate into a nested sub-agent session (Bead 6) */
	#diveIntoSession(sessionFile: string): void {
		// Push current session onto navigation stack
		const currentSession = this.#registry.getSessions().find(s => s.id === this.#selectedSessionId);
		if (currentSession?.sessionFile) {
			this.#navigationStack.push({
				sessionId: this.#selectedSessionId!,
				label: currentSession.label,
				sessionFile: currentSession.sessionFile,
			});
		}

		// Clear transcript cache for new session
		this.#transcriptCache = undefined;
		this.#scrollOffset = 0;
		this.#selectedEntryIndex = 0;
		this.#expandedEntries.clear();

		// Create a synthetic session ID for the nested session
		this.#selectedSessionId = `nested:${sessionFile}`;
		this.#refreshViewer();
	}

	/** Pop navigation stack (Bead 6) */
	#navigateBack(): boolean {
		if (this.#navigationStack.length === 0) return false;

		const prev = this.#navigationStack.pop()!;
		this.#selectedSessionId = prev.sessionId;
		this.#transcriptCache = undefined;
		this.#scrollOffset = 0;
		this.#selectedEntryIndex = 0;
		this.#expandedEntries.clear();
		this.#refreshViewer();
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

			// Show current activity in the picker description for subagents
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
		const maxScroll = Math.max(0, this.#renderedLines.length - this.#viewportHeight);
		const entryCount = this.#viewerEntries.length;

		if (matchesKey(keyData, "escape")) {
			// Try to pop navigation stack first (Bead 6)
			if (!this.#navigateBack()) {
				this.#setupPicker();
			}
			return;
		}

		// j / down arrow — move selection down
		if (keyData === "j" || matchesKey(keyData, "down")) {
			if (entryCount > 0) {
				this.#selectedEntryIndex = Math.min(this.#selectedEntryIndex + 1, entryCount - 1);
				this.#scrollToSelectedEntry();
			} else {
				this.#scrollOffset = Math.min(this.#scrollOffset + 1, maxScroll);
			}
			this.#refreshViewer();
			return;
		}

		// k / up arrow — move selection up
		if (keyData === "k" || matchesKey(keyData, "up")) {
			if (entryCount > 0) {
				this.#selectedEntryIndex = Math.max(this.#selectedEntryIndex - 1, 0);
				this.#scrollToSelectedEntry();
			} else {
				this.#scrollOffset = Math.max(this.#scrollOffset - 1, 0);
			}
			this.#refreshViewer();
			return;
		}

		// Page Down
		if (matchesKey(keyData, "pageDown")) {
			if (entryCount > 0) {
				this.#selectedEntryIndex = Math.min(this.#selectedEntryIndex + 5, entryCount - 1);
				this.#scrollToSelectedEntry();
			} else {
				this.#scrollOffset = Math.min(this.#scrollOffset + PAGE_SIZE, maxScroll);
			}
			this.#refreshViewer();
			return;
		}

		// Page Up
		if (matchesKey(keyData, "pageUp")) {
			if (entryCount > 0) {
				this.#selectedEntryIndex = Math.max(this.#selectedEntryIndex - 5, 0);
				this.#scrollToSelectedEntry();
			} else {
				this.#scrollOffset = Math.max(this.#scrollOffset - PAGE_SIZE, 0);
			}
			this.#refreshViewer();
			return;
		}

		// Enter — toggle expand/collapse on selected entry (Bead 4)
		// Or dive into nested session for task tool calls (Bead 6)
		if (keyData === "\r" || keyData === "\n") {
			if (entryCount > 0 && this.#selectedEntryIndex < entryCount) {
				const entry = this.#viewerEntries[this.#selectedEntryIndex];

				// Check if this is a task tool call with a nested session (Bead 6)
				if (entry?.kind === "toolCall") {
					const entryData = entry.data as { call: any; result: any };
					const nestedFile = this.#detectNestedSessionFile(entryData.call, entryData.result);
					if (nestedFile) {
						this.#diveIntoSession(nestedFile);
						return;
					}
				}

				// Toggle expand/collapse
				if (this.#expandedEntries.has(this.#selectedEntryIndex)) {
					this.#expandedEntries.delete(this.#selectedEntryIndex);
				} else {
					this.#expandedEntries.add(this.#selectedEntryIndex);
				}
				this.#refreshViewer();
			}
			return;
		}

		// G — jump to bottom
		if (keyData === "G") {
			if (entryCount > 0) {
				this.#selectedEntryIndex = entryCount - 1;
			}
			this.#scrollOffset = maxScroll;
			this.#refreshViewer();
			return;
		}

		// g — jump to top
		if (keyData === "g") {
			this.#selectedEntryIndex = 0;
			this.#scrollOffset = 0;
			this.#refreshViewer();
			return;
		}
	}

	/** Ensure the selected entry is visible in the viewport */
	#scrollToSelectedEntry(): void {
		if (this.#viewerEntries.length === 0) return;
		const entry = this.#viewerEntries[this.#selectedEntryIndex];
		if (!entry) return;

		const entryTop = entry.lineStart;
		const entryBottom = entry.lineStart + entry.lineCount;

		// Scroll up if entry is above viewport
		if (entryTop < this.#scrollOffset) {
			this.#scrollOffset = Math.max(0, entryTop - 1);
		}
		// Scroll down if entry is below viewport
		if (entryBottom > this.#scrollOffset + this.#viewportHeight) {
			this.#scrollOffset = Math.max(0, entryBottom - this.#viewportHeight + 1);
		}
	}
}

// Sync helpers for render path — avoid async in component rendering
import * as fs from "node:fs";

/**
 * Read new bytes from a file starting at the given byte offset.
 * Returns the new text and updated file size, or null on error.
 */
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
