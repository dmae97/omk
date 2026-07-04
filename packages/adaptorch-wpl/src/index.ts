/**
 * Public entry point for `omk-adaptorch-wpl` (experimental, design-stage).
 *
 * See README.md and `.omk/runs/adaptorch-native-loop-algorithm-20260701/final-part{1,2,3}-*.md`
 * for the design this package implements. Not wired into the `open-multi-agent-kit` CLI yet.
 */

export type { AdaptOrchTransport } from "./adaptorch-client.ts";
export { AdaptOrchClient } from "./adaptorch-client.ts";
export type { AdjudicationRequest, AdjudicationResult, PerRunVerdict } from "./adjudicator.ts";
export { adjudicate } from "./adjudicator.ts";
export type {
	AdjudicationReasonCode,
	CheckResult,
	VerdictState,
	VerifierRegistryEntry,
} from "./adjudicator-registry.ts";
export {
	ADJUDICATION_REASON_CODES,
	createVerifierRegistry,
	DEFAULT_VERIFIER,
	reduceReasonCodes,
} from "./adjudicator-registry.ts";
export type { NextActionKind, VerdictDisposition } from "./loop.ts";
export {
	decideNextTransition,
	handleAdjudicationFailure,
	projectVerdictToDisposition,
	runAdjudicationWithTimeout,
} from "./loop.ts";
export { applyTransition, canTransition, isTerminalState, requiresHumanApproval } from "./state-machine.ts";
export type {
	CardinalityMode,
	DispatchRecord,
	LoopConfig,
	LoopTerminationCondition,
	TopologyClassification,
	TransitionLogEntry,
	WorkPacket,
	WorkPacketState,
} from "./types.ts";
export { ADJUDICATIONS_DIR, LOOP_STATE_FILE, PACKET_INDEX_FILE, PACKETS_DIR, RUN_MAP_FILE } from "./types.ts";
