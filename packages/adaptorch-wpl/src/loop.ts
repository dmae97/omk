/**
 * Verdict-to-disposition integration layer (Part 3, `final-part3-integration.md`).
 *
 * This file implements exactly the bridge Part 3 defines between Part 1 (core algorithm,
 * `final-part1-core-algorithm.md`) and Part 2 (verification layer,
 * `final-part2-verification-layer.md`): projecting Part 2's five-state record-level
 * `AdjudicationResult.verdict` onto Part 1's packet disposition vocabulary, and the two
 * distinct failure-handling paths (`VERIFIER-ERROR` vs. `ADJUDICATION_FAILED`) Part 3's
 * "VERIFIER-ERROR vs. ADJUDICATION_FAILED" section keeps separate.
 *
 * What is implemented here (Part 3 §1, §2 note, §3 note):
 *  - {@link projectVerdictToDisposition} - Part 3 §1's mapping table from a *returned*
 *    `AdjudicationResult` to a `{ targetState, nextActionKind }` disposition.
 *  - {@link runAdjudicationWithTimeout} - the timeout/try-catch wrapper around `adjudicate()`
 *    itself (Part 1 §2 state 9 / Part 3's "ADJUDICATION_FAILED" trigger condition), so a hung
 *    or throwing `adjudicate()` call never escapes uncaught and never produces a verdict to
 *    project in the first place.
 *  - {@link decideNextTransition} - the `DECLINED -> {RETRY_QUEUED | CLOSED | ESCALATED}`
 *    branch (Part 1 §2/§4, Part 3 §1), keyed on the per-packet attempt budget.
 *  - {@link handleAdjudicationFailure} - the `ADJUDICATION_FAILED -> {UNDER_REVIEW |
 *    ESCALATED}` branch (Part 1 §2 state 9), keyed on a *separate* bounded adjudication-call
 *    retry counter, never the packet's attempt/dispatch budget.
 *
 * What is explicitly out of scope for this file, per the design docs' own module boundaries
 * (Part 1's introduction puts the integration boundary itself out of its scope; Part 3 §2
 * assigns request assembly to the core-algorithm/loop side as an already-specified
 * responsibility distinct from this projection):
 *  - The end-to-end AdaptOrch dispatch loop: `DRAFTED -> ROUTED -> AWAITING_APPROVAL ->
 *    DISPATCHED -> ACTIVE`, topology routing, actual `adaptorch_run` submission, and polling
 *    via `adaptorch_get_run`/reconciliation sweeps.
 *  - Assembling an `AdjudicationRequest` from a Work Packet's `dispatch_records[]` (Part 3
 *    §2's "one minor shape note") - callers of {@link runAdjudicationWithTimeout} supply an
 *    already-built `AdjudicationRequest`.
 *  - The on-disk persistence layer (`packet_index.json`, `run_map.json`, `loop_state.json`,
 *    the `adjudications/` archive, Part 1 §7) - the functions here are pure/async-pure and
 *    return decisions; they do not read or write any of those files themselves.
 */

import type { AdaptOrchClient } from "./adaptorch-client.ts";
import type { AdjudicationRequest, AdjudicationResult } from "./adjudicator.ts";
import { adjudicate } from "./adjudicator.ts";
import type { AdjudicationReasonCode, VerifierRegistryEntry } from "./adjudicator-registry.ts";
import type { WorkPacket, WorkPacketState } from "./types.ts";

/**
 * How a `CONTRADICTED` verdict with a given reason code is dispositioned (Part 3 §1's
 * three CONTRADICTED rows). Kept as a named class so {@link CONTRADICTED_DISPOSITION_CLASS}
 * stays a *total* mapping over {@link AdjudicationReasonCode}.
 */
type ContradictedDispositionClass = "escalate" | "reroute_on_recurrence" | "retry_same_topology";

/**
 * Total mapping from every {@link AdjudicationReasonCode} to its CONTRADICTED disposition
 * class. Totality is compile-time enforced: adding a new reason code without classifying
 * it here is a type error, so a new code can never silently fall into an unintended
 * disposition. Codes that cannot in practice accompany a `CONTRADICTED` verdict (e.g.
 * `ALL_CHECKS_PASSED`, `RUN_NOT_TERMINAL`) still need a row; they take the conservative
 * default (`retry_same_topology`).
 */
const CONTRADICTED_DISPOSITION_CLASS: Record<AdjudicationReasonCode, ContradictedDispositionClass> = {
	// Part 3 §1: a scope violation is a safety signal that must never silently auto-retry.
	SCOPE_VIOLATION: "escalate",
	// Part 3 §1: recurring schema/shape drift means the topology/plan template itself may be
	// structurally wrong for the payload - reroute instead of retrying the same topology.
	SCHEMA_DRIFT: "reroute_on_recurrence",
	CONTENT_CHECK_FAILED: "reroute_on_recurrence",
	// Default CONTRADICTED row: same-topology retry (subject to the attempt budget).
	NO_EVIDENCE_ON_SUCCESS: "retry_same_topology",
	EMPTY_ARTIFACT_CONTENT: "retry_same_topology",
	TRACE_CHECK_FAILED: "retry_same_topology",
	TRACE_ERROR_SPAN: "retry_same_topology",
	MIN_ACTIONS_UNMET: "retry_same_topology",
	RUN_STATUS_UNPARSEABLE: "retry_same_topology",
	RUN_FETCH_FAILED: "retry_same_topology",
	MALFORMED_REQUEST: "retry_same_topology",
	RUN_NOT_TERMINAL: "retry_same_topology",
	EVIDENCE_EMPTY: "retry_same_topology",
	FAILURE_REPORTED: "retry_same_topology",
	ALL_CHECKS_PASSED: "retry_same_topology",
};

/**
 * Part 1 §6's `next_action` vocabulary, restricted to the values Part 3 §1's projection
 * table actually produces (`'none'` covers the `CONFIRMED` row, which carries no
 * `next_action` of its own).
 */
export type NextActionKind = "retry_same_topology" | "reroute" | "escalate" | "none";

/**
 * The projected disposition for a single record-level `AdjudicationResult` (Part 3 §1):
 * the Part 1 §2 state the packet should move towards, and which further-attempt behavior
 * (if any) that implies.
 */
export interface VerdictDisposition {
	targetState: WorkPacketState;
	nextActionKind: NextActionKind;
}

/**
 * Projects a Part 2 record-level {@link AdjudicationResult} onto a Part 1 packet
 * disposition, per Part 3 §1's mapping table exactly:
 *
 * | verdict | condition | targetState | nextActionKind |
 * |---|---|---|---|
 * | `CONFIRMED` | - | `CONFIRMED` | `none` |
 * | `CORROBORATED-FAILURE` | - | `DECLINED` | `retry_same_topology` |
 * | `CONTRADICTED` | `reason_code` = `SCOPE_VIOLATION` | `DECLINED` | `escalate` |
 * | `CONTRADICTED` | `reason_code` ∈ {`SCHEMA_DRIFT`, `CONTENT_CHECK_FAILED`} AND `packet.retry_count >= 1` | `DECLINED` | `reroute` |
 * | `CONTRADICTED` | any other `reason_code` | `DECLINED` | `retry_same_topology` |
 * | `INDETERMINATE` | - | `DECLINED` | `escalate` |
 * | `VERIFIER-ERROR` | - | `DECLINED` | `escalate` |
 *
 * Branching is driven exclusively by the structured `reason_code`
 * ({@link CONTRADICTED_DISPOSITION_CLASS}); the free-text `reason` is never inspected, so
 * incidental wording in a check's human-readable explanation (e.g. "scoped variable")
 * can neither trigger a false escalation nor mask a real one.
 *
 * `VERIFIER-ERROR` vs. `ADJUDICATION_FAILED` (Part 3's dedicated section, restated here
 * because callers of this function must not conflate the two): `VERIFIER-ERROR` is a verdict
 * the OA *returned normally* - `adjudicate()` completed, produced a full
 * {@link AdjudicationResult}, and that result's own content says the OA's checks could not be
 * trusted for this record. This function only ever runs on such a completed result, so it
 * only ever needs to route `VERIFIER-ERROR` to `escalate` - never to a retry, and never
 * through `ADJUDICATION_FAILED`. `ADJUDICATION_FAILED` (Part 1 §2 state 9), by contrast, is
 * not a verdict at all: it is what happens when `adjudicate()` itself throws or times out and
 * *never returns a verdict in the first place* - there is no `AdjudicationResult` for this
 * function to project, because the mapping's input does not exist. That case is handled
 * separately by {@link runAdjudicationWithTimeout} (detecting the failure) and
 * {@link handleAdjudicationFailure} (deciding the packet's next state), never by this
 * function.
 *
 * Declared `async` for interface consistency with the rest of the verdict-handling pipeline
 * (all of whose other entry points are asynchronous); the projection logic itself is pure and
 * synchronous.
 */
export async function projectVerdictToDisposition(
	result: AdjudicationResult,
	packet: WorkPacket,
): Promise<VerdictDisposition> {
	switch (result.verdict) {
		case "CONFIRMED":
			return { targetState: "CONFIRMED", nextActionKind: "none" };

		case "CORROBORATED-FAILURE":
			return { targetState: "DECLINED", nextActionKind: "retry_same_topology" };

		case "CONTRADICTED": {
			const dispositionClass = CONTRADICTED_DISPOSITION_CLASS[result.reason_code];
			switch (dispositionClass) {
				case "escalate":
					return { targetState: "DECLINED", nextActionKind: "escalate" };
				case "reroute_on_recurrence":
					// "Recurring" is approximated as "this packet has already had at least
					// one prior dispatch attempt" (packet.retry_count >= 1), per Part 3 §1's
					// "recurring across >= 2 attempts for this packet" condition. A first
					// occurrence still takes the default same-topology retry.
					if (packet.retry_count >= 1) {
						return { targetState: "DECLINED", nextActionKind: "reroute" };
					}
					return { targetState: "DECLINED", nextActionKind: "retry_same_topology" };
				case "retry_same_topology":
					return { targetState: "DECLINED", nextActionKind: "retry_same_topology" };
				default: {
					const exhaustive: never = dispositionClass;
					throw new Error(`unhandled CONTRADICTED disposition class: ${String(exhaustive)}`);
				}
			}
		}

		case "INDETERMINATE":
			return { targetState: "DECLINED", nextActionKind: "escalate" };

		case "VERIFIER-ERROR":
			// Hard rule, not a default: VERIFIER-ERROR must never be
			// retry_same_topology or reroute. See the VERIFIER-ERROR vs.
			// ADJUDICATION_FAILED discussion above.
			return { targetState: "DECLINED", nextActionKind: "escalate" };
	}
}

/**
 * Runs `adjudicate()` under both a timeout and a try/catch, per Part 1 §2 state 9 / Part 3's
 * "ADJUDICATION_FAILED" trigger condition. Returns `{ ok: true, result }` when `adjudicate()`
 * returns a verdict within `timeoutMs`; returns `{ ok: false, error }` if it throws, rejects,
 * or does not settle before the timeout - this is the ADJUDICATION_FAILED condition, and the
 * only way this function reports failure. It never lets a hung or throwing `adjudicate()`
 * call escape uncaught.
 *
 * Note the distinction from {@link projectVerdictToDisposition}'s `VERIFIER-ERROR` handling:
 * a `VERIFIER-ERROR` result here still comes back as `{ ok: true, result }` (a verdict was
 * produced), and must be routed through `projectVerdictToDisposition`, not through
 * {@link handleAdjudicationFailure}.
 */
export async function runAdjudicationWithTimeout(
	request: AdjudicationRequest,
	client: AdaptOrchClient,
	registry: { get(kind: string): VerifierRegistryEntry },
	timeoutMs: number,
): Promise<{ ok: true; result: AdjudicationResult } | { ok: false; error: string }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const result = await Promise.race([
			adjudicate(request, client, registry),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					reject(new Error(`adjudicate() call timed out after ${timeoutMs}ms`));
				}, timeoutMs);
			}),
		]);
		return { ok: true, result };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/**
 * Decides the packet's next state given an already-projected {@link VerdictDisposition}
 * (Part 1 §2/§4, Part 3 §1's `DECLINED -> {RETRY_QUEUED | CLOSED | ESCALATED}` branch). Pure
 * and side-effect free; does not itself call {@link applyTransition} from
 * `state-machine.ts` - callers apply the returned state via that function.
 *
 * - `nextActionKind === 'escalate'` always wins, regardless of remaining budget (Part 3 §1:
 *   escalation "takes priority over the attempt-budget check below, regardless of whether
 *   budget remains").
 * - `targetState === 'CONFIRMED'` returns `'CONFIRMED'` directly; the caller is responsible
 *   for the separate `CONFIRMED -> CLOSED` transition (Part 1's success-close path), which is
 *   not this function's concern.
 * - Otherwise (`retry_same_topology` or `reroute`), the per-packet attempt budget (Part 1 §4)
 *   decides between `RETRY_QUEUED` (budget remains) and `CLOSED` (budget exhausted -
 *   abandoned).
 */
export function decideNextTransition(packet: WorkPacket, disposition: VerdictDisposition): WorkPacketState {
	if (disposition.nextActionKind === "escalate") {
		return "ESCALATED";
	}

	if (disposition.targetState === "CONFIRMED") {
		return "CONFIRMED";
	}

	return packet.retry_count < packet.attempt_budget.max_dispatch_attempts ? "RETRY_QUEUED" : "CLOSED";
}

/**
 * Decides the packet's next state after an `ADJUDICATION_FAILED` outcome (Part 1 §2 state 9;
 * see {@link runAdjudicationWithTimeout} for how that outcome is detected). This is the
 * *other* failure surface from `VERIFIER-ERROR` - there is no `AdjudicationResult` here, so
 * this function is never fed through {@link projectVerdictToDisposition} or
 * {@link decideNextTransition}.
 *
 * `adjudicationCallAttempts` / `maxAdjudicationCallAttempts` track a bounded counter for
 * retrying the `adjudicate()` *call itself* - distinct from, and never conflated with, the
 * packet's `retry_count` / `attempt_budget.max_dispatch_attempts` (Part 1 §7 notes this as a
 * separate persisted field, `adjudication_retry_count`, for exactly this purpose). Returns
 * `'UNDER_REVIEW'` (retry the call, against the already-pulled evidence) while the counter has
 * not been exhausted, else `'ESCALATED'` once it has.
 */
export function handleAdjudicationFailure(
	packet: WorkPacket,
	adjudicationCallAttempts: number,
	maxAdjudicationCallAttempts: number,
): WorkPacketState {
	void packet;
	return adjudicationCallAttempts < maxAdjudicationCallAttempts ? "UNDER_REVIEW" : "ESCALATED";
}
