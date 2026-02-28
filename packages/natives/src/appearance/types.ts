/**
 * Types for macOS appearance detection.
 */

/**
 * Long-lived macOS appearance observer.
 * Subscribes to system dark/light mode changes via CoreFoundation.
 */
export interface MacAppearanceObserver {
	/** Stop observing and release resources. */
	stop(): void;
}

declare module "../bindings" {
	interface NativeBindings {
		/**
		 * Detect macOS system appearance via CoreFoundation preferences.
		 * Returns `"dark"` or `"light"` on macOS, `null` on other platforms.
		 * Does not shell out — reads NSUserDefaults directly.
		 */
		detectMacOSAppearance(): string | null;
		/**
		 * Internal constructor — use `startMacAppearanceObserver()` instead.
		 * @internal
		 */
		MacAppearanceObserver: {
			start(callback: (err: Error | null, appearance: string) => void): MacAppearanceObserver;
		};
	}
}
