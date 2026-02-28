/**
 * macOS appearance detection via native CoreFoundation APIs.
 *
 * - `detectMacOSAppearance()`: synchronous, reads NSUserDefaults directly
 * - `startMacAppearanceObserver()`: long-lived observer via CFDistributedNotificationCenter
 */

import { native } from "../native";

export type { MacAppearanceObserver } from "./types";

/**
 * Detect macOS system appearance.
 * Returns `"dark"` or `"light"` on macOS, `undefined` on other platforms.
 */
export function detectMacOSAppearance(): "dark" | "light" | undefined {
	const result = native.detectMacOSAppearance();
	if (result === "dark" || result === "light") return result;
	return undefined;
}

/**
 * Start a long-lived macOS appearance observer.
 * Calls `callback` with `"dark"` or `"light"` on each system appearance change
 * (and once immediately on start).
 *
 * Returns an observer handle with a `stop()` method.
 * On non-macOS platforms, returns a no-op observer.
 */
export function startMacAppearanceObserver(callback: (appearance: "dark" | "light") => void): { stop(): void } {
	return native.MacAppearanceObserver.start((err, appearance) => {
		if (!err && (appearance === "dark" || appearance === "light")) {
			callback(appearance);
		}
	});
}
