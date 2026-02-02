/**
 * Types for shell execution via brush-core.
 */

import type { Cancellable, TsFunc } from "../bindings";

/**
 * Configuration for a persistent brush-core shell session.
 */
export interface ShellOptions {
	/** Environment variables to set once per session. */
	sessionEnv?: Record<string, string>;
	/** Optional snapshot path to source for bash sessions. */
	snapshotPath?: string;
}

/**
 * Options for running a single shell command.
 */
export interface ShellRunOptions extends Cancellable {
	/** The command to execute. */
	command: string;
	/** Working directory for command execution. */
	cwd?: string;
	/** Environment variables to apply for this command. */
	env?: Record<string, string>;
}

/**
 * Result of running a shell command via brush-core.
 */
export interface ShellRunResult {
	/** Exit code of the command (undefined if cancelled or timed out). */
	exitCode?: number;
	/** Whether the command was cancelled via abort. */
	cancelled: boolean;
	/** Whether the command timed out. */
	timedOut: boolean;
}

/**
 * Internal options for the native brush-core binding.
 */
export interface ShellExecuteOptions extends Cancellable {
	/** The command to execute. */
	command: string;
	/** Working directory for command execution. */
	cwd?: string;
	/** Environment variables to apply for this command. */
	env?: Record<string, string>;
	/** Environment variables to set once per session. */
	sessionEnv?: Record<string, string>;
	/** Optional snapshot path to source for bash sessions. */
	snapshotPath?: string;
}

/**
/** Internal result from the native brush-core binding. */
export interface ShellExecuteResult extends ShellRunResult {}

/** Native Shell class instance. */
export interface Shell {
	/**
	 * Run a command in the shell.
	 * @param options Command execution options.
	 * @param onChunk Optional callback for streamed output.
	 * @returns Promise resolving to the command result.
	 */
	run(options: ShellRunOptions, onChunk?: TsFunc<string>): Promise<ShellRunResult>;
	/**
	 * Abort all running commands in this session.
	 * @param reason Optional reason for the abort.
	 */
	abort(reason?: string): void;
}

/** Native Shell class constructor. */
export interface ShellConstructor {
	/**
	 * Create a new shell session.
	 * @param options Optional session configuration.
	 */
	new (options?: ShellOptions): Shell;
}

declare module "../bindings" {
	/** Native bindings exposed by the shell module. */
	interface NativeBindings {
		/**
		 * Execute a shell command with explicit session metadata.
		 * @param options Execution options including session identifiers.
		 * @param onChunk Optional callback for streamed output.
		 * @returns Promise resolving to the command result.
		 */
		executeShell(options: ShellExecuteOptions, onChunk?: TsFunc<string>): Promise<ShellExecuteResult>;

		/** Shell class constructor for creating sessions. */
		Shell: ShellConstructor;
	}
}
