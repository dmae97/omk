import type { ImageContent } from "omk-ai";
import type { DurableGoalStatus } from "./durable-goal.ts";
import { isDefaultOnEnvFlag } from "./env-flag.ts";

/** Spec 119: default on; only `0`/`false`/`off` (case-insensitive, trimmed) opt out. */
export function goalAutonomyEnabled(): boolean {
	return isDefaultOnEnvFlag(process.env.OMK_GOAL_AUTONOMY);
}

/** Spec 119: the autonomy round cap; the model cannot raise it. */
export const GOAL_AUTONOMY_MAX_ROUNDS = 8;

/** Spec 119: user-set via `/goal budget` only. */
export interface GoalAutonomyBudget {
	readonly maxCostUsd?: number;
	readonly deadlineIso?: string;
}

/** Spec 119 inputs; ignored unless `OMK_GOAL_AUTONOMY=1`. */
export interface GoalAutonomyInput {
	readonly budget?: GoalAutonomyBudget;
	/** Cost since the budget was set, incl. subagent lanes; `undefined` = undeterminable. */
	readonly spentUsd: number | undefined;
	readonly lastSideEffect: "ok" | "unknown";
	readonly scopeChanged: boolean;
	readonly nowMs: number;
}

export interface GoalContinuationInput {
	readonly status: DurableGoalStatus;
	readonly completedRounds: number;
	readonly maxRounds: number;
	readonly hasQueuedMessages: boolean;
	readonly autonomy?: GoalAutonomyInput;
}

export const GOAL_AUTONOMY_STOP_REASONS = ["budget-limit", "deadline", "outcome-unknown", "scope-changed"] as const;
export type GoalAutonomyStopReason = (typeof GOAL_AUTONOMY_STOP_REASONS)[number];

export interface GoalContinuationDecision {
	readonly continue: boolean;
	readonly reason: "active-goal" | "queued" | "not-active" | "round-limit" | GoalAutonomyStopReason;
}

export function decideGoalContinuation(input: GoalContinuationInput): GoalContinuationDecision {
	if (input.hasQueuedMessages) return { continue: true, reason: "queued" };
	if (input.status !== "active") return { continue: false, reason: "not-active" };
	const autonomy = goalAutonomyEnabled() ? input.autonomy : undefined;
	if (autonomy !== undefined) {
		if (autonomy.lastSideEffect !== "ok") return { continue: false, reason: "outcome-unknown" };
		if (autonomy.scopeChanged) return { continue: false, reason: "scope-changed" };
		const max = autonomy.budget?.maxCostUsd;
		if (max !== undefined) {
			const spent = autonomy.spentUsd;
			if (spent === undefined || !Number.isFinite(spent) || !Number.isFinite(max) || spent >= max) {
				return { continue: false, reason: "budget-limit" };
			}
		}
		const deadline = autonomy.budget?.deadlineIso;
		if (deadline !== undefined) {
			const at = Date.parse(deadline);
			if (!Number.isFinite(at) || autonomy.nowMs >= at) return { continue: false, reason: "deadline" };
		}
		if (input.completedRounds >= Math.min(input.maxRounds, GOAL_AUTONOMY_MAX_ROUNDS)) {
			return { continue: false, reason: "round-limit" };
		}
		return { continue: true, reason: "active-goal" };
	}
	if (input.completedRounds >= input.maxRounds) return { continue: false, reason: "round-limit" };
	return { continue: true, reason: "active-goal" };
}

/**
 * Spec 119: with the flag on, `AgentSession.steer()` (RPC `steer`) emits the existing `input` event as an
 * explicit steer. Flag off: no event, text and images unchanged. `undefined` = an extension handled it.
 */
export async function goalAutonomySteerInput(
	runner: {
		hasHandlers(event: "input"): boolean;
		emitInput(
			text: string,
			images: ImageContent[] | undefined,
			source: "rpc",
			streamingBehavior: "steer",
		): Promise<
			{ action: "continue" } | { action: "transform"; text: string; images?: ImageContent[] } | { action: "handled" }
		>;
	},
	text: string,
	images: ImageContent[] | undefined,
): Promise<{ readonly text: string; readonly images: ImageContent[] | undefined } | undefined> {
	if (!goalAutonomyEnabled() || !runner.hasHandlers("input")) return { text, images };
	const result = await runner.emitInput(text, images, "rpc", "steer");
	if (result.action === "handled") return undefined;
	return result.action === "transform" ? { text: result.text, images: result.images ?? images } : { text, images };
}
