/**
 * Windows ProjFS-backed overlay lifecycle bindings.
 */

import { native } from "../native";

export type { ProjfsOverlayProbeResult } from "./types";
export const { projfsOverlayProbe, projfsOverlayStart, projfsOverlayStop } = native;
