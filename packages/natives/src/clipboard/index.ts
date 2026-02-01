/**
 * Clipboard helpers backed by native arboard bindings.
 */

import { native } from "../native";

export type { ClipboardImage } from "./types";

export const { copyToClipboard, readImageFromClipboard } = native;
