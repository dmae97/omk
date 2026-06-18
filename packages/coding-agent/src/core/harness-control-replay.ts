import type { HarnessControlEvent, HarnessControlEventStatus } from "./harness-control-events.ts";
import { verifyHarnessControlLedger } from "./harness-control-events.ts";

export interface HarnessControlOperationReplay {
	operationId: string;
	kind: string;
	started: boolean;
	terminalStatus?: HarnessControlEventStatus;
	eventIds: string[];
	sequenceRange: [number, number];
	stateTransitions: Array<{ beforeStateHash: string; afterStateHash: string }>;
}

export interface HarnessControlReplayReport {
	ok: boolean;
	events: HarnessControlEvent[];
	operations: HarnessControlOperationReplay[];
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

function isTerminalStatus(status: HarnessControlEventStatus): boolean {
	return TERMINAL_STATUSES.has(status);
}

function createOperationReplay(operationId: string, events: HarnessControlEvent[]): HarnessControlOperationReplay {
	const sortedEvents = [...events].sort((a, b) => a.sequence - b.sequence);
	const terminal = [...sortedEvents].reverse().find((event) => isTerminalStatus(event.status));
	return {
		operationId,
		kind: sortedEvents[0]?.kind ?? "unknown",
		started: sortedEvents.some((event) => event.status === "started"),
		terminalStatus: terminal?.status,
		eventIds: sortedEvents.map((event) => event.eventId),
		sequenceRange: [sortedEvents[0]?.sequence ?? 0, sortedEvents.at(-1)?.sequence ?? 0],
		stateTransitions: sortedEvents.map((event) => ({
			beforeStateHash: event.beforeStateHash,
			afterStateHash: event.afterStateHash,
		})),
	};
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

	for (const operation of operations) {
		if (!operation.started) {
			warnings.push(`operation ${operation.operationId} has no started event`);
		}
		if (!operation.terminalStatus) {
			errors.push(`operation ${operation.operationId} has no terminal event`);
		}
	}

	return { ok: errors.length === 0, events: [...events], operations, errors, warnings };
}

export function verifyHarnessControlReplay(logPath: string): HarnessControlReplayReport {
	const ledger = verifyHarnessControlLedger(logPath);
	const replay = replayHarnessControlEvents(ledger.events);
	return {
		ok: ledger.ok && replay.ok,
		events: ledger.events,
		operations: replay.operations,
		errors: [...ledger.errors, ...replay.errors],
		warnings: replay.warnings,
	};
}
