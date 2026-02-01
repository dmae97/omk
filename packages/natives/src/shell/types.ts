/**
 * Options for executing a shell command via brush-core.
 */
export interface ShellExecuteOptions {
	/** The command to execute */
	command: string;
	/** Working directory for command execution */
	cwd?: string;
	/** Environment variables to set */
	env?: Record<string, string>;
	/** Timeout in milliseconds */
	timeoutMs?: number;
	/** Unique identifier for this execution (used for abort) */
	executionId: string;
}

/**
 * Result of executing a shell command via brush-core.
 */
export interface ShellExecuteResult {
	/** Exit code of the command (undefined if cancelled or timed out) */
	exitCode?: number;
	/** Whether the command was cancelled via abort */
	cancelled: boolean;
	/** Whether the command timed out */
	timedOut: boolean;
}
