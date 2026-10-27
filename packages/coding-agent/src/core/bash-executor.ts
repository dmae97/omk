/**
 * Bash command execution with streaming support and cancellation.
 *
 * This module provides a unified bash execution implementation used by:
 * - AgentSession.executeBash() for interactive and RPC modes
 * - Direct calls from modes that need bash execution
 */

import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripAnsi } from "../utils/ansi.ts";
import { sanitizeBinaryOutput } from "../utils/shell.ts";
import { EXECUTOR_LOG_CONSUMERS, registerEvidenceArtifact } from "./evidence-lifecycle.ts";
import type { BashOperations } from "./tools/bash.ts";
import { DEFAULT_MAX_BYTES, truncateTail } from "./tools/truncate.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Spec 118 D3 decision 4: executor output only reaches users through interactive/RPC
 * (`AgentSession.executeBash`), so it is always pinned `user-visible`, `excludeFromContext` included
 * (that option controls model context, not what the user saw). Unknown callers fail closed the same way.
 */
function registerExecutorLog(path: string): void {
	registerEvidenceArtifact({
		producer: "bash-executor-log",
		path,
		requiredConsumers: EXECUTOR_LOG_CONSUMERS,
		userVisible: true,
	});
}

export interface BashExecutorOptions {
	/** Callback for streaming output chunks (already sanitized) */
	onChunk?: (chunk: string) => void;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
	env?: NodeJS.ProcessEnv;
}

export interface BashResult {
	/** Combined stdout + stderr output (sanitized, possibly truncated) */
	output: string;
	/** Process exit code (undefined if killed/cancelled) */
	exitCode: number | undefined;
	/** Whether the command was cancelled via signal */
	cancelled: boolean;
	/** Whether the output was truncated */
	truncated: boolean;
	/** Path to temp file containing full output (if output exceeded truncation threshold) */
	fullOutputPath?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Execute a bash command using custom BashOperations.
 * Used for remote execution (SSH, containers, etc.).
 */
export async function executeBashWithOperations(
	command: string,
	cwd: string,
	operations: BashOperations,
	options?: BashExecutorOptions,
): Promise<BashResult> {
	const outputChunks: string[] = [];
	let outputBytes = 0;
	const maxOutputBytes = DEFAULT_MAX_BYTES * 2;

	let tempFilePath: string | undefined;
	let tempFileStream: WriteStream | undefined;
	let totalBytes = 0;
	/** Set once any leading output was evicted from the rolling buffer (output is incomplete). */
	let droppedLeading = false;

	const ensureTempFile = () => {
		if (tempFilePath) {
			return;
		}
		const id = randomBytes(8).toString("hex");
		tempFilePath = join(tmpdir(), `omk-bash-${id}.log`);
		// Owner-only permissions: full output can contain secrets (env vars, tokens, etc.).
		tempFileStream = createWriteStream(tempFilePath, { mode: 0o600 });
		for (const chunk of outputChunks) {
			tempFileStream.write(chunk);
		}
	};

	/** Close and delete the temp file when its path is never surfaced to the caller. */
	const discardTempFile = async () => {
		if (!tempFilePath) {
			return;
		}
		const path = tempFilePath;
		const stream = tempFileStream;
		tempFilePath = undefined;
		tempFileStream = undefined;
		if (stream) {
			await new Promise<void>((resolve) => {
				stream.end(() => resolve());
			});
		}
		try {
			await rm(path, { force: true });
		} catch {
			// Best effort: a stale temp file must not fail the command.
		}
	};

	const decoder = new TextDecoder();

	const onData = (data: Buffer) => {
		totalBytes += data.length;

		// Sanitize: strip ANSI, replace binary garbage, normalize newlines
		const text = sanitizeBinaryOutput(stripAnsi(decoder.decode(data, { stream: true }))).replace(/\r/g, "");

		// Start writing to temp file if exceeds threshold
		if (totalBytes > DEFAULT_MAX_BYTES) {
			ensureTempFile();
		}

		if (tempFileStream) {
			tempFileStream.write(text);
		}

		// Keep rolling buffer
		outputChunks.push(text);
		outputBytes += text.length;
		while (outputBytes > maxOutputBytes && outputChunks.length > 1) {
			const excess = outputBytes - maxOutputBytes;
			const first = outputChunks[0];
			droppedLeading = true;
			if (first.length <= excess) {
				outputChunks.shift();
				outputBytes -= first.length;
				continue;
			}
			// Trim the oldest chunk instead of dropping it whole, so the buffer always holds the last
			// maxOutputBytes chars (>= maxOutputBytes bytes) even when one long line spans several chunks.
			// Never start on a lone low surrogate (keeps the kept text valid UTF-16/UTF-8).
			let cut = excess;
			const code = first.charCodeAt(cut);
			if (code >= 0xdc00 && code <= 0xdfff) cut++;
			outputChunks[0] = first.slice(cut);
			outputBytes -= cut;
			break;
		}

		// Stream to callback
		if (options?.onChunk) {
			options.onChunk(text);
		}
	};

	try {
		const result = await operations.exec(command, cwd, {
			onData,
			signal: options?.signal,
			env: options?.env,
		});

		const fullOutput = outputChunks.join("");
		const truncationResult = truncateTail(fullOutput);
		const truncated = truncationResult.truncated || droppedLeading;
		if (truncated) {
			ensureTempFile();
		} else {
			// fullOutputPath is only surfaced when output is truncated; don't leave the spill file behind.
			await discardTempFile();
		}
		if (tempFileStream) {
			// end() is async — wait for flush so fullOutputPath is complete
			// when the caller reads it (flaky empty/partial file under load).
			await new Promise<void>((resolve) => {
				tempFileStream!.end(() => resolve());
			});
		}
		const cancelled = options?.signal?.aborted ?? false;
		if (tempFilePath) registerExecutorLog(tempFilePath);

		return {
			output: truncated ? truncationResult.content : fullOutput,
			exitCode: cancelled ? undefined : (result.exitCode ?? undefined),
			cancelled,
			truncated,
			fullOutputPath: tempFilePath,
		};
	} catch (err) {
		// Check if it was an abort
		if (options?.signal?.aborted) {
			const fullOutput = outputChunks.join("");
			const truncationResult = truncateTail(fullOutput);
			const truncated = truncationResult.truncated || droppedLeading;
			if (truncated) {
				ensureTempFile();
			} else {
				// fullOutputPath is only surfaced when output is truncated; don't leave the spill file behind.
				await discardTempFile();
			}
			if (tempFileStream) {
				await new Promise<void>((resolve) => {
					tempFileStream!.end(() => resolve());
				});
			}
			if (tempFilePath) registerExecutorLog(tempFilePath);
			return {
				output: truncated ? truncationResult.content : fullOutput,
				exitCode: undefined,
				cancelled: true,
				truncated,
				fullOutputPath: tempFilePath,
			};
		}

		// The path is never reported when the command throws; clean up the spill file.
		await discardTempFile();

		throw err;
	}
}
