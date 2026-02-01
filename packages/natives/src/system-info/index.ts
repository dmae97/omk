/**
 * System information powered by native bindings.
 */

import { native } from "../native";

export type { SystemInfo } from "./types";

export const { getSystemInfo } = native;
