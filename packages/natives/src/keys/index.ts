/**
 * Keyboard sequence utilities powered by native bindings.
 */

import { native } from "../native";

/** Match Kitty protocol sequences for codepoint and modifier. */
export function matchesKittySequence(data: string, expectedCodepoint: number, expectedModifier: number): boolean {
	return native.matchesKittySequence(data, expectedCodepoint, expectedModifier);
}
