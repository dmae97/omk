/**
 * Keyboard sequence utilities powered by native bindings.
 */

import { type KeyEventType, native, type ParsedKittyResult } from "../native";

export type { KeyEventType, ParsedKittyResult };

/** Match Kitty protocol sequences for codepoint and modifier. */
export function matchesKittySequence(data: string, expectedCodepoint: number, expectedModifier: number): boolean {
	return native.matchesKittySequence(data, expectedCodepoint, expectedModifier);
}

/**
 * Parse a Kitty keyboard protocol sequence.
 *
 * @param data - Raw escape sequence from terminal
 * @returns Parsed sequence with codepoint, modifier, and event type, or undefined if not a valid Kitty sequence
 */
export function parseKittySequence(data: string): ParsedKittyResult | undefined {
	return native.parseKittySequence(data) ?? undefined;
}

/**
 * Parse terminal input and return a normalized key identifier.
 *
 * Returns key names like "escape", "ctrl+c", "shift+tab", "alt+enter".
 * Returns undefined if the input is not a recognized key sequence.
 *
 * @param data - Raw input data from terminal
 * @param kittyProtocolActive - Whether Kitty keyboard protocol is active
 */
export function parseKey(data: string, kittyProtocolActive: boolean): string | undefined {
	return native.parseKey(data, kittyProtocolActive) ?? undefined;
}

/**
 * Check if input matches a legacy escape sequence for a specific key.
 *
 * @param data - Raw input data from terminal
 * @param keyName - Key name to match (e.g., "up", "f1", "ctrl+up")
 */
export function matchesLegacySequence(data: string, keyName: string): boolean {
	return native.matchesLegacySequence(data, keyName);
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
 * @param data - Raw input data from terminal
 * @param keyId - Key identifier (e.g., "ctrl+c", "escape")
 * @param kittyProtocolActive - Whether Kitty keyboard protocol is active
 */
export function matchesKey(data: string, keyId: string, kittyProtocolActive: boolean): boolean {
	return native.matchesKey(data, keyId, kittyProtocolActive);
}
