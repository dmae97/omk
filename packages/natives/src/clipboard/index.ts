/**
 * Clipboard helpers backed by native arboard bindings.
 */

import { native } from "../native";
import type { ClipboardImage } from "./types";

export type { ClipboardImage } from "./types";

/**
 * Copy plain text to the system clipboard.
 */
export async function copyToClipboard(text: string): Promise<void> {
	await native.copyToClipboard(text);
}

/**
 * Read an image from the clipboard, if available.
 */
export async function readImageFromClipboard(): Promise<ClipboardImage | null> {
	return native.readImageFromClipboard();
}
