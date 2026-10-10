import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	budgetFractionFromEnv,
	buildRestoreMessage,
	buildWatchdogMessage,
	DELIVERABLE_RESTORE_FRACTION,
	DELIVERABLE_WATCHDOG_FRACTION,
	type Deliverable,
	extractDeliverables,
	resolveDeliverableGuardMode,
} from "../../deliverable-guard.ts";
import { DeliverableStore, type RestoreRecord } from "../../deliverable-store.ts";
import type { ExtensionAPI } from "../types.ts";

/** Session entry and event-bus channel for restores and the per-settle summary. */
export const DELIVERABLE_GUARD_ENTRY = "deliverable_guard";
export const DELIVERABLE_GUARD_EVENT = "deliverable_guard";
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
	 * Default: `OMK_TIME_BUDGET_SEC` from the time the extension loads, as finish-check
	 * does on main. After #63 lands this becomes `() => readRunBudget()?.elapsedFraction`.
	 */
	readonly budgetFraction?: () => number | undefined;
	readonly timers?: DeliverableGuardTimers;
	/** Where last-good copies live; default `<tmpdir>/omk-deliverables/<pid>`. */
	readonly storeRoot?: string;
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
	const fraction = options.budgetFraction ?? budgetFractionFromEnv(env, options.now ?? Date.now);
	const timers = options.timers ?? DEFAULT_TIMERS;
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
			if (entry.outcome === "restored") restored += 1;
		}
	};

	const checkPoints = async () => {
		if (deliverables.length === 0) return;
		const elapsed = fraction();
		if (elapsed === undefined) return;
		if (!watchdogDone && elapsed >= DELIVERABLE_WATCHDOG_FRACTION) {
			watchdogDone = true;
			const missing = store.missing(deliverables);
			if (missing.length > 0) {
				steers += 1;
				omk.sendUserMessage(buildWatchdogMessage(missing), { deliverAs: "steer" });
			}
		}
		if (!budgetRestoreDone && elapsed >= DELIVERABLE_RESTORE_FRACTION) {
			budgetRestoreDone = true;
			const records = await store.restoreBroken(deliverables);
			record("budget", records);
			const notes = records.flatMap((entry) =>
				entry.outcome === "restored" && entry.restoredSize !== undefined
					? [{ ...entry, restoredSize: entry.restoredSize, sizeLimit: limitOf(entry.path) }]
					: [],
			);
			if (notes.length > 0) {
				steers += 1;
				omk.sendUserMessage(buildRestoreMessage(notes), { deliverAs: "steer" });
			}
		}
	};
	const limitOf = (path: string) => deliverables.find((deliverable) => deliverable.path === path)?.sizeLimit;

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
			removeSignal = (options.onTerminate ?? onSigterm)(() => store.restoreSync(deliverables));
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
			record("settle", await store.restoreBroken(deliverables));
			omk.events.emit(DELIVERABLE_GUARD_EVENT, {
				type: "summary",
				guardMs: store.takeGuardMs(),
				steers,
				restores: restored,
			});
		}),
	);

	omk.on("session_shutdown", () => {
		if (timer !== undefined) timers.clearInterval(timer);
		timer = undefined;
		removeSignal?.();
		removeSignal = undefined;
		store.dispose();
	});
}
