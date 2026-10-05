import {
	detectProgressStall,
	isFileMutatingTool,
	PROGRESS_STALL_LOW_BUDGET_FRACTION,
	PROGRESS_STALL_STEER_EVERY,
	PROGRESS_STALL_WINDOW,
	type StallRecord,
	trimStallRecords,
} from "../../progress-stall.ts";
import { isProgressStallSteerSuppressed } from "../../progress-stall-steer-gate.ts";
import { createEnvRemainingBudgetFraction, type RemainingBudgetFraction } from "../../remaining-budget-fraction.ts";
import type { ExtensionAPI } from "../types.ts";

export interface IdenticalLoopOptions {
	/** Injected remaining-budget fraction; default reads OMK_TIME_BUDGET_SEC + process start. */
	readonly remainingBudgetFraction?: RemainingBudgetFraction;
}

function errorSummaryFromContent(content: readonly { type: string; text?: string }[]): string | undefined {
	const text = content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text ?? "")
		.join("\n")
		.trim();
	if (!text) return undefined;
	return text.slice(0, 200);
}

export default function identicalLoop(omk: ExtensionAPI, options: IdenticalLoopOptions = {}): void {
	const records: StallRecord[] = [];
	const pendingById = new Map<string, StallRecord>();
	let callsSinceSteer = PROGRESS_STALL_STEER_EVERY;
	const remainingBudgetFraction = options.remainingBudgetFraction ?? createEnvRemainingBudgetFraction();
	// Finish-check announces its verification turn on the bus; similar measurement commands are expected there.
	let finishCheckActive = false;
	omk.events.on("finish_check", (data) => {
		finishCheckActive = (data as { active?: unknown } | undefined)?.active === true;
	});

	omk.on("session_start", () => {
		records.length = 0;
		pendingById.clear();
		finishCheckActive = false;
		callsSinceSteer = PROGRESS_STALL_STEER_EVERY;
	});
	omk.on("input", (event) => {
		if (event.source !== "extension") {
			records.length = 0;
			pendingById.clear();
			callsSinceSteer = PROGRESS_STALL_STEER_EVERY;
		}
	});
	omk.on("tool_result", (event) => {
		const pending = pendingById.get(event.toolCallId);
		pendingById.delete(event.toolCallId);
		if (!pending) return;
		const fileMutated = isFileMutatingTool(event.toolName) && !event.isError;
		const errorSummary = event.isError ? errorSummaryFromContent(event.content) : undefined;
		const index = records.lastIndexOf(pending);
		if (index < 0) return;
		records[index] = { ...pending, fileMutated, errorSummary };
	});
	omk.on("tool_call", (event) => {
		const record: StallRecord = { toolName: event.toolName, args: event.input };
		records.push(record);
		pendingById.set(event.toolCallId, record);
		trimStallRecords(records, PROGRESS_STALL_WINDOW);
		// Calls whose result never arrives (aborts) must not accumulate.
		for (const id of pendingById.keys()) {
			if (pendingById.size <= PROGRESS_STALL_WINDOW) break;
			pendingById.delete(id);
		}
		callsSinceSteer += 1;

		const detection = detectProgressStall(records);
		if (!detection) return undefined;

		if (detection.kind === "stop") {
			return {
				block: true,
				reason: `identical loop: ${detection.toolName} repeated ${detection.count} times with the same args`,
			};
		}
		if (detection.kind === "warn") {
			omk.sendMessage({
				customType: "identical-loop",
				content: `Same ${detection.toolName} call repeated ${detection.count} times. Change the args or stop.`,
				display: true,
				details: detection,
			});
			return undefined;
		}

		// Near-duplicate / no-progress: steer only (never block). Exact stop stays active above.
		if (detection.kind !== "steer") return undefined;
		if (finishCheckActive || isProgressStallSteerSuppressed()) return undefined;
		if (callsSinceSteer < PROGRESS_STALL_STEER_EVERY) return undefined;
		callsSinceSteer = 0;

		const remaining = remainingBudgetFraction();
		const lowBudget = remaining !== undefined && remaining < PROGRESS_STALL_LOW_BUDGET_FRACTION;
		const content = lowBudget
			? `No progress for ${detection.noProgressCalls} tool calls (${detection.similarCount} similar ${detection.toolName} approaches). Save best state, run verification, and finish.`
			: `You have tried ${detection.similarCount} similar approaches without progress: summarize what failed and pick a materially different approach.`;

		omk.sendMessage({
			customType: "progress-stall",
			content,
			display: true,
			details: { ...detection, remainingBudgetFraction: remaining, lowBudget },
		});
		return undefined;
	});
}
