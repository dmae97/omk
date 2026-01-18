/**
 * Keyboard input handling for terminal applications.
 *
 * Supports both legacy terminal sequences and Kitty keyboard protocol.
 * See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
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

// =============================================================================
// Global Kitty Protocol State
// =============================================================================

let kittyProtocolActive = false;

/**
 * Set the global Kitty keyboard protocol state.
 * Called by ProcessTerminal after detecting protocol support.
 */
export function setKittyProtocolActive(active: boolean): void {
	kittyProtocolActive = active;
}

/**
 * Query whether Kitty keyboard protocol is currently active.
 */
export function isKittyProtocolActive(): boolean {
	return kittyProtocolActive;
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
	| "home"
	| "end"
	| "pageUp"
	| "pageDown"
	| "up"
	| "down"
	| "left"
	| "right";

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

/**
 * Helper object for creating typed key identifiers with autocomplete.
 *
 * Usage:
 * - Key.escape, Key.enter, Key.tab, etc. for special keys
 * - Key.backtick, Key.comma, Key.period, etc. for symbol keys
 * - Key.ctrl("c"), Key.alt("x") for single modifier
 * - Key.ctrlShift("p"), Key.ctrlAlt("x") for combined modifiers
 */
export const Key = {
	// Special keys
	escape: "escape" as const,
	esc: "esc" as const,
	enter: "enter" as const,
	return: "return" as const,
	tab: "tab" as const,
	space: "space" as const,
	backspace: "backspace" as const,
	delete: "delete" as const,
	home: "home" as const,
	end: "end" as const,
	pageUp: "pageUp" as const,
	pageDown: "pageDown" as const,
	up: "up" as const,
	down: "down" as const,
	left: "left" as const,
	right: "right" as const,

	// Symbol keys
	backtick: "`" as const,
	hyphen: "-" as const,
	equals: "=" as const,
	leftbracket: "[" as const,
	rightbracket: "]" as const,
	backslash: "\\" as const,
	semicolon: ";" as const,
	quote: "'" as const,
	comma: "," as const,
	period: "." as const,
	slash: "/" as const,
	exclamation: "!" as const,
	at: "@" as const,
	hash: "#" as const,
	dollar: "$" as const,
	percent: "%" as const,
	caret: "^" as const,
	ampersand: "&" as const,
	asterisk: "*" as const,
	leftparen: "(" as const,
	rightparen: ")" as const,
	underscore: "_" as const,
	plus: "+" as const,
	pipe: "|" as const,
	tilde: "~" as const,
	leftbrace: "{" as const,
	rightbrace: "}" as const,
	colon: ":" as const,
	lessthan: "<" as const,
	greaterthan: ">" as const,
	question: "?" as const,

	// Single modifiers
	ctrl: <K extends BaseKey>(key: K): `ctrl+${K}` => `ctrl+${key}`,
	shift: <K extends BaseKey>(key: K): `shift+${K}` => `shift+${key}`,
	alt: <K extends BaseKey>(key: K): `alt+${K}` => `alt+${key}`,

	// Combined modifiers
	ctrlShift: <K extends BaseKey>(key: K): `ctrl+shift+${K}` => `ctrl+shift+${key}`,
	shiftCtrl: <K extends BaseKey>(key: K): `shift+ctrl+${K}` => `shift+ctrl+${key}`,
	ctrlAlt: <K extends BaseKey>(key: K): `ctrl+alt+${K}` => `ctrl+alt+${key}`,
	altCtrl: <K extends BaseKey>(key: K): `alt+ctrl+${K}` => `alt+ctrl+${key}`,
	shiftAlt: <K extends BaseKey>(key: K): `shift+alt+${K}` => `shift+alt+${key}`,
	altShift: <K extends BaseKey>(key: K): `alt+shift+${K}` => `alt+shift+${key}`,

	// Triple modifiers
	ctrlShiftAlt: <K extends BaseKey>(key: K): `ctrl+shift+alt+${K}` => `ctrl+shift+alt+${key}`,
} as const;

// =============================================================================
// Constants
// =============================================================================

const SYMBOL_KEYS = new Set([
	"`",
	"-",
	"=",
	"[",
	"]",
	"\\",
	";",
	"'",
	",",
	".",
	"/",
	"!",
	"@",
	"#",
	"$",
	"%",
	"^",
	"&",
	"*",
	"(",
	")",
	"_",
	"+",
	"|",
	"~",
	"{",
	"}",
	":",
	"<",
	">",
	"?",
]);

const MODIFIERS = {
	shift: 1,
	alt: 2,
	ctrl: 4,
} as const;

const LOCK_MASK = 64 + 128; // Caps Lock + Num Lock

const CODEPOINTS = {
	escape: 27,
	tab: 9,
	enter: 13,
	space: 32,
	backspace: 127,
	backspaceCtrl: 8,
	kpEnter: 57414, // Numpad Enter (Kitty protocol)
} as const;

const BACKSPACE_CODEPOINTS = new Set([CODEPOINTS.backspace, CODEPOINTS.backspaceCtrl]);

const ARROW_CODEPOINTS = {
	up: -1,
	down: -2,
	right: -3,
	left: -4,
} as const;

const FUNCTIONAL_CODEPOINTS = {
	delete: -10,
	insert: -11,
	pageUp: -12,
	pageDown: -13,
	home: -14,
	end: -15,
} as const;

// =============================================================================
// Kitty Protocol Parsing
// =============================================================================

/**
 * Event types from Kitty keyboard protocol (flag 2)
 * 1 = key press, 2 = key repeat, 3 = key release
 */
export type KeyEventType = "press" | "repeat" | "release";

interface ParsedKittySequence {
	codepoint: number;
	modifier: number;
	eventType: KeyEventType;
	shiftedCodepoint?: number;
	baseCodepoint?: number;
}

/**
 * Check if the last parsed key event was a key release.
 * Only meaningful when Kitty keyboard protocol with flag 2 is active.
 */
export function isKeyRelease(data: string): boolean {
	// Don't treat bracketed paste content as key release, even if it contains
	// patterns like ":3F" (e.g., bluetooth MAC addresses like "90:62:3F:A5").
	// Terminal.ts re-wraps paste content with bracketed paste markers before
	// passing to TUI, so pasted data will always contain \x1b[200~.
	if (data.includes("\x1b[200~")) {
		return false;
	}

	// Quick check: release events with flag 2 contain ":3"
	// Format: \x1b[<codepoint>;<modifier>:3u
	if (
		data.includes(":3u") ||
		data.includes(":3~") ||
		data.includes(":3A") ||
		data.includes(":3B") ||
		data.includes(":3C") ||
		data.includes(":3D") ||
		data.includes(":3H") ||
		data.includes(":3F")
	) {
		return true;
	}
	return false;
}

/**
 * Check if the last parsed key event was a key repeat.
 * Only meaningful when Kitty keyboard protocol with flag 2 is active.
 */
export function isKeyRepeat(data: string): boolean {
	// Don't treat bracketed paste content as key repeat, even if it contains
	// patterns like ":2F". See isKeyRelease() for details.
	if (data.includes("\x1b[200~")) {
		return false;
	}

	if (
		data.includes(":2u") ||
		data.includes(":2~") ||
		data.includes(":2A") ||
		data.includes(":2B") ||
		data.includes(":2C") ||
		data.includes(":2D") ||
		data.includes(":2H") ||
		data.includes(":2F")
	) {
		return true;
	}
	return false;
}

function parseEventType(eventTypeStr: string | undefined): KeyEventType {
	if (!eventTypeStr) return "press";
	const eventType = parseInt(eventTypeStr, 10);
	if (eventType === 2) return "repeat";
	if (eventType === 3) return "release";
	return "press";
}

function parseKittyKeyCodes(keyCodes: string): {
	codepoint: number;
	shiftedCodepoint?: number;
	baseCodepoint?: number;
} {
	const parts = keyCodes.split(":");
	const codepoint = parseInt(parts[0]!, 10);
	const shiftedCodepoint = parts[1] ? parseInt(parts[1], 10) : undefined;
	const baseCodepoint = parts.length > 2 && parts[2] ? parseInt(parts[2], 10) : undefined;
	return { codepoint, shiftedCodepoint, baseCodepoint };
}

function parseKittySequence(data: string): ParsedKittySequence | null {
	// CSI u format: \x1b[<num>u or \x1b[<num>;<mod>u or \x1b[<num>;<mod>:<event>u
	const csiUMatch = data.match(/^\x1b\[(\d+(?::\d+)*)(?:;(\d+))?(?::(\d+))?u$/);
	if (csiUMatch) {
		const { codepoint, shiftedCodepoint, baseCodepoint } = parseKittyKeyCodes(csiUMatch[1]!);
		const modValue = csiUMatch[2] ? parseInt(csiUMatch[2], 10) : 1;
		const eventType = parseEventType(csiUMatch[3]);
		return { codepoint, modifier: modValue - 1, eventType, shiftedCodepoint, baseCodepoint };
	}

	// Arrow keys with modifier: \x1b[1;<mod>A/B/C/D or \x1b[1;<mod>:<event>A/B/C/D
	const arrowMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([ABCD])$/);
	if (arrowMatch) {
		const modValue = parseInt(arrowMatch[1]!, 10);
		const eventType = parseEventType(arrowMatch[2]);
		const arrowCodes: Record<string, number> = { A: -1, B: -2, C: -3, D: -4 };
		return { codepoint: arrowCodes[arrowMatch[3]!]!, modifier: modValue - 1, eventType };
	}

	// Functional keys: \x1b[<num>~ or \x1b[<num>;<mod>~ or \x1b[<num>;<mod>:<event>~
	const funcMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?~$/);
	if (funcMatch) {
		const keyNum = parseInt(funcMatch[1]!, 10);
		const modValue = funcMatch[2] ? parseInt(funcMatch[2], 10) : 1;
		const eventType = parseEventType(funcMatch[3]);
		const funcCodes: Record<number, number> = {
			2: FUNCTIONAL_CODEPOINTS.insert,
			3: FUNCTIONAL_CODEPOINTS.delete,
			5: FUNCTIONAL_CODEPOINTS.pageUp,
			6: FUNCTIONAL_CODEPOINTS.pageDown,
			7: FUNCTIONAL_CODEPOINTS.home,
			8: FUNCTIONAL_CODEPOINTS.end,
		};
		const codepoint = funcCodes[keyNum];
		if (codepoint !== undefined) {
			return { codepoint, modifier: modValue - 1, eventType };
		}
	}

	// Home/End with modifier: \x1b[1;<mod>H/F or \x1b[1;<mod>:<event>H/F
	const homeEndMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([HF])$/);
	if (homeEndMatch) {
		const modValue = parseInt(homeEndMatch[1]!, 10);
		const eventType = parseEventType(homeEndMatch[2]);
		const codepoint = homeEndMatch[3] === "H" ? FUNCTIONAL_CODEPOINTS.home : FUNCTIONAL_CODEPOINTS.end;
		return { codepoint, modifier: modValue - 1, eventType };
	}

	return null;
}

function getKittyCodepoints(parsed: ParsedKittySequence): number[] {
	const codepoints = new Set<number>();
	codepoints.add(parsed.codepoint);
	if (parsed.shiftedCodepoint !== undefined) codepoints.add(parsed.shiftedCodepoint);
	if (parsed.baseCodepoint !== undefined) codepoints.add(parsed.baseCodepoint);
	return Array.from(codepoints.values());
}

function matchesKittySequence(data: string, expectedCodepoint: number, expectedModifier: number): boolean {
	const parsed = parseKittySequence(data);
	if (!parsed) return false;
	const actualMod = parsed.modifier & ~LOCK_MASK;
	const expectedMod = expectedModifier & ~LOCK_MASK;
	if (actualMod !== expectedMod) return false;
	return getKittyCodepoints(parsed).includes(expectedCodepoint);
}

// =============================================================================
// Generic Key Matching
// =============================================================================

function rawCtrlChar(letter: string): string {
	const code = letter.toLowerCase().charCodeAt(0) - 96;
	return String.fromCharCode(code);
}

function parseKeyId(keyId: string): { key: string; ctrl: boolean; shift: boolean; alt: boolean } | null {
	const parts = keyId.toLowerCase().split("+");
	const key = parts[parts.length - 1];
	if (!key) return null;
	return {
		key,
		ctrl: parts.includes("ctrl"),
		shift: parts.includes("shift"),
		alt: parts.includes("alt"),
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
	const parsed = parseKeyId(keyId);
	if (!parsed) return false;

	const { key, ctrl, shift, alt } = parsed;
	let modifier = 0;
	if (shift) modifier |= MODIFIERS.shift;
	if (alt) modifier |= MODIFIERS.alt;
	if (ctrl) modifier |= MODIFIERS.ctrl;

	switch (key) {
		case "escape":
		case "esc":
			if (modifier !== 0) return false;
			return data === "\x1b" || matchesKittySequence(data, CODEPOINTS.escape, 0);

		case "space":
			if (modifier === 0) {
				return data === " " || matchesKittySequence(data, CODEPOINTS.space, 0);
			}
			return matchesKittySequence(data, CODEPOINTS.space, modifier);

		case "tab":
			if (shift && !ctrl && !alt) {
				return data === "\x1b[Z" || matchesKittySequence(data, CODEPOINTS.tab, MODIFIERS.shift);
			}
			if (modifier === 0) {
				return data === "\t" || matchesKittySequence(data, CODEPOINTS.tab, 0);
			}
			return matchesKittySequence(data, CODEPOINTS.tab, modifier);

		case "enter":
		case "return":
			if (shift && !ctrl && !alt) {
				if (
					matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.shift) ||
					matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.shift)
				) {
					return true;
				}
				if (kittyProtocolActive) {
					return data === "\x1b\r" || data === "\n";
				}
				return false;
			}
			if (alt && !ctrl && !shift) {
				if (
					matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.alt) ||
					matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.alt)
				) {
					return true;
				}
				if (!kittyProtocolActive) {
					return data === "\x1b\r";
				}
				return false;
			}
			if (modifier === 0) {
				return (
					data === "\r" ||
					data === "\x1bOM" || // SS3 M (numpad enter in some terminals)
					matchesKittySequence(data, CODEPOINTS.enter, 0) ||
					matchesKittySequence(data, CODEPOINTS.kpEnter, 0)
				);
			}
			return (
				matchesKittySequence(data, CODEPOINTS.enter, modifier) ||
				matchesKittySequence(data, CODEPOINTS.kpEnter, modifier)
			);

		case "backspace":
			if (alt && !ctrl && !shift) {
				return (
					data === "\x1b\x7f" ||
					data === "\x1b\x08" ||
					matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.alt) ||
					matchesKittySequence(data, CODEPOINTS.backspaceCtrl, MODIFIERS.alt)
				);
			}
			if (modifier === 0) {
				return (
					data === "\x7f" ||
					data === "\x08" ||
					matchesKittySequence(data, CODEPOINTS.backspace, 0) ||
					matchesKittySequence(data, CODEPOINTS.backspaceCtrl, 0)
				);
			}
			return (
				matchesKittySequence(data, CODEPOINTS.backspace, modifier) ||
				matchesKittySequence(data, CODEPOINTS.backspaceCtrl, modifier)
			);

		case "delete":
			if (modifier === 0) {
				return data === "\x1b[3~" || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, 0);
			}
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, modifier);

		case "home":
			if (modifier === 0) {
				return (
					data === "\x1b[H" ||
					data === "\x1b[1~" ||
					data === "\x1b[7~" ||
					matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, 0)
				);
			}
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, modifier);

		case "end":
			if (modifier === 0) {
				return (
					data === "\x1b[F" ||
					data === "\x1b[4~" ||
					data === "\x1b[8~" ||
					matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, 0)
				);
			}
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, modifier);

		case "pageUp":
			if (modifier === 0) {
				return data === "\x1b[5~" || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, 0);
			}
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, modifier);

		case "pageDown":
			if (modifier === 0) {
				return data === "\x1b[6~" || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, 0);
			}
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, modifier);

		case "up":
			if (modifier === 0) {
				return data === "\x1b[A" || matchesKittySequence(data, ARROW_CODEPOINTS.up, 0);
			}
			return matchesKittySequence(data, ARROW_CODEPOINTS.up, modifier);

		case "down":
			if (modifier === 0) {
				return data === "\x1b[B" || matchesKittySequence(data, ARROW_CODEPOINTS.down, 0);
			}
			return matchesKittySequence(data, ARROW_CODEPOINTS.down, modifier);

		case "left":
			if (alt && !ctrl && !shift) {
				return (
					data === "\x1b[1;3D" ||
					data === "\x1bb" ||
					matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.alt)
				);
			}
			if (ctrl && !alt && !shift) {
				return data === "\x1b[1;5D" || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.ctrl);
			}
			if (modifier === 0) {
				return data === "\x1b[D" || matchesKittySequence(data, ARROW_CODEPOINTS.left, 0);
			}
			return matchesKittySequence(data, ARROW_CODEPOINTS.left, modifier);

		case "right":
			if (alt && !ctrl && !shift) {
				return (
					data === "\x1b[1;3C" ||
					data === "\x1bf" ||
					matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.alt)
				);
			}
			if (ctrl && !alt && !shift) {
				return data === "\x1b[1;5C" || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.ctrl);
			}
			if (modifier === 0) {
				return data === "\x1b[C" || matchesKittySequence(data, ARROW_CODEPOINTS.right, 0);
			}
			return matchesKittySequence(data, ARROW_CODEPOINTS.right, modifier);
	}

	// Handle single letter keys (a-z) and some symbols
	if (key.length === 1 && ((key >= "a" && key <= "z") || SYMBOL_KEYS.has(key))) {
		const codepoint = key.charCodeAt(0);

		if (ctrl && !shift && !alt) {
			const raw = rawCtrlChar(key);
			if (data === raw) return true;
			if (data.length > 0 && data.charCodeAt(0) === raw.charCodeAt(0)) return true;
			return matchesKittySequence(data, codepoint, MODIFIERS.ctrl);
		}

		if (ctrl && shift && !alt) {
			return matchesKittySequence(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl);
		}

		if (shift && !ctrl && !alt) {
			// Legacy: shift+letter produces uppercase
			if (data === key.toUpperCase()) return true;
			return matchesKittySequence(data, codepoint, MODIFIERS.shift);
		}

		if (alt && !ctrl && !shift && key >= "a" && key <= "z") {
			return data === `\x1b${key}` || data === `\x1b${key.toUpperCase()}`;
		}

		if (modifier !== 0) {
			return matchesKittySequence(data, codepoint, modifier);
		}

		return data === key || matchesKittySequence(data, codepoint, 0);
	}

	return false;
}

function keyNameFromCodepoint(codepoint: number): string | undefined {
	if (codepoint === CODEPOINTS.escape) return "escape";
	if (codepoint === CODEPOINTS.tab) return "tab";
	if (codepoint === CODEPOINTS.enter || codepoint === CODEPOINTS.kpEnter) return "enter";
	if (codepoint === CODEPOINTS.space) return "space";
	if (BACKSPACE_CODEPOINTS.has(codepoint)) return "backspace";
	if (codepoint === FUNCTIONAL_CODEPOINTS.delete) return "delete";
	if (codepoint === FUNCTIONAL_CODEPOINTS.home) return "home";
	if (codepoint === FUNCTIONAL_CODEPOINTS.end) return "end";
	if (codepoint === FUNCTIONAL_CODEPOINTS.pageUp) return "pageUp";
	if (codepoint === FUNCTIONAL_CODEPOINTS.pageDown) return "pageDown";
	if (codepoint === ARROW_CODEPOINTS.up) return "up";
	if (codepoint === ARROW_CODEPOINTS.down) return "down";
	if (codepoint === ARROW_CODEPOINTS.left) return "left";
	if (codepoint === ARROW_CODEPOINTS.right) return "right";
	if (codepoint >= 97 && codepoint <= 122) return String.fromCharCode(codepoint);
	const char = String.fromCharCode(codepoint);
	if (SYMBOL_KEYS.has(char)) return char;
	return undefined;
}

function resolveKittyKeyName(parsed: ParsedKittySequence, effectiveMod: number): string | undefined {
	if (effectiveMod & MODIFIERS.shift && parsed.shiftedCodepoint !== undefined) {
		const keyName = keyNameFromCodepoint(parsed.shiftedCodepoint);
		if (keyName) return keyName;
	}
	if (parsed.baseCodepoint !== undefined) {
		const keyName = keyNameFromCodepoint(parsed.baseCodepoint);
		if (keyName) return keyName;
	}
	const fallback = keyNameFromCodepoint(parsed.codepoint);
	if (fallback) return fallback;
	if (parsed.shiftedCodepoint !== undefined) return keyNameFromCodepoint(parsed.shiftedCodepoint);
	return undefined;
}

/**
 * Parse input data and return the key identifier if recognized.
 *
 * @param data - Raw input data from terminal
 * @returns Key identifier string (e.g., "ctrl+c") or undefined
 */
export function parseKey(data: string): string | undefined {
	const kitty = parseKittySequence(data);
	if (kitty) {
		const { modifier } = kitty;
		const mods: string[] = [];
		const effectiveMod = modifier & ~LOCK_MASK;
		if (effectiveMod & MODIFIERS.shift) mods.push("shift");
		if (effectiveMod & MODIFIERS.ctrl) mods.push("ctrl");
		if (effectiveMod & MODIFIERS.alt) mods.push("alt");

		const keyName = resolveKittyKeyName(kitty, effectiveMod);
		if (keyName) {
			return mods.length > 0 ? `${mods.join("+")}+${keyName}` : keyName;
		}
	}

	// Mode-aware legacy sequences
	// When Kitty protocol is active, ambiguous sequences are interpreted as custom terminal mappings:
	// - \x1b\r = shift+enter (Kitty mapping), not alt+enter
	// - \n = shift+enter (Ghostty mapping)
	if (kittyProtocolActive) {
		if (data === "\x1b\r" || data === "\n") return "shift+enter";
	}

	// Legacy sequences (used when Kitty protocol is not active, or for unambiguous sequences)
	if (data === "\x1b") return "escape";
	if (data === "\t") return "tab";
	if (data === "\r" || data === "\x1bOM") return "enter";
	if (data === " ") return "space";
	if (data === "\x7f" || data === "\x08") return "backspace";
	if (data === "\x1b[Z") return "shift+tab";
	if (!kittyProtocolActive && data === "\x1b\r") return "alt+enter";
	if (data === "\x1b\x7f" || data === "\x1b\x08") return "alt+backspace";
	if (data.length === 2 && data.startsWith("\x1b")) {
		const letter = data[1];
		if (letter >= "a" && letter <= "z") return `alt+${letter}`;
		if (letter >= "A" && letter <= "Z") return `alt+${letter.toLowerCase()}`;
	}
	if (data === "\x1b[A") return "up";
	if (data === "\x1b[B") return "down";
	if (data === "\x1b[C") return "right";
	if (data === "\x1b[D") return "left";
	if (data === "\x1b[H") return "home";
	if (data === "\x1b[F") return "end";
	if (data === "\x1b[3~") return "delete";
	if (data === "\x1b[5~") return "pageUp";
	if (data === "\x1b[6~") return "pageDown";

	// Raw Ctrl+letter
	if (data.length === 1) {
		const code = data.charCodeAt(0);
		if (code >= 1 && code <= 26) {
			return `ctrl+${String.fromCharCode(code + 96)}`;
		}
		if (code >= 32 && code <= 126) {
			return data;
		}
	}

	return undefined;
}

// =============================================================================
// Legacy helper wrappers (for compatibility)
// =============================================================================

export function isArrowUp(data: string): boolean {
	return matchesKey(data, "up");
}

export function isArrowDown(data: string): boolean {
	return matchesKey(data, "down");
}

export function isArrowLeft(data: string): boolean {
	return matchesKey(data, "left");
}

export function isArrowRight(data: string): boolean {
	return matchesKey(data, "right");
}

export function isPageUp(data: string): boolean {
	return matchesKey(data, "pageUp");
}

export function isPageDown(data: string): boolean {
	return matchesKey(data, "pageDown");
}

export function isEscape(data: string): boolean {
	return matchesKey(data, "escape") || matchesKey(data, "esc");
}

export function isEnter(data: string): boolean {
	return matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n";
}

export function isTab(data: string): boolean {
	return matchesKey(data, "tab");
}

export function isShiftTab(data: string): boolean {
	return matchesKey(data, "shift+tab");
}

export function isShiftEnter(data: string): boolean {
	return matchesKey(data, "shift+enter");
}

export function isAltEnter(data: string): boolean {
	return matchesKey(data, "alt+enter");
}

export function isAltBackspace(data: string): boolean {
	return matchesKey(data, "alt+backspace");
}

export function isBackspace(data: string): boolean {
	return matchesKey(data, "backspace");
}

export function isDelete(data: string): boolean {
	return matchesKey(data, "delete");
}

export function isHome(data: string): boolean {
	return matchesKey(data, "home");
}

export function isEnd(data: string): boolean {
	return matchesKey(data, "end");
}

export function isCtrlA(data: string): boolean {
	return matchesKey(data, "ctrl+a");
}

export function isCtrlC(data: string): boolean {
	return matchesKey(data, "ctrl+c");
}

export function isCtrlD(data: string): boolean {
	return matchesKey(data, "ctrl+d");
}

export function isCtrlE(data: string): boolean {
	return matchesKey(data, "ctrl+e");
}

export function isCtrlG(data: string): boolean {
	return matchesKey(data, "ctrl+g");
}

export function isCtrlK(data: string): boolean {
	return matchesKey(data, "ctrl+k");
}

export function isCtrlL(data: string): boolean {
	return matchesKey(data, "ctrl+l");
}

export function isCtrlO(data: string): boolean {
	return matchesKey(data, "ctrl+o");
}

export function isCtrlP(data: string): boolean {
	return matchesKey(data, "ctrl+p");
}

export function isCtrlT(data: string): boolean {
	return matchesKey(data, "ctrl+t");
}

export function isCtrlU(data: string): boolean {
	return matchesKey(data, "ctrl+u");
}

export function isCtrlV(data: string): boolean {
	return matchesKey(data, "ctrl+v");
}

export function isCtrlW(data: string): boolean {
	return matchesKey(data, "ctrl+w");
}

export function isCtrlY(data: string): boolean {
	return matchesKey(data, "ctrl+y");
}

export function isCtrlZ(data: string): boolean {
	return matchesKey(data, "ctrl+z");
}

export function isCtrlLeft(data: string): boolean {
	return matchesKey(data, "ctrl+left");
}

export function isCtrlRight(data: string): boolean {
	return matchesKey(data, "ctrl+right");
}

export function isAltLeft(data: string): boolean {
	return matchesKey(data, "alt+left");
}

export function isAltRight(data: string): boolean {
	return matchesKey(data, "alt+right");
}

export function isShiftCtrlD(data: string): boolean {
	return matchesKey(data, "shift+ctrl+d") || matchesKey(data, "ctrl+shift+d");
}

export function isShiftCtrlO(data: string): boolean {
	return matchesKey(data, "shift+ctrl+o") || matchesKey(data, "ctrl+shift+o");
}

export function isShiftCtrlP(data: string): boolean {
	return matchesKey(data, "shift+ctrl+p") || matchesKey(data, "ctrl+shift+p");
}

export function isShiftBackspace(data: string): boolean {
	return matchesKey(data, "shift+backspace");
}

export function isShiftDelete(data: string): boolean {
	return matchesKey(data, "shift+delete");
}

export function isShiftSpace(data: string): boolean {
	return matchesKey(data, "shift+space");
}

/**
 * Check if input indicates Caps Lock state change.
 * Kitty protocol reports Caps Lock via modifier bit 64.
 */
export function isCapsLock(data: string): boolean {
	const parsed = parseKittySequence(data);
	if (!parsed) return false;
	// Caps Lock is modifier bit 64
	return (parsed.modifier & 64) !== 0;
}
