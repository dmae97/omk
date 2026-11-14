import {
	parseRunStartCommand,
	parseWorkbenchControlFrame,
	type RunStartCommand,
	WORKBENCH_CONTROL_VERSION,
} from "omk-protocol";
import { authorizationStillOpen } from "./authority-meaning.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";

/** Current host/peer state supplied out of band; never deserialize this from UI JSON. */
export interface WorkbenchControlHostContext {
	readonly hostId: string;
	readonly hostEpoch: string;
	readonly hostSignal: AbortSignal;
	readonly peer: {
		readonly actorId: string;
		readonly connectionId: string;
		readonly signal: AbortSignal;
		readonly authorizationDeadline: number;
	} | null;
	readonly graphRevision: number;
	readonly runState: "absent" | "present";
	readonly expectedCommand: RunStartCommand;
	/** A host-owned rollback-detecting clock, e.g. createAuthorityClock(). */
	readonly clock: () => number;
}

/** Inactive validation boundary, not peer authentication, approval or an execution capability. */
export function validateWorkbenchControlFrame(frame: Uint8Array, context: WorkbenchControlHostContext | null) {
	const peer = context?.peer;
	const hostSignal = context?.hostSignal;
	if (
		!context ||
		!peer ||
		!(hostSignal instanceof AbortSignal) ||
		!(peer.signal instanceof AbortSignal) ||
		hostSignal.aborted ||
		peer.signal.aborted
	)
		throw new VerifiedRunError("workbench_unauthenticated");
	const request = parseWorkbenchControlFrame(frame);
	const deadline = peer.authorizationDeadline;
	if (!Number.isSafeInteger(deadline) || deadline < 0) throw new VerifiedRunError("authorization_expired");
	const now = context.clock();
	if (hostSignal.aborted || peer.signal.aborted) throw new VerifiedRunError("workbench_unauthenticated");
	if (!authorizationStillOpen(now, deadline)) throw new VerifiedRunError("authorization_expired");
	if (
		request.hostId !== context.hostId ||
		request.actorId !== peer.actorId ||
		request.connectionId !== peer.connectionId
	)
		throw new VerifiedRunError("workbench_identity");
	if (request.hostEpoch !== context.hostEpoch) throw new VerifiedRunError("stale_epoch");
	if (request.graphRevision !== context.graphRevision || request.expectedState !== context.runState)
		throw new VerifiedRunError("precondition");
	const commandDigest = digestObject(request.command);
	if (commandDigest !== digestObject(parseRunStartCommand(context.expectedCommand)))
		throw new VerifiedRunError("command_conflict");
	const confirmedNow = context.clock();
	if (hostSignal.aborted || peer.signal.aborted) throw new VerifiedRunError("workbench_unauthenticated");
	if (!authorizationStillOpen(confirmedNow, deadline)) throw new VerifiedRunError("authorization_expired");
	return Object.freeze({
		schemaVersion: WORKBENCH_CONTROL_VERSION,
		kind: "validated-no-execution",
		requestId: request.requestId,
		hostId: request.hostId,
		hostEpoch: request.hostEpoch,
		connectionId: request.connectionId,
		runId: request.command.runId,
		commandId: request.command.commandId,
		commandDigest,
		executionRequested: false,
		capabilities: Object.freeze({ execute: false, amendGraph: false, publish: false }),
	});
}
