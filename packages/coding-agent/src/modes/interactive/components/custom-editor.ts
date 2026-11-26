import { Editor, type EditorOptions, type EditorTheme, type TUI, visibleWidth } from "omk-tui";
import type { AppKeybinding, KeybindingsManager } from "../../../core/keybindings.ts";
import { theme } from "../theme/theme.ts";
import { renderHairlineRule } from "./paper-hairline.ts";

const BORDER_SENTINEL = "\uE000";
const SCROLL_BADGE_RE = /[↑↓]\s+\d+\s+more/;
const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;

export function formatEditorPlanCaption(rawStatus: string | undefined): string | undefined {
	if (!rawStatus) return undefined;
	const clean = rawStatus.replace(ANSI_SGR_RE, "").trim();
	if (!clean.startsWith("plan:")) return undefined;
	const rest = clean.slice("plan:".length).trim().toUpperCase();
	if (!rest) return undefined;
	return rest.includes("(RO)") ? `PLAN · ${rest}` : `EXEC · ${rest}`;
}

/**
 * Custom editor that handles app-level keybindings for coding-agent.
 */
export class CustomEditor extends Editor {
	private keybindings: KeybindingsManager;
	public actionHandlers: Map<AppKeybinding, () => void> = new Map();

	// Special handlers that can be dynamically replaced
	public onEscape?: () => void;
	public onCtrlD?: () => void;
	public onPasteImage?: () => void;
	/** Handler for extension-registered shortcuts. Returns true if handled. */
	public onExtensionShortcut?: (data: string) => boolean;
	/** Spec 091: sees every key first (suggestion Tab/dismiss). Returns true if consumed. */
	public onBeforeInput?: (data: string) => boolean;
	/** Optional dynamic label for the top hairline caption (defaults to "PROMPT"). */
	public getPromptLabel?: () => string | undefined;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions) {
		super(tui, theme, options);
		this.keybindings = keybindings;
	}

	/**
	 * Register a handler for an app action.
	 */
	onAction(action: AppKeybinding, handler: () => void): void {
		this.actionHandlers.set(action, handler);
	}

	override render(width: number): string[] {
		if (width < 8) return super.render(width);
		const innerWidth = width - 2;
		const savedBorderColor = this.borderColor;
		let raw: string[];
		this.borderColor = (text: string) => `${BORDER_SENTINEL}${text}`;
		try {
			raw = super.render(innerWidth);
		} finally {
			this.borderColor = savedBorderColor;
		}
		if (raw.length < 2) return raw;

		let bottomIdx = raw.length - 1;
		for (let i = raw.length - 1; i >= 1; i--) {
			if (raw[i]!.includes(BORDER_SENTINEL)) {
				bottomIdx = i;
				break;
			}
		}

		const topScroll = SCROLL_BADGE_RE.exec(raw[0]!)?.[0];
		const bottomScroll = SCROLL_BADGE_RE.exec(raw[bottomIdx]!)?.[0];
		const label = this.getPromptLabel?.() || "PROMPT";
		const topLeft = `${savedBorderColor("▸")} ${theme.fg("dim", label)}`;
		const topRight = topScroll ? theme.fg("dim", topScroll) : "";
		const bottomRight = bottomScroll ? theme.fg("dim", bottomScroll) : "";
		const pipe = theme.fg("borderMuted", "│");

		const framed: string[] = [renderHairlineRule(width, "┌", "┐", topLeft, topRight)];
		for (let i = 1; i < bottomIdx; i++) {
			const row = raw[i]!;
			const pad = Math.max(0, innerWidth - visibleWidth(row));
			framed.push(`${pipe}${row}${" ".repeat(pad)}${pipe}`);
		}
		framed.push(renderHairlineRule(width, "└", "┘", "", bottomRight));

		for (let i = bottomIdx + 1; i < raw.length; i++) {
			const row = raw[i]!;
			const pad = Math.max(0, innerWidth - visibleWidth(row));
			framed.push(` ${row}${" ".repeat(pad)} `);
		}
		return framed;
	}

	handleInput(data: string): void {
		if (this.onBeforeInput?.(data)) return;
		// Pasted control bytes are content, never app shortcuts.
		if (this.isInPaste || data.includes("\x1b[200~")) {
			super.handleInput(data);
			return;
		}
		// Check extension-registered shortcuts first
		if (this.onExtensionShortcut?.(data)) {
			return;
		}

		// Check for paste image keybinding
		if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
			this.onPasteImage?.();
			return;
		}

		// Check app keybindings first

		// Escape/interrupt - only if autocomplete is NOT active
		if (this.keybindings.matches(data, "app.interrupt")) {
			if (!this.isShowingAutocomplete()) {
				// Use dynamic onEscape if set, otherwise registered handler
				const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
				if (handler) {
					handler();
					return;
				}
			}
			// Let parent handle escape for autocomplete cancellation
			super.handleInput(data);
			return;
		}

		// Exit (Ctrl+D) - only when editor is empty
		if (this.keybindings.matches(data, "app.exit")) {
			if (this.getText().length === 0) {
				const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
				if (handler) handler();
				return;
			}
			// Fall through to editor handling for delete-char-forward when not empty
		}

		// Check all other app actions
		for (const [action, handler] of this.actionHandlers) {
			if (action !== "app.interrupt" && action !== "app.exit" && this.keybindings.matches(data, action)) {
				handler();
				return;
			}
		}

		// Pass to parent for editor handling
		super.handleInput(data);
	}
}
