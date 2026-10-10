import type { Message } from "omk-ai";
import type { AgentCheckpoint } from "./checkpoint-runtime.ts";
import type { ManagedProcessCleanup, ManagedProcessReason, ManagedProcessResult } from "./managed-process.ts";

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export type DeadlineOutcome = "completed" | "cutoff" | "aborted" | "failed" | "budget-exhausted";

export interface DeadlineAttemptMetadata {
	readonly attempt: number;
	readonly shardId: string;
	readonly cutoffMs: number;
	readonly elapsedMs: number;
	readonly outcome: Exclude<DeadlineOutcome, "budget-exhausted">;
	readonly exitCode: number;
	readonly messageCount: number;
	readonly processReason: ManagedProcessReason;
	readonly cleanup: ManagedProcessCleanup;
}

export interface AgentDeadlineMetadata {
	readonly outcome: DeadlineOutcome;
	readonly startedAtMs: number;
	readonly elapsedMs: number;
	readonly hardDeadlineMs: number;
	readonly estimatedTokens: number;
	readonly workUnits: number;
	readonly predictedMs: number;
	readonly plannedShardIds: readonly string[];
	readonly completedShardIds: readonly string[];
	readonly remainingShardIds: readonly string[];
	readonly resumeCount: number;
	readonly duplicateResumeBlocked: boolean;
	readonly provider: string;
	readonly model: string;
	readonly profileSamples: number;
	readonly attempts: readonly DeadlineAttemptMetadata[];
	readonly checkpoint?: AgentCheckpoint;
}

export interface SingleResult {
	nodeId?: string;
	attemptId?: string;
	/** Bounded display projection only, never a completed message or checkpoint. */
	progress?: { readonly text: string; readonly sequence: number };
	dependencyDigests?: Readonly<Record<string, string>>;
	/** `settlement` is present on the owner's copy and stripped from tool-result details (toDetailsResult). */
	process?: Omit<ManagedProcessResult, "settlement"> & { readonly settlement?: Promise<void> };
	stream?: {
		stdoutBytes: number;
		stderrBytes: number;
		events: number;
		messages: number;
		stdoutDigest: string;
		stderrDigest: string;
		usageUnknown: boolean;
		failure?: string;
	};
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	output?: string;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	deadline?: AgentDeadlineMetadata;
}

/**
 * Tool-result `details` must be plain data, so the live `process.settlement`
 * Promise stays with the lane owner (the value runSingleAgent returns) and only
 * the snapshot fields cross the boundary.
 */
export function toDetailsResult(result: SingleResult): SingleResult {
	if (!result.process) return result;
	const { settlement: _settlement, ...process } = result.process;
	return { ...result, process };
}

export interface SubagentAttemptResult {
	readonly result: SingleResult;
	readonly process: {
		readonly reason: ManagedProcessReason;
		readonly elapsedMs: number;
		readonly cleanup: ManagedProcessCleanup;
		readonly terminationObserved?: boolean;
		readonly settlement?: Promise<void>;
	};
}

export function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}
