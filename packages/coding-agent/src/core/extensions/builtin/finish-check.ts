import {
	FINISH_CHECK_SAVE_NOW_FRACTION,
	FINISH_CHECK_SAVE_NOW_MESSAGE,
	FINISH_CHECK_WRAP_UP_MESSAGE,
	finishDisciplinePrompt,
	isWorkspaceMutatingTool,
	resolveFinishCheckMode,
	shouldRunFinishCheck,
} from "../../finish-check.ts";
import {
	buildFinishCheckMessage,
	extractRequirements,
	finishCheckToolCap,
	parseFinishCheckLedger,
} from "../../finish-check-requirements.ts";
import { requestPreCheckSnapshot, resolveSnapshotHandshake } from "../../finish-check-snapshot.ts";
import { createRemainingBudgetFromEnv, ensureActiveRemainingBudget } from "../../remaining-budget.ts";
import type { ExtensionAPI } from "../types.ts";

export interface FinishCheckOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}

/** Event-bus channel for the verification turn: `{ active: true }` when it starts, `{ active: false, ledger }` when it ends. */
export const FINISH_CHECK_EVENT = "finish_check";
/** Session entry type holding the measured checklist results of a finish check. */
export const FINISH_CHECK_LEDGER_ENTRY = "finish_check_ledger";

function assistantText(message: unknown): string {
	const content = (message as { role?: string; content?: unknown } | undefined)?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: { type?: string; text?: string }) => (part?.type === "text" ? (part.text ?? "") : ""))
		.join("\n");
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
	// One clock for the whole run: bash timeouts, the 75%/90% thresholds and the stall detector all read it.
	// Tests inject env and get a private clock so nothing leaks between them.
	const budget =
		options.env === undefined ? ensureActiveRemainingBudget({ now }) : createRemainingBudgetFromEnv({ env, now });
	const budgetMs = budget?.budgetMs;
	const snapshot = resolveSnapshotHandshake(env);
	let snapshotSequence = 0;
	const elapsedFraction = () => budget?.elapsedFraction();

	let mutated = false;
	let checked = false;
	let warnedSaveNow = false;
	let checkToolCalls = 0;
	let wrappedUp = false;
	let checkActive = false;
	let requirements: string[] = [];

	omk.on("input", (event) => {
		// Our own follow-up arrives as extension input; only a new user task resets the check.
		if (event.source !== "extension") {
			mutated = false;
			checked = false;
			checkToolCalls = 0;
			wrappedUp = false;
			requirements = extractRequirements(event.text);
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
			if (checkToolCalls >= finishCheckToolCap(requirements.length)) {
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
		if (checkActive) {
			checkActive = false;
			const ledger = requirements.length > 0 ? parseFinishCheckLedger(assistantText(last), requirements) : [];
			if (ledger.length > 0) omk.appendEntry(FINISH_CHECK_LEDGER_ENTRY, { items: ledger });
			omk.events.emit(FINISH_CHECK_EVENT, { active: false, ledger });
			return;
		}
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
			// Time spent waiting for a harness snapshot is not part of the run's budget.
			budget?.addExcludedWaitMs(result.waitedMs);
		}
		checkActive = true;
		omk.events.emit(FINISH_CHECK_EVENT, { active: true, requirements: [...requirements] });
		omk.sendUserMessage(buildFinishCheckMessage(requirements), { deliverAs: "followUp" });
	});
}
