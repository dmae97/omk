/**
 * Native shell execution via brush-core.
 */

import { native } from "../native";
import type { ShellExecuteOptions, ShellExecuteResult } from "./types";

export type { ShellExecuteOptions, ShellExecuteResult, ShellOptions, ShellRunOptions, ShellRunResult } from "./types";

export const { Shell } = native;
export type Shell = import("./types").Shell;

/**
 * Execute a shell command using brush-core.
 *
 * @param options - Execution options including command, cwd, env, timeout
 * @param onChunk - Optional callback for streaming output chunks
 * @returns Promise resolving to execution result with exit code and status
 */
export async function executeShell(
	options: ShellExecuteOptions,
	onChunk?: (chunk: string) => void,
): Promise<ShellExecuteResult> {
	const wrappedCallback = onChunk ? (err: Error | null, chunk: string) => !err && onChunk(chunk) : undefined;
	return native.executeShell(options, wrappedCallback);
}
