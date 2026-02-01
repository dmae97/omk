import type { AutocompleteProvider, CombinedAutocompleteProvider } from "../autocomplete";
import { getEditorKeybindings } from "../keybindings";
import { matchesKey } from "../keys";
import type { SymbolTheme } from "../symbols";
import { type Component, CURSOR_MARKER, type Focusable } from "../tui";
import { getSegmenter, isPunctuationChar, isWhitespaceChar, padding, truncateToWidth, visibleWidth } from "../utils";
import { SelectList, type SelectListTheme } from "./select-list";

const segmenter = getSegmenter();

/**
 * Represents a chunk of text for word-wrap layout.
 * Tracks both the text content and its position in the original line.
 */
interface TextChunk {
	text: string;
	startIndex: number;
	endIndex: number;
}

/**
 * Split a line into word-wrapped chunks.
 * Wraps at word boundaries when possible, falling back to character-level
 * wrapping for words longer than the available width.
 *
 * @param line - The text line to wrap
 * @param maxWidth - Maximum visible width per chunk
 * @returns Array of chunks with text and position information
 */
function wordWrapLine(line: string, maxWidth: number): TextChunk[] {
	if (!line || maxWidth <= 0) {
		return [{ text: "", startIndex: 0, endIndex: 0 }];
	}

	const lineWidth = visibleWidth(line);
	if (lineWidth <= maxWidth) {
		return [{ text: line, startIndex: 0, endIndex: line.length }];
	}

	const chunks: TextChunk[] = [];

	// Split into tokens (words and whitespace runs)
	const tokens: { text: string; startIndex: number; endIndex: number; isWhitespace: boolean }[] = [];
	let currentToken = "";
	let tokenStart = 0;
	let inWhitespace = false;
	let charIndex = 0;

	for (const seg of segmenter.segment(line)) {
		const grapheme = seg.segment;
		const graphemeIsWhitespace = isWhitespaceChar(grapheme);

		if (currentToken === "") {
			inWhitespace = graphemeIsWhitespace;
			tokenStart = charIndex;
		} else if (graphemeIsWhitespace !== inWhitespace) {
			// Token type changed - save current token
			tokens.push({
				text: currentToken,
				startIndex: tokenStart,
				endIndex: charIndex,
				isWhitespace: inWhitespace,
			});
			currentToken = "";
			tokenStart = charIndex;
			inWhitespace = graphemeIsWhitespace;
		}

		currentToken += grapheme;
		charIndex += grapheme.length;
	}

	// Push final token
	if (currentToken) {
		tokens.push({
			text: currentToken,
			startIndex: tokenStart,
			endIndex: charIndex,
			isWhitespace: inWhitespace,
		});
	}

	// Build chunks using word wrapping
	let currentChunk = "";
	let currentWidth = 0;
	let chunkStartIndex = 0;
	let atLineStart = true; // Track if we're at the start of a line (for skipping whitespace)

	for (const token of tokens) {
		const tokenWidth = visibleWidth(token.text);

		// Skip leading whitespace at line start
		if (atLineStart && token.isWhitespace) {
			chunkStartIndex = token.endIndex;
			continue;
		}
		atLineStart = false;

		// If this single token is wider than maxWidth, we need to break it
		if (tokenWidth > maxWidth) {
			// First, push any accumulated chunk
			if (currentChunk) {
				chunks.push({
					text: currentChunk,
					startIndex: chunkStartIndex,
					endIndex: token.startIndex,
				});
				currentChunk = "";
				currentWidth = 0;
				chunkStartIndex = token.startIndex;
			}

			// Break the long token by grapheme
			let tokenChunk = "";
			let tokenChunkWidth = 0;
			let tokenChunkStart = token.startIndex;
			let tokenCharIndex = token.startIndex;

			for (const seg of segmenter.segment(token.text)) {
				const grapheme = seg.segment;
				const graphemeWidth = visibleWidth(grapheme);

				if (tokenChunkWidth + graphemeWidth > maxWidth && tokenChunk) {
					chunks.push({
						text: tokenChunk,
						startIndex: tokenChunkStart,
						endIndex: tokenCharIndex,
					});
					tokenChunk = grapheme;
					tokenChunkWidth = graphemeWidth;
					tokenChunkStart = tokenCharIndex;
				} else {
					tokenChunk += grapheme;
					tokenChunkWidth += graphemeWidth;
				}
				tokenCharIndex += grapheme.length;
			}

			// Keep remainder as start of next chunk
			if (tokenChunk) {
				currentChunk = tokenChunk;
				currentWidth = tokenChunkWidth;
				chunkStartIndex = tokenChunkStart;
			}
			continue;
		}

		// Check if adding this token would exceed width
		if (currentWidth + tokenWidth > maxWidth) {
			// Push current chunk (trimming trailing whitespace for display)
			const trimmedChunk = currentChunk.trimEnd();
			if (trimmedChunk || chunks.length === 0) {
				chunks.push({
					text: trimmedChunk,
					startIndex: chunkStartIndex,
					endIndex: chunkStartIndex + currentChunk.length,
				});
			}

			// Start new line - skip leading whitespace
			atLineStart = true;
			if (token.isWhitespace) {
				currentChunk = "";
				currentWidth = 0;
				chunkStartIndex = token.endIndex;
			} else {
				currentChunk = token.text;
				currentWidth = tokenWidth;
				chunkStartIndex = token.startIndex;
				atLineStart = false;
			}
		} else {
			// Add token to current chunk
			currentChunk += token.text;
			currentWidth += tokenWidth;
		}
	}

	// Push final chunk
	if (currentChunk) {
		chunks.push({
			text: currentChunk,
			startIndex: chunkStartIndex,
			endIndex: line.length,
		});
	}

	return chunks.length > 0 ? chunks : [{ text: "", startIndex: 0, endIndex: 0 }];
}

// Kitty CSI-u sequences for printable keys, including optional shifted/base codepoints and text field.
const KITTY_CSI_U_REGEX = /^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?(?:;([\d:]*))?u$/;
const KITTY_MOD_SHIFT = 1;
const KITTY_MOD_ALT = 2;
const KITTY_MOD_CTRL = 4;

// Decode a printable CSI-u sequence, preferring the shifted key when present.
function decodeKittyPrintable(data: string): string | undefined {
	const match = data.match(KITTY_CSI_U_REGEX);
	if (!match) return undefined;

	// CSI-u groups: <codepoint>[:<shifted>[:<base>]];<mod>u
	const codepoint = Number.parseInt(match[1] ?? "", 10);
	if (!Number.isFinite(codepoint)) return undefined;

	const shiftedKey = match[2] && match[2].length > 0 ? Number.parseInt(match[2], 10) : undefined;
	const modValue = match[4] ? Number.parseInt(match[4], 10) : 1;
	// Modifiers are 1-indexed in CSI-u; normalize to our bitmask.
	const modifier = Number.isFinite(modValue) ? modValue - 1 : 0;

	// Ignore CSI-u sequences used for Alt/Ctrl shortcuts.
	if (modifier & (KITTY_MOD_ALT | KITTY_MOD_CTRL)) return undefined;

	const textField = match[6];
	if (textField && textField.length > 0) {
		const codepoints = textField
			.split(":")
			.filter(Boolean)
			.map(value => Number.parseInt(value, 10))
			.filter(value => Number.isFinite(value) && value >= 32);
		if (codepoints.length > 0) {
			try {
				return String.fromCodePoint(...codepoints);
			} catch {
				return undefined;
			}
		}
	}

	// Prefer the shifted keycode when Shift is held.
	let effectiveCodepoint = codepoint;
	if (modifier & KITTY_MOD_SHIFT && typeof shiftedKey === "number") {
		effectiveCodepoint = shiftedKey;
	}
	if (effectiveCodepoint >= 0xe000 && effectiveCodepoint <= 0xf8ff) {
		return undefined;
	}
	// Drop control characters or invalid codepoints.
	if (!Number.isFinite(effectiveCodepoint) || effectiveCodepoint < 32) return undefined;

	try {
		return String.fromCodePoint(effectiveCodepoint);
	} catch {
		return undefined;
	}
}

interface EditorState {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
}

interface LayoutLine {
	text: string;
	hasCursor: boolean;
	cursorPos?: number;
}

export interface EditorTheme {
	borderColor: (str: string) => string;
	selectList: SelectListTheme;
	symbols: SymbolTheme;
	editorPaddingX?: number;
}

export interface EditorTopBorder {
	/** The status content (already styled) */
	content: string;
	/** Visible width of the content */
	width: number;
}

interface HistoryEntry {
	prompt: string;
}

interface HistoryStorage {
	add(prompt: string, cwd?: string): void;
	getRecent(limit: number): HistoryEntry[];
}

export class Editor implements Component, Focusable {
	private state: EditorState = {
		lines: [""],
		cursorLine: 0,
		cursorCol: 0,
	};

	/** Focusable interface - set by TUI when focus changes */
	focused: boolean = false;

	private theme: EditorTheme;
	private useTerminalCursor = false;

	// Store last layout width for cursor navigation
	private lastLayoutWidth: number = 80;
	private paddingXOverride: number | undefined;
	private maxHeight?: number;
	private scrollOffset: number = 0;

	// Emacs-style kill ring
	private killRing: string[] = [];
	private lastKillWasKillCommand: boolean = false;

	// Character jump mode
	private jumpMode: "forward" | "backward" | null = null;

	// Border color (can be changed dynamically)
	public borderColor: (str: string) => string;

	// Autocomplete support
	private autocompleteProvider?: AutocompleteProvider;
	private autocompleteList?: SelectList;
	private autocompleteState: "regular" | "force" | null = null;
	private autocompletePrefix: string = "";
	private autocompleteRequestId: number = 0;
	private autocompleteMaxVisible: number = 5;
	public onAutocompleteUpdate?: () => void;

	// Paste tracking for large pastes
	private pastes: Map<number, string> = new Map();
	private pasteCounter: number = 0;

	// Bracketed paste mode buffering
	private pasteBuffer: string = "";
	private isInPaste: boolean = false;

	// Prompt history for up/down navigation
	private history: string[] = [];
	private historyIndex: number = -1; // -1 = not browsing, 0 = most recent, 1 = older, etc.
	private historyStorage?: HistoryStorage;

	// Undo stack for editor state changes
	private undoStack: EditorState[] = [];
	private suspendUndo = false;

	// Debounce timer for autocomplete updates
	private autocompleteTimeout: ReturnType<typeof setTimeout> | null = null;

	public onSubmit?: (text: string) => void;
	public onAltEnter?: (text: string) => void;
	public onChange?: (text: string) => void;
	public onAutocompleteCancel?: () => void;
	public disableSubmit: boolean = false;

	// Custom top border (for status line integration)
	private topBorderContent?: EditorTopBorder;

	constructor(theme: EditorTheme) {
		this.theme = theme;
		this.borderColor = theme.borderColor;
	}

	setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.autocompleteProvider = provider;
	}

	/**
	 * Set custom content for the top border (e.g., status line).
	 * Pass undefined to use the default plain border.
	 */
	setTopBorder(content: EditorTopBorder | undefined): void {
		this.topBorderContent = content;
	}

	/**
	 * Use the real terminal cursor instead of rendering a cursor glyph.
	 */
	setUseTerminalCursor(useTerminalCursor: boolean): void {
		this.useTerminalCursor = useTerminalCursor;
	}

	setMaxHeight(maxHeight: number | undefined): void {
		this.maxHeight = maxHeight;
		this.scrollOffset = 0;
	}

	setPaddingX(paddingX: number): void {
		this.paddingXOverride = Math.max(0, paddingX);
	}

	getAutocompleteMaxVisible(): number {
		return this.autocompleteMaxVisible;
	}

	setAutocompleteMaxVisible(maxVisible: number): void {
		const newMaxVisible = Number.isFinite(maxVisible) ? Math.max(3, Math.min(20, Math.floor(maxVisible))) : 5;
		if (this.autocompleteMaxVisible !== newMaxVisible) {
			this.autocompleteMaxVisible = newMaxVisible;
		}
	}

	setHistoryStorage(storage: HistoryStorage): void {
		this.historyStorage = storage;
		const recent = storage.getRecent(100);
		this.history = recent.map(entry => entry.prompt);
		this.historyIndex = -1;
	}

	/**
	 * Add a prompt to history for up/down arrow navigation.
	 * Called after successful submission.
	 */
	addToHistory(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;
		// Don't add consecutive duplicates
		if (this.history.length > 0 && this.history[0] === trimmed) return;
		this.history.unshift(trimmed);
		// Limit history size
		if (this.history.length > 100) {
			this.history.pop();
		}

		this.historyStorage?.add(trimmed, process.cwd());
	}

	private isEditorEmpty(): boolean {
		return this.state.lines.length === 1 && this.state.lines[0] === "";
	}

	private isOnFirstVisualLine(): boolean {
		const visualLines = this.buildVisualLineMap(this.lastLayoutWidth);
		const currentVisualLine = this.findCurrentVisualLine(visualLines);
		return currentVisualLine === 0;
	}

	private isOnLastVisualLine(): boolean {
		const visualLines = this.buildVisualLineMap(this.lastLayoutWidth);
		const currentVisualLine = this.findCurrentVisualLine(visualLines);
		return currentVisualLine === visualLines.length - 1;
	}

	private navigateHistory(direction: 1 | -1): void {
		this.resetKillSequence();
		if (this.history.length === 0) return;

		const newIndex = this.historyIndex - direction; // Up(-1) increases index, Down(1) decreases
		if (newIndex < -1 || newIndex >= this.history.length) return;

		this.historyIndex = newIndex;

		if (this.historyIndex === -1) {
			// Returned to "current" state - clear editor
			this.setTextInternal("");
		} else {
			this.setTextInternal(this.history[this.historyIndex] || "");
		}
	}

	/** Internal setText that doesn't reset history state - used by navigateHistory */
	private setTextInternal(text: string): void {
		this.clearUndoStack();
		const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
		this.state.lines = lines.length === 0 ? [""] : lines;
		this.state.cursorLine = this.state.lines.length - 1;
		this.state.cursorCol = this.state.lines[this.state.cursorLine]?.length || 0;

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	private getEditorPaddingX(): number {
		const padding = this.paddingXOverride ?? this.theme.editorPaddingX ?? 2;
		return Math.max(0, padding);
	}

	private getContentWidth(width: number, paddingX: number): number {
		return Math.max(0, width - 2 * (paddingX + 1));
	}

	private getLayoutWidth(width: number, paddingX: number): number {
		const contentWidth = this.getContentWidth(width, paddingX);
		return Math.max(1, contentWidth - (paddingX === 0 ? 1 : 0));
	}

	private getVisibleContentHeight(contentLines: number): number {
		if (this.maxHeight === undefined) return contentLines;
		return Math.max(1, this.maxHeight - 2);
	}

	private updateScrollOffset(layoutWidth: number, layoutLines: LayoutLine[], visibleHeight: number): void {
		if (layoutLines.length <= visibleHeight) {
			this.scrollOffset = 0;
			return;
		}

		const visualLines = this.buildVisualLineMap(layoutWidth);
		const cursorLine = this.findCurrentVisualLine(visualLines);
		if (cursorLine < this.scrollOffset) {
			this.scrollOffset = cursorLine;
		} else if (cursorLine >= this.scrollOffset + visibleHeight) {
			this.scrollOffset = cursorLine - visibleHeight + 1;
		}

		const maxOffset = Math.max(0, layoutLines.length - visibleHeight);
		this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
	}

	render(width: number): string[] {
		const paddingX = this.getEditorPaddingX();
		const contentAreaWidth = this.getContentWidth(width, paddingX);
		const layoutWidth = this.getLayoutWidth(width, paddingX);
		this.lastLayoutWidth = layoutWidth;

		// Box-drawing characters for rounded corners
		const box = this.theme.symbols.boxRound;
		const borderWidth = paddingX + 1;
		const topLeft = this.borderColor(`${box.topLeft}${box.horizontal.repeat(paddingX)}`);
		const topRight = this.borderColor(`${box.horizontal.repeat(paddingX)}${box.topRight}`);
		const bottomLeft = this.borderColor(`${box.bottomLeft}${box.horizontal}${padding(Math.max(0, paddingX - 1))}`);
		const horizontal = this.borderColor(box.horizontal);

		// Layout the text
		const layoutLines = this.layoutText(layoutWidth);
		const visibleContentHeight = this.getVisibleContentHeight(layoutLines.length);
		this.updateScrollOffset(layoutWidth, layoutLines, visibleContentHeight);
		const visibleLayoutLines = layoutLines.slice(this.scrollOffset, this.scrollOffset + visibleContentHeight);

		const result: string[] = [];

		// Render top border: ╭─ [status content] ────────────────╮
		const topFillWidth = width - borderWidth * 2;
		if (this.topBorderContent) {
			const { content, width: statusWidth } = this.topBorderContent;
			if (statusWidth <= topFillWidth) {
				// Status fits - add fill after it
				const fillWidth = topFillWidth - statusWidth;
				result.push(topLeft + content + this.borderColor(box.horizontal.repeat(fillWidth)) + topRight);
			} else {
				// Status too long - truncate it
				const truncated = truncateToWidth(content, topFillWidth - 1);
				const truncatedWidth = visibleWidth(truncated);
				const fillWidth = Math.max(0, topFillWidth - truncatedWidth);
				result.push(topLeft + truncated + this.borderColor(box.horizontal.repeat(fillWidth)) + topRight);
			}
		} else {
			result.push(topLeft + horizontal.repeat(topFillWidth) + topRight);
		}

		// Render each layout line
		// Emit hardware cursor marker only when focused and not showing autocomplete
		const emitCursorMarker = this.focused && !this.autocompleteState;
		const lineContentWidth = contentAreaWidth;

		for (const layoutLine of visibleLayoutLines) {
			let displayText = layoutLine.text;
			let displayWidth = visibleWidth(layoutLine.text);
			let cursorInPadding = false;

			// Add cursor if this line has it
			const hasCursor = layoutLine.hasCursor && layoutLine.cursorPos !== undefined;
			const marker = emitCursorMarker ? CURSOR_MARKER : "";

			if (hasCursor && this.useTerminalCursor) {
				if (marker) {
					const before = displayText.slice(0, layoutLine.cursorPos);
					const after = displayText.slice(layoutLine.cursorPos);
					displayText = before + marker + after;
				}
			} else if (hasCursor && !this.useTerminalCursor) {
				const before = displayText.slice(0, layoutLine.cursorPos);
				const after = displayText.slice(layoutLine.cursorPos);

				if (after.length > 0) {
					// Cursor is on a character (grapheme) - replace it with highlighted version
					// Get the first grapheme from 'after'
					const afterGraphemes = [...segmenter.segment(after)];
					const firstGrapheme = afterGraphemes[0]?.segment || "";
					const restAfter = after.slice(firstGrapheme.length);
					const cursor = `\x1b[7m${firstGrapheme}\x1b[0m`;
					displayText = before + marker + cursor + restAfter;
					// displayWidth stays the same - we're replacing, not adding
				} else {
					// Cursor is at the end - add thin cursor glyph
					const cursorChar = this.theme.symbols.inputCursor;
					const cursor = `\x1b[5m${cursorChar}\x1b[0m`;
					displayText = before + marker + cursor;
					displayWidth += visibleWidth(cursorChar);
					if (displayWidth > lineContentWidth && paddingX > 0) {
						cursorInPadding = true;
					}
				}
			}

			// All lines have consistent borders based on padding
			const isLastLine = layoutLine === visibleLayoutLines[visibleLayoutLines.length - 1];
			const linePad = padding(Math.max(0, lineContentWidth - displayWidth));

			const rightPaddingWidth = Math.max(0, paddingX - (cursorInPadding ? 1 : 0));
			if (isLastLine) {
				const bottomRightPadding = Math.max(0, paddingX - 1 - (cursorInPadding ? 1 : 0));
				const bottomRightAdjusted = this.borderColor(
					`${padding(bottomRightPadding)}${box.horizontal}${box.bottomRight}`,
				);
				result.push(`${bottomLeft}${displayText}${linePad}${bottomRightAdjusted}`);
			} else {
				const leftBorder = this.borderColor(`${box.vertical}${padding(paddingX)}`);
				const rightBorder = this.borderColor(`${padding(rightPaddingWidth)}${box.vertical}`);
				result.push(leftBorder + displayText + linePad + rightBorder);
			}
		}

		// Add autocomplete list if active
		if (this.autocompleteState && this.autocompleteList) {
			const autocompleteResult = this.autocompleteList.render(width);
			result.push(...autocompleteResult);
		}

		return result;
	}

	getCursorPosition(width: number): { row: number; col: number } | null {
		if (!this.useTerminalCursor) return null;

		const paddingX = this.getEditorPaddingX();
		const borderWidth = paddingX + 1;
		const layoutWidth = this.getLayoutWidth(width, paddingX);
		if (layoutWidth <= 0) return null;

		const layoutLines = this.layoutText(layoutWidth);
		const visibleContentHeight = this.getVisibleContentHeight(layoutLines.length);
		this.updateScrollOffset(layoutWidth, layoutLines, visibleContentHeight);

		for (let i = 0; i < layoutLines.length; i++) {
			if (i < this.scrollOffset || i >= this.scrollOffset + visibleContentHeight) continue;
			const layoutLine = layoutLines[i];
			if (!layoutLine || !layoutLine.hasCursor || layoutLine.cursorPos === undefined) continue;

			const lineWidth = visibleWidth(layoutLine.text);
			const isCursorAtLineEnd = layoutLine.cursorPos === layoutLine.text.length;

			if (isCursorAtLineEnd && lineWidth >= layoutWidth && layoutLine.text.length > 0) {
				const graphemes = [...segmenter.segment(layoutLine.text)];
				const lastGrapheme = graphemes[graphemes.length - 1]?.segment || "";
				const lastWidth = visibleWidth(lastGrapheme) || 1;
				const colOffset = borderWidth + Math.max(0, lineWidth - lastWidth);
				return { row: 1 + i - this.scrollOffset, col: colOffset };
			}

			const before = layoutLine.text.slice(0, layoutLine.cursorPos);
			const colOffset = borderWidth + visibleWidth(before);
			return { row: 1 + i - this.scrollOffset, col: colOffset };
		}

		return null;
	}

	handleInput(data: string): void {
		const kb = getEditorKeybindings();

		// Handle character jump mode (awaiting next character to jump to)
		if (this.jumpMode !== null) {
			// Cancel if the hotkey is pressed again
			if (kb.matches(data, "jumpForward") || kb.matches(data, "jumpBackward")) {
				this.jumpMode = null;
				return;
			}

			if (data.charCodeAt(0) >= 32) {
				// Printable character - perform the jump
				const direction = this.jumpMode;
				this.jumpMode = null;
				this.jumpToChar(data, direction);
				return;
			}

			// Control character - cancel and fall through to normal handling
			this.jumpMode = null;
		}

		// Handle bracketed paste mode
		// Start of paste: \x1b[200~
		// End of paste: \x1b[201~

		// Check if we're starting a bracketed paste
		if (data.includes("\x1b[200~")) {
			this.isInPaste = true;
			this.pasteBuffer = "";
			// Remove the start marker and keep the rest
			data = data.replace("\x1b[200~", "");
		}

		// If we're in a paste, buffer the data
		if (this.isInPaste) {
			// Append data to buffer first (end marker could be split across chunks)
			this.pasteBuffer += data;

			// Check if the accumulated buffer contains the end marker
			const endIndex = this.pasteBuffer.indexOf("\x1b[201~");
			if (endIndex !== -1) {
				// Extract content before the end marker
				const pasteContent = this.pasteBuffer.substring(0, endIndex);

				// Process the complete paste
				this.handlePaste(pasteContent);

				// Reset paste state
				this.isInPaste = false;

				// Process any remaining data after the end marker
				const remaining = this.pasteBuffer.substring(endIndex + 6); // 6 = length of \x1b[201~
				this.pasteBuffer = "";

				if (remaining.length > 0) {
					this.handleInput(remaining);
				}
				return;
			} else {
				// Still accumulating, wait for more data
				return;
			}
		}

		// Handle special key combinations first

		// Ctrl+C - Exit (let parent handle this)
		if (matchesKey(data, "ctrl+c")) {
			return;
		}

		// Ctrl+- / Ctrl+_ - Undo last edit
		if (matchesKey(data, "ctrl+-") || matchesKey(data, "ctrl+_")) {
			this.applyUndo();
			return;
		}

		// Handle autocomplete special keys first (but don't block other input)
		if (this.autocompleteState && this.autocompleteList) {
			// Escape - cancel autocomplete
			if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
				this.cancelAutocomplete(true);
				return;
			}
			// Let the autocomplete list handle navigation and selection
			else if (
				matchesKey(data, "up") ||
				matchesKey(data, "down") ||
				matchesKey(data, "enter") ||
				matchesKey(data, "return") ||
				data === "\n" ||
				matchesKey(data, "tab")
			) {
				// Only pass arrow keys to the list, not Enter/Tab (we handle those directly)
				if (matchesKey(data, "up") || matchesKey(data, "down")) {
					this.autocompleteList.handleInput(data);
					this.onAutocompleteUpdate?.();
					return;
				}

				// If Tab was pressed, always apply the selection
				if (matchesKey(data, "tab")) {
					const selected = this.autocompleteList.getSelectedItem();
					if (selected && this.autocompleteProvider) {
						const result = this.autocompleteProvider.applyCompletion(
							this.state.lines,
							this.state.cursorLine,
							this.state.cursorCol,
							selected,
							this.autocompletePrefix,
						);

						this.state.lines = result.lines;
						this.state.cursorLine = result.cursorLine;
						this.state.cursorCol = result.cursorCol;

						this.cancelAutocomplete();

						if (this.onChange) {
							this.onChange(this.getText());
						}
					}
					return;
				}

				// If Enter was pressed on a slash command, apply completion and submit
				if (
					(matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") &&
					this.autocompletePrefix.startsWith("/")
				) {
					// Check for stale autocomplete state due to debounce
					const currentLine = this.state.lines[this.state.cursorLine] ?? "";
					const currentTextBeforeCursor = currentLine.slice(0, this.state.cursorCol);
					if (currentTextBeforeCursor !== this.autocompletePrefix) {
						// Autocomplete is stale - cancel and fall through to normal submission
						this.cancelAutocomplete();
					} else {
						const selected = this.autocompleteList.getSelectedItem();
						if (selected && this.autocompleteProvider) {
							const result = this.autocompleteProvider.applyCompletion(
								this.state.lines,
								this.state.cursorLine,
								this.state.cursorCol,
								selected,
								this.autocompletePrefix,
							);

							this.state.lines = result.lines;
							this.state.cursorLine = result.cursorLine;
							this.state.cursorCol = result.cursorCol;
						}
						this.cancelAutocomplete();
					}
					// Don't return - fall through to submission logic
				}
				// If Enter was pressed on a file path, apply completion
				else if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
					const selected = this.autocompleteList.getSelectedItem();
					if (selected && this.autocompleteProvider) {
						const result = this.autocompleteProvider.applyCompletion(
							this.state.lines,
							this.state.cursorLine,
							this.state.cursorCol,
							selected,
							this.autocompletePrefix,
						);

						this.state.lines = result.lines;
						this.state.cursorLine = result.cursorLine;
						this.state.cursorCol = result.cursorCol;

						this.cancelAutocomplete();

						if (this.onChange) {
							this.onChange(this.getText());
						}
					}
					return;
				}
			}
			// For other keys (like regular typing), DON'T return here
			// Let them fall through to normal character handling
		}

		// Tab key - context-aware completion (but not when already autocompleting)
		if (matchesKey(data, "tab") && !this.autocompleteState) {
			this.handleTabCompletion();
			return;
		}

		// Continue with rest of input handling
		// Ctrl+K - Delete to end of line
		if (matchesKey(data, "ctrl+k")) {
			this.deleteToEndOfLine();
		}
		// Ctrl+U - Delete to start of line
		else if (matchesKey(data, "ctrl+u")) {
			this.deleteToStartOfLine();
		}
		// Ctrl+W - Delete word backwards
		else if (matchesKey(data, "ctrl+w")) {
			this.deleteWordBackwards();
		}
		// Option/Alt+Backspace - Delete word backwards
		else if (matchesKey(data, "alt+backspace")) {
			this.deleteWordBackwards();
		}
		// Option/Alt+D - Delete word forwards
		else if (matchesKey(data, "alt+d") || matchesKey(data, "alt+delete")) {
			this.deleteWordForwards();
		}
		// Ctrl+Y - Yank from kill ring
		else if (matchesKey(data, "ctrl+y")) {
			this.yankFromKillRing();
		}
		// Ctrl+A - Move to start of line
		else if (matchesKey(data, "ctrl+a")) {
			this.moveToLineStart();
		}
		// Ctrl+E - Move to end of line
		else if (matchesKey(data, "ctrl+e")) {
			this.moveToLineEnd();
		}
		// Alt+Enter - special handler if callback exists, otherwise new line
		else if (matchesKey(data, "alt+enter")) {
			if (this.onAltEnter) {
				this.onAltEnter(this.getText());
			} else {
				this.addNewLine();
			}
		}
		// New line shortcuts (but not plain LF/CR which should be submit)
		else if (
			(data.charCodeAt(0) === 10 && data.length > 1) || // Ctrl+Enter with modifiers
			data === "\x1b[13;5u" || // Ctrl+Enter (Kitty protocol)
			data === "\x1b[27;5;13~" || // Ctrl+Enter (legacy format)
			data === "\x1b\r" || // Option+Enter in some terminals (legacy)
			data === "\x1b[13;2~" || // Shift+Enter in some terminals (legacy format)
			matchesKey(data, "shift+enter") || // Shift+Enter (Kitty protocol, handles lock bits)
			(data.length > 1 && data.includes("\x1b") && data.includes("\r")) ||
			(data === "\n" && data.length === 1) // Shift+Enter from iTerm2 mapping
		) {
			// Modifier + Enter = new line
			this.addNewLine();
		}
		// Plain Enter - submit (handles both legacy \r and Kitty protocol with lock bits)
		else if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
			// If submit is disabled, do nothing
			if (this.disableSubmit) {
				return;
			}

			// Workaround for terminals without Shift+Enter support:
			// If char before cursor is \, delete it and insert newline instead of submitting.
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			if (this.state.cursorCol > 0 && currentLine[this.state.cursorCol - 1] === "\\") {
				this.handleBackspace();
				this.addNewLine();
				return;
			}

			this.resetKillSequence();

			// Get text and substitute paste markers with actual content
			let result = this.state.lines.join("\n").trim();

			// Replace all [paste #N +xxx lines] or [paste #N xxx chars] markers with actual paste content
			for (const [pasteId, pasteContent] of this.pastes) {
				// Match formats: [paste #N], [paste #N +xxx lines], or [paste #N xxx chars]
				const markerRegex = new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`, "g");
				result = result.replace(markerRegex, pasteContent);
			}

			// Reset editor and clear pastes
			this.state = {
				lines: [""],
				cursorLine: 0,
				cursorCol: 0,
			};
			this.clearUndoStack();
			this.pastes.clear();
			this.pasteCounter = 0;
			this.historyIndex = -1; // Exit history browsing mode

			// Notify that editor is now empty
			if (this.onChange) {
				this.onChange("");
			}

			if (this.onSubmit) {
				this.onSubmit(result);
			}
		}
		// Backspace (including Shift+Backspace)
		else if (matchesKey(data, "backspace") || matchesKey(data, "shift+backspace")) {
			this.handleBackspace();
		}
		// Line navigation shortcuts (Home/End keys)
		else if (matchesKey(data, "home")) {
			this.moveToLineStart();
		} else if (matchesKey(data, "end")) {
			this.moveToLineEnd();
		}
		// Forward delete (Fn+Backspace or Delete key, including Shift+Delete)
		else if (matchesKey(data, "delete") || matchesKey(data, "shift+delete")) {
			this.handleForwardDelete();
		}
		// Word navigation (Option/Alt + Arrow or Ctrl + Arrow)
		else if (matchesKey(data, "alt+left") || matchesKey(data, "ctrl+left")) {
			// Word left
			this.resetKillSequence();
			this.moveWordBackwards();
		} else if (matchesKey(data, "alt+right") || matchesKey(data, "ctrl+right")) {
			// Word right
			this.resetKillSequence();
			this.moveWordForwards();
		}
		// Arrow keys
		else if (matchesKey(data, "up")) {
			// Up - history navigation or cursor movement
			if (this.isEditorEmpty()) {
				this.navigateHistory(-1); // Start browsing history
			} else if (this.historyIndex > -1 && this.isOnFirstVisualLine()) {
				this.navigateHistory(-1); // Navigate to older history entry
			} else if (this.isOnFirstVisualLine()) {
				// Already at top - jump to start of line
				this.moveToLineStart();
			} else {
				this.moveCursor(-1, 0); // Cursor movement (within text or history entry)
			}
		} else if (matchesKey(data, "down")) {
			// Down - history navigation or cursor movement
			if (this.historyIndex > -1 && this.isOnLastVisualLine()) {
				this.navigateHistory(1); // Navigate to newer history entry or clear
			} else if (this.isOnLastVisualLine()) {
				// Already at bottom - jump to end of line
				this.moveToLineEnd();
			} else {
				this.moveCursor(1, 0); // Cursor movement (within text or history entry)
			}
		} else if (matchesKey(data, "right")) {
			// Right
			this.moveCursor(0, 1);
		} else if (matchesKey(data, "left")) {
			// Left
			this.moveCursor(0, -1);
		}
		// Shift+Space - insert regular space (Kitty protocol sends escape sequence)
		else if (matchesKey(data, "shift+space")) {
			this.insertCharacter(" ");
		}
		// Character jump mode triggers
		else if (kb.matches(data, "jumpForward")) {
			this.jumpMode = "forward";
		} else if (kb.matches(data, "jumpBackward")) {
			this.jumpMode = "backward";
		}
		// Kitty CSI-u printable characters (shifted symbols like @, ?, {, })
		else {
			const kittyChar = decodeKittyPrintable(data);
			if (kittyChar) {
				this.insertText(kittyChar);
				return;
			}
			// Regular characters (printable characters and unicode, but not control characters)
			if (data.charCodeAt(0) >= 32) {
				this.insertCharacter(data);
			}
		}
	}

	private layoutText(contentWidth: number): LayoutLine[] {
		const layoutLines: LayoutLine[] = [];

		if (this.state.lines.length === 0 || (this.state.lines.length === 1 && this.state.lines[0] === "")) {
			// Empty editor
			layoutLines.push({
				text: "",
				hasCursor: true,
				cursorPos: 0,
			});
			return layoutLines;
		}

		// Process each logical line
		for (let i = 0; i < this.state.lines.length; i++) {
			const line = this.state.lines[i] || "";
			const isCurrentLine = i === this.state.cursorLine;
			const lineVisibleWidth = visibleWidth(line);

			if (lineVisibleWidth <= contentWidth) {
				// Line fits in one layout line
				if (isCurrentLine) {
					layoutLines.push({
						text: line,
						hasCursor: true,
						cursorPos: this.state.cursorCol,
					});
				} else {
					layoutLines.push({
						text: line,
						hasCursor: false,
					});
				}
			} else {
				// Line needs wrapping - use word-aware wrapping
				const chunks = wordWrapLine(line, contentWidth);

				for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
					const chunk = chunks[chunkIndex];
					if (!chunk) continue;

					const cursorPos = this.state.cursorCol;
					const isLastChunk = chunkIndex === chunks.length - 1;

					// Determine if cursor is in this chunk
					// For word-wrapped chunks, we need to handle the case where
					// cursor might be in trimmed whitespace at end of chunk
					let hasCursorInChunk = false;
					let adjustedCursorPos = 0;

					if (isCurrentLine) {
						if (isLastChunk) {
							// Last chunk: cursor belongs here if >= startIndex
							hasCursorInChunk = cursorPos >= chunk.startIndex;
							adjustedCursorPos = cursorPos - chunk.startIndex;
						} else {
							// Non-last chunk: cursor belongs here if in range [startIndex, endIndex)
							// But we need to handle the visual position in the trimmed text
							hasCursorInChunk = cursorPos >= chunk.startIndex && cursorPos < chunk.endIndex;
							if (hasCursorInChunk) {
								adjustedCursorPos = cursorPos - chunk.startIndex;
								// Clamp to text length (in case cursor was in trimmed whitespace)
								if (adjustedCursorPos > chunk.text.length) {
									adjustedCursorPos = chunk.text.length;
								}
							}
						}
					}

					if (hasCursorInChunk) {
						layoutLines.push({
							text: chunk.text,
							hasCursor: true,
							cursorPos: adjustedCursorPos,
						});
					} else {
						layoutLines.push({
							text: chunk.text,
							hasCursor: false,
						});
					}
				}
			}
		}

		return layoutLines;
	}

	getText(): string {
		return this.state.lines.join("\n");
	}

	/**
	 * Get text with paste markers expanded to their actual content.
	 * Use this when you need the full content (e.g., for external editor).
	 */
	getExpandedText(): string {
		let result = this.state.lines.join("\n");
		for (const [pasteId, pasteContent] of this.pastes) {
			const markerRegex = new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`, "g");
			result = result.replace(markerRegex, pasteContent);
		}
		return result;
	}

	getLines(): string[] {
		return [...this.state.lines];
	}

	getCursor(): { line: number; col: number } {
		return { line: this.state.cursorLine, col: this.state.cursorCol };
	}

	setText(text: string): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.resetKillSequence();
		this.setTextInternal(text);
	}

	/** Insert text at the current cursor position */
	insertText(text: string): void {
		this.historyIndex = -1;
		this.resetKillSequence();
		this.recordUndoState();

		const line = this.state.lines[this.state.cursorLine] || "";
		const before = line.slice(0, this.state.cursorCol);
		const after = line.slice(this.state.cursorCol);

		this.state.lines[this.state.cursorLine] = before + text + after;
		this.state.cursorCol += text.length;

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	// All the editor methods from before...
	private insertCharacter(char: string): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.resetKillSequence();
		this.recordUndoState();

		const line = this.state.lines[this.state.cursorLine] || "";

		const before = line.slice(0, this.state.cursorCol);
		const after = line.slice(this.state.cursorCol);

		this.state.lines[this.state.cursorLine] = before + char + after;
		this.state.cursorCol += char.length; // Fix: increment by the length of the inserted string

		if (this.onChange) {
			this.onChange(this.getText());
		}

		// Check if we should trigger or update autocomplete
		if (!this.autocompleteState) {
			// Auto-trigger for "/" at the start of a line (slash commands)
			if (char === "/" && this.isAtStartOfMessage()) {
				this.tryTriggerAutocomplete();
			}
			// Auto-trigger for "@" file reference (fuzzy search)
			else if (char === "@") {
				const currentLine = this.state.lines[this.state.cursorLine] || "";
				const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
				// Only trigger if @ is after whitespace or at start of line
				const charBeforeAt = textBeforeCursor[textBeforeCursor.length - 2];
				if (textBeforeCursor.length === 1 || charBeforeAt === " " || charBeforeAt === "\t") {
					this.tryTriggerAutocomplete();
				}
			}
			// Also auto-trigger when typing letters/path chars in a slash command context
			else if (/[a-zA-Z0-9.\-_/]/.test(char)) {
				const currentLine = this.state.lines[this.state.cursorLine] || "";
				const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
				// Check if we're in a slash command (with or without space for arguments)
				if (textBeforeCursor.trimStart().startsWith("/")) {
					this.tryTriggerAutocomplete();
				}
				// Check if we're in an @ file reference context
				else if (textBeforeCursor.match(/(?:^|[\s])@[^\s]*$/)) {
					this.tryTriggerAutocomplete();
				}
			}
		} else {
			this.debouncedUpdateAutocomplete();
		}
	}

	private handlePaste(pastedText: string): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.resetKillSequence();
		this.recordUndoState();

		this.withUndoSuspended(() => {
			// Clean the pasted text
			const cleanText = pastedText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

			// Convert tabs to spaces (4 spaces per tab)
			const tabExpandedText = cleanText.replace(/\t/g, "    ");

			// Filter out non-printable characters except newlines
			let filteredText = tabExpandedText
				.split("")
				.filter(char => char === "\n" || char.charCodeAt(0) >= 32)
				.join("");

			// If pasting a file path (starts with /, ~, or .) and the character before
			// the cursor is a word character, prepend a space for better readability
			if (/^[/~.]/.test(filteredText)) {
				const currentLine = this.state.lines[this.state.cursorLine] || "";
				const charBeforeCursor = this.state.cursorCol > 0 ? currentLine[this.state.cursorCol - 1] : "";
				if (charBeforeCursor && /\w/.test(charBeforeCursor)) {
					filteredText = ` ${filteredText}`;
				}
			}

			// Split into lines
			const pastedLines = filteredText.split("\n");

			// Check if this is a large paste (> 10 lines or > 1000 characters)
			const totalChars = filteredText.length;
			if (pastedLines.length > 10 || totalChars > 1000) {
				// Store the paste and insert a marker
				this.pasteCounter++;
				const pasteId = this.pasteCounter;
				this.pastes.set(pasteId, filteredText);

				// Insert marker like "[paste #1 +123 lines]" or "[paste #1 1234 chars]"
				const marker =
					pastedLines.length > 10
						? `[paste #${pasteId} +${pastedLines.length} lines]`
						: `[paste #${pasteId} ${totalChars} chars]`;
				this.insertTextAtCursor(marker);

				return;
			}

			if (pastedLines.length === 1) {
				// Single line - insert character by character to trigger autocomplete
				for (const char of filteredText) {
					this.insertCharacter(char);
				}
				return;
			}

			// Multi-line paste - use insertTextAtCursor for proper handling
			this.insertTextAtCursor(filteredText);
		});
	}

	private addNewLine(): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.resetKillSequence();
		this.recordUndoState();

		const currentLine = this.state.lines[this.state.cursorLine] || "";

		const before = currentLine.slice(0, this.state.cursorCol);
		const after = currentLine.slice(this.state.cursorCol);

		// Split current line
		this.state.lines[this.state.cursorLine] = before;
		this.state.lines.splice(this.state.cursorLine + 1, 0, after);

		// Move cursor to start of new line
		this.state.cursorLine++;
		this.state.cursorCol = 0;

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private handleBackspace(): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.resetKillSequence();
		this.recordUndoState();

		if (this.state.cursorCol > 0) {
			// Delete grapheme before cursor (handles emojis, combining characters, etc.)
			const line = this.state.lines[this.state.cursorLine] || "";
			const beforeCursor = line.slice(0, this.state.cursorCol);

			// Find the last grapheme in the text before cursor
			const graphemes = [...segmenter.segment(beforeCursor)];
			const lastGrapheme = graphemes[graphemes.length - 1];
			const graphemeLength = lastGrapheme ? lastGrapheme.segment.length : 1;

			const before = line.slice(0, this.state.cursorCol - graphemeLength);
			const after = line.slice(this.state.cursorCol);

			this.state.lines[this.state.cursorLine] = before + after;
			this.state.cursorCol -= graphemeLength;
		} else if (this.state.cursorLine > 0) {
			// Merge with previous line
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const previousLine = this.state.lines[this.state.cursorLine - 1] || "";

			this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
			this.state.lines.splice(this.state.cursorLine, 1);

			this.state.cursorLine--;
			this.state.cursorCol = previousLine.length;
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}

		// Update or re-trigger autocomplete after backspace
		if (this.autocompleteState) {
			this.debouncedUpdateAutocomplete();
		} else {
			// If autocomplete was cancelled (no matches), re-trigger if we're in a completable context
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
			// Slash command context
			if (textBeforeCursor.trimStart().startsWith("/")) {
				this.tryTriggerAutocomplete();
			}
			// @ file reference context
			else if (textBeforeCursor.match(/(?:^|[\s])@[^\s]*$/)) {
				this.tryTriggerAutocomplete();
			}
		}
	}

	private moveToLineStart(): void {
		this.resetKillSequence();
		this.state.cursorCol = 0;
	}

	private moveToLineEnd(): void {
		this.resetKillSequence();
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		this.state.cursorCol = currentLine.length;
	}

	private resetKillSequence(): void {
		this.lastKillWasKillCommand = false;
	}

	private clearUndoStack(): void {
		this.undoStack = [];
	}

	private withUndoSuspended<T>(fn: () => T): T {
		const wasSuspended = this.suspendUndo;
		this.suspendUndo = true;
		try {
			return fn();
		} finally {
			this.suspendUndo = wasSuspended;
		}
	}

	private recordUndoState(): void {
		if (this.suspendUndo) return;
		const snapshot: EditorState = {
			lines: [...this.state.lines],
			cursorLine: this.state.cursorLine,
			cursorCol: this.state.cursorCol,
		};

		const last = this.undoStack[this.undoStack.length - 1];
		if (last) {
			const sameLines =
				last.cursorLine === snapshot.cursorLine &&
				last.cursorCol === snapshot.cursorCol &&
				last.lines.length === snapshot.lines.length &&
				last.lines.every((line, index) => line === snapshot.lines[index]);
			if (sameLines) return;
		}

		this.undoStack.push(snapshot);
		if (this.undoStack.length > 200) {
			this.undoStack.shift();
		}
	}

	private applyUndo(): void {
		const snapshot = this.undoStack.pop();
		if (!snapshot) return;

		this.historyIndex = -1;
		this.resetKillSequence();
		this.state = {
			lines: [...snapshot.lines],
			cursorLine: snapshot.cursorLine,
			cursorCol: snapshot.cursorCol,
		};

		if (this.onChange) {
			this.onChange(this.getText());
		}

		if (this.autocompleteState) {
			this.debouncedUpdateAutocomplete();
		} else {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
			if (textBeforeCursor.trimStart().startsWith("/")) {
				this.tryTriggerAutocomplete();
			} else if (textBeforeCursor.match(/(?:^|[\s])@[^\s]*$/)) {
				this.tryTriggerAutocomplete();
			}
		}
	}

	private recordKill(text: string, direction: "forward" | "backward"): void {
		if (!text) return;
		if (this.lastKillWasKillCommand && this.killRing.length > 0) {
			if (direction === "backward") {
				this.killRing[0] = text + this.killRing[0];
			} else {
				this.killRing[0] = this.killRing[0] + text;
			}
		} else {
			this.killRing.unshift(text);
		}
		this.lastKillWasKillCommand = true;
	}

	private insertTextAtCursor(text: string): void {
		this.historyIndex = -1;
		this.resetKillSequence();
		this.recordUndoState();

		const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		const lines = normalized.split("\n");

		if (lines.length === 1) {
			const line = this.state.lines[this.state.cursorLine] || "";
			const before = line.slice(0, this.state.cursorCol);
			const after = line.slice(this.state.cursorCol);
			this.state.lines[this.state.cursorLine] = before + normalized + after;
			this.state.cursorCol += normalized.length;
		} else {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const beforeCursor = currentLine.slice(0, this.state.cursorCol);
			const afterCursor = currentLine.slice(this.state.cursorCol);

			const newLines: string[] = [];
			for (let i = 0; i < this.state.cursorLine; i++) {
				newLines.push(this.state.lines[i] || "");
			}

			newLines.push(beforeCursor + (lines[0] || ""));
			for (let i = 1; i < lines.length - 1; i++) {
				newLines.push(lines[i] || "");
			}
			newLines.push((lines[lines.length - 1] || "") + afterCursor);

			for (let i = this.state.cursorLine + 1; i < this.state.lines.length; i++) {
				newLines.push(this.state.lines[i] || "");
			}

			this.state.lines = newLines;
			this.state.cursorLine += lines.length - 1;
			this.state.cursorCol = (lines[lines.length - 1] || "").length;
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private yankFromKillRing(): void {
		if (this.killRing.length === 0) return;
		this.insertTextAtCursor(this.killRing[0] || "");
	}

	private deleteToStartOfLine(): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.recordUndoState();

		const currentLine = this.state.lines[this.state.cursorLine] || "";
		let deletedText = "";

		if (this.state.cursorCol > 0) {
			// Delete from start of line up to cursor
			deletedText = currentLine.slice(0, this.state.cursorCol);
			this.state.lines[this.state.cursorLine] = currentLine.slice(this.state.cursorCol);
			this.state.cursorCol = 0;
		} else if (this.state.cursorLine > 0) {
			// At start of line - merge with previous line
			deletedText = "\n";
			const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
			this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
			this.state.lines.splice(this.state.cursorLine, 1);
			this.state.cursorLine--;
			this.state.cursorCol = previousLine.length;
		}

		this.recordKill(deletedText, "backward");

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private deleteToEndOfLine(): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.recordUndoState();

		const currentLine = this.state.lines[this.state.cursorLine] || "";
		let deletedText = "";

		if (this.state.cursorCol < currentLine.length) {
			// Delete from cursor to end of line
			deletedText = currentLine.slice(this.state.cursorCol);
			this.state.lines[this.state.cursorLine] = currentLine.slice(0, this.state.cursorCol);
		} else if (this.state.cursorLine < this.state.lines.length - 1) {
			// At end of line - merge with next line
			const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
			deletedText = `\n${nextLine}`;
			this.state.lines[this.state.cursorLine] = currentLine + nextLine;
			this.state.lines.splice(this.state.cursorLine + 1, 1);
		}

		this.recordKill(deletedText, "forward");

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private deleteWordBackwards(): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.recordUndoState();

		const currentLine = this.state.lines[this.state.cursorLine] || "";

		// If at start of line, behave like backspace at column 0 (merge with previous line)
		if (this.state.cursorCol === 0) {
			if (this.state.cursorLine > 0) {
				this.recordKill("\n", "backward");
				const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
				this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
				this.state.lines.splice(this.state.cursorLine, 1);
				this.state.cursorLine--;
				this.state.cursorCol = previousLine.length;
			}
		} else {
			const oldCursorCol = this.state.cursorCol;
			this.moveWordBackwards();
			const deleteFrom = this.state.cursorCol;
			this.state.cursorCol = oldCursorCol;

			const deletedText = currentLine.slice(deleteFrom, oldCursorCol);
			this.state.lines[this.state.cursorLine] =
				currentLine.slice(0, deleteFrom) + currentLine.slice(this.state.cursorCol);
			this.state.cursorCol = deleteFrom;
			this.recordKill(deletedText, "backward");
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private deleteWordForwards(): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.recordUndoState();

		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol >= currentLine.length) {
			if (this.state.cursorLine < this.state.lines.length - 1) {
				this.recordKill("\n", "forward");
				const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
				this.state.lines[this.state.cursorLine] = currentLine + nextLine;
				this.state.lines.splice(this.state.cursorLine + 1, 1);
			}
		} else {
			const oldCursorCol = this.state.cursorCol;
			this.moveWordForwards();
			const deleteTo = this.state.cursorCol;
			this.state.cursorCol = oldCursorCol;

			const deletedText = currentLine.slice(oldCursorCol, deleteTo);
			this.state.lines[this.state.cursorLine] = currentLine.slice(0, oldCursorCol) + currentLine.slice(deleteTo);
			this.recordKill(deletedText, "forward");
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private handleForwardDelete(): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.resetKillSequence();
		this.recordUndoState();

		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol < currentLine.length) {
			// Delete grapheme at cursor position (handles emojis, combining characters, etc.)
			const afterCursor = currentLine.slice(this.state.cursorCol);

			// Find the first grapheme at cursor
			const graphemes = [...segmenter.segment(afterCursor)];
			const firstGrapheme = graphemes[0];
			const graphemeLength = firstGrapheme ? firstGrapheme.segment.length : 1;

			const before = currentLine.slice(0, this.state.cursorCol);
			const after = currentLine.slice(this.state.cursorCol + graphemeLength);
			this.state.lines[this.state.cursorLine] = before + after;
		} else if (this.state.cursorLine < this.state.lines.length - 1) {
			// At end of line - merge with next line
			const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
			this.state.lines[this.state.cursorLine] = currentLine + nextLine;
			this.state.lines.splice(this.state.cursorLine + 1, 1);
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}

		// Update or re-trigger autocomplete after forward delete
		if (this.autocompleteState) {
			this.debouncedUpdateAutocomplete();
		} else {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
			// Slash command context
			if (textBeforeCursor.trimStart().startsWith("/")) {
				this.tryTriggerAutocomplete();
			}
			// @ file reference context
			else if (textBeforeCursor.match(/(?:^|[\s])@[^\s]*$/)) {
				this.tryTriggerAutocomplete();
			}
		}
	}

	/**
	 * Build a mapping from visual lines to logical positions.
	 * Returns an array where each element represents a visual line with:
	 * - logicalLine: index into this.state.lines
	 * - startCol: starting column in the logical line
	 * - length: length of this visual line segment
	 */
	private buildVisualLineMap(width: number): Array<{ logicalLine: number; startCol: number; length: number }> {
		const visualLines: Array<{ logicalLine: number; startCol: number; length: number }> = [];

		for (let i = 0; i < this.state.lines.length; i++) {
			const line = this.state.lines[i] || "";
			const lineVisWidth = visibleWidth(line);
			if (line.length === 0) {
				// Empty line still takes one visual line
				visualLines.push({ logicalLine: i, startCol: 0, length: 0 });
			} else if (lineVisWidth <= width) {
				visualLines.push({ logicalLine: i, startCol: 0, length: line.length });
			} else {
				// Line needs wrapping - use word-aware wrapping
				const chunks = wordWrapLine(line, width);
				for (const chunk of chunks) {
					visualLines.push({
						logicalLine: i,
						startCol: chunk.startIndex,
						length: chunk.endIndex - chunk.startIndex,
					});
				}
			}
		}

		return visualLines;
	}

	/**
	 * Find the visual line index for the current cursor position.
	 */
	private findCurrentVisualLine(
		visualLines: Array<{ logicalLine: number; startCol: number; length: number }>,
	): number {
		for (let i = 0; i < visualLines.length; i++) {
			const vl = visualLines[i];
			if (!vl) continue;
			if (vl.logicalLine === this.state.cursorLine) {
				const colInSegment = this.state.cursorCol - vl.startCol;
				// Cursor is in this segment if it's within range
				// For the last segment of a logical line, cursor can be at length (end position)
				const isLastSegmentOfLine =
					i === visualLines.length - 1 || visualLines[i + 1]?.logicalLine !== vl.logicalLine;
				if (colInSegment >= 0 && (colInSegment < vl.length || (isLastSegmentOfLine && colInSegment <= vl.length))) {
					return i;
				}
			}
		}
		// Fallback: return last visual line
		return visualLines.length - 1;
	}

	private moveCursor(deltaLine: number, deltaCol: number): void {
		this.resetKillSequence();
		const contentWidth = this.lastLayoutWidth;

		if (deltaLine !== 0) {
			// Build visual line map for navigation
			const visualLines = this.buildVisualLineMap(contentWidth);
			const currentVisualLine = this.findCurrentVisualLine(visualLines);

			// Calculate column position within current visual line
			const currentVL = visualLines[currentVisualLine];
			const visualCol = currentVL ? this.state.cursorCol - currentVL.startCol : 0;

			// Move to target visual line
			const targetVisualLine = currentVisualLine + deltaLine;

			if (targetVisualLine >= 0 && targetVisualLine < visualLines.length) {
				const targetVL = visualLines[targetVisualLine];
				if (targetVL) {
					this.state.cursorLine = targetVL.logicalLine;
					// Try to maintain visual column position, clamped to line length
					const targetCol = targetVL.startCol + Math.min(visualCol, targetVL.length);
					const logicalLine = this.state.lines[targetVL.logicalLine] || "";
					this.state.cursorCol = Math.min(targetCol, logicalLine.length);
				}
			}
		}

		if (deltaCol !== 0) {
			const currentLine = this.state.lines[this.state.cursorLine] || "";

			if (deltaCol > 0) {
				// Moving right - move by one grapheme (handles emojis, combining characters, etc.)
				if (this.state.cursorCol < currentLine.length) {
					const afterCursor = currentLine.slice(this.state.cursorCol);
					const graphemes = [...segmenter.segment(afterCursor)];
					const firstGrapheme = graphemes[0];
					this.state.cursorCol += firstGrapheme ? firstGrapheme.segment.length : 1;
				} else if (this.state.cursorLine < this.state.lines.length - 1) {
					// Wrap to start of next logical line
					this.state.cursorLine++;
					this.state.cursorCol = 0;
				}
			} else {
				// Moving left - move by one grapheme (handles emojis, combining characters, etc.)
				if (this.state.cursorCol > 0) {
					const beforeCursor = currentLine.slice(0, this.state.cursorCol);
					const graphemes = [...segmenter.segment(beforeCursor)];
					const lastGrapheme = graphemes[graphemes.length - 1];
					this.state.cursorCol -= lastGrapheme ? lastGrapheme.segment.length : 1;
				} else if (this.state.cursorLine > 0) {
					// Wrap to end of previous logical line
					this.state.cursorLine--;
					const prevLine = this.state.lines[this.state.cursorLine] || "";
					this.state.cursorCol = prevLine.length;
				}
			}
		}
	}

	private moveWordBackwards(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		// If at start of line, move to end of previous line
		if (this.state.cursorCol === 0) {
			if (this.state.cursorLine > 0) {
				this.state.cursorLine--;
				const prevLine = this.state.lines[this.state.cursorLine] || "";
				this.state.cursorCol = prevLine.length;
			}
			return;
		}

		const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
		const graphemes = [...segmenter.segment(textBeforeCursor)];
		let newCol = this.state.cursorCol;

		// Skip trailing whitespace
		while (graphemes.length > 0 && isWhitespaceChar(graphemes[graphemes.length - 1]?.segment || "")) {
			newCol -= graphemes.pop()?.segment.length || 0;
		}

		if (graphemes.length > 0) {
			const lastGrapheme = graphemes[graphemes.length - 1]?.segment || "";
			if (isPunctuationChar(lastGrapheme)) {
				// Skip punctuation run
				while (graphemes.length > 0 && isPunctuationChar(graphemes[graphemes.length - 1]?.segment || "")) {
					newCol -= graphemes.pop()?.segment.length || 0;
				}
			} else {
				// Skip word run
				while (
					graphemes.length > 0 &&
					!isWhitespaceChar(graphemes[graphemes.length - 1]?.segment || "") &&
					!isPunctuationChar(graphemes[graphemes.length - 1]?.segment || "")
				) {
					newCol -= graphemes.pop()?.segment.length || 0;
				}
			}
		}

		this.state.cursorCol = newCol;
	}

	/**
	 * Jump to the first occurrence of a character in the specified direction.
	 * Multi-line search. Case-sensitive. Skips the current cursor position.
	 */
	private jumpToChar(char: string, direction: "forward" | "backward"): void {
		this.resetKillSequence();
		const isForward = direction === "forward";
		const lines = this.state.lines;

		const end = isForward ? lines.length : -1;
		const step = isForward ? 1 : -1;

		for (let lineIdx = this.state.cursorLine; lineIdx !== end; lineIdx += step) {
			const line = lines[lineIdx] || "";
			const isCurrentLine = lineIdx === this.state.cursorLine;

			// Current line: start after/before cursor; other lines: search full line
			const searchFrom = isCurrentLine
				? isForward
					? this.state.cursorCol + 1
					: this.state.cursorCol - 1
				: undefined;

			const idx = isForward ? line.indexOf(char, searchFrom) : line.lastIndexOf(char, searchFrom);

			if (idx !== -1) {
				this.state.cursorLine = lineIdx;
				this.state.cursorCol = idx;
				return;
			}
		}
		// No match found - cursor stays in place
	}

	private moveWordForwards(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		// If at end of line, move to start of next line
		if (this.state.cursorCol >= currentLine.length) {
			if (this.state.cursorLine < this.state.lines.length - 1) {
				this.state.cursorLine++;
				this.state.cursorCol = 0;
			}
			return;
		}

		const textAfterCursor = currentLine.slice(this.state.cursorCol);
		const segments = segmenter.segment(textAfterCursor);
		const iterator = segments[Symbol.iterator]();
		let next = iterator.next();

		// Skip leading whitespace
		while (!next.done && isWhitespaceChar(next.value.segment)) {
			this.state.cursorCol += next.value.segment.length;
			next = iterator.next();
		}

		if (!next.done) {
			const firstGrapheme = next.value.segment;
			if (isPunctuationChar(firstGrapheme)) {
				// Skip punctuation run
				while (!next.done && isPunctuationChar(next.value.segment)) {
					this.state.cursorCol += next.value.segment.length;
					next = iterator.next();
				}
			} else {
				// Skip word run
				while (!next.done && !isWhitespaceChar(next.value.segment) && !isPunctuationChar(next.value.segment)) {
					this.state.cursorCol += next.value.segment.length;
					next = iterator.next();
				}
			}
		}
	}

	// Helper method to check if cursor is at start of message (for slash command detection)
	private isAtStartOfMessage(): boolean {
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		const beforeCursor = currentLine.slice(0, this.state.cursorCol);

		// At start if line is empty, only contains whitespace, or is just "/"
		return beforeCursor.trim() === "" || beforeCursor.trim() === "/";
	}

	// Autocomplete methods
	private async tryTriggerAutocomplete(explicitTab: boolean = false): Promise<void> {
		if (!this.autocompleteProvider) return;
		// Check if we should trigger file completion on Tab
		if (explicitTab) {
			const provider = this.autocompleteProvider as CombinedAutocompleteProvider;
			const shouldTrigger =
				!provider.shouldTriggerFileCompletion ||
				provider.shouldTriggerFileCompletion(this.state.lines, this.state.cursorLine, this.state.cursorCol);
			if (!shouldTrigger) {
				return;
			}
		}

		const requestId = ++this.autocompleteRequestId;

		const suggestions = await this.autocompleteProvider.getSuggestions(
			this.state.lines,
			this.state.cursorLine,
			this.state.cursorCol,
		);
		if (requestId !== this.autocompleteRequestId) return;

		if (suggestions && suggestions.items.length > 0) {
			this.autocompletePrefix = suggestions.prefix;
			this.autocompleteList = new SelectList(suggestions.items, this.autocompleteMaxVisible, this.theme.selectList);
			this.autocompleteState = "regular";
			this.onAutocompleteUpdate?.();
		} else {
			this.cancelAutocomplete();
			this.onAutocompleteUpdate?.();
		}
	}

	private handleTabCompletion(): void {
		if (!this.autocompleteProvider) return;

		const currentLine = this.state.lines[this.state.cursorLine] || "";
		const beforeCursor = currentLine.slice(0, this.state.cursorCol);

		// Check if we're in a slash command context
		if (beforeCursor.trimStart().startsWith("/") && !beforeCursor.trimStart().includes(" ")) {
			this.handleSlashCommandCompletion();
		} else {
			this.forceFileAutocomplete(true);
		}
	}

	private handleSlashCommandCompletion(): void {
		this.tryTriggerAutocomplete(true);
	}

	/*
https://github.com/EsotericSoftware/spine-runtimes/actions/runs/19536643416/job/559322883
17 this job fails with https://github.com/EsotericSoftware/spine-runtimes/actions/runs/19
536643416/job/55932288317 havea  look at .gi
    */
	private async forceFileAutocomplete(explicitTab: boolean = false): Promise<void> {
		if (!this.autocompleteProvider) return;

		// Check if provider supports force file suggestions via runtime check
		const provider = this.autocompleteProvider as {
			getForceFileSuggestions?: CombinedAutocompleteProvider["getForceFileSuggestions"];
		};
		if (typeof provider.getForceFileSuggestions !== "function") {
			await this.tryTriggerAutocomplete(true);
			return;
		}

		const requestId = ++this.autocompleteRequestId;
		const suggestions = await provider.getForceFileSuggestions(
			this.state.lines,
			this.state.cursorLine,
			this.state.cursorCol,
		);
		if (requestId !== this.autocompleteRequestId) return;

		if (suggestions && suggestions.items.length > 0) {
			// If there's exactly one suggestion and this was an explicit Tab press, apply it immediately
			if (explicitTab && suggestions.items.length === 1) {
				const item = suggestions.items[0]!;
				const result = this.autocompleteProvider.applyCompletion(
					this.state.lines,
					this.state.cursorLine,
					this.state.cursorCol,
					item,
					suggestions.prefix,
				);

				this.state.lines = result.lines;
				this.state.cursorLine = result.cursorLine;
				this.state.cursorCol = result.cursorCol;

				if (this.onChange) {
					this.onChange(this.getText());
				}
				return;
			}

			this.autocompletePrefix = suggestions.prefix;
			this.autocompleteList = new SelectList(suggestions.items, this.autocompleteMaxVisible, this.theme.selectList);
			this.autocompleteState = "force";
			this.onAutocompleteUpdate?.();
		} else {
			this.cancelAutocomplete();
			this.onAutocompleteUpdate?.();
		}
	}

	private cancelAutocomplete(notifyCancel: boolean = false): void {
		const wasAutocompleting = this.autocompleteState !== null;
		this.clearAutocompleteTimeout();
		this.autocompleteRequestId += 1;
		this.autocompleteState = null;
		this.autocompleteList = undefined;
		this.autocompletePrefix = "";
		if (notifyCancel && wasAutocompleting) {
			this.onAutocompleteCancel?.();
		}
	}

	public isShowingAutocomplete(): boolean {
		return this.autocompleteState !== null;
	}

	private async updateAutocomplete(): Promise<void> {
		if (!this.autocompleteState || !this.autocompleteProvider) return;

		// In force mode, use forceFileAutocomplete to get suggestions
		if (this.autocompleteState === "force") {
			this.forceFileAutocomplete();
			return;
		}

		const requestId = ++this.autocompleteRequestId;

		const suggestions = await this.autocompleteProvider.getSuggestions(
			this.state.lines,
			this.state.cursorLine,
			this.state.cursorCol,
		);
		if (requestId !== this.autocompleteRequestId) return;

		if (suggestions && suggestions.items.length > 0) {
			this.autocompletePrefix = suggestions.prefix;
			// Always create new SelectList to ensure update
			this.autocompleteList = new SelectList(suggestions.items, this.autocompleteMaxVisible, this.theme.selectList);
			this.onAutocompleteUpdate?.();
		} else {
			this.cancelAutocomplete();
			this.onAutocompleteUpdate?.();
		}
	}

	private debouncedUpdateAutocomplete(): void {
		if (this.autocompleteTimeout) {
			clearTimeout(this.autocompleteTimeout);
		}
		this.autocompleteTimeout = setTimeout(() => {
			this.updateAutocomplete();
			this.autocompleteTimeout = null;
		}, 100);
	}

	private clearAutocompleteTimeout(): void {
		if (this.autocompleteTimeout) {
			clearTimeout(this.autocompleteTimeout);
			this.autocompleteTimeout = null;
		}
	}
}
