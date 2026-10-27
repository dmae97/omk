/**
 * Spec 096/100: the text and wire renderings of task-result events. Every surface (TUI, print
 * text, print json, RPC) renders the same event object through these functions (B1).
 */
import {
	hostFacts,
	type TaskCheckFact,
	type TaskResultDowngradeEvent,
	type TaskResultEvent,
	type TaskResultProjection,
	type TaskTestCount,
} from "./task-result.ts";

function countText(value: TaskTestCount): string {
	return value === "unknown" ? "?" : String(value);
}

function factDetail(fact: TaskCheckFact): string {
	const status = fact.reason ? `${fact.status}/${fact.reason}` : fact.status;
	const tests = fact.tests
		? `, tests ${countText(fact.tests.executed)} run/${countText(fact.tests.matched)} matched/${countText(fact.tests.skipped)} skipped`
		: "";
	const kind = fact.checkKind ? ` ${fact.checkKind}` : "";
	return `${status}${kind}${tests}`;
}

/** One line for print text mode and the TUI. */
export function formatTaskResultLine(projection: TaskResultProjection): string {
	const { checksRun, checksTotal, receiptsObserved } = projection.coverage;
	const total = checksTotal === "unknown" ? "?" : String(checksTotal);
	const required = hostFacts(projection.facts).filter((fact) => fact.required && fact.checkId !== undefined);
	const details = required.length > 0 ? ` [${required.map(factDetail).join("; ")}]` : "";
	return `task result: execution ${projection.execution}, check ${projection.check} (${projection.checkSource}), checks ${checksRun}/${total}, receipts ${receiptsObserved}${details} (host check observation, not task correctness)`;
}

/** One line for the downgrade event, the same on every surface. */
export function formatTaskResultDowngradeLine(event: TaskResultDowngradeEvent): string {
	const { fact } = event;
	const attempt = fact.attempt !== undefined ? ` attempt ${fact.attempt}` : "";
	const detail = fact.detail ? ` (${fact.detail})` : "";
	return `task result: check ${fact.checkId ?? fact.id}${attempt} downgraded: passed -> ${fact.status}/${fact.reason ?? "none"}${detail}`;
}

/** The text-surface line for any task-result event (TUI and print share it), or undefined. */
export function taskResultSurfaceLine(event: { type: string }): string | undefined {
	if (event.type === "task_result" && typeof (event as Partial<TaskResultEvent>).projection === "object")
		return formatTaskResultLine((event as TaskResultEvent).projection);
	if (event.type === "task_result_downgrade" && typeof (event as Partial<TaskResultDowngradeEvent>).fact === "object")
		return formatTaskResultDowngradeLine(event as TaskResultDowngradeEvent);
	return undefined;
}

/** The RPC / print-json line: the event itself, serialized once. */
export function serializeTaskResultEvent(event: TaskResultEvent): string {
	return JSON.stringify(event);
}
