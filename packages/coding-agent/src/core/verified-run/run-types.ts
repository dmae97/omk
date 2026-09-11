import type {
	RunContract,
	RunResumeCommand,
	RunStartCommand,
	RunTaskRetryCommand,
	RunWriterRestartCommand,
} from "omk-protocol";
import type { DagEvent, RunTaskCheckpoint, RunTaskProjection } from "./dag-types.ts";
import type { NamespaceIdentity } from "./namespace-identity.ts";
import type { RecoveryBudget } from "./recovery-clock.ts";

export type RunEvent =
	| DagEvent
	| { readonly kind: "created"; readonly contract: RunContract; readonly command: RunStartCommand }
	| {
			readonly kind: "budget_anchored";
			readonly budget: RecoveryBudget;
			readonly environmentDigest: string;
			readonly driver: "linux-pidns-gate-v1";
	  }
	| {
			readonly kind: "dispatch";
			readonly executionId: string;
			readonly role: "writer" | "verifier";
			readonly claimId: string | null;
	  }
	| { readonly kind: "input_checkpoint"; readonly digest: string }
	| { readonly kind: "process_ready"; readonly executionId: string; readonly identity: NamespaceIdentity }
	| { readonly kind: "writer_opened" }
	| { readonly kind: "model_request"; readonly requestId: string }
	| { readonly kind: "writer_closed"; readonly completed: boolean }
	| { readonly kind: "exited"; readonly executionId: string; readonly failure: string | null }
	| {
			readonly kind: "candidate";
			readonly digest: string;
			readonly observedMs?: number;
			readonly verificationDeadlineMs?: number;
	  }
	| {
			readonly kind: "resumed";
			readonly command: RunResumeCommand;
			readonly observedMs: number;
			readonly reconciledExecutionIds: readonly string[];
	  }
	| {
			readonly kind: "writer_restarted";
			readonly command: RunWriterRestartCommand;
			readonly observedMs: number;
			readonly reconciledExecutionIds: readonly string[];
	  }
	| {
			readonly kind: "tasks_retried";
			readonly command: RunTaskRetryCommand;
			readonly observedMs: number;
			readonly reconciledExecutionIds: readonly string[];
			readonly adopted: readonly RunTaskCheckpoint[];
	  }
	| { readonly kind: "evaluated"; readonly receiptDigest: string; readonly verified: boolean }
	| { readonly kind: "failed"; readonly code: string };

export interface RunProjection {
	readonly runId: string;
	readonly revision: number;
	readonly generation: number;
	readonly execution: "ready" | "running" | "paused" | "succeeded" | "failed";
	readonly settlement: "open" | "draining" | "settled" | "quarantined";
	readonly verification: "not_requested" | "verified" | "violated" | "inconclusive";
	readonly application: "not_requested" | "candidate_ready";
	readonly candidateDigest: string | null;
	readonly inputDigest: string | null;
	readonly receiptDigest: string | null;
	readonly failure: string | null;
	readonly activeExecutionIds: readonly string[];
	readonly writerOpen: boolean;
	readonly modelRequests: number;
	readonly tasks: readonly RunTaskProjection[];
	readonly budget: RecoveryBudget | null;
	readonly environmentDigest: string | null;
	readonly verificationDeadlineMs: number | null;
	readonly lastClockMs: number | null;
	readonly processes: readonly { readonly executionId: string; readonly identity: NamespaceIdentity }[];
}

/** Mutable reduction bookkeeping, confined to one replay call. */
export interface WriterReduction {
	readonly contract: RunContract;
	state: RunProjection;
	writerFinished: boolean;
	writerStarted: boolean;
	producerStarted: boolean;
	writerCommands: number;
	requestBaseline: number;
	readonly requests: Set<string>;
}
