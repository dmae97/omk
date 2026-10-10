import type { ProofClosureResult } from "omk-protocol";
import { type DagTaskExplanation, explainDagTasks } from "./dag-explanation.ts";
import { readRunEvidence } from "./evidence.ts";
import { evaluateRunClaims } from "./evidence-binding.ts";
import { readRunJournal } from "./journal.ts";
import { type AuthorityStatus, deriveRunStatus, type RunStatus } from "./run-status.ts";
import { withOwnedGitStatus } from "./run-status-owned.ts";
import { VerifiedRunError } from "./storage.ts";

export interface RunExplanation {
	readonly runId: string;
	readonly revision: number;
	readonly generation: number;
	readonly executionRequested: false;
	readonly status: RunStatus;
	readonly tasks: readonly DagTaskExplanation[];
	readonly binding: {
		readonly journalDigest: string;
		readonly contractDigest: string;
		readonly candidateDigest: string | null;
		readonly receiptDigest: string | null;
		readonly environmentDigest: string | null;
	};
	readonly proof: ProofClosureResult;
}

/** One journal snapshot supplies every projection; no writer, verifier or recovery is dispatched. */
export function readRunExplanation(runPath: string, runId: string, authority: AuthorityStatus): RunExplanation {
	const journal = readRunJournal(runPath);
	const first = journal?.records[0]?.event;
	if (!journal || first?.kind !== "created" || journal.state.runId !== runId)
		throw new VerifiedRunError("missing_run");
	const { state } = journal;
	const evidence = state.receiptDigest ? readRunEvidence(runPath, journal) : null;
	const owned = authority.blockingGrants.filter(
		(grant) => grant.sessionId === state.runId && grant.claims.some((claim) => claim.namespace === "git-ref"),
	);
	const unresolved = [...state.activeExecutionIds, ...owned.map((grant) => grant.dispatchId ?? grant.grantSequence)];
	if (state.writerOpen) unresolved.push("writer_open");
	return Object.freeze({
		runId: state.runId,
		revision: state.revision,
		generation: state.generation,
		executionRequested: false,
		status: withOwnedGitStatus(deriveRunStatus(state), authority),
		tasks: explainDagTasks(first.contract, state),
		binding: Object.freeze({
			journalDigest: journal.bytesDigest,
			contractDigest: first.command.contractDigest,
			candidateDigest: state.candidateDigest,
			receiptDigest: state.receiptDigest,
			environmentDigest: state.environmentDigest,
		}),
		proof: evaluateRunClaims(first.contract, {
			candidate: state.candidateDigest ?? "",
			environment: state.environmentDigest ?? "",
			checks: evidence?.checks ?? [],
			unresolvedEffectIds: unresolved,
			workspaceCompleteness: state.candidateDigest ? "complete" : "unknown",
		}),
	});
}
