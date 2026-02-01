/**
 * Types for shell execution via brush-core.
 */

import type { TsFunc } from "../bindings";

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
export interface ShellRunOptions {
	/** The command to execute. */
	command: string;
	/** Working directory for command execution. */
	cwd?: string;
	/** Environment variables to apply for this command. */
	env?: Record<string, string>;
	/** Timeout in milliseconds. */
	timeoutMs?: number;
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
export interface ShellExecuteOptions {
	/** The command to execute. */
	command: string;
	/** Working directory for command execution. */
	cwd?: string;
	/** Environment variables to apply for this command. */
	env?: Record<string, string>;
	/** Environment variables to set once per session. */
	sessionEnv?: Record<string, string>;
	/** Timeout in milliseconds. */
	timeoutMs?: number;
	/** Unique identifier for this execution (used for abort). */
	executionId: string;
	/** Session key for persistent brush shell instances. */
	sessionKey: string;
	/** Optional snapshot path to source for bash sessions. */
	snapshotPath?: string;
}

/**
/** Internal result from the native brush-core binding. */
export interface ShellExecuteResult extends ShellRunResult {}

/** Native Shell class instance. */
export interface NativeShell {
	/**
	 * Run a command in the shell.
	 * @param options Command execution options.
	 * @param onChunk Optional callback for streamed output.
	 * @returns Promise resolving to the command result.
	 */
	run(options: ShellRunOptions, onChunk?: TsFunc<string>): Promise<ShellRunResult>;
	/**
	 * Abort all running commands in this session.
	 */
	abort(): void;
}

/** Native Shell class constructor. */
export interface NativeShellConstructor {
	/**
	 * Create a new shell session.
	 * @param options Optional session configuration.
	 */
	new (options?: ShellOptions): NativeShell;
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
		/**
		 * Abort a running shell execution by ID.
		 * @param executionId Execution identifier from ShellExecuteOptions.
		 */
		abortShellExecution(executionId: string): void;
		/** Shell class constructor for creating sessions. */
		Shell: NativeShellConstructor;
	}
}
