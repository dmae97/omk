/**
 * Spec 096 phase 2: collects the facts one prompt run produced and builds the
 * `task_result` event after `prompt_settled`.
 *
 * Read-only and in memory: facts arrive on the extension event bus (goal
 * acceptance publishes host facts, finish-check publishes its ledger), nothing
 * is persisted, and with `OMK_TASK_RESULT` off the collector is never created.
 */
import type { AgentMessage } from "omk-agent-core";
import type { EventBus } from "./event-bus.ts";
import type { FinishCheckLedgerItem } from "./finish-check-requirements.ts";
import type { PromptSettledEvent } from "./prompt-settlement.ts";
import {
	buildTaskResultEvent,
	claimFromModelText,
	claimsFromFinishCheckLedger,
	isTaskResultEnabled,
	TASK_RESULT_VERSION,
	type TaskCheckAttempt,
	type TaskCheckFact,
	type TaskModelClaim,
	type TaskResultDowngradeEvent,
	type TaskResultEvent,
} from "./task-result.ts";

export type { TaskResultDowngradeEvent, TaskResultEvent } from "./task-result.ts";

/** The session events this feature adds (flag on only). */
export type TaskResultSessionEvent = TaskResultEvent | TaskResultDowngradeEvent;

/** Event-bus channel goal acceptance publishes host facts on (flag on only). */
export const TASK_RESULT_FACT_CHANNEL = "task_result_fact";
/** Same value as `FINISH_CHECK_EVENT`; kept here to avoid importing the extension. */
const FINISH_CHECK_CHANNEL = "finish_check";

/** Brand on host-published facts: a plain object on the shared bus is not a host fact (B6). */
const HOST_FACT = Symbol("omk.taskResult.hostFact");
const hostEnvelopes = new WeakSet<object>();

interface HostEnvelope {
	readonly [HOST_FACT]: { readonly promptRunId: string; readonly fact: TaskCheckFact };
}

/** Synchronous query channel: the collector writes the run it is collecting for (none between runs). */
const TASK_RESULT_RUN_CHANNEL = "task_result_run";

/**
 * The run a check is starting in; capture it before the check runs and pass it to publishHostTaskFact.
 * Extensions see a wrapper of the bus, so this asks over the bus instead of keying on the object.
 * The answer only stamps the fact; the collector still compares it with its own run id.
 */
export function currentTaskRunId(bus: Pick<EventBus, "emit">): string | undefined {
	const query: { promptRunId?: string } = {};
	bus.emit(TASK_RESULT_RUN_CHANNEL, query);
	return query.promptRunId;
}

/**
 * Host-side publisher used by goal acceptance; the envelope cannot be forged with plain data.
 * `promptRunId` is the run the check started in; a fact for any other run is dropped (late receipts).
 */
export function publishHostTaskFact(
	bus: Pick<EventBus, "emit">,
	fact: TaskCheckFact,
	promptRunId: string | undefined,
): void {
	if (promptRunId === undefined) return;
	const envelope: HostEnvelope = { [HOST_FACT]: { promptRunId, fact: { ...fact } } };
	hostEnvelopes.add(envelope);
	bus.emit(TASK_RESULT_FACT_CHANNEL, envelope);
}

function hostFactOf(data: unknown, promptRunId: string | undefined): TaskCheckFact | undefined {
	if (typeof data !== "object" || data === null || !hostEnvelopes.has(data)) return undefined;
	const body = (data as HostEnvelope)[HOST_FACT];
	if (promptRunId === undefined || body.promptRunId !== promptRunId) return undefined;
	return isFact(body.fact) ? body.fact : undefined;
}

function isFact(data: unknown): data is TaskCheckFact {
	if (typeof data !== "object" || data === null) return false;
	const fact = data as Partial<TaskCheckFact>;
	return (
		typeof fact.id === "string" &&
		(fact.source === "host_receipt" || fact.source === "model_text") &&
		typeof fact.status === "string" &&
		typeof fact.required === "boolean"
	);
}

function ledgerOf(data: unknown): readonly FinishCheckLedgerItem[] | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const ledger = (data as { ledger?: unknown }).ledger;
	return Array.isArray(ledger) ? (ledger as FinishCheckLedgerItem[]) : undefined;
}

function attemptOf(fact: TaskCheckFact): TaskCheckAttempt {
	return {
		attempt: fact.attempt ?? 1,
		status: fact.status,
		...(fact.reason !== undefined ? { reason: fact.reason } : {}),
		...(fact.receiptId !== undefined ? { receiptId: fact.receiptId } : {}),
	};
}

/** Spec 100: emits the downgrade event the moment a check's pass stops being one. */
export type TaskResultDowngradeSink = (event: TaskResultDowngradeEvent) => void;

export class TaskResultCollector {
	/** Current fact per check (`checkId`, else the fact id); earlier attempts ride on it. */
	private facts = new Map<string, TaskCheckFact>();
	private readonly onDowngrade: TaskResultDowngradeSink | undefined;
	private ledger: readonly FinishCheckLedgerItem[] = [];
	private readonly unsubscribe: Array<() => void> = [];
	private readonly run: { promptRunId: string | undefined } = { promptRunId: undefined };

	/** Without a bus the run still gets an event, with no host facts and no ledger claims. */
	constructor(bus: EventBus | undefined, onDowngrade?: TaskResultDowngradeSink) {
		this.onDowngrade = onDowngrade;
		if (!bus) return;
		this.unsubscribe.push(
			bus.on(TASK_RESULT_FACT_CHANNEL, (data) => {
				// Anything not published through publishHostTaskFact is ignored.
				const fact = hostFactOf(data, this.run.promptRunId);
				if (fact) this.record(fact);
			}),
			bus.on(TASK_RESULT_RUN_CHANNEL, (data) => {
				if (typeof data === "object" && data !== null && this.run.promptRunId !== undefined)
					(data as { promptRunId?: string }).promptRunId = this.run.promptRunId;
			}),
			bus.on(FINISH_CHECK_CHANNEL, (data) => {
				const ledger = ledgerOf(data);
				if (ledger !== undefined) this.ledger = ledger;
			}),
		);
	}

	private record(fact: TaskCheckFact): void {
		const key = fact.checkId ?? fact.id;
		const previous = this.facts.get(key);
		const sameAttempt = previous !== undefined && (previous.attempt ?? 1) === (fact.attempt ?? 1);
		const history = previous === undefined ? [] : [...(previous.attempts ?? []), attemptOf(previous)];
		const attempts = sameAttempt ? history.slice(0, -1) : history;
		const next: TaskCheckFact = { ...fact, ...(attempts.length > 0 ? { attempts } : {}) };
		this.facts.set(key, next);
		const promptRunId = this.run.promptRunId;
		if (sameAttempt && previous.status === "passed" && fact.status !== "passed" && promptRunId !== undefined)
			this.onDowngrade?.({
				type: "task_result_downgrade",
				version: TASK_RESULT_VERSION,
				promptRunId,
				from: "passed",
				fact: { ...next },
			});
	}

	/** A new top-level run starts with no facts and accepts only its own receipts. */
	begin(promptRunId: string): void {
		this.facts = new Map();
		this.ledger = [];
		this.run.promptRunId = promptRunId;
	}

	/** The run's event; resets for the next run. */
	finish(
		settled: Pick<PromptSettledEvent, "promptRunId" | "outcome">,
		finalText: string | undefined,
	): TaskResultEvent {
		const modelClaims: TaskModelClaim[] = claimsFromFinishCheckLedger(this.ledger);
		const textClaim = finalText === undefined ? undefined : claimFromModelText(finalText);
		if (textClaim) modelClaims.push(textClaim);
		const event = buildTaskResultEvent({ settled, facts: [...this.facts.values()], modelClaims });
		// Receipts arriving after the run settled belong to no run and are dropped.
		this.facts = new Map();
		this.ledger = [];
		this.run.promptRunId = undefined;
		return event;
	}

	/** Returns undefined so the owner can clear its field in one step. */
	dispose(): undefined {
		for (const off of this.unsubscribe.splice(0)) off();
		return undefined;
	}
}

/** The run's collector (reused across runs, reset per run), or undefined while the flag is off (an old one is disposed). */
export function beginTaskResult(
	existing: TaskResultCollector | undefined,
	loader: { getEventBus?(): EventBus },
	promptRunId: string,
	onDowngrade?: TaskResultDowngradeSink,
): TaskResultCollector | undefined {
	if (!isTaskResultEnabled()) return existing?.dispose();
	const collector = existing ?? new TaskResultCollector(loader.getEventBus?.(), onDowngrade);
	collector.begin(promptRunId);
	return collector;
}

/** Text of the last assistant message, read only for the `model_text` claim. */
export function finalAssistantText(messages: readonly AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		const text = message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		return text.length > 0 ? text : undefined;
	}
	return undefined;
}
