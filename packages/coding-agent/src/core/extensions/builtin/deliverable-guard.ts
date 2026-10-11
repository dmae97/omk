import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildRestoreMessage,
	buildWatchdogMessage,
	DELIVERABLE_RESTORE_FRACTION,
	DELIVERABLE_WATCHDOG_FRACTION,
	type Deliverable,
	extractDeliverables,
	resolveDeliverableGuardMode,
	runBudgetFraction,
} from "../../deliverable-guard.ts";
import { DeliverableStore, type RestoreRecord } from "../../deliverable-store.ts";
import { appendRunLog, type RunLogRecord, type RunLogValue } from "../../run-log.ts";
import type { ExtensionAPI } from "../types.ts";

/** Session entry and event-bus channel for restores and the per-settle summary. */
export const DELIVERABLE_GUARD_ENTRY = "deliverable_guard";
export const DELIVERABLE_GUARD_EVENT = "deliverable_guard";
/** `<OMK_RUN_LOG_DIR>/deliverable-guard.jsonl`: steers, restore-point verdicts, restores and summaries (spec 042). */
export const DELIVERABLE_GUARD_RUN_LOG = "deliverable-guard";

/** Drops undefined fields; records hold paths, reasons and numbers only (spec 042 privacy rule). */
function toRunLogRecord(fields: Readonly<Record<string, unknown>>): RunLogRecord {
	const record: Record<string, RunLogValue> = {};
	for (const [key, value] of Object.entries(fields)) if (value !== undefined) record[key] = value as RunLogValue;
	return record;
}

/** How often the timer looks at the clock, so a long single stream still hits 40% and 90%. */
export const DELIVERABLE_GUARD_POLL_MS = 5000;

export interface DeliverableGuardTimers {
	setInterval(fn: () => unknown, ms: number): unknown;
	clearInterval(handle: unknown): void;
}

export interface DeliverableGuardOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => number;
	/**
	 * Elapsed fraction of the run's time budget, or undefined without a budget.
	 * Default: the shared run clock (`readRunBudget()?.elapsedFraction`, spec 036), falling
	 * back to `OMK_TIME_BUDGET_SEC` from load time when no clock is bound, as finish-check does.
	 * The guard's own checks are run time, not harness waits, so nothing is excluded.
	 */
	readonly budgetFraction?: () => number | undefined;
	readonly timers?: DeliverableGuardTimers;
	/** Where last-good copies live; default `<tmpdir>/omk-deliverables/<pid>`. */
	readonly storeRoot?: string;
	/** Receives each run-log record; default `appendRunLog("deliverable-guard", record)` (spec 042). */
	readonly runLog?: (record: RunLogRecord) => void;
	/** Registers the SIGTERM handler; returns its remover. */
	readonly onTerminate?: (handler: () => void) => () => void;
}

/** A `setInterval` that does not keep the process alive. */
export function unrefInterval(fn: () => unknown, ms: number): NodeJS.Timeout {
	const handle = setInterval(fn, ms);
	handle.unref();
	return handle;
}

const DEFAULT_TIMERS: DeliverableGuardTimers = {
	setInterval: unrefInterval,
	clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

const onSigterm = (handler: () => void) => {
	process.on("SIGTERM", handler);
	return () => {
		process.off("SIGTERM", handler);
	};
};

/**
 * Spec 034, opt-in with `OMK_DELIVERABLE_GUARD`: keeps the last valid copy of each
 * output file the prompt names, steers once at 40% of the budget when one is
 * missing, and puts the copy back when the file is missing or broken at 90%, at
 * settle (before finish-check's turn) and, best effort, on SIGTERM.
 */
export default function deliverableGuard(omk: ExtensionAPI, options: DeliverableGuardOptions = {}): void {
	const env = options.env ?? process.env;
	const mode = resolveDeliverableGuardMode(env.OMK_DELIVERABLE_GUARD);
	if (mode === "off") return;
	const fraction = options.budgetFraction ?? runBudgetFraction(env, options.now ?? (() => performance.now()));
	const timers = options.timers ?? DEFAULT_TIMERS;
	const runLog =
		options.runLog ?? ((record: RunLogRecord) => appendRunLog(DELIVERABLE_GUARD_RUN_LOG, record, { env }));
	const log = (fields: Readonly<Record<string, unknown>>) => runLog(toRunLogRecord(fields));
	const store = new DeliverableStore(options.storeRoot ?? join(tmpdir(), "omk-deliverables", String(process.pid)));

	let deliverables: Deliverable[] = [];
	let watchdogDone = false;
	let budgetRestoreDone = false;
	let steers = 0;
	let restored = 0;
	let timer: unknown;
	let removeSignal: (() => void) | undefined;
	let chain: Promise<void> = Promise.resolve();

	// Events and the timer can overlap; run the guard's file work one step at a time and never throw.
	const serial = (work: () => Promise<void>): Promise<void> => {
		chain = chain.then(work).catch(() => {});
		return chain;
	};

	const record = (point: "budget" | "settle", records: readonly RestoreRecord[]) => {
		for (const entry of records) {
			const data = { ...entry, point };
			omk.appendEntry(DELIVERABLE_GUARD_ENTRY, data);
			omk.events.emit(DELIVERABLE_GUARD_EVENT, data);
			log({ type: "restore", ...data });
			if (entry.outcome === "restored") restored += 1;
		}
	};
	const steer = (kind: "watchdog" | "restore", paths: readonly string[], text: string) => {
		steers += 1;
		log({ type: "steer", kind, paths });
		omk.sendUserMessage(text, { deliverAs: "steer" });
	};
	const restoreBroken = (point: "budget" | "settle") =>
		store.restoreBroken(deliverables, (path, check, decision) =>
			log({ type: "verdict", path, point, ok: check.ok, reason: check.reason, ms: check.ms, decision }),
		);

	const checkPoints = async () => {
		if (deliverables.length === 0) return;
		const elapsed = fraction();
		if (elapsed === undefined) return;
		if (!watchdogDone && elapsed >= DELIVERABLE_WATCHDOG_FRACTION) {
			watchdogDone = true;
			const missing = store.missing(deliverables);
			if (missing.length > 0) steer("watchdog", missing, buildWatchdogMessage(missing));
		}
		if (!budgetRestoreDone && elapsed >= DELIVERABLE_RESTORE_FRACTION) {
			budgetRestoreDone = true;
			const records = await restoreBroken("budget");
			record("budget", records);
			const notes = records.flatMap((entry) =>
				entry.outcome === "restored" && entry.restoredSize !== undefined
					? [{ ...entry, restoredSize: entry.restoredSize, sizeLimit: limitOf(entry.path) }]
					: [],
			);
			if (notes.length > 0)
				steer(
					"restore",
					notes.map((note) => note.path),
					buildRestoreMessage(notes),
				);
		}
	};
	const limitOf = (path: string) => deliverables.find((deliverable) => deliverable.path === path)?.sizeLimit;
	const restoreNow = (point: "sigterm" | "shutdown") => {
		for (const entry of store.restoreSync(deliverables)) log({ type: "restore", ...entry, point });
	};

	omk.on("input", (event, ctx) => {
		// Our own follow-ups (finish-check) arrive as extension input; only a new user task resets the guard.
		if (event.source === "extension") return undefined;
		if (mode === "headless" && ctx.hasUI) {
			deliverables = [];
			return undefined;
		}
		deliverables = extractDeliverables(event.text, ctx.cwd);
		store.reset();
		watchdogDone = false;
		budgetRestoreDone = false;
		if (deliverables.length === 0) return undefined;
		if (timer === undefined && fraction() !== undefined)
			timer = timers.setInterval(() => serial(checkPoints), DELIVERABLE_GUARD_POLL_MS);
		if (removeSignal === undefined && !ctx.hasUI)
			removeSignal = (options.onTerminate ?? onSigterm)(() => restoreNow("sigterm"));
		return undefined;
	});

	omk.on("tool_execution_end", () =>
		serial(async () => {
			if (deliverables.length === 0) return;
			await store.observe(deliverables, fraction());
			await checkPoints();
		}),
	);

	omk.on("message_end", (event) => (event.message.role === "assistant" ? serial(checkPoints) : undefined));

	// Registered before finish-check, so its turn sees the restored files.
	omk.on("agent_settled", () =>
		serial(async () => {
			if (deliverables.length === 0) return;
			await store.observe(deliverables, fraction());
			record("settle", await restoreBroken("settle"));
			const summary = { type: "summary" as const, guardMs: store.takeGuardMs(), steers, restores: restored };
			omk.events.emit(DELIVERABLE_GUARD_EVENT, summary);
			log(summary);
		}),
	);

	omk.on("session_shutdown", (event) => {
		if (timer !== undefined) timers.clearInterval(timer);
		timer = undefined;
		// Print mode's SIGTERM listener (registered first) disposes the runtime, which can reach
		// this handler before our own SIGTERM listener runs; put copies back before deleting them.
		if (removeSignal !== undefined && event.reason === "quit") restoreNow("shutdown");
		removeSignal?.();
		removeSignal = undefined;
		store.dispose();
	});
}
