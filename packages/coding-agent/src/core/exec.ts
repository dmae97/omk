/**
 * Shared command execution utilities for hooks and custom tools.
 */

import { ptree } from "@oh-my-pi/pi-utils";

/**
 * Options for executing shell commands.
 */
export interface ExecOptions {
	/** AbortSignal to cancel the command */
	signal?: AbortSignal;
	/** Timeout in milliseconds */
	timeout?: number;
	/** Working directory */
	cwd?: string;
}

/**
 * Result of executing a shell command.
 */
export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

/**
 * Execute a shell command and return stdout/stderr/code.
 * Supports timeout and abort signal.
 */
export async function execCommand(
	command: string,
	args: string[],
	cwd: string,
	options?: ExecOptions,
): Promise<ExecResult> {
	const proc = ptree.cspawn([command, ...args], {
		cwd,
		signal: options?.signal,
		timeout: options?.timeout,
	});
	try {
		await proc.exited;
	} catch {
		// ChildProcess rejects on non-zero exit; we handle it below
	}
	return {
		stdout: await proc.stdout.text(),
		stderr: await proc.stderr.text(),
		code: proc.exitCode ?? 0,
		killed: proc.exitReason instanceof ptree.AbortError,
	};
}
