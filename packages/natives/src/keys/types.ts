/**
 * Types for keyboard sequence handling.
 */

/**
 * Event types from Kitty keyboard protocol (flag 2).
 * 1 = key press, 2 = key repeat, 3 = key release.
 */
export const enum KeyEventType {
	/** Key press event. */
	Press = 1,
	/** Key repeat event. */
	Repeat = 2,
	/** Key release event. */
	Release = 3,
}

/** Parsed Kitty keyboard protocol sequence result. */
export interface ParsedKittyResult {
	/** Primary codepoint associated with the key. */
	codepoint: number;
	/** Optional shifted key codepoint from the sequence. */
	shiftedKey?: number;
	/** Optional base layout key codepoint from the sequence. */
	baseLayoutKey?: number;
	/** Modifier bitmask (shift/alt/ctrl), excluding lock bits. */
	modifier: number;
	/** Optional event type from the sequence. */
	eventType?: KeyEventType;
}

declare module "../bindings" {
	interface NativeBindings {
		/**
		 * Match Kitty protocol sequences for a codepoint and modifier mask.
		 * @param data Raw terminal input data.
		 * @param expectedCodepoint Codepoint to compare against the parsed sequence.
		 * @param expectedModifier Modifier mask (shift/alt/ctrl).
		 * @returns True when the sequence matches the expected codepoint and modifiers.
		 */
		matchesKittySequence(data: string, expectedCodepoint: number, expectedModifier: number): boolean;
		/**
		 * Parse terminal input and return a normalized key identifier.
		 * Returns key names like "escape", "ctrl+c", "shift+tab", "alt+enter".
		 * Returns null if the input is not a recognized key sequence.
		 * @param data Raw terminal input data.
		 * @param kittyProtocolActive Whether Kitty disambiguation is enabled.
		 * @returns The normalized key id or null when unrecognized.
		 */
		parseKey(data: string, kittyProtocolActive: boolean): string | null;
		/**
		 * Check if input matches a legacy escape sequence for a specific key.
		 * @param data Raw terminal input data.
		 * @param keyName Key identifier to match (e.g. "home").
		 * @returns True when the sequence maps to the given key name.
		 */
		matchesLegacySequence(data: string, keyName: string): boolean;
		/**
		 * Parse a Kitty keyboard protocol sequence.
		 * @param data Raw terminal input data.
		 * @returns Parsed sequence info or null if not a Kitty sequence.
		 */
		parseKittySequence(data: string): ParsedKittyResult | null;
		/**
		 * Match input data against a key identifier string.
		 * Supports: escape, tab, enter, backspace, delete, home, end, space,
		 * arrows (up/down/left/right), ctrl+X, shift+X, alt+X, combined modifiers.
		 * @param data Raw terminal input data.
		 * @param keyId Key identifier string to match (e.g. "ctrl+c").
		 * @param kittyProtocolActive Whether Kitty disambiguation is enabled.
		 * @returns True when the input matches the key identifier.
		 */
		matchesKey(data: string, keyId: string, kittyProtocolActive: boolean): boolean;
	}
}
