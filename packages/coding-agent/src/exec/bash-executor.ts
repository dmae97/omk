/**
 * Bash command execution with streaming support and cancellation.
 *
 * Uses brush-core via native bindings for shell execution.
 */
import * as crypto from "node:crypto";
import { abortShellExecution, executeShell } from "@oh-my-pi/pi-natives";
import { Settings } from "../config/settings";
import { OutputSink } from "../session/streaming-output";

export interface BashExecutorOptions {
	cwd?: string;
	timeout?: number;
	onChunk?: (chunk: string) => void;
	signal?: AbortSignal;
	/** Additional environment variables to inject */
	env?: Record<string, string>;
	/** Artifact path/id for full output storage */
	artifactPath?: string;
	artifactId?: string;
}

export interface BashResult {
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	artifactId?: string;
}

export async function executeBash(command: string, options?: BashExecutorOptions): Promise<BashResult> {
	const settings = await Settings.init();
	const { env: shellEnv, prefix } = settings.getShellConfig();

	// Generate unique execution ID for abort support
	const executionId = crypto.randomUUID();

	// Merge shell env with additional env vars (additional takes precedence)
	// Filter out undefined values and problematic vars for the native API
	// BASH_ENV and ENV cause brush-core to fail with "not yet implemented" errors
	const mergedEnv: Record<string, string> = {};
	for (const [key, value] of Object.entries(shellEnv)) {
		if (value !== undefined && key !== "BASH_ENV" && key !== "ENV") {
			mergedEnv[key] = value;
		}
	}
	if (options?.env) {
		for (const [key, value] of Object.entries(options.env)) {
			if (key !== "BASH_ENV" && key !== "ENV") {
				mergedEnv[key] = value;
			}
		}
	}

	// Apply command prefix if configured
	const finalCommand = prefix ? `${prefix} ${command}` : command;

	// Create output sink for truncation and artifact handling
	const sink = new OutputSink({
		onChunk: options?.onChunk,
		artifactPath: options?.artifactPath,
		artifactId: options?.artifactId,
	});

	// Set up abort handling
	let abortListener: (() => void) | undefined;
	if (options?.signal) {
		const signal = options.signal;
		if (signal.aborted) {
			// Already aborted
			return {
				exitCode: undefined,
				cancelled: true,
				...(await sink.dump("Command cancelled")),
			};
		}
		abortListener = () => {
			abortShellExecution(executionId);
		};
		signal.addEventListener("abort", abortListener, { once: true });
	}

	try {
		const result = await executeShell(
			{
				command: finalCommand,
				cwd: options?.cwd,
				env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
				timeoutMs: options?.timeout,
				executionId,
			},
			async (chunk: string) => {
				await sink.push(chunk);
			},
		);

		// Handle timeout
		if (result.timedOut) {
			const annotation = options?.timeout
				? `Command timed out after ${Math.round(options.timeout / 1000)} seconds`
				: "Command timed out";
			return {
				exitCode: undefined,
				cancelled: true,
				...(await sink.dump(annotation)),
			};
		}

		// Handle cancellation
		if (result.cancelled) {
			return {
				exitCode: undefined,
				cancelled: true,
				...(await sink.dump("Command cancelled")),
			};
		}

		// Normal completion
		return {
			exitCode: result.exitCode,
			cancelled: false,
			...(await sink.dump()),
		};
	} finally {
		// Clean up abort listener
		if (abortListener && options?.signal) {
			options.signal.removeEventListener("abort", abortListener);
		}
	}
}
