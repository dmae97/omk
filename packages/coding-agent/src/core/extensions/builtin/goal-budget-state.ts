import type { GoalAutonomyBudget } from "../../goal-continuation.ts";

interface Spend {
	budget: GoalAutonomyBudget;
	spentUsd: number | undefined;
}

export function finiteCost(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Branch-owned budget projection. Stored data can restrict authority, never grant command approval. */
export class GoalBudgetState {
	readonly spend = new Map<string, Spend>();
	private readonly settled = new Map<string, Set<string>>();
	private readonly seen = new WeakSet<object>();

	restore(entries: readonly unknown[]): void {
		this.spend.clear();
		this.settled.clear();
		for (const raw of entries) {
			const entry = record(raw);
			const data = record(entry?.data);
			if (entry?.type !== "custom" || !data || typeof data.goalId !== "string" || typeof data.createdAt !== "string")
				continue;
			const key = `${data.goalId}@${data.createdAt}`;
			if (entry.customType === "goal_autonomy_budget") {
				if (data.cleared === true || (data.maxCostUsd === undefined && data.deadlineIso === undefined)) {
					this.spend.delete(key);
					continue;
				}
				const maxCostUsd = finiteCost(data.maxCostUsd);
				const deadlineIso =
					typeof data.deadlineIso === "string" && Number.isFinite(Date.parse(data.deadlineIso))
						? data.deadlineIso
						: undefined;
				this.spend.set(key, {
					budget: {
						...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
						...(deadlineIso ? { deadlineIso } : {}),
						...((data.maxCostUsd !== undefined && maxCostUsd === undefined) ||
						(data.deadlineIso !== undefined && !deadlineIso)
							? { maxCostUsd: 0 }
							: {}),
					},
					spentUsd: data.accountingVersion === 1 ? finiteCost(data.spentUsd) : undefined,
				});
			} else if (
				entry.customType === "goal_autonomy_spend" &&
				typeof data.settlementId === "string" &&
				this.admit(key, data.settlementId)
			) {
				const spend = this.spend.get(key);
				if (spend) {
					const cost = finiteCost(data.costUsd);
					spend.spentUsd = spend.spentUsd !== undefined && cost !== undefined ? spend.spentUsd + cost : undefined;
				}
			}
		}
	}

	admit(key: string, id: string | object): boolean {
		if (typeof id === "object") {
			if (this.seen.has(id)) return false;
			this.seen.add(id);
			return true;
		}
		let ids = this.settled.get(key);
		if (!ids) {
			ids = new Set();
			this.settled.set(key, ids);
		}
		if (ids.has(id)) return false;
		ids.add(id);
		return true;
	}
}
