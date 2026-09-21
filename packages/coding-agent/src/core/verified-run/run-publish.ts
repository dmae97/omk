import { realpathSync } from "node:fs";
import type { RunContract, RunPublishCommand } from "omk-protocol";
import type { GrantToken } from "../../coordination/types.ts";
import { acquireSessionOwnerLeaseSync } from "../session-owner-lease.ts";
import { openRunAuthority, type RunAuthority } from "./authority-runtime.ts";
import { commandEnvironmentDigest } from "./broker.ts";
import { loadCandidate } from "./candidate.ts";
import { readRunEvidence } from "./evidence.ts";
import {
	assertGitWorkspaceRoot,
	casRef,
	GitRefCasError,
	OMK_ACCEPTED_REF,
	objectExists,
	repoObjectFormat,
	resolveRef,
	sealCandidateCommit,
	zeroOid,
} from "./git-plumbing.ts";
import { type JournalSnapshot, journalPath, VerifiedRunJournal } from "./journal.ts";
import { requireRunJournal } from "./recovery-command.ts";
import type { RunEvent, RunProjection } from "./run-types.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";

export { OMK_ACCEPTED_REF };

/** Policy fields the publish gate pins; the command must carry this digest so a policy change fails loudly. */
export function publishPolicyDigest(contract: RunContract): string {
	return digestObject({
		apply: contract.apply,
		profile: contract.profile,
		targetRef: OMK_ACCEPTED_REF,
		writablePaths: contract.writablePaths,
	});
}

type PublishIntent = Extract<RunEvent, { kind: "publish_intent" }>;

function openPublishIntents(journal: JournalSnapshot): readonly PublishIntent[] {
	return journal.records.flatMap(({ event }) => (event.kind === "publish_intent" ? [event] : []));
}

function terminalFor(journal: JournalSnapshot, commandId: string): boolean {
	return journal.records.some(
		({ event }) => (event.kind === "published" || event.kind === "publish_failed") && event.commandId === commandId,
	);
}

/**
 * Same commandId + same recorded payload resumes the outbox entry; same commandId
 * + different payload is a collision. A fresh commandId must name the current
 * revision/generation exactly.
 */
function publishDisposition(journal: JournalSnapshot, command: RunPublishCommand): "completed" | "resume" | "new" {
	const first = journal.records[0]?.event;
	if (
		first?.kind !== "created" ||
		first.contract.runId !== command.runId ||
		digestObject(first.contract) !== command.contractDigest
	)
		throw new VerifiedRunError("command_conflict");
	if (first.command.commandId === command.commandId) throw new VerifiedRunError("command_conflict");
	const own = openPublishIntents(journal).find((event) => event.commandId === command.commandId);
	if (own) {
		if (
			own.candidateDigest !== command.candidateDigest ||
			own.parentOid !== command.parentOid ||
			own.receiptDigest !== command.receiptDigest ||
			own.policyDigest !== command.policyDigest
		)
			throw new VerifiedRunError("command_conflict");
		return terminalFor(journal, command.commandId) ? "completed" : "resume";
	}
	if (command.expectedRevision !== journal.state.revision || command.expectedGeneration !== journal.state.generation)
		throw new VerifiedRunError("stale_revision");
	if (journal.state.publication === "intent") throw new VerifiedRunError("reconciliation_required");
	if (journal.state.publication === "accepted") throw new VerifiedRunError("already_published");
	return "new";
}

export interface PublishOptions {
	/** Fault-injection seam invoked once a CAS succeeds and before the result is appended. */
	readonly afterCas?: () => void;
	/**
	 * The caller's open authority session (coordinator path). When absent, the
	 * publish opens, reconciles and registers its own — the outbox runs
	 * through the same durable authority boundary either way.
	 */
	readonly authority?: RunAuthority;
}

/**
 * Durable publish intent -> resolve -> single old-OID CAS -> result record.
 * The intent row is the outbox record: a replay finds the ref already at the
 * candidate OID and only appends the missing `published` result, so a CAS is
 * structurally never executed twice for one intent.
 */
export function publishVerifiedRun(
	runPath: string,
	command: RunPublishCommand,
	options: PublishOptions = {},
): RunProjection {
	const initial = requireRunJournal(runPath);
	if (publishDisposition(initial, command) === "completed") return initial.state;
	const owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
	let opened: RunAuthority | null = null;
	try {
		const snapshot = requireRunJournal(runPath);
		if (publishDisposition(snapshot, command) === "completed") return snapshot.state;
		// Open (or reuse) the reconciled authority boundary before any new work:
		// the restart reconcile ran when the store opened.
		if (!options.authority) opened = openRunAuthority(runPath);
		const authority = options.authority ?? (opened as RunAuthority);
		const journal = new VerifiedRunJournal(runPath, owner);
		return executePublish(runPath, snapshot, journal, command, options, authority);
	} finally {
		try {
			opened?.store.release();
		} finally {
			owner.release();
		}
	}
}

function executePublish(
	runPath: string,
	snapshot: JournalSnapshot,
	journal: VerifiedRunJournal,
	command: RunPublishCommand,
	options: PublishOptions,
	authority: RunAuthority,
): RunProjection {
	const first = snapshot.records[0]?.event;
	if (first?.kind !== "created") throw new VerifiedRunError("missing_run");
	const contract = first.contract;
	const state = snapshot.state;
	if (
		state.verification !== "verified" ||
		state.application !== "candidate_ready" ||
		state.settlement !== "settled" ||
		!state.receiptDigest ||
		!state.candidateDigest ||
		state.activeExecutionIds.length !== 0 ||
		state.writerOpen
	)
		throw new VerifiedRunError("unverified");
	if (
		command.candidateDigest !== state.candidateDigest ||
		command.receiptDigest !== state.receiptDigest ||
		command.policyDigest !== publishPolicyDigest(contract)
	)
		throw new VerifiedRunError("invalid_binding");
	// The gate never trusts command-carried receipt fields: reload the envelope and
	// re-verify HMAC, dispatch binding and proof closure before any Git write.
	const evidence = readRunEvidence(runPath, snapshot, commandEnvironmentDigest(contract, "gated-v1"));
	if (
		!evidence.verified ||
		evidence.candidateDigest !== state.candidateDigest ||
		evidence.receiptDigest !== state.receiptDigest
	)
		throw new VerifiedRunError("invalid_binding");
	const repoRoot = realpathSync(contract.workspace.root);
	assertGitWorkspaceRoot(repoRoot);
	const zero = zeroOid(repoObjectFormat(repoRoot));
	if (command.parentOid.length !== zero.length) throw new VerifiedRunError("invalid_binding");
	// Sealing reads only the stored, digest-verified blobs; a mutated workspace or
	// blob store fails integrity here instead of publishing different bytes.
	const candidate = loadCandidate(runPath, state.candidateDigest, contract.budget);
	const candidateOid = sealCandidateCommit(repoRoot, {
		manifest: candidate.manifest,
		contents: candidate.contents,
		parentOid: command.parentOid,
		zeroOid: zero,
		runId: contract.runId,
		candidateDigest: state.candidateDigest,
		receiptDigest: state.receiptDigest,
	});
	const resumed = state.publication === "intent" && state.publicationCommandId === command.commandId;
	// The ref interaction runs as an authority effect: a fresh commandId mints
	// a git-ref grant (a replayed one reuses the pending grant — commandIds
	// are unique across grants), effect-started binds it, and termination is
	// observed exactly once when the region exits. A crash in between leaves
	// a quarantined grant the next writer's reconcile settles.
	const refClaims = [
		{
			namespace: "git-ref",
			instanceId: "verified-run",
			canonicalKey: `omk-accepted-ref/${digestObject(repoRoot).slice(0, 16)}`,
			access: "write",
			generation: String(state.generation),
		},
	];
	const now = Date.now();
	const pending = authority.store.lookup(command.commandId, now);
	// A stored grant is not itself permission to start. An expired reservation
	// must not skip admission; a grant that already started keeps its binding.
	if (pending.status === "pending" && pending.token.authorizationDeadline <= now) {
		const stored = authority.store.state.grants.get(pending.token.grantSequence);
		if (!stored || stored.state === "reserved") throw new VerifiedRunError("authority");
	}
	const admission =
		pending.status === "pending"
			? { status: "granted" as const, token: pending.token }
			: authority.store.acquire({
					sessionId: authority.sessionId,
					incarnation: authority.incarnation,
					commandId: command.commandId,
					intentDigest: digestObject({
						candidateDigest: command.candidateDigest,
						parentOid: command.parentOid,
						receiptDigest: command.receiptDigest,
						policyDigest: command.policyDigest,
						targetRef: OMK_ACCEPTED_REF,
					}),
					claims: refClaims,
					now,
					ttl: 60000,
				});
	if (admission.status !== "granted") throw new VerifiedRunError("authority_blocked");
	const token: GrantToken = admission.token;
	try {
		if (pending.status !== "pending" && !authority.store.effectStarted(token, refClaims, undefined, now))
			throw new VerifiedRunError("authority");
		if (resumed) {
			if (state.publicationCandidateOid !== candidateOid) throw new VerifiedRunError("invalid_binding");
		} else {
			journal.append({
				kind: "publish_intent",
				commandId: command.commandId,
				candidateDigest: state.candidateDigest,
				candidateOid,
				parentOid: command.parentOid,
				targetRef: OMK_ACCEPTED_REF,
				receiptDigest: state.receiptDigest,
				policyDigest: command.policyDigest,
				generation: state.generation,
			});
		}
		const observed = resolveRef(repoRoot, OMK_ACCEPTED_REF);
		const matchesParent = observed === null ? command.parentOid === zero : observed === command.parentOid;
		if (observed === candidateOid) {
			// CAS already happened for this intent; only the durable result was lost.
			if (!objectExists(repoRoot, candidateOid)) {
				journal.append({ kind: "publish_failed", commandId: command.commandId, code: "reconciliation-required" });
			} else {
				journal.append({
					kind: "published",
					commandId: command.commandId,
					candidateOid,
					previousOid: command.parentOid,
				});
			}
			return journal.state;
		}
		if (!matchesParent) {
			// A third OID means another publisher won or the ref was moved by hand;
			// a fresh command is stale, a resuming one needs manual reconciliation.
			journal.append({
				kind: "publish_failed",
				commandId: command.commandId,
				code: resumed ? "reconciliation-required" : "stale-parent",
			});
			return journal.state;
		}
		try {
			casRef(repoRoot, OMK_ACCEPTED_REF, candidateOid, command.parentOid);
		} catch (error) {
			if (!(error instanceof GitRefCasError)) throw error;
			const after = resolveRef(repoRoot, OMK_ACCEPTED_REF);
			if (after === candidateOid && objectExists(repoRoot, candidateOid)) {
				journal.append({
					kind: "published",
					commandId: command.commandId,
					candidateOid,
					previousOid: command.parentOid,
				});
			} else {
				journal.append({
					kind: "publish_failed",
					commandId: command.commandId,
					code: after === observed ? "ref-rejected" : resumed ? "reconciliation-required" : "stale-parent",
				});
			}
			return journal.state;
		}
		options.afterCas?.();
		journal.append({
			kind: "published",
			commandId: command.commandId,
			candidateOid,
			previousOid: command.parentOid,
		});
		return journal.state;
	} finally {
		// The ref region is over: whether the CAS landed, was refused, or threw,
		// this effect is provably finished — witness its termination. A false
		// return means the grant was already settled (idempotent); a commit
		// failure propagates rather than settling in memory only.
		authority.store.confirmTerminated(token);
	}
}
