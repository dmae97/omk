/**
 * The spec 032 verifier turn: while it runs, the model input starts at the
 * verifier instruction, `write`/`edit` are blocked, and its tool and time caps
 * apply. The finish-check extension decides when it starts and what follows it.
 */
import { type FinishCheckLedgerItem, parseFinishCheckLedger } from "../../finish-check-requirements.ts";
import {
	buildReverifyMessage,
	FINISH_CHECK_REVERIFY_BLOCK_REASON,
	FINISH_CHECK_REVERIFY_MAX_TOOL_CALLS,
	FINISH_CHECK_REVERIFY_TIME_FRACTION,
	FINISH_CHECK_REVERIFY_WRAP_UP_MESSAGE,
	freshContextMessages,
	parseVerifyReply,
	reverifyDeliverables,
	type VerifyFinding,
	type VerifyUsage,
	type VerifyVerdict,
	verifyUsage,
} from "../../finish-check-reverify.ts";
import { changedDeliverables, hashDeliverables } from "../../finish-check-reverify-hash.ts";
import type { ExtensionAPI } from "../types.ts";

/** Session entry type holding the verifier's result (spec 032). */
export const FINISH_CHECK_VERIFY_ENTRY = "finish_check_verify";

/** The run budget as finish-check reads it: the fields of `RunBudgetSnapshot` (spec 036) that it uses. */
export interface FinishCheckBudget {
	readonly budgetMs: number;
	readonly elapsedMs: number;
	readonly elapsedFraction: number;
}

export type FinishCheckBudgetReader = () => FinishCheckBudget | undefined;

export interface ReverifyStartInput {
	readonly task: string;
	readonly requirements: readonly string[];
	readonly unmeasured: readonly FinishCheckLedgerItem[];
	readonly cwd: string;
}

export interface ReverifyOutcome {
	readonly verdict: VerifyVerdict;
	readonly findings: VerifyFinding[];
	/** FAIL findings that may call for the fix turn: none when the verifier is void or said PASS. */
	readonly failing: VerifyFinding[];
	/** The verifier's own REQ measurements; empty when it is void. */
	readonly ledger: FinishCheckLedgerItem[];
	readonly mutated: boolean;
	/** Deliverable paths whose fingerprint changed during the verifier (paths only). */
	readonly changed: string[];
	/** Number of deliverable paths the verifier checked. */
	readonly deliverables: number;
	readonly toolCalls: number;
	/** Budget fractions when the verifier started and settled; `undefined` without a budget. */
	readonly startFraction: number | undefined;
	readonly endFraction: number | undefined;
	readonly usage: VerifyUsage;
}

export interface ReverifyStage {
	readonly active: boolean;
	/** The verifier ran (or is running) for the current user task. */
	readonly started: boolean;
	reset(): void;
	start(input: ReverifyStartInput): Promise<void>;
	finish(messages: readonly unknown[], reply: string): Promise<ReverifyOutcome>;
}

const isFileWrite = (toolName: string) => toolName === "write" || toolName === "edit";

export function createReverifyStage(omk: ExtensionAPI, readBudget: FinishCheckBudgetReader): ReverifyStage {
	let active = false;
	let started = false;
	let written: string[] = [];
	let toolCalls = 0;
	let wrappedUp = false;
	let startElapsedMs = 0;
	let startFraction: number | undefined;
	let paths: string[] = [];
	let before: Record<string, string> = {};
	let cwd = "";
	let requirements: readonly string[] = [];

	const maybeWrapUp = () => {
		if (!active || wrappedUp) return;
		const budget = readBudget();
		const overTime =
			budget !== undefined &&
			budget.elapsedMs - startElapsedMs >= FINISH_CHECK_REVERIFY_TIME_FRACTION * budget.budgetMs;
		if (toolCalls < FINISH_CHECK_REVERIFY_MAX_TOOL_CALLS && !overTime) return;
		wrappedUp = true;
		omk.sendUserMessage(FINISH_CHECK_REVERIFY_WRAP_UP_MESSAGE, { deliverAs: "steer" });
	};

	omk.on("tool_execution_start", (event) => {
		const path = (event.args as { path?: unknown } | undefined)?.path;
		if (!active && isFileWrite(event.toolName) && typeof path === "string") written.push(path);
	});
	omk.on("tool_call", (event) =>
		active && isFileWrite(event.toolName) ? { block: true, reason: FINISH_CHECK_REVERIFY_BLOCK_REASON } : undefined,
	);
	omk.on(
		"context",
		(event) => {
			const messages = active ? freshContextMessages(event.messages) : undefined;
			return messages ? { messages } : undefined;
		},
		{ mutatesMessages: false },
	);
	omk.on("tool_execution_end", () => {
		if (active) toolCalls += 1;
		maybeWrapUp();
	});
	omk.on("message_end", (event) => {
		if (event.message.role === "assistant") maybeWrapUp();
	});

	return {
		get active() {
			return active;
		},
		get started() {
			return started;
		},
		reset() {
			active = false;
			started = false;
			written = [];
		},
		async start(input) {
			started = true;
			cwd = input.cwd;
			requirements = input.requirements;
			paths = reverifyDeliverables(written, input.requirements);
			before = await hashDeliverables(paths, cwd);
			toolCalls = 0;
			wrappedUp = false;
			const budget = readBudget();
			startElapsedMs = budget?.elapsedMs ?? 0;
			startFraction = budget?.elapsedFraction;
			active = true;
			omk.sendUserMessage(buildReverifyMessage({ ...input, deliverables: paths }), { deliverAs: "followUp" });
		},
		async finish(messages, reply) {
			active = false;
			const changed = changedDeliverables(before, await hashDeliverables(paths, cwd));
			const mutated = changed.length > 0;
			const parsed = parseVerifyReply(reply);
			const verdict: VerifyVerdict = mutated ? "void" : parsed.verdict;
			const usage = verifyUsage(messages);
			const end = readBudget();
			omk.appendEntry(FINISH_CHECK_VERIFY_ENTRY, {
				verdict,
				findings: parsed.findings,
				toolCalls,
				elapsedMs: Math.max(0, (end?.elapsedMs ?? startElapsedMs) - startElapsedMs),
				mutated,
				changed,
				paths,
				...usage,
			});
			return {
				verdict,
				findings: parsed.findings,
				failing: mutated ? [] : parsed.failing,
				ledger: mutated || requirements.length === 0 ? [] : parseFinishCheckLedger(reply, requirements),
				mutated,
				changed,
				deliverables: paths.length,
				toolCalls,
				startFraction,
				endFraction: end?.elapsedFraction,
				usage,
			};
		},
	};
}
