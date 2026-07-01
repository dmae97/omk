/**
 * Design-fidelity note: this file implements the packet-level state machine defined in
 * Part 1 (`final-part1-core-algorithm.md`), Section 2 (transition table), Section 4 (terminal
 * state, since only CLOSED is terminal per §2's own text), and Section 2 state 3
 * (AWAITING_APPROVAL's trigger condition). It is an implementation of that document, not a
 * restatement of it.
 */

import type { LoopConfig, TopologyClassification, WorkPacket, WorkPacketState } from "./types.ts";

/**
 * Part 1 §2 — the full transition table, as an adjacency map keyed by source state. This is
 * the single source of truth for which transitions are legal; every other state-machine
 * function in this file is built on top of `canTransition`.
 */
const TRANSITIONS: Record<WorkPacketState, WorkPacketState[]> = {
	DRAFTED: ["ROUTED"],
	ROUTED: ["AWAITING_APPROVAL", "DISPATCHED"],
	AWAITING_APPROVAL: ["DISPATCHED", "CLOSED"],
	DISPATCHED: ["ACTIVE", "RAW_TERMINAL", "CLOSED"],
	ACTIVE: ["RAW_TERMINAL", "HALTING", "CLOSED"],
	HALTING: ["RAW_TERMINAL", "CLOSED"],
	RAW_TERMINAL: ["UNDER_REVIEW", "ADJUDICATION_FAILED"],
	UNDER_REVIEW: ["ADJUDICATION_FAILED", "CONFIRMED", "DECLINED"],
	ADJUDICATION_FAILED: ["UNDER_REVIEW", "ESCALATED"],
	CONFIRMED: ["CLOSED"],
	DECLINED: ["ESCALATED", "RETRY_QUEUED", "CLOSED"],
	RETRY_QUEUED: ["ROUTED"],
	ESCALATED: ["RETRY_QUEUED", "CLOSED"],
	CLOSED: [],
};

/**
 * Part 1 §2 — returns whether `from -> to` is a legal Work Packet state transition, per the
 * transition table. Pure and side-effect free.
 */
export function canTransition(from: WorkPacketState, to: WorkPacketState): boolean {
	return TRANSITIONS[from].includes(to);
}

/**
 * Part 1 §2 / §7 — applies a state transition to a Work Packet, returning a new packet object
 * with `state` updated and a new `TransitionLogEntry` appended to `transition_log`. Throws if
 * the transition is not legal per `canTransition`. Does not mutate `packet`.
 *
 * `now` defaults to the wall-clock ISO timestamp but is accepted as a parameter so callers
 * (and tests) can supply a deterministic clock.
 */
export function applyTransition(
	packet: WorkPacket,
	to: WorkPacketState,
	cause: string,
	now: () => string = () => new Date().toISOString(),
): WorkPacket {
	if (!canTransition(packet.state, to)) {
		throw new Error(
			`Illegal work packet transition: ${packet.state} -> ${to} for packet ${packet.packet_id} (cause: ${cause})`,
		);
	}
	const at = now();
	return {
		...packet,
		state: to,
		transition_log: [...packet.transition_log, { from: packet.state, to, at, cause }],
	};
}

/**
 * Part 1 §2 state 14 / §4 "Completion exhaustion" — CLOSED is the only terminal state.
 * ESCALATED and RETRY_QUEUED are explicitly not terminal: both can still transition further
 * (ESCALATED via an explicit external unblock signal; RETRY_QUEUED back into ROUTED).
 */
export function isTerminalState(state: WorkPacketState): boolean {
	return state === "CLOSED";
}

/**
 * Part 1 §2 state 3 — whether the next attempt for `packet` must be held in
 * AWAITING_APPROVAL before its first `adaptorch_run` call, rather than going straight from
 * ROUTED to DISPATCHED.
 *
 * True only if the proposed payload differs from the packet's last-human-approved baseline,
 * or the proposed topology classification differs from the packet's currently stored topology
 * decision — unless the loop instance is running in pre-approved-batch mode (§2 state 3's
 * documented opt-in escape hatch), in which case this always returns false.
 */
export function requiresHumanApproval(
	packet: WorkPacket,
	newPayload: unknown,
	newTopology: TopologyClassification | null,
	loopConfig: LoopConfig,
): boolean {
	if (loopConfig.pre_approved_batch) {
		return false;
	}

	// Pragmatic choice, not a claim of full structural equality semantics: JSON.stringify
	// comparison is order-sensitive for object keys and does not handle non-JSON-serializable
	// values (e.g. undefined, functions, symbols) specially. Adequate for the plain task
	// payloads this design assumes; a caller with payloads that need true structural equality
	// should compare upstream and pass an already-decided `newPayload` reference instead.
	const payloadChanged = JSON.stringify(newPayload) !== JSON.stringify(packet.last_human_approved_payload);

	const topologyChanged =
		newTopology !== null &&
		packet.topology_decision !== null &&
		newTopology !== packet.topology_decision.classification;

	return payloadChanged || topologyChanged;
}
