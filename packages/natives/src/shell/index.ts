/**
 * Native shell execution via brush-core.
 */

import { native } from "../native";
import type { ShellExecuteOptions, ShellExecuteResult } from "./types";

export type { ShellExecuteOptions, ShellExecuteResult } from "./types";

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
	// napi-rs ThreadsafeFunction passes (error, value) - skip callback on error
	const wrappedCallback = onChunk ? (err: Error | null, chunk: string) => !err && onChunk(chunk) : undefined;
	return native.executeShell(options, wrappedCallback);
}

/**
 * Abort a running shell execution.
 *
 * @param executionId - The execution ID to abort
 */
export function abortShellExecution(executionId: string): void {
	native.abortShellExecution(executionId);
}
