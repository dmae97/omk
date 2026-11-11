export interface RunGcOptions {
	/** Minimum age of the last journal write and each native companion file, in milliseconds. */
	readonly olderThanMs: number;
	/** False takes the same leases but deletes no run or native artifacts. */
	readonly execute: boolean;
	/** Explicit opt-in to unindexed/legacy data with no recovery-command authorization. */
	readonly obsolete?: boolean;
}

export interface RunGcEntry {
	readonly runId: string;
	readonly action: "pruned" | "prunable" | "kept";
	/** Why a run was kept; null when it was (or would be) pruned. */
	readonly reason: string | null;
	/** Derived workspace names relative to the run, never native deletion paths. */
	readonly paths: readonly string[];
	readonly bytes: number;
}

export interface NativeRecordGcEntry {
	readonly requestId: string;
	readonly runId: string | null;
	readonly executionId: string | null;
	readonly action: "kept" | "prunable" | "pruned";
	readonly reason: string | null;
	/** Paths relative to the state root, never workspace deletion paths. */
	readonly paths: readonly string[];
	readonly bytes: number;
}

export interface RunGcReport {
	readonly stateRoot: string;
	readonly execute: boolean;
	readonly olderThanMs: number;
	readonly runs: readonly RunGcEntry[];
	readonly prunedBytes: number;
	readonly prunableBytes: number;
	readonly nativeRecords: readonly NativeRecordGcEntry[];
	readonly prunedNativeBytes: number;
	readonly prunableNativeBytes: number;
}
