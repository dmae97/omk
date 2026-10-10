import {
	decideExtraTurn,
	FINISH_CHECK_EXTRA_TURN_STOP_MESSAGE,
	FINISH_CHECK_SAVE_NOW_FRACTION,
	FINISH_CHECK_SAVE_NOW_MESSAGE,
	FINISH_CHECK_SKIP_FRACTION,
	FINISH_CHECK_WRAP_UP_MESSAGE,
	finishDisciplinePrompt,
	isWorkspaceMutatingTool,
	resolveFinishCheckExtraTurn,
	resolveFinishCheckMode,
	shouldAddFinishDiscipline,
	shouldRunFinishCheck,
} from "../../finish-check.ts";
import {
	buildFinishCheckContinueMessage,
	buildFinishCheckMessage,
	extractRequirements,
	extraTurnItems,
	finishCheckToolCap,
	hasFinishCheckLedgerLines,
	parseFinishCheckLedger,
} from "../../finish-check-requirements.ts";
import { requestPreCheckSnapshot, resolveSnapshotHandshake } from "../../finish-check-snapshot.ts";
import { excludeRunBudgetWaitMs, readRunBudget, resolveTimeBudgetMs } from "../../remaining-budget.ts";
import type { ExtensionAPI } from "../types.ts";
import type { FinishCheckBudgetReader } from "./finish-check-reverify-stage.ts";

export interface FinishCheckOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
	/** Budget source for every finish-check threshold and spec 032's trigger; defaults to the shared run clock. */
	readonly readBudget?: FinishCheckBudgetReader;
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
 * The text the turn's REQ lines are read from: the latest assistant message of
 * this run that has any, else the last assistant message. `messages` holds only
 * the run that just settled, so an earlier turn's lines are never read.
 */
function ledgerReply(messages: readonly unknown[]): string {
	let fallback: string | undefined;
	for (let index = messages.length - 1; index >= 0; index--) {
		if ((messages[index] as { role?: string } | undefined)?.role !== "assistant") continue;
		const text = assistantText(messages[index]);
		if (hasFinishCheckLedgerLines(text)) return text;
		fallback ??= text;
	}
	return fallback ?? "";
}

/**
 * In headless runs (or with `OMK_FINISH_CHECK=always`), adds finish discipline
 * to the system prompt and one verification turn after a run that changed the
 * workspace. With `OMK_TIME_BUDGET_SEC` it also tells the run to save its
 * outputs at 75%.
 */
export default function finishCheck(omk: ExtensionAPI, options: FinishCheckOptions = {}): void {
	const env = options.env ?? process.env;
	const now = options.now ?? (() => performance.now());
	const mode = resolveFinishCheckMode(env.OMK_FINISH_CHECK);
	if (mode === "off") return;
	const budgetMs = resolveTimeBudgetMs(env.OMK_TIME_BUDGET_SEC);
	// Spec 035's extra turn (and its 90% stop steer) is opt-in; off, the check ends as it did before.
	const extraTurnEnabled = resolveFinishCheckExtraTurn(env.OMK_FINISH_CHECK_EXTRA_TURN);
	const snapshot = resolveSnapshotHandshake(env);
	// Spec 036: the 0.75 / 0.85 / 0.90 checks read the shared run clock, which starts at process
	// start in `runPrintMode`, so finish-check, the bash clamp and spec 033 agree on one origin.
	// Without a bound clock (interactive `OMK_FINISH_CHECK=always`, unit tests) a local clock from
	// extension load is kept, exactly as before.
	let startedAt = now();
	let snapshotSequence = 0;
	const localBudget: FinishCheckBudgetReader = () =>
		budgetMs === undefined
			? undefined
			: { budgetMs, elapsedMs: now() - startedAt, elapsedFraction: (now() - startedAt) / budgetMs };
	// One budget source for the 0.75 / 0.85 / 0.90 checks and spec 032's 0.30 trigger.
	const readBudget = options.readBudget ?? (() => readRunBudget() ?? localBudget());
	const elapsedFraction = (): number | undefined => readBudget()?.elapsedFraction;

	let mutated = false;
	let checked = false;
	let warnedSaveNow = false;
	let checkToolCalls = 0;
	let wrappedUp = false;
	let checkActive = false;
	let extraTurnActive = false;
	let extraTurnsUsed = 0;
	let stoppedExtraTurn = false;
	let requirements: string[] = [];

	omk.on("input", (event) => {
		// Our own follow-up arrives as extension input; only a new user task resets the check.
		if (event.source !== "extension") {
			mutated = false;
			checked = false;
			checkToolCalls = 0;
			wrappedUp = false;
			extraTurnActive = false;
			extraTurnsUsed = 0;
			stoppedExtraTurn = false;
			requirements = extractRequirements(event.text);
		}
		return undefined;
	});

	omk.on("before_agent_start", (event, ctx) => {
		if (!shouldAddFinishDiscipline(mode, ctx.hasUI)) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${finishDisciplinePrompt(budgetMs)}` };
	});

	const maybeWarnSaveNow = () => {
		const fraction = elapsedFraction();
		if (!warnedSaveNow && fraction !== undefined && fraction >= FINISH_CHECK_SAVE_NOW_FRACTION) {
			warnedSaveNow = true;
			omk.sendUserMessage(FINISH_CHECK_SAVE_NOW_MESSAGE, { deliverAs: "steer" });
		}
		// The extra turn has no tool cap; at 90% it is told once to keep its best result and stop.
		if (extraTurnActive && !stoppedExtraTurn && fraction !== undefined && fraction >= FINISH_CHECK_SKIP_FRACTION) {
			stoppedExtraTurn = true;
			omk.sendUserMessage(FINISH_CHECK_EXTRA_TURN_STOP_MESSAGE, { deliverAs: "steer" });
		}
	};

	omk.on("tool_execution_end", (event) => {
		if (isWorkspaceMutatingTool(event.toolName)) mutated = true;
		maybeWarnSaveNow();
		// With the extra turn on, only the check turn is capped (the extra turn is ordinary work);
		// off, the cap counts from the check to the next user task, as before spec 035.
		if ((extraTurnEnabled ? checkActive : checked) && !wrappedUp) {
			checkToolCalls += 1;
			if (checkToolCalls >= finishCheckToolCap(requirements.length)) {
				wrappedUp = true;
				omk.sendUserMessage(FINISH_CHECK_WRAP_UP_MESSAGE, { deliverAs: "steer" });
			}
		}
	});

	// Long reasoning can pass 75% (or 90% in the extra turn) without any tool finishing; check when each assistant message ends too.
	omk.on("message_end", (event) => {
		if (event.message.role === "assistant") maybeWarnSaveNow();
	});

	omk.on("agent_settled", async (event, ctx) => {
		const last = event.messages.at(-1);
		const aborted = last?.role === "assistant" && (last.stopReason === "aborted" || last.stopReason === "error");
		if (extraTurnActive) {
			// The extra turn's REQ lines are recorded; nothing follows it, whatever they say.
			extraTurnActive = false;
			const ledger = parseFinishCheckLedger(ledgerReply(event.messages), requirements);
			omk.appendEntry(FINISH_CHECK_LEDGER_ENTRY, { items: ledger, round: 2 });
			omk.events.emit(FINISH_CHECK_EVENT, { active: false, ledger, round: 2 });
			return;
		}
		if (checkActive) {
			checkActive = false;
			const ledger =
				requirements.length > 0 ? parseFinishCheckLedger(ledgerReply(event.messages), requirements) : [];
			if (ledger.length > 0) omk.appendEntry(FINISH_CHECK_LEDGER_ENTRY, { items: ledger });
			const { failing, unmeasured } = extraTurnItems(ledger);
			const extraTurn =
				extraTurnEnabled &&
				decideExtraTurn({
					extraTurnsUsed,
					failing: failing.length,
					unmeasured: unmeasured.length,
					aborted,
					hasPendingMessages: ctx.hasPendingMessages(),
					elapsedFraction: elapsedFraction(),
				});
			if (!extraTurn) {
				omk.events.emit(FINISH_CHECK_EVENT, { active: false, ledger });
				return;
			}
			extraTurnsUsed += 1;
			extraTurnActive = true;
			const extraTurnIds = [...failing, ...unmeasured].map((item) => item.id);
			omk.events.emit(FINISH_CHECK_EVENT, { active: false, ledger, extraTurn, extraTurnIds });
			omk.sendUserMessage(buildFinishCheckContinueMessage(ledger), { deliverAs: "followUp" });
			return;
		}
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
			if (readRunBudget()) excludeRunBudgetWaitMs(result.waitedMs);
			else startedAt += result.waitedMs;
		}
		checkActive = true;
		omk.events.emit(FINISH_CHECK_EVENT, { active: true, requirements: [...requirements] });
		omk.sendUserMessage(buildFinishCheckMessage(requirements), { deliverAs: "followUp" });
	});
}
