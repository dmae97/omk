/**
 * Keyboard input handling for terminal applications.
 *
 * Supports both legacy terminal sequences and Kitty keyboard protocol.
 * See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 * Reference: https://github.com/sst/opentui/blob/7da92b4088aebfe27b9f691c04163a48821e49fd/packages/core/src/lib/parse.keypress.ts
 *
 * Symbol keys are also supported, however some ctrl+symbol combos
 * overlap with ASCII codes, e.g. ctrl+[ = ESC.
 * See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/#legacy-ctrl-mapping-of-ascii-keys
 * Those can still be * used for ctrl+shift combos
 *
 * API:
 * - matchesKey(data, keyId) - Check if input matches a key identifier
 * - parseKey(data) - Parse input and return the key identifier
 * - Key - Helper object for creating typed key identifiers
 * - setKittyProtocolActive(active) - Set global Kitty protocol state
 * - isKittyProtocolActive() - Query global Kitty protocol state
 */

import {
	type KeyEventType,
	matchesKey as matchesKeyNative,
	parseKey as parseKeyNative,
	parseKittySequence as parseKittySequenceNative,
} from "@oh-my-pi/pi-natives";

// =============================================================================
// Global Kitty Protocol State
// =============================================================================

let _kittyProtocolActive = false;

/**
 * Set the global Kitty keyboard protocol state.
 * Called by ProcessTerminal after detecting protocol support.
 */
export function setKittyProtocolActive(active: boolean): void {
	_kittyProtocolActive = active;
}

/**
 * Query whether Kitty keyboard protocol is currently active.
 */
export function isKittyProtocolActive(): boolean {
	return _kittyProtocolActive;
}

// =============================================================================
// Type-Safe Key Identifiers
// =============================================================================

type Letter =
	| "a"
	| "b"
	| "c"
	| "d"
	| "e"
	| "f"
	| "g"
	| "h"
	| "i"
	| "j"
	| "k"
	| "l"
	| "m"
	| "n"
	| "o"
	| "p"
	| "q"
	| "r"
	| "s"
	| "t"
	| "u"
	| "v"
	| "w"
	| "x"
	| "y"
	| "z";

type SymbolKey =
	| "`"
	| "-"
	| "="
	| "["
	| "]"
	| "\\"
	| ";"
	| "'"
	| ","
	| "."
	| "/"
	| "!"
	| "@"
	| "#"
	| "$"
	| "%"
	| "^"
	| "&"
	| "*"
	| "("
	| ")"
	| "_"
	| "+"
	| "|"
	| "~"
	| "{"
	| "}"
	| ":"
	| "<"
	| ">"
	| "?";

type SpecialKey =
	| "escape"
	| "esc"
	| "enter"
	| "return"
	| "tab"
	| "space"
	| "backspace"
	| "delete"
	| "insert"
	| "clear"
	| "home"
	| "end"
	| "pageUp"
	| "pageDown"
	| "up"
	| "down"
	| "left"
	| "right"
	| "f1"
	| "f2"
	| "f3"
	| "f4"
	| "f5"
	| "f6"
	| "f7"
	| "f8"
	| "f9"
	| "f10"
	| "f11"
	| "f12";

type BaseKey = Letter | SymbolKey | SpecialKey;

/**
 * Union type of all valid key identifiers.
 * Provides autocomplete and catches typos at compile time.
 */
export type KeyId =
	| BaseKey
	| `ctrl+${BaseKey}`
	| `shift+${BaseKey}`
	| `alt+${BaseKey}`
	| `ctrl+shift+${BaseKey}`
	| `shift+ctrl+${BaseKey}`
	| `ctrl+alt+${BaseKey}`
	| `alt+ctrl+${BaseKey}`
	| `shift+alt+${BaseKey}`
	| `alt+shift+${BaseKey}`
	| `ctrl+shift+alt+${BaseKey}`
	| `ctrl+alt+shift+${BaseKey}`
	| `shift+ctrl+alt+${BaseKey}`
	| `shift+alt+ctrl+${BaseKey}`
	| `alt+ctrl+shift+${BaseKey}`
	| `alt+shift+ctrl+${BaseKey}`;

// =============================================================================
// Kitty Protocol Parsing
// =============================================================================

interface ParsedKittySequence {
	codepoint: number;
	shiftedKey?: number; // Shifted version of the key (when shift is pressed)
	baseLayoutKey?: number; // Key in standard PC-101 layout (for non-Latin layouts)
	modifier: number;
	eventType?: KeyEventType;
}

// Regex for Kitty protocol event type detection
// Matches CSI sequences with :2 (repeat) or :3 (release) event type
// Format: \x1b[...;modifier:event_type<terminator> where terminator is u, ~, or A-F/H
const KITTY_RELEASE_PATTERN = /^\x1b\[[\d:;]*:3[u~ABCDHF]$/;
const KITTY_REPEAT_PATTERN = /^\x1b\[[\d:;]*:2[u~ABCDHF]$/;

/**
 * Check if the input is a key release event.
 * Only meaningful when Kitty keyboard protocol with flag 2 is active.
 * Returns false if Kitty protocol is not active.
 */
export function isKeyRelease(data: string): boolean {
	// Only detect release events when Kitty protocol is active
	if (!_kittyProtocolActive) {
		return false;
	}

	// Don't treat bracketed paste content as key release
	if (data.includes("\x1b[200~")) {
		return false;
	}

	// Match the full CSI sequence pattern for release events
	return KITTY_RELEASE_PATTERN.test(data);
}

/**
 * Check if the input is a key repeat event.
 * Only meaningful when Kitty keyboard protocol with flag 2 is active.
 * Returns false if Kitty protocol is not active.
 */
export function isKeyRepeat(data: string): boolean {
	// Only detect repeat events when Kitty protocol is active
	if (!_kittyProtocolActive) {
		return false;
	}

	// Don't treat bracketed paste content as key repeat
	if (data.includes("\x1b[200~")) {
		return false;
	}

	// Match the full CSI sequence pattern for repeat events
	return KITTY_REPEAT_PATTERN.test(data);
}

export function parseKittySequence(data: string): ParsedKittySequence | null {
	const result = parseKittySequenceNative(data);
	if (!result) return null;
	return {
		codepoint: result.codepoint,
		shiftedKey: result.shiftedKey ?? undefined,
		baseLayoutKey: result.baseLayoutKey ?? undefined,
		modifier: result.modifier,
		eventType: result.eventType,
	};
}

/**
 * Match input data against a key identifier string.
 *
 * Supported key identifiers:
 * - Single keys: "escape", "tab", "enter", "backspace", "delete", "home", "end", "space"
 * - Arrow keys: "up", "down", "left", "right"
 * - Ctrl combinations: "ctrl+c", "ctrl+z", etc.
 * - Shift combinations: "shift+tab", "shift+enter"
 * - Alt combinations: "alt+enter", "alt+backspace"
 * - Combined modifiers: "shift+ctrl+p", "ctrl+alt+x"
 *
 * Use the Key helper for autocomplete: Key.ctrl("c"), Key.escape, Key.ctrlShift("p")
 *
 * @param data - Raw input data from terminal
 * @param keyId - Key identifier (e.g., "ctrl+c", "escape", Key.ctrl("c"))
 */
export function matchesKey(data: string, keyId: KeyId): boolean {
	return matchesKeyNative(data, keyId, _kittyProtocolActive);
}

/**
 * Parse terminal input and return a normalized key identifier.
 *
 * Returns key names like "escape", "ctrl+c", "shift+tab", "alt+enter".
 * Returns undefined if the input is not a recognized key sequence.
 *
 * @param data - Raw input data from terminal
 */
export function parseKey(data: string): string | undefined {
	return parseKeyNative(data, _kittyProtocolActive) ?? undefined;
}
