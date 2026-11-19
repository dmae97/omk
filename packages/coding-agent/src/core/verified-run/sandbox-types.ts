import type { NamespaceIdentity } from "./namespace-identity.ts";
import type { NativePhaseDeadline } from "./native-phase-deadline.ts";

export interface SandboxExecution {
	readonly workspace: string;
	readonly argv: readonly string[];
	readonly writable: boolean;
	readonly timeoutMs: number;
	readonly cleanupMs: number;
	readonly maxOutputBytes: number;
	readonly signal?: AbortSignal;
	readonly onReady?: (identity: NamespaceIdentity) => void | Promise<void>;
	/** Trusted built-in publisher only: readonly worktree, writable .git, readonly current Node executable. */
	readonly gitPublication?: true;
	/** Private directory for native durable termination receipts; ignored by the Node backend. */
	readonly witnessDir?: string;
	/** Native host request ID (32 lowercase hex); the durable record and duplicate guard key. */
	readonly requestId?: string;
	/** Private directory for the native host's durable execution record; ignored by the Node backend. */
	readonly recordDir?: string;
	/** Trusted dispatch binding to the existing grant and execution generation. */
	readonly bindingDigest?: string;
	/** Original run phase cap in the Linux boot clock; native detach never renews it. */
	readonly phaseDeadline?: NativePhaseDeadline;
	/** Keep a committed native writer alive after parent loss, under its original deadline. */
	readonly detachable?: true;
}

export interface SandboxOutcome {
	readonly stdout: Buffer;
	readonly stderr: Buffer;
	readonly exitCode: number | null;
	readonly failure: string | null;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly durationMs: number;
}
