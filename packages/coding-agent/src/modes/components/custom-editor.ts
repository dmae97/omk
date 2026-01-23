import { Editor, type KeyId, matchesKey, parseKittySequence } from "@oh-my-pi/pi-tui";

/**
 * Custom editor that handles Escape and Ctrl+C keys for coding-agent
 */
export class CustomEditor extends Editor {
	public onEscape?: () => void;
	public onCtrlC?: () => void;
	public onCtrlD?: () => void;
	public onShiftTab?: () => void;
	public onCtrlP?: () => void;
	public onShiftCtrlP?: () => void;
	public onCtrlL?: () => void;
	public onCtrlR?: () => void;
	public onCtrlO?: () => void;
	public onCtrlT?: () => void;
	public onCtrlG?: () => void;
	public onCtrlZ?: () => void;
	public onQuestionMark?: () => void;
	public onCapsLock?: () => void;
	public onAltP?: () => void;
	/** Called when Ctrl+V is pressed. Returns true if handled (image found), false to fall through to text paste. */
	public onCtrlV?: () => Promise<boolean>;
	/** Called when Alt+Up is pressed (dequeue keybinding). */
	public onAltUp?: () => void;

	/** Custom key handlers from extensions */
	private customKeyHandlers = new Map<KeyId, () => void>();

	/**
	 * Register a custom key handler. Extensions use this for shortcuts.
	 */
	setCustomKeyHandler(key: KeyId, handler: () => void): void {
		this.customKeyHandlers.set(key, handler);
	}

	/**
	 * Remove a custom key handler.
	 */
	removeCustomKeyHandler(key: KeyId): void {
		this.customKeyHandlers.delete(key);
	}

	/**
	 * Clear all custom key handlers.
	 */
	clearCustomKeyHandlers(): void {
		this.customKeyHandlers.clear();
	}

	handleInput(data: string): void {
		const parsed = parseKittySequence(data);
		if (parsed && (parsed.modifier & 64) !== 0 && this.onCapsLock) {
			// Caps Lock is modifier bit 64
			this.onCapsLock();
			return;
		}

		// Intercept Ctrl+V for image paste (async - fires and handles result)
		if (matchesKey(data, "ctrl+v") && this.onCtrlV) {
			void this.onCtrlV();
			return;
		}

		// Intercept Ctrl+G for external editor
		if (matchesKey(data, "ctrl+g") && this.onCtrlG) {
			this.onCtrlG();
			return;
		}

		// Intercept Alt+P for quick model switching
		if (matchesKey(data, "alt+p") && this.onAltP) {
			this.onAltP();
			return;
		}

		// Intercept Ctrl+Z for suspend
		if (matchesKey(data, "ctrl+z") && this.onCtrlZ) {
			this.onCtrlZ();
			return;
		}

		// Intercept Ctrl+T for thinking block visibility toggle
		if (matchesKey(data, "ctrl+t") && this.onCtrlT) {
			this.onCtrlT();
			return;
		}

		// Intercept Ctrl+L for model selector
		if (matchesKey(data, "ctrl+l") && this.onCtrlL) {
			this.onCtrlL();
			return;
		}

		// Intercept Ctrl+R for history search
		if (matchesKey(data, "ctrl+r") && this.onCtrlR) {
			this.onCtrlR();
			return;
		}

		// Intercept Ctrl+O for tool output expansion
		if (matchesKey(data, "ctrl+o") && this.onCtrlO) {
			this.onCtrlO();
			return;
		}

		// Intercept Shift+Ctrl+P for backward model cycling (check before Ctrl+P)
		if ((matchesKey(data, "shift+ctrl+p") || matchesKey(data, "ctrl+shift+p")) && this.onShiftCtrlP) {
			this.onShiftCtrlP();
			return;
		}

		// Intercept Ctrl+P for model cycling
		if (matchesKey(data, "ctrl+p") && this.onCtrlP) {
			this.onCtrlP();
			return;
		}

		// Intercept Shift+Tab for thinking level cycling
		if (matchesKey(data, "shift+tab") && this.onShiftTab) {
			this.onShiftTab();
			return;
		}

		// Intercept Escape key - but only if autocomplete is NOT active
		// (let parent handle escape for autocomplete cancellation)
		if ((matchesKey(data, "escape") || matchesKey(data, "esc")) && this.onEscape && !this.isShowingAutocomplete()) {
			this.onEscape();
			return;
		}

		// Intercept Ctrl+C
		if (matchesKey(data, "ctrl+c") && this.onCtrlC) {
			this.onCtrlC();
			return;
		}

		// Intercept Ctrl+D (only when editor is empty)
		if (matchesKey(data, "ctrl+d")) {
			if (this.getText().length === 0 && this.onCtrlD) {
				this.onCtrlD();
			}
			// Always consume Ctrl+D (don't pass to parent)
			return;
		}

		// Intercept Alt+Up for dequeue (restore queued message to editor)
		if (matchesKey(data, "alt+up") && this.onAltUp) {
			this.onAltUp();
			return;
		}

		// Intercept ? when editor is empty to show hotkeys
		if (data === "?" && this.getText().length === 0 && this.onQuestionMark) {
			this.onQuestionMark();
			return;
		}

		// Check custom key handlers (extensions)
		for (const [keyId, handler] of this.customKeyHandlers) {
			if (matchesKey(data, keyId)) {
				handler();
				return;
			}
		}

		// Pass to parent for normal handling
		super.handleInput(data);
	}
}
