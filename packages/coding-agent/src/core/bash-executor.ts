/**
 * Bash command execution with streaming support and cancellation.
 *
 * Provides unified bash execution for AgentSession.executeBash() and direct calls.
 */

import { cspawn, Exception, ptree } from "@oh-my-pi/pi-utils";
import { getShellConfig } from "../utils/shell";
import { getOrCreateSnapshot, getSnapshotSourceCommand } from "../utils/shell-snapshot";
import { OutputSink } from "./streaming-output";

export interface BashExecutorOptions {
	cwd?: string;
	timeout?: number;
	onChunk?: (chunk: string) => void;
	signal?: AbortSignal;
}

export interface BashResult {
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	fullOutputPath?: string;
}

export async function executeBash(command: string, options?: BashExecutorOptions): Promise<BashResult> {
	const { shell, args, env, prefix } = await getShellConfig();

	const snapshotPath = await getOrCreateSnapshot(shell, env);
	const snapshotPrefix = getSnapshotSourceCommand(snapshotPath);

	const prefixedCommand = prefix ? `${prefix} ${command}` : command;
	const finalCommand = `${snapshotPrefix}${prefixedCommand}`;

	const sink = new OutputSink({ onChunk: options?.onChunk });

	const child = cspawn([shell, ...args, finalCommand], {
		cwd: options?.cwd,
		env,
		signal: options?.signal,
		timeout: options?.timeout,
	});

	// Pump streams - errors during abort/timeout are expected
	// Use preventClose to avoid closing the shared sink when either stream finishes
	await Promise.allSettled([child.stdout.pipeTo(sink.createInput()), child.stderr.pipeTo(sink.createInput())]).catch(
		() => {},
	);

	// Wait for process exit
	try {
		await child.exited;
		return {
			exitCode: child.exitCode ?? 0,
			cancelled: false,
			...(await sink.dump()),
		};
	} catch (err) {
		// Exception covers NonZeroExitError, AbortError, TimeoutError
		if (err instanceof Exception) {
			if (err.aborted) {
				const isTimeout = err instanceof ptree.TimeoutError || err.message.toLowerCase().includes("timed out");
				const annotation = isTimeout
					? `Command timed out after ${Math.round((options?.timeout ?? 0) / 1000)} seconds`
					: undefined;
				return {
					exitCode: undefined,
					cancelled: true,
					...(await sink.dump(annotation)),
				};
			}

			// NonZeroExitError
			return {
				exitCode: err.exitCode,
				cancelled: false,
				...(await sink.dump()),
			};
		}

		throw err;
	}
}
