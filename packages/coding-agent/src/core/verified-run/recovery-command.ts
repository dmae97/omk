import type { RunResumeCommand, RunWriterRestartCommand } from "omk-protocol";
import { acquireSessionOwnerLeaseSync } from "../session-owner-lease.ts";
import { type JournalSnapshot, journalPath, readRunJournal, VerifiedRunJournal } from "./journal.ts";
import type { RunProjection } from "./run-types.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";

export type RecoveryCommand = RunResumeCommand | RunWriterRestartCommand;
export function requireRunJournal(runPath: string): JournalSnapshot {
	const journal = readRunJournal(runPath);
	if (!journal) throw new VerifiedRunError("missing_run");
	return journal;
}

function commandDisposition(journal: JournalSnapshot, command: RecoveryCommand): "new" | "duplicate" {
	const first = journal.records[0]?.event;
	if (
		first?.kind !== "created" ||
		first.contract.runId !== command.runId ||
		digestObject(first.contract) !== command.contractDigest
	)
		throw new VerifiedRunError("command_conflict");
	if (first.command.commandId === command.commandId) throw new VerifiedRunError("command_conflict");
	const previous = journal.records.find(
		({ event }) =>
			(event.kind === "resumed" || event.kind === "writer_restarted") &&
			event.command.commandId === command.commandId,
	)?.event;
	if (previous?.kind === "resumed" || previous?.kind === "writer_restarted") {
		if (digestObject(previous.command) !== digestObject(command)) throw new VerifiedRunError("command_conflict");
		return "duplicate";
	}
	if (command.expectedRevision !== journal.state.revision || command.expectedGeneration !== journal.state.generation)
		throw new VerifiedRunError("stale_revision");
	switch (command.kind) {
		case "resume":
			if (command.candidateDigest !== journal.state.candidateDigest)
				throw new VerifiedRunError("candidate_mismatch");
			break;
		case "restart_writer":
			if (!journal.state.inputDigest) throw new VerifiedRunError("input_checkpoint_missing");
			if (
				command.baseDigest !== journal.state.inputDigest ||
				command.baseDigest !== first.contract.workspace.baseDigest
			)
				throw new VerifiedRunError("input_mismatch");
			break;
		default: {
			const exhaustive: never = command;
			throw new VerifiedRunError(String(exhaustive));
		}
	}
	return "new";
}

/** One lease/CAS/idempotency boundary for all explicit recovery actions. */
export async function withRecoveryLease(
	runPath: string,
	command: RecoveryCommand,
	execute: (input: {
		readonly snapshot: JournalSnapshot;
		readonly journal: VerifiedRunJournal;
	}) => Promise<RunProjection>,
): Promise<RunProjection> {
	const initial = requireRunJournal(runPath);
	if (commandDisposition(initial, command) === "duplicate") return initial.state;
	const owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
	try {
		const snapshot = requireRunJournal(runPath);
		if (commandDisposition(snapshot, command) === "duplicate") return snapshot.state;
		const journal = new VerifiedRunJournal(runPath, owner);
		try {
			return await execute({ snapshot, journal });
		} catch (error) {
			if (
				error instanceof VerifiedRunError &&
				journal.state.generation > snapshot.state.generation &&
				!journal.state.receiptDigest
			)
				return journal.append({ kind: "failed", code: error.code });
			throw error;
		}
	} finally {
		owner.release();
	}
}
