/**
 * Spec 119 — goal autonomy (`OMK_GOAL_AUTONOMY=1` only). Hard, recorded stops for the
 * `/goal` loop: user budget/deadline, outcome-unknown side effects, scope pin and
 * explicit-steer revocation. Entries carry ids, counts and sha256 only (G6).
 */
import { createHash } from "node:crypto";
import { takeToolTerminalCause } from "omk-agent-core";
import { DurableGoalError, type DurableGoalSnapshot, nextDurableGoalTimestamp } from "../../durable-goal.ts";
import type { DurableGoalStore } from "../../durable-goal-store.ts";
import type { GoalAcceptance } from "../../goal-acceptance.ts";
import type { GoalAutonomyBudget, GoalAutonomyInput, GoalAutonomyStopReason } from "../../goal-continuation.ts";
import type { ExtensionAPI, ExtensionContext } from "../types.ts";
import { parseGoalBudget } from "./goal-budget-command.ts";
import { GoalBudgetState } from "./goal-budget-state.ts";
import { renderGoal } from "./goal-controller-text.ts";
import { settledRunCostUsd } from "./goal-cost-accounting.ts";

export { parseGoalBudget } from "./goal-budget-command.ts";
export { settledRunCostUsd } from "./goal-cost-accounting.ts";

export const GOAL_AUTONOMY_ENTRY = {
	budget: "goal_autonomy_budget",
	stop: "goal_autonomy_stop",
	revoke: "goal_autonomy_revoke",
	resume: "goal_autonomy_resume",
	rejected: "goal_autonomy_continuation_rejected",
} as const;

/** AU4: only these tools' aborted or timed-out calls make a round's outcome unknown. */
const SIDE_EFFECT_TOOLS: ReadonlySet<string> = new Set(["bash", "edit", "write"]);

type Message = { readonly role?: unknown; readonly [key: string]: unknown };

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** A goal instance: the store id is reused by every `/goal <text>`, so creation time separates them. */
export function goalAutonomyKey(goal: DurableGoalSnapshot): string {
	return `${goal.ref.id}@${goal.createdAt}`;
}

/** AU4: reads the in-memory terminal cause the tool boundary attached; no output text is inspected. */
export function settledRunSideEffect(messages: readonly unknown[]): "ok" | "unknown" {
	let unknown = false;
	for (const raw of messages) {
		if (typeof raw !== "object" || raw === null) continue;
		const message = raw as Message;
		if (message.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
		const cause = takeToolTerminalCause(message.toolCallId);
		if (cause !== undefined && typeof message.toolName === "string" && SIDE_EFFECT_TOOLS.has(message.toolName)) {
			unknown = true;
		}
	}
	return unknown ? "unknown" : "ok";
}

export class GoalAutonomy {
	private readonly omk: Pick<ExtensionAPI, "appendEntry">;
	private readonly acceptance: GoalAcceptance;
	private readonly budgets = new GoalBudgetState();

	restore(entries: readonly unknown[]): void {
		this.budgets.restore(entries);
	}
	private readonly pins = new Map<string, string>();
	private readonly revoked = new Set<string>();
	/** Unknown side effects survive queued turns until the user explicitly resumes this goal instance. */
	private readonly unknownOutcomes = new Set<string>();

	constructor(omk: Pick<ExtensionAPI, "appendEntry">, acceptance: GoalAcceptance) {
		this.omk = omk;
		this.acceptance = acceptance;
	}

	setBudget(goal: DurableGoalSnapshot, budget: GoalAutonomyBudget | null): string {
		const key = goalAutonomyKey(goal);
		const spentUsd = this.budgets.spend.get(key)?.spentUsd;
		const knownSpend = this.budgets.spend.has(key) ? spentUsd : 0;
		this.omk.appendEntry(GOAL_AUTONOMY_ENTRY.budget, {
			accountingVersion: 1,
			spentUsd: knownSpend ?? null,
			cleared: budget === null,
			goalId: goal.ref.id,
			createdAt: goal.createdAt,
			...(budget?.maxCostUsd !== undefined ? { maxCostUsd: budget.maxCostUsd } : {}),
			...(budget?.deadlineIso !== undefined ? { deadlineIso: budget.deadlineIso } : {}),
		});
		if (budget === null) this.budgets.spend.delete(key);
		else this.budgets.spend.set(key, { budget, spentUsd: knownSpend });
		return this.describe(goal);
	}

	/** `/goal budget …`; `false` when `text` is another subcommand. */
	budgetCommand(text: string, existing: DurableGoalSnapshot | null, ctx: Pick<ExtensionContext, "ui">): boolean {
		if (text !== "budget" && !text.startsWith("budget ")) return false;
		if (!existing || existing.status === "completed" || existing.status === "cleared") {
			throw new DurableGoalError("store-missing", "no open durable goal to budget");
		}
		const rest = text.slice("budget".length).trim();
		const line = rest.length === 0 ? this.describe(existing) : this.setBudget(existing, parseGoalBudget(rest));
		ctx.ui.notify(renderGoal(existing, line), "info");
		return true;
	}

	describe(goal: DurableGoalSnapshot): string {
		const spend = this.budgets.spend.get(goalAutonomyKey(goal));
		if (spend === undefined) return "budget: none (set with /goal budget <usd|-> [<deadline ISO>])";
		const cost =
			spend.budget.maxCostUsd === undefined
				? "no cost cap"
				: `$${spend.spentUsd === undefined ? "unknown" : spend.spentUsd.toFixed(4)} of $${spend.budget.maxCostUsd}`;
		return `budget: ${cost}${spend.budget.deadlineIso ? `, deadline ${spend.budget.deadlineIso}` : ""}`;
	}

	/** One settled run: account cost (incl. lanes) and read the side-effect outcome. */
	observe(
		goal: DurableGoalSnapshot,
		messages: readonly unknown[],
		nowMs: number,
		settlementId?: string,
	): GoalAutonomyInput {
		const key = goalAutonomyKey(goal);
		if (settledRunSideEffect(messages) === "unknown") this.unknownOutcomes.add(key);
		const lastSideEffect = this.unknownOutcomes.has(key) ? "unknown" : "ok";
		const spend = this.accountCost(
			goal,
			() => settledRunCostUsd(messages),
			settlementId ?? messages,
			settlementId ?? `legacy-${nowMs}-${goal.ref.revision}`,
		);
		const pin = this.scopePin(goal);
		if (!this.pins.has(key)) this.pins.set(key, pin);
		return {
			...(spend !== undefined ? { budget: spend.budget } : {}),
			spentUsd: spend?.spentUsd,
			lastSideEffect,
			scopeChanged: this.pins.get(key) !== pin,
			nowMs,
		};
	}

	/** Cost-only delivery: no side-effect reduction, scope pin, acceptance or round advancement. */
	observeCost(goal: DurableGoalSnapshot, cost: number | undefined, settlementId: string) {
		const previous = this.budgets.spend.get(goalAutonomyKey(goal))?.spentUsd;
		if (previous !== undefined && cost !== undefined && !Number.isFinite(previous + cost)) cost = undefined;
		const spend = this.accountCost(goal, () => cost, settlementId, settlementId);
		return { budget: spend?.budget, spentUsd: spend?.spentUsd };
	}

	private accountCost(
		goal: DurableGoalSnapshot,
		readCost: () => number | undefined,
		identity: string | object,
		settlementId: string,
	) {
		const key = goalAutonomyKey(goal);
		const spend = this.budgets.spend.get(key);
		if (this.budgets.admit(key, identity) && spend !== undefined) {
			const cost = readCost();
			this.omk.appendEntry("goal_autonomy_spend", {
				goalId: goal.ref.id,
				createdAt: goal.createdAt,
				settlementId,
				costUsd: cost ?? null,
			});
			spend.spentUsd = cost === undefined || spend.spentUsd === undefined ? undefined : spend.spentUsd + cost;
		}
		return spend;
	}

	/** AU3: objective, approved command (sha256) and contract revision. */
	private scopePin(goal: DurableGoalSnapshot): string {
		const command = this.acceptance.approvedCommand(goal);
		const identity = this.acceptance.checkIdentity(goal);
		return `${sha256(goal.objective)}:${identity?.revision ?? 0}:${command === undefined ? "" : sha256(command)}`;
	}

	/** G8: no auto-continue after a revoke or a stop (any reason, known or not) without a later resume. */
	mayContinue(goal: DurableGoalSnapshot, ctx: Pick<ExtensionContext, "sessionManager">): boolean {
		if (this.revoked.has(goalAutonomyKey(goal))) return false;
		const entries = ctx.sessionManager.getEntries();
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
			if (entry.type !== "custom" || typeof entry.customType !== "string") continue;
			if (!entry.customType.startsWith("goal_autonomy_")) continue;
			const data = (entry.data ?? {}) as { goalId?: unknown; createdAt?: unknown };
			if (data.goalId !== goal.ref.id || data.createdAt !== goal.createdAt) continue;
			if (entry.customType === GOAL_AUTONOMY_ENTRY.resume) return true;
			if (entry.customType === GOAL_AUTONOMY_ENTRY.stop || entry.customType === GOAL_AUTONOMY_ENTRY.revoke) {
				return false;
			}
		}
		return true;
	}

	/** AU4/AU3: record the stop (no prompt or command text) and block the goal. */
	async stop(
		store: DurableGoalStore,
		goal: DurableGoalSnapshot,
		reason: GoalAutonomyStopReason,
		ctx: Pick<ExtensionContext, "ui">,
	): Promise<void> {
		this.omk.appendEntry(GOAL_AUTONOMY_ENTRY.stop, {
			goalId: goal.ref.id,
			createdAt: goal.createdAt,
			reason,
			round: goal.completedRounds,
			revision: goal.ref.revision,
		});
		const latest = await store.current();
		if (latest?.status === "active" && goalAutonomyKey(latest) === goalAutonomyKey(goal)) {
			await store.transition(
				{ kind: "block", ref: latest.ref, reason: `goal autonomy stop: ${reason}` },
				nextDurableGoalTimestamp(latest),
			);
		}
		const hint =
			reason === "scope-changed" ? "; re-approve the scope, then /goal resume" : "; /goal resume continues";
		ctx.ui.notify(`goal blocked: goal autonomy stop: ${reason}${hint}`, "error");
	}

	/** AU2: an explicit user steer pauses the goal and revokes the pending continuation. */
	async revoke(store: DurableGoalStore, ctx: Pick<ExtensionContext, "ui">): Promise<void> {
		const current = await store.current();
		if (current?.status !== "active") return;
		this.revoked.add(goalAutonomyKey(current));
		this.omk.appendEntry(GOAL_AUTONOMY_ENTRY.revoke, {
			goalId: current.ref.id,
			createdAt: current.createdAt,
			round: current.completedRounds,
		});
		await store.transition({ kind: "pause", ref: current.ref }, nextDurableGoalTimestamp(current));
		ctx.ui.notify("goal paused by your steer; /goal resume continues it", "info");
	}

	/** Continuations refused after a revoke, process-wide; numbers only. */
	rejectedContinuations = 0;

	/** AU2: a refused late continuation is counted and logged with numbers only (no text, no ids). */
	rejectContinuation(goal: DurableGoalSnapshot): void {
		this.rejectedContinuations += 1;
		this.omk.appendEntry(GOAL_AUTONOMY_ENTRY.rejected, {
			round: goal.completedRounds,
			revision: goal.ref.revision,
			count: this.rejectedContinuations,
		});
	}

	isRevoked(goal: DurableGoalSnapshot): boolean {
		return this.revoked.has(goalAutonomyKey(goal));
	}

	/** G8: explicit `/goal resume` re-pins the current scope and revision. */
	resumed(goal: DurableGoalSnapshot): void {
		const key = goalAutonomyKey(goal);
		this.revoked.delete(key);
		this.unknownOutcomes.delete(key);
		this.pins.set(key, this.scopePin(goal));
		this.omk.appendEntry(GOAL_AUTONOMY_ENTRY.resume, {
			goalId: goal.ref.id,
			createdAt: goal.createdAt,
			round: goal.completedRounds,
			revision: goal.ref.revision,
		});
		// An unknown cost stays unknown: resuming never resets the spend to 0.
	}

	forget(goal: DurableGoalSnapshot): void {
		const key = goalAutonomyKey(goal);
		this.budgets.spend.delete(key);
		this.pins.delete(key);
		this.revoked.delete(key);
		this.unknownOutcomes.delete(key);
	}
}
