/**
 * PTY-backed interactive execution.
 */

import { native } from "../native";

export type { PtyRunResult, PtySessionConstructor, PtyStartOptions } from "./types";

export const { PtySession } = native;
export type PtySession = import("./types").PtySession;
