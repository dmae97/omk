import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import type { SessionOwnerLease } from "../session-owner-lease.ts";
import { readRunJournal } from "./journal.ts";
import { nativeReconnectBinding } from "./native-reconnect-binding.ts";
import type { RunPhaseContext } from "./phase-context.ts";
import { requireRunJournal } from "./recovery-command.ts";
import { reattachRustExecution } from "./rust-host-reattach.ts";
import { VerifiedRunError } from "./storage.ts";

/** Recover only an existing check: no acquire, gate commit, workspace materialization or dispatch. */
export async function recoverVerifierCheck(context: RunPhaseContext, executionId: string, owner: SessionOwnerLease) {
	const { runPath, journal, authority, contract, signal } = context;
	const snapshot = requireRunJournal(runPath);
	const binding = nativeReconnectBinding(runPath, snapshot, executionId, owner, authority);
	const deadline = performance.now() + binding.remainingMs;
	const result = await reattachRustExecution(dirname(runPath), executionId, {
		...contract.budget,
		deadline,
		...(signal ? { signal } : {}),
		assertBinding(record) {
			const restriction = binding.assertRecord(record);
			if (readRunJournal(runPath)?.bytesDigest !== snapshot.bytesDigest)
				throw new VerifiedRunError("stale_revision");
			return restriction;
		},
	});
	const grant = authority.store.state.grants.get(binding.grant.token.grantSequence);
	if (!grant) throw new VerifiedRunError("authority_binding");
	if (grant.state !== "terminated") {
		if (signal?.aborted || result.failure === "cancelled") authority.store.cancel(binding.grant.token);
		if (!authority.store.confirmTerminated(binding.grant.token)) throw new VerifiedRunError("authority");
	}
	if (journal.state.activeExecutionIds.includes(executionId))
		journal.append({ kind: "exited", executionId, failure: null });
	if (signal?.aborted) throw new VerifiedRunError("cancelled");
	if (performance.now() >= deadline) throw new VerifiedRunError("deadline");
	const failure = result.failure;
	if (failure !== null && ["authorization_expired", "authorization_revoked", "cancelled"].includes(failure))
		throw new VerifiedRunError(failure);
	return result;
}
