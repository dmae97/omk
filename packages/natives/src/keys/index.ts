/**
 * Keyboard sequence utilities powered by native bindings.
 */

import { native } from "../native";

export type { KeyEventType, ParsedKittyResult } from "./types";

export const { matchesKittySequence, parseKey, matchesLegacySequence, parseKittySequence, matchesKey } = native;
