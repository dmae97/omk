import { dirname, join } from "node:path";
import type { RunContract } from "omk-protocol";
import { canonicalClaim, sameClaimSet } from "../../coordination/resource.ts";
import type { SessionOwnerLease } from "../session-owner-lease.ts";
import { createAuthorityClock } from "./authority-clock.ts";
import type { AuthorityGrantRecord } from "./authority-events.ts";
import type { RunAuthority } from "./authority-runtime.ts";
import { AuthorityStore, authorityStorePath } from "./authority-store.ts";
import { commandEnvironmentDigest } from "./broker.ts";
import { loadCandidate } from "./candidate.ts";
import { type JournalSnapshot, journalPath } from "./journal.ts";
import { workspaceClaim } from "./owned-execution.ts";
import { readRunClock, remainingRunTime } from "./recovery-clock.ts";
import type { RustExecutionRecord } from "./rust-host-record.ts";
import { digestObject, readRegularFile, VerifiedRunError } from "./storage.ts";

/** A new observer owns leases, not a new execution grant. Old token/claims are never rewritten. */
export function nativeReconnectBinding(
	runPath: string,
	snapshot: JournalSnapshot,
	executionId: string,
	owner: SessionOwnerLease,
	authority: RunAuthority,
): {
	readonly contract: RunContract;
	readonly workspace: string;
	readonly remainingMs: number;
	readonly grant: AuthorityGrantRecord;
	readonly authorityEpoch: string;
	assertRecord(record: RustExecutionRecord): "authorization_revoked" | "authorization_expired" | undefined;
} {
	const { state } = snapshot;
	const first = snapshot.records[0]?.event;
	if (
		first?.kind !== "created" ||
		first.contract.profile !== "linux-command-v1" ||
		!state.budget ||
		!state.inputDigest ||
		!state.environmentDigest ||
		state.writerOpen
	)
		throw new VerifiedRunError("unsupported_boundary");
	const contract = first.contract;
	const dispatch = snapshot.records.find(
		(r) => r.generation === state.generation && r.event.kind === "dispatch" && r.event.executionId === executionId,
	)?.event;
	const identity = state.processes.find((p) => p.executionId === executionId)?.identity;
	if (dispatch?.kind !== "dispatch" || dispatch.taskId !== undefined || !identity)
		throw new VerifiedRunError("unsettled");
	const role = dispatch.role;
	const verifier = role === "verifier";
	const check = verifier ? contract.checks.find((item) => item.claimId === dispatch.claimId) : undefined;
	if (
		verifier &&
		(!check ||
			!state.candidateDigest ||
			state.verificationDeadlineMs === null ||
			!dispatch.timeoutMs ||
			dispatch.timeoutMs > contract.budget.verifyMs)
	)
		throw new VerifiedRunError("recovery_legacy");
	const dispatchTimeout = dispatch.timeoutMs;
	const argv = check?.argv ?? contract.writer;
	const claimId = check?.claimId;
	const name = verifier ? "candidate" : "writer";
	const workspace = join(runPath, state.generation === 1 ? name : `${name}-${state.generation}`);
	const claims = workspaceClaim(workspace, verifier ? "read" : "write", state.generation).map(canonicalClaim);
	const sourceDigest = verifier ? state.candidateDigest : state.inputDigest;
	if (!sourceDigest) throw new VerifiedRunError("recovery_legacy");
	loadCandidate(runPath, sourceDigest, contract.budget);
	if (
		readRegularFile(join(runPath, "issuer.key"), 32).length !== 32 ||
		commandEnvironmentDigest(contract, "gated-v1") !== state.environmentDigest
	)
		throw new VerifiedRunError("integrity");
	const budget = state.budget;
	const clock = readRunClock();
	const phaseDeadline = verifier ? state.verificationDeadlineMs : budget.workDeadlineMs;
	if (phaseDeadline === null) throw new VerifiedRunError("recovery_legacy");
	const remainingMs = remainingRunTime(budget, phaseDeadline, clock);
	if (clock.nowMs < (state.lastClockMs ?? budget.startedMs)) throw new VerifiedRunError("clock_rollback");
	const { store, sessionId, incarnation } = authority;
	const epoch = store.state.epoch;
	if (epoch === null) throw new VerifiedRunError("reconcile_pending");
	const now = createAuthorityClock();
	let original: AuthorityGrantRecord | undefined;
	function inspectGrant(): AuthorityGrantRecord {
		if (store.isReleased || !owner.owns(journalPath(runPath))) throw new VerifiedRunError("stale_owner");
		if (store.path !== authorityStorePath(dirname(runPath)) || sessionId !== state.runId)
			throw new VerifiedRunError("authority_binding");
		const view = AuthorityStore.inspectJournal(store.path);
		if (digestObject(view.head) !== digestObject(store.head)) throw new VerifiedRunError("stale_head");
		if (
			view.state.epoch !== epoch ||
			view.state.reconciledEpoch !== epoch ||
			view.state.incarnations.get(sessionId) !== incarnation
		)
			throw new VerifiedRunError("stale_owner");
		const matches = [...view.state.grants.values()].filter((g) => g.commandId === executionId);
		const grant = matches[0];
		if (
			matches.length !== 1 ||
			!grant ||
			grant.dispatchId !== executionId ||
			grant.token.sessionId !== sessionId ||
			!grant.identity ||
			digestObject(grant.identity) !== digestObject(identity) ||
			!grant.actualClaims ||
			!sameClaimSet(grant.claims, claims) ||
			!sameClaimSet(grant.actualClaims, claims) ||
			grant.intentDigest !==
				digestObject({
					argv,
					claims,
					role,
					...(verifier ? { timeoutMs: dispatchTimeout, claimId, candidateDigest: state.candidateDigest } : {}),
				}) ||
			!["running", "quarantined", "terminated"].includes(grant.state)
		)
			throw new VerifiedRunError("authority_binding");
		if (original && digestObject(original.token) !== digestObject(grant.token))
			throw new VerifiedRunError("authority_binding");
		if (grant.startProvenance === undefined) throw new VerifiedRunError("authority_history_missing");
		return grant;
	}
	original = inspectGrant();
	const bindingDigest = digestObject({
		token: original.token,
		generation: state.generation,
		executionId,
		intentDigest: original.intentDigest,
	});
	return {
		contract,
		workspace,
		remainingMs,
		grant: original,
		authorityEpoch: epoch,
		assertRecord(record: RustExecutionRecord) {
			const grant = inspectGrant();
			if (
				!record.durable ||
				record.bindingDigest !== bindingDigest ||
				!record.committed ||
				!record.identity ||
				digestObject(record.identity) !== digestObject(identity) ||
				record.host.bootId !== budget.bootId ||
				digestObject(record.phaseDeadline) !== digestObject({ bootId: budget.bootId, deadlineMs: phaseDeadline })
			)
				throw new VerifiedRunError("native_binding");
			const currentClock = readRunClock();
			remainingRunTime(budget, phaseDeadline, currentClock);
			if (currentClock.nowMs < clock.nowMs) throw new VerifiedRunError("clock_rollback");
			if (grant.startProvenance === "revoked") return "authorization_revoked";
			if (now() >= grant.token.authorizationDeadline) return "authorization_expired";
			return undefined;
		},
	};
}
