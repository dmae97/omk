import { MAX_VERIFIED_RUN_GENERATIONS } from "omk-protocol";
import { SETTLED_EFFECT_STATES } from "../../coordination/types.ts";
import type { AuthorityEvent, AuthorityGrantRecord, AuthorityProjection } from "./authority-events.ts";
import { authorityPendingReconcile } from "./authority-events.ts";
import type { RunProjection } from "./run-types.ts";

/**
 * Derived lifecycle/recovery status surfaces (WP06).
 *
 * Everything here is a pure function of the replayed journals: the run
 * projection and the authority projection/records are the single source of
 * truth, and this module never invents parallel status strings — `lifecycle`
 * and `completion` are named projections of the same facts the axes already
 * report (`execution`, `settlement`, `verification`, `application`,
 * `publication`, `failure`, grant states and transition events).
 *
 * Separations the surface guarantees (docs/03, docs/12 WP06):
 *   - cancellation requested vs terminated: an authority grant that got
 *     `cancel-requested` with a live effect stays `quarantined` and keeps its
 *     claims until `termination-observed` witnesses it;
 *   - prompt settled vs verified vs published: `completion` is a three-tier
 *     ladder (`prompt_settled` < `verification_passed` < `published`) derived
 *     from candidate/receipt/publication facts, never from prose;
 *   - accepted vs published: `lifecycle: "accepted"` is the verified,
 *     publishable state; `published` requires the CAS result record;
 *   - recovery/unknown states vs clean success: `cleanSuccess` is true only
 *     for a terminal run with an empty `unresolved` list — quarantine,
 *     unverified termination, a refused or half-published outbox entry and a
 *     violated check set all stay visible instead of collapsing into success.
 */

/** Single-token lifecycle derived from the run axes; snake_case matches the projection vocabulary. */
export type RunLifecycle =
	| "queued"
	| "running"
	| "verifying"
	| "resuming"
	| "blocked"
	| "accepted"
	| "published"
	| "violated"
	| "cancelled"
	| "failed"
	| "quarantined";

/** User-visible completion ladder: prompt-settled < verification-passed < published (docs/03 §10). */
export type RunCompletion = "none" | "prompt_settled" | "verification_passed" | "published";

/** Machine-collected open concerns; a clean terminal run carries none. */
export type RunUnresolved =
	| "pending_effects"
	| "verification_pending"
	| "verification_violated"
	| "publication_intent"
	| "publication_refused"
	| "publication_reconciliation_required";

export interface RunRecoveryCommand {
	/** The recovery CLI verb to run. */
	readonly command: "resume" | "retry_tasks" | "restart_writer" | "publish";
	/** Exact target identity the command must name. */
	readonly runId: string;
	readonly revision: number;
	readonly generation: number;
	/** Scope: candidate/base digests or task ids the command binds. */
	readonly scope: {
		readonly candidateDigest?: string;
		readonly baseDigest?: string;
		readonly taskIds?: readonly string[];
	};
	/**
	 * Projection-level eligibility only — deadline, clock and namespace
	 * readiness are host-checked by `inspectRecovery`/`inspectWriterRecovery`/
	 * `inspectTaskRecovery`; this hint never claims the command will succeed.
	 */
	readonly advisory: true;
}

export interface RunStatus {
	readonly runId: string;
	readonly revision: number;
	readonly generation: number;
	readonly lifecycle: RunLifecycle;
	readonly completion: RunCompletion;
	/** True only for a terminal run that reached verification_passed/published with zero unresolved concerns. */
	readonly cleanSuccess: boolean;
	readonly terminal: boolean;
	readonly unresolved: readonly RunUnresolved[];
	/** Verbatim axes, same strings the journal projection computes. */
	readonly execution: RunProjection["execution"];
	readonly settlement: RunProjection["settlement"];
	readonly verification: RunProjection["verification"];
	readonly application: RunProjection["application"];
	readonly publication: {
		readonly state: RunProjection["publication"];
		readonly commandId: string | null;
		readonly candidateOid: string | null;
		readonly ref: string | null;
		readonly failure: string | null;
	};
	/** Failure code as recorded (`descendant_escape`, `termination_unverified`, `cancelled`, …). */
	readonly cause: string | null;
	readonly pendingEffects: number;
	readonly writerOpen: boolean;
	readonly recovery: RunProjection["lastRecovery"];
	readonly recoveryCommands: readonly RunRecoveryCommand[];
}

/** Derive the status view; pure projection truth in, status out, no I/O. */
export function deriveRunStatus(state: RunProjection): RunStatus {
	const unresolved: RunUnresolved[] = [];
	if (state.activeExecutionIds.length > 0 || state.writerOpen) unresolved.push("pending_effects");
	if (state.candidateDigest && !state.receiptDigest && state.execution !== "failed" && state.execution !== "ready")
		unresolved.push("verification_pending");
	if (state.verification === "violated") unresolved.push("verification_violated");
	if (state.publication === "intent") unresolved.push("publication_intent");
	if (state.publication === "failed") unresolved.push("publication_refused");
	if (state.publication === "reconciliation_required") unresolved.push("publication_reconciliation_required");

	const completion: RunCompletion =
		state.publication === "accepted"
			? "published"
			: state.verification === "verified"
				? "verification_passed"
				: state.candidateDigest
					? "prompt_settled"
					: "none";

	const terminal = state.execution === "succeeded" || state.execution === "failed";
	let lifecycle: RunLifecycle;
	if (state.settlement === "quarantined") lifecycle = "quarantined";
	else if (state.execution === "ready") lifecycle = "queued";
	else if (state.execution === "running") {
		if (state.lastRecovery && state.lastRecovery.generation === state.generation) lifecycle = "resuming";
		else if (state.candidateDigest && !state.receiptDigest) lifecycle = "verifying";
		else lifecycle = "running";
	} else if (state.execution === "paused") lifecycle = "blocked";
	else if (state.execution === "failed") lifecycle = state.failure === "cancelled" ? "cancelled" : "failed";
	else if (state.verification === "verified") lifecycle = state.publication === "accepted" ? "published" : "accepted";
	else lifecycle = "violated";

	return Object.freeze({
		runId: state.runId,
		revision: state.revision,
		generation: state.generation,
		lifecycle,
		completion,
		// Clean success means the verification ladder actually climbed: a
		// terminal cancel/failure/violation, or a verified run with an open
		// publish outbox, never reports clean.
		cleanSuccess:
			terminal && unresolved.length === 0 && (completion === "verification_passed" || completion === "published"),
		terminal,
		unresolved: Object.freeze(unresolved),
		execution: state.execution,
		settlement: state.settlement,
		verification: state.verification,
		application: state.application,
		publication: Object.freeze({
			state: state.publication,
			commandId: state.publicationCommandId,
			candidateOid: state.publicationCandidateOid,
			ref: state.publicationRef,
			failure: state.publicationFailure,
		}),
		cause: state.failure,
		pendingEffects: state.activeExecutionIds.length,
		writerOpen: state.writerOpen,
		recovery: state.lastRecovery,
		recoveryCommands: Object.freeze(recoveryCommands(state)),
	});
}

function recoveryCommands(state: RunProjection): RunRecoveryCommand[] {
	const commands: RunRecoveryCommand[] = [];
	if (state.generation >= MAX_VERIFIED_RUN_GENERATIONS) return commands;
	const base = { runId: state.runId, revision: state.revision, generation: state.generation } as const;
	// A frozen candidate can be re-verified under a new generation (resume gate
	// mirrors `assertCandidateRecoverable`: candidate, no receipt, not failed).
	if (
		state.candidateDigest &&
		!state.receiptDigest &&
		!state.writerOpen &&
		state.execution !== "failed" &&
		state.execution !== "ready"
	) {
		commands.push({
			...base,
			command: "resume",
			scope: { candidateDigest: state.candidateDigest },
			advisory: true,
		});
	}
	// DAG tasks can be retried from the input checkpoint (retry gate mirrors
	// `commandDisposition`: input checkpoint present, tasks exist).
	if (state.inputDigest && state.tasks.length > 0) {
		const failed = state.tasks
			.filter((task) => task.status === "failed" || (task.status === "pending" && task.attempt > 0))
			.map((task) => task.taskId);
		if (failed.length > 0) {
			commands.push({
				...base,
				command: "retry_tasks",
				scope: { baseDigest: state.inputDigest, taskIds: Object.freeze(failed) },
				advisory: true,
			});
		}
	}
	// A writer that never produced a candidate restarts from the input
	// checkpoint (non-DAG profiles only; DAG recovery is retry_tasks).
	if (state.inputDigest && !state.candidateDigest && state.tasks.length === 0 && state.execution !== "ready") {
		commands.push({
			...base,
			command: "restart_writer",
			scope: { baseDigest: state.inputDigest },
			advisory: true,
		});
	}
	// The publish outbox: a verified, settled run can publish; a refused or
	// half-published intent is re-driven by the same command identity.
	if (
		state.application === "candidate_ready" &&
		state.settlement === "settled" &&
		state.receiptDigest &&
		state.candidateDigest &&
		(state.publication === "none" || state.publication === "failed" || state.publication === "intent")
	) {
		commands.push({
			...base,
			command: "publish",
			scope: { candidateDigest: state.candidateDigest },
			advisory: true,
		});
	}
	return commands;
}

export type AuthorityGrantCause = "cancel_requested" | "authorization_expired" | "restart_unreconciled" | "unwitnessed";

export interface AuthorityGrantStatus {
	readonly grantSequence: string;
	readonly sessionId: string;
	readonly sessionIncarnation: string;
	readonly authorityEpoch: string;
	readonly commandId: string;
	readonly intentDigest: string;
	/** Verbatim grant state — the authority projection's own vocabulary. */
	readonly state: AuthorityGrantRecord["state"];
	readonly effectLive: boolean;
	/** Claims this grant still holds — what it blocks, with exact scope. */
	readonly claims: readonly {
		readonly namespace: string;
		readonly instanceId: string;
		readonly canonicalKey: string;
		readonly access: string;
		readonly generation: string;
	}[];
	readonly weight: number;
	readonly dispatchId: string | null;
	readonly authorizationDeadline: number;
	/** Why the grant is in this state; null when records were not supplied. */
	readonly cause: AuthorityGrantCause | null;
	/**
	 * Cancellation requested vs terminated: true only when a
	 * `termination-observed` record witnessed this exact grant.
	 */
	readonly terminationWitnessed: boolean;
}

export interface AuthorityStatus {
	readonly epoch: string | null;
	readonly reconciledEpoch: string | null;
	readonly pendingReconcile: boolean;
	/** Grants still holding claims — what is blocking new admission. */
	readonly blockingGrants: readonly AuthorityGrantStatus[];
	readonly settledGrantCount: number;
	readonly tombstoneCount: number;
	readonly incarnations: readonly { readonly sessionId: string; readonly incarnation: string }[];
}

/**
 * Derive the authority status from the committed projection; pass the journal
 * records' events so quarantine/cancel causes stay distinguishable — the
 * projection alone intentionally does not restate them.
 */
export function deriveAuthorityStatus(
	projection: AuthorityProjection,
	events: readonly AuthorityEvent[] = [],
): AuthorityStatus {
	const transitionOf = (grantSequence: string): AuthorityGrantCause | null => {
		for (let index = events.length - 1; index >= 0; index--) {
			const event = events[index]!;
			if (event.kind === "cancel-requested" && event.grantSequence === grantSequence) return "cancel_requested";
			if (event.kind === "authorization-expired" && event.grantSequence === grantSequence)
				return "authorization_expired";
			if (event.kind === "quarantined" && event.grantSequence === grantSequence) return "restart_unreconciled";
			if (
				event.kind === "authority-epoch-advanced" &&
				event.transitions.some((transition) => transition.grantSequence === grantSequence)
			)
				return "restart_unreconciled";
		}
		return null;
	};
	const witnessed = new Set(
		events.flatMap((event) => (event.kind === "termination-observed" ? [event.grantSequence] : [])),
	);
	const grants = [...projection.grants.values()];
	const blocking = grants.filter((grant) => !SETTLED_EFFECT_STATES.has(grant.state));
	return Object.freeze({
		epoch: projection.epoch,
		reconciledEpoch: projection.reconciledEpoch,
		pendingReconcile: authorityPendingReconcile(projection),
		blockingGrants: Object.freeze(
			blocking.map((grant) =>
				Object.freeze({
					grantSequence: grant.token.grantSequence,
					sessionId: grant.token.sessionId,
					sessionIncarnation: grant.token.sessionIncarnation,
					authorityEpoch: grant.token.authorityEpoch,
					commandId: grant.commandId,
					intentDigest: grant.intentDigest,
					state: grant.state,
					effectLive: grant.effectLive,
					claims: Object.freeze(
						grant.claims.map((claim) =>
							Object.freeze({
								namespace: claim.namespace,
								instanceId: claim.instanceId,
								canonicalKey: claim.canonicalKey,
								access: claim.access,
								generation: claim.generation,
							}),
						),
					),
					weight: grant.weight,
					dispatchId: grant.dispatchId,
					authorizationDeadline: grant.token.authorizationDeadline,
					cause: grant.state === "quarantined" ? (transitionOf(grant.token.grantSequence) ?? "unwitnessed") : null,
					terminationWitnessed: witnessed.has(grant.token.grantSequence),
				}),
			),
		),
		settledGrantCount: grants.length - blocking.length,
		tombstoneCount: projection.tombstones.size,
		incarnations: Object.freeze(
			[...projection.incarnations.entries()].map(([sessionId, incarnation]) =>
				Object.freeze({ sessionId, incarnation }),
			),
		),
	});
}
