/**
 * Types for PTY-backed interactive execution.
 */

import type { Cancellable, TsFunc } from "../bindings";

/**
 * Options for starting a command in a pseudo-terminal session.
 */
export interface PtyStartOptions extends Cancellable {
	/** Command to execute. */
	command: string;
	/** Working directory for command execution. */
	cwd?: string;
	/** Environment variables for this command. */
	env?: Record<string, string>;
	/** PTY column count. */
	cols?: number;
	/** PTY row count. */
	rows?: number;
}

/**
 * Result of a PTY command run.
 */
export interface PtyRunResult {
	/** Exit code of the command, if available. */
	exitCode?: number;
	/** Whether the command was cancelled by abort signal or kill request. */
	cancelled: boolean;
	/** Whether the command timed out. */
	timedOut: boolean;
}

/** Stateful PTY session instance. */
export interface PtySession {
	/** Start command execution and stream output while it runs. */
	start(options: PtyStartOptions, onChunk?: TsFunc<string>): Promise<PtyRunResult>;
	/** Write raw input bytes to PTY stdin. */
	write(data: string): void;
	/** Resize active PTY. */
	resize(cols: number, rows: number): void;
	/** Force-kill active command. */
	kill(): void;
}

/** Native PTY session constructor. */
export interface PtySessionConstructor {
	new (): PtySession;
}

declare module "../bindings" {
	interface NativeBindings {
		/** Stateful PTY session constructor for interactive terminal passthrough. */
		PtySession: PtySessionConstructor;
	}
}
