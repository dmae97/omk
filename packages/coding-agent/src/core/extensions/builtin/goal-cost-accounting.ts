import { join } from "node:path";
import type { DurableGoalSnapshot } from "../../durable-goal.ts";
import { DurableGoalStore } from "../../durable-goal-store.ts";
import type { GoalAutonomyInput } from "../../goal-continuation.ts";
import { goalStateDirectory } from "../../goal-verification.ts";
import type { Extension, ExtensionAPI, ExtensionContext } from "../types.ts";
import { finiteCost } from "./goal-budget-state.ts";

type Message = { readonly role?: unknown; readonly [key: string]: unknown };

/** Cost of one settled run incl. subagent lanes; `undefined` when any call's cost is unknown (never 0). */
export function settledRunCostUsd(messages: readonly unknown[]): number | undefined {
	let total = 0;
	for (const raw of messages) {
		if (typeof raw !== "object" || raw === null) continue;
		const message = raw as Message;
		if (message.role === "assistant") {
			if (
				Array.isArray(message.diagnostics) &&
				message.diagnostics.some((diagnostic: { type?: string }) => diagnostic.type === "usage_incomplete")
			)
				return undefined;
			const usage = message.usage as { cost?: { total?: unknown } } | undefined;
			const cost = finiteCost(usage?.cost?.total);
			if (cost === undefined) return undefined;
			total += cost;
		} else if (message.role === "toolResult" && message.toolName === "subagent") {
			const results = (message.details as { results?: unknown } | undefined)?.results;
			if (!Array.isArray(results)) return undefined;
			for (const result of results) {
				const cost = finiteCost((result as { usage?: { cost?: unknown } } | null)?.usage?.cost);
				if (cost === undefined) return undefined;
				total += cost;
			}
		}
	}
	return total;
}

export interface CompactionCostBatch {
	readonly sessionId: string;
	readonly settlementId: string;
	readonly costUsd: number | undefined;
}
type GoalCostSink = (batch: CompactionCostBatch, ctx: ExtensionContext, terminal: boolean) => Promise<void>;
const goalCostSink = Symbol("goal-compaction-cost");
type CostOwner = { readonly [goalCostSink]?: GoalCostSink };
interface GoalCostAccountant {
	restore(entries: readonly unknown[]): void;
	observeCost(
		goal: DurableGoalSnapshot,
		cost: number | undefined,
		settlementId: string,
	): Pick<GoalAutonomyInput, "budget" | "spentUsd">;
	stop(
		store: DurableGoalStore,
		goal: DurableGoalSnapshot,
		reason: "budget-limit",
		ctx: ExtensionContext,
	): Promise<void>;
}

/** Private metadata only: the normal loaders return these same extension/API objects. */
export function transferGoalCostSink<T extends Extension>(api: ExtensionAPI, extension: T): T {
	// Jiti can evaluate a factory's imports in a separate module graph. Canonicalize only this private slot.
	const slots = Object.getOwnPropertySymbols(api).filter((slot) => slot.description === goalCostSink.description);
	if (slots.length > 1) throw new Error("Duplicate goal cost sink registration");
	if (slots.length === 0) return extension;
	const descriptor = Object.getOwnPropertyDescriptor(api, slots[0]);
	if (!descriptor || descriptor.enumerable || typeof descriptor.value !== "function")
		throw new Error("Invalid private goal cost sink");
	Object.defineProperty(extension, goalCostSink, { value: descriptor.value });
	return extension;
}

export function findGoalCostSink(extensions: readonly Extension[]): GoalCostSink | undefined {
	const sinks = extensions.flatMap((extension) => {
		const sink = (extension as CostOwner)[goalCostSink];
		return sink ? [sink] : [];
	});
	if (sinks.length > 1) throw new Error("Automatic compaction accounting requires exactly one goal cost sink");
	return sinks[0];
}

export function registerGoalCostAccounting(api: ExtensionAPI, autonomy: GoalCostAccountant): void {
	if ((api as CostOwner)[goalCostSink]) throw new Error("Duplicate goal cost sink registration");
	const sink: GoalCostSink = async (batch, ctx, terminal) => {
		if (ctx.sessionManager.getSessionId() !== batch.sessionId) throw new Error("Stale compaction cost session");
		const store = new DurableGoalStore(join(goalStateDirectory(ctx.cwd), "current.json"));
		const current = await store.current();
		// admit() mutates before append: restore persisted IDs on EVERY delivery, including failed-append retries.
		autonomy.restore(ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries());
		if (current?.status !== "active") return;
		const observed = autonomy.observeCost(current, batch.costUsd, batch.settlementId);
		const max = observed.budget?.maxCostUsd;
		if (
			terminal &&
			max !== undefined &&
			(observed.spentUsd === undefined || !Number.isFinite(observed.spentUsd) || observed.spentUsd >= max)
		) {
			await autonomy.stop(store, current, "budget-limit", ctx);
		}
	};
	Object.defineProperty(api, goalCostSink, { value: sink });
}
