import { realpathSync } from "node:fs";
import type { RunPublishCommand } from "omk-protocol";
import { acquireSessionOwnerLeaseSync } from "../session-owner-lease.ts";
import { openRunAuthority, type RunAuthority } from "./authority-runtime.ts";
import { loadCandidate } from "./candidate.ts";
import { GitOperationBudget } from "./git-execution.ts";
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
import { assertPublishable } from "./publish-preflight.ts";
import { assertPublishEffectStart } from "./publish-start.ts";
import { requireRunJournal } from "./recovery-command.ts";
import type { RunEvent, RunProjection } from "./run-types.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";
export { OMK_ACCEPTED_REF };
export { publishPolicyDigest } from "./publish-preflight.ts";

type PublishIntent = Extract<RunEvent, { kind: "publish_intent" }>;
function openPublishIntents(journal: JournalSnapshot): readonly PublishIntent[] {
	return journal.records.flatMap(({ event }) => (event.kind === "publish_intent" ? [event] : []));
}
function terminalFor(journal: JournalSnapshot, commandId: string): boolean {
	return journal.records.some(
		({ event }) => (event.kind === "published" || event.kind === "publish_failed") && event.commandId === commandId,
	);
}
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
	/** Fault injection after a successful CAS, before the result record. */
	readonly afterCas?: () => void;
	readonly signal?: AbortSignal;
	/** One monotonic deadline shared by all Git writes, never replenished per file. */
	readonly timeoutMs?: number;
	readonly authority?: RunAuthority;
}

export function publishVerifiedRun(
	runPath: string,
	command: RunPublishCommand,
	options: PublishOptions = {},
): RunProjection {
	const initial = requireRunJournal(runPath);
	if (publishDisposition(initial, command) === "completed") return initial.state;
	if (options.signal?.aborted) throw new VerifiedRunError("cancelled");
	const owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
	let opened: RunAuthority | null = null;
	try {
		const snapshot = requireRunJournal(runPath);
		if (publishDisposition(snapshot, command) === "completed") return snapshot.state;
		if (!options.authority) opened = openRunAuthority(runPath);
		const authority = options.authority ?? opened;
		if (!authority) throw new VerifiedRunError("authority");
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

function recordPublished(journal: VerifiedRunJournal, command: RunPublishCommand, candidateOid: string): RunProjection {
	return journal.append({
		kind: "published",
		commandId: command.commandId,
		candidateOid,
		previousOid: command.parentOid,
	});
}

function executePublish(
	runPath: string,
	snapshot: JournalSnapshot,
	journal: VerifiedRunJournal,
	command: RunPublishCommand,
	options: PublishOptions,
	authority: RunAuthority,
): RunProjection {
	const budget = new GitOperationBudget({ signal: options.signal, timeoutMs: options.timeoutMs ?? 60_000 });
	budget.remaining();
	const { contract, state } = assertPublishable(snapshot, command, runPath);
	const repoRoot = realpathSync(contract.workspace.root);
	assertGitWorkspaceRoot(repoRoot, budget);
	const zero = zeroOid(repoObjectFormat(repoRoot, budget));
	if (command.parentOid.length !== zero.length) throw new VerifiedRunError("invalid_binding");
	const resumed = state.publication === "intent" && state.publicationCommandId === command.commandId;
	// Recovery observes the existing ref; it does not restart a terminal/unknown effect.
	if (resumed) {
		const sealed = state.publicationCandidateOid;
		if (!sealed) throw new VerifiedRunError("invalid_binding");
		const observed = resolveRef(repoRoot, OMK_ACCEPTED_REF, budget);
		if (observed === sealed && objectExists(repoRoot, sealed, budget))
			return recordPublished(journal, command, sealed);
		if ((observed ?? zero) !== command.parentOid)
			return journal.append({
				kind: "publish_failed",
				commandId: command.commandId,
				code: "reconciliation-required",
			});
	}
	budget.remaining();
	const refClaims = [
		{
			namespace: "git-ref",
			instanceId: "verified-run",
			canonicalKey: `omk-accepted-ref/${digestObject(repoRoot).slice(0, 16)}`,
			access: "write",
			generation: String(state.generation),
		},
	];
	const admission = authority.store.acquire({
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
		now: Date.now(),
		ttl: 60_000,
	});
	if (admission.status !== "granted") throw new VerifiedRunError("authority_blocked");
	const token = admission.token;
	// Failure here must not settle somebody else's running/quarantined grant.
	assertPublishEffectStart(authority.store, token, refClaims, admission.duplicate);
	let uncertain = false;
	try {
		budget.remaining();
		const candidate = loadCandidate(runPath, state.candidateDigest, contract.budget);
		const candidateOid = sealCandidateCommit(
			repoRoot,
			{
				manifest: candidate.manifest,
				contents: candidate.contents,
				parentOid: command.parentOid,
				zeroOid: zero,
				runId: contract.runId,
				candidateDigest: state.candidateDigest,
				receiptDigest: state.receiptDigest,
			},
			budget,
		);
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
		const observed = resolveRef(repoRoot, OMK_ACCEPTED_REF, budget);
		if (observed === candidateOid && objectExists(repoRoot, candidateOid, budget))
			return recordPublished(journal, command, candidateOid);
		if ((observed ?? zero) !== command.parentOid)
			return journal.append({
				kind: "publish_failed",
				commandId: command.commandId,
				code: resumed ? "reconciliation-required" : "stale-parent",
			});
		budget.remaining();
		if (!authority.store.effectAuthorized(token, refClaims)) throw new VerifiedRunError("authority");
		try {
			casRef(repoRoot, OMK_ACCEPTED_REF, candidateOid, command.parentOid, budget);
		} catch (error) {
			if (!(error instanceof GitRefCasError)) throw error;
			const recoveryBudget = new GitOperationBudget({ timeoutMs: 5_000 });
			const after = resolveRef(repoRoot, OMK_ACCEPTED_REF, recoveryBudget);
			if (after === candidateOid && objectExists(repoRoot, candidateOid, recoveryBudget))
				return recordPublished(journal, command, candidateOid);
			return journal.append({
				kind: "publish_failed",
				commandId: command.commandId,
				code: after === observed ? "ref-rejected" : resumed ? "reconciliation-required" : "stale-parent",
			});
		}
		// Once CAS succeeded, cancellation must not undo the committed publication.
		options.afterCas?.();
		return recordPublished(journal, command, candidateOid);
	} catch (error) {
		uncertain = error instanceof VerifiedRunError && error.code === "git_outcome_unknown";
		throw error;
	} finally {
		if (uncertain) authority.store.cancel(token);
		else authority.store.confirmTerminated(token);
	}
}
