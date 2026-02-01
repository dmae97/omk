/**
 * Options for executing a shell command via brush-core.
 */
export interface ShellExecuteOptions {
	/** The command to execute */
	command: string;
	/** Working directory for command execution */
	cwd?: string;
	/** Environment variables to apply for this command */
	env?: Record<string, string>;
	/** Environment variables to set once per session */
	sessionEnv?: Record<string, string>;
	/** Timeout in milliseconds */
	timeoutMs?: number;
	/** Unique identifier for this execution (used for abort) */
	executionId: string;
	/** Session key for persistent brush shell instances */
	sessionKey: string;
	/** Optional snapshot path to source for bash sessions */
	snapshotPath?: string;
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
