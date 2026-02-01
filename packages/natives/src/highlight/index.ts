/**
 * Syntax highlighting powered by native syntect bindings.
 */

import { native } from "../native";

export type { HighlightColors } from "./types";

export const { highlightCode, supportsLanguage, getSupportedLanguages } = native;
