import type { ResourceClaimInput } from "../src/coordination/resource.ts";
import type { Sequence } from "../src/coordination/types.ts";
import type { SessionOwnerLease } from "../src/core/session-owner-lease.ts";
import { authorizationStillOpen } from "../src/core/verified-run/authority-meaning.ts";
import type { RunAuthority } from "../src/core/verified-run/authority-runtime.ts";
import { authorityStorePath } from "../src/core/verified-run/authority-store.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import type { VerifiedRunApproval } from "../src/core/verified-run/run-plan.ts";
import { parseApprovedRunStart } from "../src/core/verified-run/start-preflight.ts";
import {
	assertStateOutsideWorkspace,
	digestObject,
	stateRunPath,
	VerifiedRunError,
} from "../src/core/verified-run/storage.ts";

/** Trusted test host resources, never deserialized UI authority or a production state root. */
export interface StartAdmissionFixtureContext {
	readonly stateRoot: string;
	readonly owner: SessionOwnerLease;
	readonly authority: RunAuthority;
	readonly expectedEpoch: Sequence;
	readonly authorizationDeadline: number;
	readonly clock: () => number;
	readonly claims: readonly ResourceClaimInput[];
	readonly weight?: number;
}

/** Test-only admission diagnostic; its reservation is cancelled before any successful reply. */
export function admitStartWithoutExecution(
	input: unknown,
	request: unknown,
	approval: VerifiedRunApproval,
	context: StartAdmissionFixtureContext,
) {
	const { contract, command, contractDigest } = parseApprovedRunStart(input, request, approval);
	assertStateOutsideWorkspace(context.stateRoot, contract.workspace.root);
	const ownerPath = journalPath(stateRunPath(context.stateRoot, contract.runId));
	if (!context.owner.owns(ownerPath)) throw new VerifiedRunError("stale_owner");
	const { store, sessionId, incarnation } = context.authority;
	if (sessionId !== contract.runId || store.path !== authorityStorePath(context.stateRoot))
		throw new VerifiedRunError("command_conflict");
	if (context.expectedEpoch !== store.state.epoch) throw new VerifiedRunError("stale_epoch");
	if (store.pendingReconcile) throw new VerifiedRunError("reconcile_pending");
	if (
		[...store.state.grants.values()].some(
			(grant) => grant.token.sessionId === sessionId && grant.commandId !== command.commandId,
		)
	)
		throw new VerifiedRunError("command_conflict");
	const now = context.clock();
	if (!Number.isSafeInteger(context.authorizationDeadline) || context.authorizationDeadline < 0)
		throw new TypeError("authorizationDeadline must be a nonnegative safe integer");
	if (!authorizationStillOpen(now, context.authorizationDeadline)) throw new VerifiedRunError("authorization_expired");
	const capabilities = { execute: false, executionRequested: false, publish: false } as const;
	const resultDigest = digestObject({ kind: "h0-no-execution-admission", command, contractDigest, ...capabilities });
	const admissionInput = {
		sessionId,
		incarnation,
		commandId: command.commandId,
		intentDigest: digestObject({
			command,
			epoch: context.expectedEpoch,
			authorizationDeadline: context.authorizationDeadline,
		}),
		claims: context.claims,
		now,
		ttl: context.authorizationDeadline - now,
		...(context.weight === undefined ? {} : { weight: context.weight }),
	};
	const admission = store.acquire(admissionInput);
	if (admission.status === "blocked")
		return Object.freeze({ status: "blocked" as const, duplicate: false, resultDigest: null, ...capabilities });
	if (admission.status === "result-expired") throw new VerifiedRunError("outcome_unknown");
	const grant = store.state.grants.get(admission.token.grantSequence);
	if (
		!grant ||
		grant.effectLive ||
		grant.dispatchId !== null ||
		grant.identity !== null ||
		(grant.state !== "reserved" && grant.state !== "cancelled")
	)
		throw new VerifiedRunError("authority");
	if (admission.status === "result") {
		if (grant.state !== "cancelled" || admission.resultDigest !== resultDigest)
			throw new VerifiedRunError("integrity");
	} else {
		if (grant.state === "reserved" && !store.cancel(admission.token)) throw new VerifiedRunError("authority");
		store.retainResult(command.commandId, resultDigest, now, context.authorizationDeadline - now);
	}
	const confirmed = store.acquire(admissionInput);
	if (confirmed.status !== "result" || confirmed.resultDigest !== resultDigest)
		throw new VerifiedRunError("integrity");
	if (approval.signal?.aborted) throw new VerifiedRunError("cancelled");
	if (!context.owner.owns(ownerPath)) throw new VerifiedRunError("stale_owner");
	if (!authorizationStillOpen(context.clock(), context.authorizationDeadline))
		throw new VerifiedRunError("authorization_expired");
	return Object.freeze({
		status: "admitted" as const,
		duplicate: admission.status === "result" || admission.duplicate,
		resultDigest,
		...capabilities,
	});
}
