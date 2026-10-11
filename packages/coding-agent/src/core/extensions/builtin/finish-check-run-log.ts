/**
 * Finish-check lines in the shared run log (spec 042): `<OMK_RUN_LOG_DIR>/finish-check.jsonl`.
 * Spec 032 decision 10 (verifier trigger and result) and spec 035 decision 8 (the extra turn).
 * Lines hold paths, numbers, booleans and enums only; `appendRunLog` adds `t`, `elapsedFraction`,
 * `pid` and `role`, so no record here uses those names.
 */
import type { FinishCheckSkipReason, ReverifySkipReason } from "../../finish-check.ts";
import { appendRunLog, type RunLogRecord } from "../../run-log.ts";
import type { ReverifyOutcome } from "./finish-check-reverify-stage.ts";

export const FINISH_CHECK_RUN_LOG = "finish-check";

export type FinishCheckRunLog = (record: RunLogRecord) => void;

/** Writes to `finish-check.jsonl`; a no-op when `OMK_RUN_LOG_DIR` is unset (inside `appendRunLog`). */
export function finishCheckRunLog(env: NodeJS.ProcessEnv): FinishCheckRunLog {
	return (record) => {
		appendRunLog(FINISH_CHECK_RUN_LOG, record, { env });
	};
}

/** Why spec 035's single extra turn was called for, in a fixed order. */
export type ExtraTurnReason = "below-threshold" | "unmeasured" | "reverify-fix";

const fraction = (value: number | undefined): number | null => value ?? null;

/** `reason: "no-check-turn"` means the task's first settle ran no check turn; `checkSkipReason` says why. */
export function reverifyTriggerRecord(
	reason: ReverifySkipReason | "no-check-turn" | undefined,
	firstSettleFraction: number | undefined,
	checkSkipReason: FinishCheckSkipReason | null = null,
): RunLogRecord {
	return {
		type: "reverify-trigger",
		fired: reason === undefined,
		reason: reason ?? null,
		checkSkipReason,
		firstSettleFraction: fraction(firstSettleFraction),
	};
}

export function reverifyResultRecord(
	outcome: ReverifyOutcome,
	fixTurn: boolean,
	fixTurnFraction: number | undefined,
): RunLogRecord {
	return {
		type: "reverify-result",
		verdict: outcome.verdict,
		passed: outcome.findings.filter((finding) => finding.status === "pass").length,
		failed: outcome.findings.filter((finding) => finding.status === "fail").length,
		changed: outcome.changed,
		deliverables: outcome.deliverables,
		toolCalls: outcome.toolCalls,
		verifyStartFraction: fraction(outcome.startFraction),
		verifyEndFraction: fraction(outcome.endFraction),
		...outcome.usage,
		fixTurn,
		fixTurnFraction: fixTurn ? fraction(fixTurnFraction) : null,
	};
}

export function extraTurnRecord(
	counts: { readonly failing: number; readonly unmeasured: number; readonly reverifyFailing: number },
	used: boolean,
	extraTurnFraction: number | undefined,
): RunLogRecord {
	const reasons: ExtraTurnReason[] = [];
	if (counts.failing > 0) reasons.push("below-threshold");
	if (counts.unmeasured > 0) reasons.push("unmeasured");
	if (counts.reverifyFailing > 0) reasons.push("reverify-fix");
	return { type: "extra-turn", used, reasons, extraTurnFraction: fraction(extraTurnFraction) };
}

export interface FinishCheckRunLogger {
	/** Spec 032: the trigger decision when the check turn settles; replaces a held no-check-turn line. */
	trigger(reason: ReverifySkipReason | undefined, firstSettleFraction: number | undefined): void;
	/** Spec 032: the task's first settle ran no check turn; the line waits for the end of the task. */
	holdNoCheckTurn(checkSkipReason: FinishCheckSkipReason, settleFraction: number | undefined): void;
	/** Writes the held no-check-turn line, if any, synchronously and at most once. */
	flush(): void;
	/** Spec 032: the verifier result, and spec 035's decision on the fix turn it may call for. */
	verifyResult(outcome: ReverifyOutcome, checkFailing: number, fixTurn: boolean, fraction: number | undefined): void;
	/** Spec 035: the extra-turn decision when the check turn settles without the verifier. */
	extraTurn(failing: number, unmeasured: number, used: boolean, fraction: number | undefined): void;
}

/** The run-log part of `FinishCheckOptions`. */
export interface FinishCheckRunLogOptions {
	/** Receives run-log records; default `appendRunLog("finish-check", record)` (spec 032 decision 10, spec 042). */
	readonly runLog?: FinishCheckRunLog;
	/** Registers the SIGTERM fallback for a held trigger line; returns its remover. Default `process.on("SIGTERM")`. */
	readonly onTerminate?: (handler: () => void) => () => void;
}

/**
 * Print, json, rpc and interactive modes already exit on SIGTERM through their own listeners. If nobody else
 * listens (an SDK host), the signal is raised again after the flush so the default exit is kept.
 */
const onSigterm = (handler: () => void) => {
	const listener = () => {
		process.off("SIGTERM", listener);
		handler();
		if (process.listenerCount("SIGTERM") === 0) process.kill(process.pid, "SIGTERM");
	};
	process.on("SIGTERM", listener);
	return () => {
		process.off("SIGTERM", listener);
	};
};

/**
 * 032 lines only with `OMK_FINISH_CHECK_REVERIFY` on, 035 lines only with `OMK_FINISH_CHECK_EXTRA_TURN` on,
 * and nothing at all without `OMK_RUN_LOG_DIR` (spec 032 decision 10, spec 035 decision 8). Exactly one
 * trigger line per task: a no-check-turn line is held until the task ends (next user task, session
 * shutdown, or SIGTERM as a fallback) and dropped when a later check turn writes the trigger line instead.
 */
export function createFinishCheckRunLogger(
	env: NodeJS.ProcessEnv,
	options: FinishCheckRunLogOptions,
	flags: { readonly reverify: boolean; readonly extraTurn: boolean },
): FinishCheckRunLogger {
	const write = options.runLog ?? finishCheckRunLog(env);
	let held: RunLogRecord | undefined;
	let removeSignal: (() => void) | undefined;
	const release = () => {
		held = undefined;
		removeSignal?.();
		removeSignal = undefined;
	};
	const flush = () => {
		const record = held;
		release();
		if (record) write(record);
	};
	const extraTurn = (counts: Parameters<typeof extraTurnRecord>[0], used: boolean, fraction: number | undefined) => {
		if (flags.extraTurn) write(extraTurnRecord(counts, used, fraction));
	};
	return {
		trigger(reason, firstSettleFraction) {
			if (!flags.reverify) return;
			release();
			write(reverifyTriggerRecord(reason, firstSettleFraction));
		},
		holdNoCheckTurn(checkSkipReason, settleFraction) {
			if (!flags.reverify || held) return;
			held = reverifyTriggerRecord("no-check-turn", settleFraction, checkSkipReason);
			removeSignal = (options.onTerminate ?? onSigterm)(flush);
		},
		flush,
		verifyResult(outcome, checkFailing, fixTurn, fraction) {
			if (!flags.reverify) return;
			write(reverifyResultRecord(outcome, fixTurn, fraction));
			extraTurn(
				{ failing: checkFailing, unmeasured: 0, reverifyFailing: outcome.failing.length },
				fixTurn,
				fraction,
			);
		},
		extraTurn(failing, unmeasured, used, fraction) {
			extraTurn({ failing, unmeasured, reverifyFailing: 0 }, used, fraction);
		},
	};
}
