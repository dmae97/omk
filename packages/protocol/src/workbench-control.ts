import { parseRunStartCommand, RunContractError, type RunStartCommand } from "./run-contract.ts";
import { runId, runObject, runText } from "./run-parsing.ts";

export const WORKBENCH_CONTROL_VERSION = "omk.workbench-control.v1" as const;
export const MAX_WORKBENCH_CONTROL_BYTES = 4096;

export interface WorkbenchStartControl {
	readonly schemaVersion: typeof WORKBENCH_CONTROL_VERSION;
	readonly kind: "validate-start";
	readonly requestId: string;
	readonly hostId: string;
	readonly hostEpoch: string;
	readonly actorId: string;
	readonly connectionId: string;
	readonly graphRevision: 0;
	readonly expectedState: "absent";
	readonly nodeId: null;
	readonly attempt: null;
	readonly grantDigest: null;
	readonly command: RunStartCommand;
}

/** Compact UTF-8 JSON plus one LF; parsing never authenticates or admits execution. */
export function parseWorkbenchControlFrame(frame: Uint8Array): WorkbenchStartControl {
	if (
		!(frame instanceof Uint8Array) ||
		frame.byteLength < 3 ||
		frame.byteLength > MAX_WORKBENCH_CONTROL_BYTES + 1 ||
		frame[frame.byteLength - 1] !== 10
	)
		throw new RunContractError("workbench frame");
	const payload = frame.subarray(0, -1);
	if (payload.some((byte) => byte === 10 || byte === 13)) throw new RunContractError("workbench frame");
	let value: unknown;
	try {
		const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload);
		value = JSON.parse(text);
		if (JSON.stringify(value) !== text) throw new RunContractError("workbench JSON");
	} catch (error) {
		if (error instanceof SyntaxError || error instanceof TypeError) throw new RunContractError("workbench JSON");
		throw error;
	}
	const input = runObject(value, [
		"schemaVersion",
		"kind",
		"requestId",
		"hostId",
		"hostEpoch",
		"actorId",
		"connectionId",
		"graphRevision",
		"expectedState",
		"nodeId",
		"attempt",
		"grantDigest",
		"command",
	]);
	if (
		input.schemaVersion !== WORKBENCH_CONTROL_VERSION ||
		input.kind !== "validate-start" ||
		input.graphRevision !== 0 ||
		input.expectedState !== "absent" ||
		input.nodeId !== null ||
		input.attempt !== null ||
		input.grantDigest !== null
	)
		throw new RunContractError("workbench version/kind/precondition");
	const hostEpoch = runText(input.hostEpoch, "hostEpoch", 40);
	if (!/^[1-9][0-9]*$/.test(hostEpoch)) throw new RunContractError("hostEpoch");
	return Object.freeze({
		schemaVersion: WORKBENCH_CONTROL_VERSION,
		kind: "validate-start",
		requestId: runId(input.requestId),
		hostId: runId(input.hostId),
		hostEpoch,
		actorId: runId(input.actorId),
		connectionId: runId(input.connectionId),
		graphRevision: 0,
		expectedState: "absent",
		nodeId: null,
		attempt: null,
		grantDigest: null,
		command: parseRunStartCommand(input.command),
	});
}
