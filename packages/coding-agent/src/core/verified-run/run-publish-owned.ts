import { realpathSync } from "node:fs";
import type { RunPublishCommand } from "omk-protocol";
import { acquireSessionOwnerLeaseSync } from "../session-owner-lease.ts";
import { openRunAuthority, type RunAuthority } from "./authority-runtime.ts";
import { probeVerifiedSandbox } from "./broker.ts";
import { loadCandidate } from "./candidate.ts";
import { preflightGitCandidate } from "./git-candidate-preflight.ts";
import { executeOwnedGitPublication } from "./git-effect-supervisor.ts";
import { GitOperationBudget } from "./git-execution.ts";
import {
	assertGitWorkspaceRoot,
	OMK_ACCEPTED_REF,
	objectExists,
	repoObjectFormat,
	resolveRef,
	zeroOid,
} from "./git-plumbing.ts";
import { ownedGitDirectory } from "./git-sandbox-layout.ts";
import { loadGitWorkerRuntime } from "./git-worker-runtime.ts";
import { type JournalSnapshot, journalPath, VerifiedRunJournal } from "./journal.ts";
import { assertPublishable } from "./publish-preflight.ts";
import { requireRunJournal } from "./recovery-command.ts";
import { type PublishOptions, publishDisposition, recordPublished } from "./run-publish.ts";
import type { RunProjection } from "./run-types.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";
import { loadSupervisorBackend } from "./supervisor-adapter.ts";

/** SDK/CLI publisher. Unsupported supervision never falls back to the legacy synchronous writer. */
export async function publishVerifiedRunOwned(
	runPath: string,
	command: RunPublishCommand,
	options: PublishOptions = {},
): Promise<RunProjection> {
	const initial = requireRunJournal(runPath);
	if (publishDisposition(initial, command) === "completed") return initial.state;
	if (options.signal?.aborted) throw new VerifiedRunError("cancelled");
	const owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
	let opened: RunAuthority | null = null;
	let result: RunProjection | undefined;
	const failures: unknown[] = [];
	try {
		const snapshot = requireRunJournal(runPath);
		if (publishDisposition(snapshot, command) === "completed") result = snapshot.state;
		else {
			if (!options.authority) opened = openRunAuthority(runPath);
			const authority = options.authority ?? opened;
			if (!authority) throw new VerifiedRunError("authority");
			result = await executePublish(
				runPath,
				snapshot,
				new VerifiedRunJournal(runPath, owner),
				command,
				options,
				authority,
			);
		}
	} catch (error) {
		failures.push(error);
	}
	try {
		opened?.store.release();
	} catch (error) {
		failures.push(error);
	}
	try {
		owner.release();
	} catch (error) {
		failures.push(error);
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, "Publication owner cleanup failed");
	if (!result) throw new VerifiedRunError("integrity");
	return result;
}

async function executePublish(
	runPath: string,
	snapshot: JournalSnapshot,
	journal: VerifiedRunJournal,
	command: RunPublishCommand,
	options: PublishOptions,
	authority: RunAuthority,
): Promise<RunProjection> {
	const timeoutMs = options.timeoutMs ?? 60_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new VerifiedRunError("deadline");
	const deadlineNs = (process.hrtime.bigint() + BigInt(timeoutMs) * 1_000_000n).toString();
	const budget = new GitOperationBudget({ signal: options.signal, timeoutMs });
	budget.remaining();
	const { contract, state } = assertPublishable(snapshot, command, runPath);
	const repo = realpathSync(contract.workspace.root);
	assertGitWorkspaceRoot(repo, budget);
	const zero = zeroOid(repoObjectFormat(repo, budget));
	if (command.parentOid.length !== zero.length) throw new VerifiedRunError("invalid_binding");
	const resumed = state.publication === "intent" && state.publicationCommandId === command.commandId;
	if (resumed) {
		const oid = state.publicationCandidateOid;
		if (!oid) throw new VerifiedRunError("invalid_binding");
		const observed = resolveRef(repo, OMK_ACCEPTED_REF, budget);
		if (observed === oid && objectExists(repo, oid, budget)) return recordPublished(journal, command, oid);
		if ((observed ?? zero) !== command.parentOid)
			return journal.append({
				kind: "publish_failed",
				commandId: command.commandId,
				code: "reconciliation-required",
			});
	}
	loadSupervisorBackend();
	probeVerifiedSandbox();
	ownedGitDirectory(repo);
	const runtime = loadGitWorkerRuntime();
	const candidate = loadCandidate(runPath, state.candidateDigest, contract.budget);
	preflightGitCandidate(candidate.manifest, candidate.contents);
	budget.remaining();
	const claims = [
		{
			namespace: "git-ref",
			instanceId: "verified-run",
			canonicalKey: `omk-accepted-ref/${digestObject(repo).slice(0, 16)}`,
			access: "write",
			generation: String(state.generation),
		},
	];
	const admission = authority.store.acquire({
		sessionId: authority.sessionId,
		incarnation: authority.incarnation,
		commandId: command.commandId,
		intentDigest: digestObject({
			adapter: "owned-git-v1",
			runtimeDigest: runtime.digest,
			candidateDigest: command.candidateDigest,
			parentOid: command.parentOid,
			receiptDigest: command.receiptDigest,
			policyDigest: command.policyDigest,
			targetRef: OMK_ACCEPTED_REF,
		}),
		claims,
		now: Date.now(),
		ttl: timeoutMs + contract.budget.cleanupMs,
	});
	if (admission.status !== "granted") throw new VerifiedRunError("authority_blocked");
	try {
		const result = await executeOwnedGitPublication({
			workspace: repo,
			runtime,
			authority,
			token: admission.token,
			claims,
			budget,
			deadlineNs,
			cleanupMs: contract.budget.cleanupMs,
			signal: options.signal,
			afterCas: options.afterCas,
			input: {
				manifest: candidate.manifest,
				contents: candidate.contents,
				parentOid: command.parentOid,
				zeroOid: zero,
				runId: contract.runId,
				candidateDigest: state.candidateDigest,
				receiptDigest: state.receiptDigest,
			},
			onPrepared: (candidateOid) => {
				if (resumed) {
					if (state.publicationCandidateOid !== candidateOid) throw new VerifiedRunError("invalid_binding");
				} else
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
			},
		});
		const observed = resolveRef(repo, OMK_ACCEPTED_REF);
		if (observed === result.candidateOid && objectExists(repo, result.candidateOid))
			return recordPublished(journal, command, result.candidateOid);
		return journal.append({
			kind: "publish_failed",
			commandId: command.commandId,
			code:
				(observed ?? zero) === command.parentOid
					? "ref-rejected"
					: resumed
						? "reconciliation-required"
						: "stale-parent",
		});
	} catch (error) {
		const grant = authority.store.state.grants.get(admission.token.grantSequence);
		try {
			if (grant?.state === "reserved") authority.store.cancel(admission.token);
			if (
				grant?.state === "terminated" &&
				journal.state.publication === "intent" &&
				error instanceof VerifiedRunError &&
				["cancelled", "deadline"].includes(error.code) &&
				resolveRef(repo, OMK_ACCEPTED_REF) !== journal.state.publicationCandidateOid
			)
				journal.append({ kind: "publish_failed", commandId: command.commandId, code: "reconciliation-required" });
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "Publication failure could not be recorded");
		}
		throw error;
	}
}
