import {
	FINISH_CHECK_MAX_TOOL_CALLS,
	FINISH_CHECK_MESSAGE,
	FINISH_CHECK_SAVE_NOW_FRACTION,
	FINISH_CHECK_SAVE_NOW_MESSAGE,
	FINISH_CHECK_WRAP_UP_MESSAGE,
	finishDisciplinePrompt,
	isWorkspaceMutatingTool,
	resolveFinishCheckMode,
	resolveTimeBudgetMs,
	shouldRunFinishCheck,
} from "../../finish-check.ts";
import { requestPreCheckSnapshot, resolveSnapshotHandshake } from "../../finish-check-snapshot.ts";
import type { ExtensionAPI } from "../types.ts";

export interface FinishCheckOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Adds finish discipline to the system prompt and, in headless runs, one
 * verification turn after a run that changed the workspace. With
 * `OMK_TIME_BUDGET_SEC` it also tells the run to save its outputs at 75%.
 */
export default function finishCheck(omk: ExtensionAPI, options: FinishCheckOptions = {}): void {
	const env = options.env ?? process.env;
	const now = options.now ?? Date.now;
	const mode = resolveFinishCheckMode(env.OMK_FINISH_CHECK);
	if (mode === "off") return;
	const budgetMs = resolveTimeBudgetMs(env.OMK_TIME_BUDGET_SEC);
	const snapshot = resolveSnapshotHandshake(env);
	// Time spent waiting for a harness snapshot is not part of the run's budget.
	let startedAt = now();
	let snapshotSequence = 0;
	const elapsedFraction = () => (budgetMs === undefined ? undefined : (now() - startedAt) / budgetMs);

	let mutated = false;
	let checked = false;
	let warnedSaveNow = false;
	let checkToolCalls = 0;
	let wrappedUp = false;

	omk.on("input", (event) => {
		// Our own follow-up arrives as extension input; only a new user task resets the check.
		if (event.source !== "extension") {
			mutated = false;
			checked = false;
			checkToolCalls = 0;
			wrappedUp = false;
		}
		return undefined;
	});

	omk.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${finishDisciplinePrompt(budgetMs)}`,
	}));

	const maybeWarnSaveNow = () => {
		const fraction = elapsedFraction();
		if (!warnedSaveNow && fraction !== undefined && fraction >= FINISH_CHECK_SAVE_NOW_FRACTION) {
			warnedSaveNow = true;
			omk.sendUserMessage(FINISH_CHECK_SAVE_NOW_MESSAGE, { deliverAs: "steer" });
		}
	};

	omk.on("tool_execution_end", (event) => {
		if (isWorkspaceMutatingTool(event.toolName)) mutated = true;
		maybeWarnSaveNow();
		if (checked && !wrappedUp) {
			checkToolCalls += 1;
			if (checkToolCalls >= FINISH_CHECK_MAX_TOOL_CALLS) {
				wrappedUp = true;
				omk.sendUserMessage(FINISH_CHECK_WRAP_UP_MESSAGE, { deliverAs: "steer" });
			}
		}
	});

	// Long reasoning can pass 75% without any tool finishing; check when each assistant message ends too.
	omk.on("message_end", (event) => {
		if (event.message.role === "assistant") maybeWarnSaveNow();
	});

	omk.on("agent_settled", async (event, ctx) => {
		const last = event.messages.at(-1);
		const aborted = last?.role === "assistant" && (last.stopReason === "aborted" || last.stopReason === "error");
		const run = shouldRunFinishCheck({
			mode,
			hasUI: ctx.hasUI,
			alreadyChecked: checked,
			mutatedWorkspace: mutated,
			hasPendingMessages: ctx.hasPendingMessages(),
			aborted,
			elapsedFraction: elapsedFraction(),
		});
		if (!run) return;
		checked = true;
		if (snapshot) {
			snapshotSequence += 1;
			const result = await requestPreCheckSnapshot(snapshot, snapshotSequence, { now, sleep: options.sleep });
			startedAt += result.waitedMs;
		}
		omk.sendUserMessage(FINISH_CHECK_MESSAGE, { deliverAs: "followUp" });
	});
}
