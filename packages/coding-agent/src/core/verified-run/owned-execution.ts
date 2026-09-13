import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { executeSandbox, type SandboxOutcome } from "./broker.ts";
import type { VerifiedRunJournal } from "./journal.ts";
import type { NamespaceIdentity } from "./namespace-identity.ts";
import { VerifiedRunError } from "./storage.ts";

export interface OwnedRunCommand {
	readonly role: "writer" | "verifier";
	readonly argv: readonly string[];
	readonly workspace: string;
	readonly deadline: number;
	readonly claimId: string | null;
	readonly taskId?: string;
}
export interface OwnedRunResult {
	readonly executionId: string;
	readonly result: SandboxOutcome;
	readonly timeoutMs: number;
}

/** The mandatory durable intent boundary is shared by command and AgentSession writers. */
export async function executeRunCommand(
	journal: VerifiedRunJournal,
	request: OwnedRunCommand,
	policy: {
		readonly cleanupMs: number;
		readonly maxOutputBytes: number;
		readonly signal?: AbortSignal;
	},
): Promise<OwnedRunResult> {
	if (Math.floor(request.deadline - performance.now()) <= 0) throw new VerifiedRunError("deadline");
	if (policy.signal?.aborted) throw new VerifiedRunError("cancelled");
	const generation = journal.state.generation;
	const executionId = randomUUID();
	journal.append({
		kind: "dispatch",
		executionId,
		role: request.role,
		claimId: request.claimId,
		...(request.taskId === undefined ? {} : { taskId: request.taskId }),
	});
	const timeoutMs = Math.floor(request.deadline - performance.now());
	if (timeoutMs <= 0 || policy.signal?.aborted) {
		const failure = policy.signal?.aborted ? "cancelled" : "deadline";
		journal.append({ kind: "exited", executionId, failure });
		throw new VerifiedRunError(failure);
	}
	const result = await executeSandbox({
		workspace: request.workspace,
		argv: request.argv,
		writable: request.role === "writer",
		timeoutMs,
		cleanupMs: policy.cleanupMs,
		maxOutputBytes: policy.maxOutputBytes,
		...(policy.signal ? { signal: policy.signal } : {}),
		...(journal.state.budget
			? {
					onReady: (identity: NamespaceIdentity) => {
						if (journal.state.generation !== generation) throw new VerifiedRunError("stale_generation");
						journal.append({ kind: "process_ready", executionId, identity });
					},
				}
			: {}),
	});
	if (journal.state.generation !== generation) throw new VerifiedRunError("stale_generation");
	journal.append({ kind: "exited", executionId, failure: request.role === "writer" ? result.failure : null });
	return { executionId, result, timeoutMs };
}
