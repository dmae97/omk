/**
 * Types for clipboard operations.
 */

/** PNG-encoded clipboard image payload. */
export interface ClipboardImage {
	/** PNG image bytes. */
	data: Uint8Array;
	/** MIME type for the PNG payload. */
	mimeType: string;
}

declare module "../bindings" {
	/** Native clipboard operations exposed by the bindings layer. */
	interface NativeBindings {
		/**
		 * Copy text to the system clipboard.
		 * @param text - UTF-8 text to place on the clipboard.
		 */
		copyToClipboard(text: string): Promise<void>;
		/**
		 * Read an image from the clipboard.
		 * @returns PNG payload or null when no image is available.
		 */
		readImageFromClipboard(): Promise<ClipboardImage | null>;
	}
}
