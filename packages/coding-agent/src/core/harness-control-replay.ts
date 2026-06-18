import type { HarnessControlEvent, HarnessControlEventStatus } from "./harness-control-events.ts";
import { hashCanonical, verifyHarnessControlLedger } from "./harness-control-events.ts";

export interface HarnessControlOperationReplay {
	operationId: string;
	kind: string;
	started: boolean;
	terminalStatus?: HarnessControlEventStatus;
	terminalEventIds: string[];
	eventIds: string[];
	sequenceRange: [number, number];
	stateTransitions: Array<{ beforeStateHash: string; afterStateHash: string }>;
	finalStateHash?: string;
}

export interface HarnessControlReplayReport {
	ok: boolean;
	events: HarnessControlEvent[];
	operations: HarnessControlOperationReplay[];
	reconstructedStateHash: string;
	errors: string[];
	warnings: string[];
}

const TERMINAL_STATUSES = new Set<HarnessControlEventStatus>([
	"completed",
	"failed",
	"blocked",
	"rolled_back",
	"in_doubt",
]);

const NON_TERMINAL_STATUS_ORDER = new Map<HarnessControlEventStatus, number>([
	["prepared", 0],
	["started", 1],
	["applying", 2],
	["verifying", 3],
]);

function isTerminalStatus(status: HarnessControlEventStatus): boolean {
	return TERMINAL_STATUSES.has(status);
}

function createOperationReplay(operationId: string, events: HarnessControlEvent[]): HarnessControlOperationReplay {
	const sortedEvents = [...events].sort((a, b) => a.sequence - b.sequence);
	const terminalEvents = sortedEvents.filter((event) => isTerminalStatus(event.status));
	const terminal = terminalEvents.at(-1);
	return {
		operationId,
		kind: sortedEvents[0]?.kind ?? "unknown",
		started: sortedEvents.some((event) => event.status === "started"),
		terminalStatus: terminal?.status,
		terminalEventIds: terminalEvents.map((event) => event.eventId),
		eventIds: sortedEvents.map((event) => event.eventId),
		sequenceRange: [sortedEvents[0]?.sequence ?? 0, sortedEvents.at(-1)?.sequence ?? 0],
		stateTransitions: sortedEvents.map((event) => ({
			beforeStateHash: event.beforeStateHash,
			afterStateHash: event.afterStateHash,
		})),
		finalStateHash: terminal?.afterStateHash ?? sortedEvents.at(-1)?.afterStateHash,
	};
}

function validateUniqueEventIds(events: readonly HarnessControlEvent[]): string[] {
	const errors: string[] = [];
	const seen = new Set<string>();
	for (const event of events) {
		if (seen.has(event.eventId)) errors.push(`event ${event.eventId} is duplicated`);
		seen.add(event.eventId);
	}
	return errors;
}

function validateCausation(events: readonly HarnessControlEvent[]): string[] {
	const errors: string[] = [];
	const byId = new Map(events.map((event) => [event.eventId, event]));
	for (const event of events) {
		if (!event.causationId) continue;
		const causationEvent = byId.get(event.causationId);
		if (
			!causationEvent ||
			causationEvent.sequence >= event.sequence ||
			causationEvent.correlationId !== event.correlationId
		) {
			errors.push(
				`event causation ${event.causationId} for operation ${event.operationId} does not reference an earlier event`,
			);
		}
	}
	return errors;
}

function reconstructHarnessStateHash(operations: readonly HarnessControlOperationReplay[]): string {
	return hashCanonical(
		operations.map((operation) => ({
			operationId: operation.operationId,
			kind: operation.kind,
			finalStateHash: operation.finalStateHash,
			terminalStatus: operation.terminalStatus,
		})),
	);
}

function validateOperationStateMachine(
	operation: HarnessControlOperationReplay,
	events: HarnessControlEvent[],
): string[] {
	const errors: string[] = [];
	const sortedEvents = [...events].sort((a, b) => a.sequence - b.sequence);
	const kinds = new Set(sortedEvents.map((event) => event.kind));
	const correlations = new Set(sortedEvents.map((event) => event.correlationId));
	const startedCount = sortedEvents.filter((event) => event.status === "started").length;
	let lastNonTerminalOrder = -1;
	let sawTerminal = false;
	let sawEventAfterTerminal = false;

	if (kinds.size > 1) errors.push(`operation ${operation.operationId} mixes event kinds`);
	if (correlations.size > 1) errors.push(`operation ${operation.operationId} mixes correlation ids`);
	if (startedCount > 1) errors.push(`operation ${operation.operationId} has multiple started events`);
	if (operation.terminalEventIds.length > 1)
		errors.push(`operation ${operation.operationId} has multiple terminal events`);

	for (const event of sortedEvents) {
		if (sawTerminal) {
			sawEventAfterTerminal = true;
			continue;
		}
		if (isTerminalStatus(event.status)) {
			sawTerminal = true;
			continue;
		}
		const order = NON_TERMINAL_STATUS_ORDER.get(event.status);
		if (order === undefined) {
			errors.push(`operation ${operation.operationId} has unsupported status ${event.status}`);
			continue;
		}
		if (order < lastNonTerminalOrder) {
			errors.push(`operation ${operation.operationId} has invalid status transition to ${event.status}`);
		}
		lastNonTerminalOrder = order;
	}
	if (sawEventAfterTerminal) errors.push(`operation ${operation.operationId} has event after terminal event`);
	return errors;
}

export function replayHarnessControlEvents(events: readonly HarnessControlEvent[]): HarnessControlReplayReport {
	const errors: string[] = [];
	const warnings: string[] = [];
	const operationEvents = new Map<string, HarnessControlEvent[]>();
	for (const event of events) {
		const group = operationEvents.get(event.operationId) ?? [];
		group.push(event);
		operationEvents.set(event.operationId, group);
	}

	const operations = [...operationEvents]
		.sort(([, a], [, b]) => (a[0]?.sequence ?? 0) - (b[0]?.sequence ?? 0))
		.map(([operationId, groupedEvents]) => createOperationReplay(operationId, groupedEvents));

	errors.push(...validateUniqueEventIds(events));
	errors.push(...validateCausation(events));

	for (const operation of operations) {
		const groupedEvents = operationEvents.get(operation.operationId) ?? [];
		errors.push(...validateOperationStateMachine(operation, groupedEvents));
		if (!operation.started) {
			warnings.push(`operation ${operation.operationId} has no started event`);
		}
		if (!operation.terminalStatus) {
			errors.push(`operation ${operation.operationId} has no terminal event`);
		}
	}

	return {
		ok: errors.length === 0,
		events: [...events],
		operations,
		reconstructedStateHash: reconstructHarnessStateHash(operations),
		errors,
		warnings,
	};
}

export function verifyHarnessControlReplay(logPath: string): HarnessControlReplayReport {
	const ledger = verifyHarnessControlLedger(logPath);
	const replay = replayHarnessControlEvents(ledger.events);
	return {
		ok: ledger.ok && replay.ok,
		events: ledger.events,
		operations: replay.operations,
		reconstructedStateHash: replay.reconstructedStateHash,
		errors: [...ledger.errors, ...replay.errors],
		warnings: replay.warnings,
	};
}
