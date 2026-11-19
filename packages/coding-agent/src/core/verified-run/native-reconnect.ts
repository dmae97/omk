import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import type { RunReconnectCommand } from "omk-protocol";
import { acquireSessionOwnerLeaseSync } from "../session-owner-lease.ts";
import type { RunAuthority } from "./authority-runtime.ts";
import { stopEvent } from "./interruption.ts";
import { type JournalSnapshot, journalPath, readRunJournal, VerifiedRunJournal } from "./journal.ts";
import { nativeReconnectBinding } from "./native-reconnect-binding.ts";
import { recoverVerifierCheck } from "./native-verifier-check.ts";
import { readRunClock } from "./recovery-clock.ts";
import { requireRunJournal } from "./recovery-command.ts";
import type { RunProjection } from "./run-types.ts";
import { rustHostReconnectEnabled } from "./rust-host-binding.ts";
import { reattachRustExecution } from "./rust-host-reattach.ts";
import {
	nativeExecutionDir,
	nativeRequestId,
	type RustExecutionRecord,
	readRustExecutionRecord,
} from "./rust-host-record.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";
import { verifyCandidate } from "./verification-phase.ts";
import { publishWriterCandidate } from "./writer-completion.ts";

function disposition(snapshot: JournalSnapshot, command: RunReconnectCommand): "new" | "retry" | "complete" {
	const first = snapshot.records[0]?.event;
	const state = snapshot.state;
	if (
		first?.kind !== "created" ||
		first.contract.runId !== command.runId ||
		digestObject(first.contract) !== command.contractDigest ||
		first.command.commandId === command.commandId
	)
		throw new VerifiedRunError("command_conflict");
	const target = snapshot.records.find(
		(r) =>
			r.generation === state.generation &&
			r.event.kind === "dispatch" &&
			r.event.executionId === command.executionId,
	)?.event;
	const verifier = target?.kind === "dispatch" && target.role === "verifier";
	const prior = snapshot.records.find(
		({ event }) => "command" in event && event.command.commandId === command.commandId,
	)?.event;
	if (prior) {
		if (prior.kind !== "reconnected" || digestObject(prior.command) !== digestObject(command))
			throw new VerifiedRunError("command_conflict");
		if (state.generation !== command.expectedGeneration) throw new VerifiedRunError("stale_generation");
		if (
			state.receiptDigest ||
			(!verifier && state.candidateDigest) ||
			state.execution === "failed" ||
			state.execution === "paused"
		)
			return "complete";
		return "retry";
	}
	if (state.revision !== command.expectedRevision || state.generation !== command.expectedGeneration)
		throw new VerifiedRunError("stale_revision");
	if (
		(verifier
			? snapshot.records.filter((r) => r.generation === state.generation && r.event.kind === "dispatch").at(-1)
					?.event !== target
			: state.activeExecutionIds.length !== 1) ||
		state.activeExecutionIds.some((id) => id !== command.executionId) ||
		state.execution !== "running" ||
		state.failure ||
		(verifier ? !state.candidateDigest || state.receiptDigest : state.candidateDigest)
	)
		throw new VerifiedRunError("reconnect_unavailable");
	return "new";
}

/** Returns a completed duplicate without reopening authority, reserving grants or changing epochs. */
export function completedNativeReconnect(runPath: string, command: RunReconnectCommand): RunProjection | undefined {
	const snapshot = requireRunJournal(runPath);
	return disposition(snapshot, command) === "complete" ? snapshot.state : undefined;
}

export async function reconnectNativeExecution(
	runPath: string,
	command: RunReconnectCommand,
	options: { readonly authority: RunAuthority; readonly signal?: AbortSignal },
): Promise<RunProjection> {
	if (!rustHostReconnectEnabled()) throw new VerifiedRunError("unsupported_boundary");
	const owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
	try {
		const snapshot = requireRunJournal(runPath);
		const mode = disposition(snapshot, command);
		if (mode === "complete") return snapshot.state;
		const binding = nativeReconnectBinding(runPath, snapshot, command.executionId, owner, options.authority);
		const stateRoot = dirname(runPath);
		const record = readRustExecutionRecord(
			nativeExecutionDir(stateRoot),
			nativeRequestId(command.executionId),
			binding.contract.budget.maxOutputBytes,
		);
		if (!record) throw new VerifiedRunError("missing_record");
		binding.assertRecord(record);
		const journal = new VerifiedRunJournal(runPath, owner);
		const deadline = performance.now() + binding.remainingMs;
		if (mode === "new")
			journal.append({
				kind: "reconnected",
				command,
				observedMs: readRunClock().nowMs,
				grantSequence: binding.grant.token.grantSequence,
				authorityEpoch: binding.authorityEpoch,
			});
		const target = snapshot.records.find(
			(r) => r.event.kind === "dispatch" && r.event.executionId === command.executionId,
		)?.event;
		if (target?.kind === "dispatch" && target.role === "verifier") {
			try {
				const context = {
					runPath,
					journal,
					contract: binding.contract,
					authority: options.authority,
					...(options.signal ? { signal: options.signal } : {}),
				};
				const active = journal.state.activeExecutionIds[0];
				if (active) await recoverVerifierCheck(context, active, owner);
				return await verifyCandidate(context, owner);
			} catch (error) {
				if (
					error instanceof VerifiedRunError &&
					!["stale_owner", "stale_head", "stale_revision"].includes(error.code) &&
					!journal.state.receiptDigest
				)
					return journal.append(stopEvent(journal.state, error.code));
				throw error;
			}
		}
		const expectedDigest = requireRunJournal(runPath).bytesDigest;
		const assertBinding = (current: RustExecutionRecord) => {
			const restriction = binding.assertRecord(current);
			if (readRunJournal(runPath)?.bytesDigest !== expectedDigest) throw new VerifiedRunError("stale_revision");
			return restriction;
		};
		const context = {
			runPath,
			journal,
			contract: binding.contract,
			authority: options.authority,
			...(options.signal ? { signal: options.signal } : {}),
		};
		try {
			const result = await reattachRustExecution(stateRoot, command.executionId, {
				...binding.contract.budget,
				deadline,
				assertBinding,
				...(options.signal ? { signal: options.signal } : {}),
			});
			const store = options.authority.store;
			const grant = store.state.grants.get(binding.grant.token.grantSequence);
			if (!grant) throw new VerifiedRunError("authority_binding");
			if (grant.state !== "terminated" && (options.signal?.aborted || result.failure === "cancelled"))
				store.cancel(binding.grant.token);
			if (grant.state !== "terminated" && !store.confirmTerminated(binding.grant.token))
				throw new VerifiedRunError("authority");
			let failure = result.failure;
			if (performance.now() >= deadline) failure = "deadline";
			if (options.signal?.aborted) failure = "cancelled";
			if (journal.state.activeExecutionIds.includes(command.executionId))
				journal.append({ kind: "exited", executionId: command.executionId, failure });
			if (failure) throw new VerifiedRunError(failure);
			publishWriterCandidate(context, binding.workspace, deadline);
			return await verifyCandidate(context);
		} catch (error) {
			if (
				error instanceof VerifiedRunError &&
				!["stale_owner", "stale_head", "stale_revision"].includes(error.code) &&
				!journal.state.receiptDigest
			)
				return journal.append(stopEvent(journal.state, error.code));
			throw error;
		}
	} finally {
		owner.release();
	}
}
