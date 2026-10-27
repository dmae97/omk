/**
 * Spec 104 phase 3: the goal controller (contract producer) and the session's turn-admission
 * host meet on the extension event bus, the same way goal acceptance hands host facts to the
 * task-result collector. Envelopes are branded in this module, so plain data on the shared bus
 * is neither a contract nor a capability report. Nothing is published with `OMK_REQUIRED_TOOLS` off.
 */
import type { EventBus } from "./event-bus.ts";
import type { RequiredToolContract } from "./required-tools.ts";

/** Producer -> host: the required-tool contract of the current task segment (`undefined` clears it). */
export const REQUIRED_TOOLS_CONTRACT_CHANNEL = "required_tools_contract";
/** Host -> producer: whether a turn could carry every required tool. Names and counts only. */
export const REQUIRED_CAPABILITY_CHANNEL = "required_capability";

export type RequiredCapabilityReport =
	| {
			readonly state: "missing";
			readonly taskSegmentId: string;
			readonly missing: readonly string[];
			readonly kind: "absent" | "over_ceiling";
	  }
	| { readonly state: "present"; readonly taskSegmentId: string; readonly requiredCount: number };

interface ContractEnvelope {
	readonly contract: RequiredToolContract | undefined;
}

const branded = new WeakSet<object>();

function emitBranded(bus: Pick<EventBus, "emit">, channel: string, body: object): void {
	const envelope = Object.freeze(body);
	branded.add(envelope);
	bus.emit(channel, envelope);
}

function isBranded(data: unknown): data is object {
	return typeof data === "object" && data !== null && branded.has(data);
}

export function publishRequiredToolContract(
	bus: Pick<EventBus, "emit">,
	contract: RequiredToolContract | undefined,
): void {
	const copy = contract && Object.freeze({ ...contract, tools: new Set(contract.tools) });
	emitBranded(bus, REQUIRED_TOOLS_CONTRACT_CHANNEL, { contract: copy } satisfies ContractEnvelope);
}

export function onRequiredToolContract(
	bus: Pick<EventBus, "on">,
	handler: (contract: RequiredToolContract | undefined) => void,
): () => void {
	return bus.on(REQUIRED_TOOLS_CONTRACT_CHANNEL, (data) => {
		if (isBranded(data)) handler((data as ContractEnvelope).contract);
	});
}

export function reportRequiredCapability(bus: Pick<EventBus, "emit">, report: RequiredCapabilityReport): void {
	emitBranded(bus, REQUIRED_CAPABILITY_CHANNEL, { ...report });
}

export function onRequiredCapability(
	bus: Pick<EventBus, "on">,
	handler: (report: RequiredCapabilityReport) => void,
): () => void {
	return bus.on(REQUIRED_CAPABILITY_CHANNEL, (data) => {
		if (isBranded(data)) handler(data as RequiredCapabilityReport);
	});
}
