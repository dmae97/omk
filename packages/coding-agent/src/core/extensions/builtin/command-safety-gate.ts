/**
 * Built-in command-safety gate extension.
 *
 * Wires the pure `classifyShellCommand` verdict engine into the two live bash
 * entry points:
 * - LLM tool calls (`tool_call` for the `bash` tool) — block-tier verdicts stop
 *   execution via `{ block, reason }`.
 * - User `!`/`!!` bash (`user_bash`) — block/confirm verdicts produce a synthetic
 *   FAILED `BashResult` instead of running the command.
 *
 * Fail-closed contract:
 * - `user_bash` deny NEVER throws. A thrown `user_bash` handler is logged by the
 *   runner and default execution continues (fail-open). Returning a synthetic
 *   failed `result` short-circuits execution safely.
 * - `confirm`-tier verdicts deny by default when no interactive UI is available.
 * - `priv.*` verdicts are never headless-allowed.
 *
 * This gate reuses `command-safety.ts` read-only and adds no new classification
 * branches. `extraDeny` patterns can only promote allow/confirm to block; they
 * can never relax a block verdict.
 */

import type { BashResult } from "../../bash-executor.ts";
import { type CommandVerdict, classifyShellCommand } from "../../command-safety.ts";
import { type ExtensionAPI, isToolCallEventType } from "../types.ts";

/** Confirmation callback. Returns true when the user approves execution. */
export type ConfirmFn = (message: string) => Promise<boolean>;

/** Options controlling how a user `!`/`!!` bash command is evaluated. */
export interface UserBashEvaluateOptions {
	/** Whether a dialog-capable UI is available for confirmation. */
	hasUI: boolean;
	/** Interactive confirmation callback used when `hasUI` is true. */
	confirm?: ConfirmFn;
	/** Headless policy for `confirm`-tier verdicts. `priv.*` is never allowed. Defaults to "deny". */
	headlessConfirmPolicy?: "deny" | "allow";
	/** Extra substrings that promote allow/confirm verdicts to block. Never relaxes a block. */
	extraDeny?: string[];
}

function formatReason(verdict: CommandVerdict): string {
	return `[${verdict.rule}] ${verdict.reason}`;
}

function matchesExtraDeny(command: string, patterns: string[] | undefined): boolean {
	if (!patterns || patterns.length === 0) return false;
	for (const pattern of patterns) {
		if (pattern.length > 0 && command.includes(pattern)) return true;
	}
	return false;
}

/**
 * Classify a command, applying `extraDeny` promotion.
 *
 * `extraDeny` can only escalate allow/confirm to block; an existing block
 * verdict is returned unchanged.
 */
function classifyWithExtraDeny(command: string, extraDeny?: string[]): CommandVerdict {
	const verdict = classifyShellCommand(command);
	if (verdict.risk === "block") return verdict;
	if (matchesExtraDeny(command, extraDeny)) {
		return {
			risk: "block",
			rule: "command.extra_deny",
			reason: "Command matches a configured deny pattern.",
		};
	}
	return verdict;
}

/**
 * Decide whether an LLM `bash` tool call must be blocked.
 *
 * Only block-tier verdicts produce a block here. The `tool_call` path has no
 * confirm UI in this helper, so confirm/allow verdicts pass through.
 */
export function evaluateBashToolCall(
	command: string,
	extraDeny?: string[],
): { block: true; reason: string } | undefined {
	const verdict = classifyWithExtraDeny(command, extraDeny);
	if (verdict.risk === "block") {
		return { block: true, reason: formatReason(verdict) };
	}
	return undefined;
}

/**
 * Decide whether a user `!`/`!!` bash command must be denied.
 *
 * - block  => deny.
 * - confirm => hasUI ? (approved ? undefined : deny) : (policy === "allow" && !priv ? undefined : deny).
 * - allow  => undefined (preserve later extensions / default execution).
 */
export async function evaluateUserBash(
	command: string,
	opts: UserBashEvaluateOptions,
): Promise<{ deny: boolean; reason: string } | undefined> {
	const verdict = classifyWithExtraDeny(command, opts.extraDeny);

	if (verdict.risk === "allow") return undefined;
	if (verdict.risk === "block") {
		return { deny: true, reason: formatReason(verdict) };
	}

	// confirm-tier verdict.
	if (opts.hasUI) {
		if (opts.confirm) {
			const approved = await opts.confirm(formatReason(verdict));
			return approved ? undefined : { deny: true, reason: formatReason(verdict) };
		}
		// UI claimed but no confirm callback: cannot obtain consent => fail-closed.
		return { deny: true, reason: formatReason(verdict) };
	}

	// Headless: privilege escalation is never auto-allowed.
	const isPrivilege = verdict.rule.startsWith("priv.");
	if (!isPrivilege && opts.headlessConfirmPolicy === "allow") {
		return undefined;
	}
	return { deny: true, reason: formatReason(verdict) };
}

/** Build a synthetic failed `BashResult` surfacing the safety reason. */
function buildBlockedBashResult(reason: string): BashResult {
	return {
		output: `command-safety: blocked\n${reason}`,
		exitCode: 1,
		cancelled: false,
		truncated: false,
	};
}

/**
 * Extension factory. Registered as the first extension so its handlers run
 * before any discovered extension (`tool_call` short-circuits on first block;
 * `user_bash` short-circuits on first truthy result).
 */
export default function commandSafetyGate(omk: ExtensionAPI): void {
	omk.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return undefined;
		return evaluateBashToolCall(event.input.command);
	});

	omk.on("user_bash", async (event, ctx) => {
		const decision = await evaluateUserBash(event.command, {
			hasUI: ctx.hasUI,
			confirm: ctx.hasUI ? (message) => ctx.ui.confirm("Command safety", message) : undefined,
			headlessConfirmPolicy: "deny",
		});
		if (decision?.deny) {
			return { result: buildBlockedBashResult(decision.reason) };
		}
		return undefined;
	});
}
