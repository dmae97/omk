import { DurableGoalError } from "../../durable-goal.ts";
import type { GoalAutonomyBudget } from "../../goal-continuation.ts";

export function parseGoalBudget(args: string): GoalAutonomyBudget | null {
	const usage = () =>
		new DurableGoalError("invalid-input", "usage: /goal budget <usd|-> [<deadline ISO>|-] | /goal budget clear");
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 1 && parts[0] === "clear") return null;
	if (parts.length < 1 || parts.length > 2) throw usage();
	const [cost, deadline] = parts;
	const budget: { maxCostUsd?: number; deadlineIso?: string } = {};
	if (cost !== "-") {
		const value = Number(cost.replace(/^\$/, ""));
		if (!Number.isFinite(value) || value <= 0) throw usage();
		budget.maxCostUsd = value;
	}
	if (deadline !== undefined && deadline !== "-") {
		const at = Date.parse(deadline);
		if (!Number.isFinite(at)) throw usage();
		budget.deadlineIso = new Date(at).toISOString();
	}
	if (budget.maxCostUsd === undefined && budget.deadlineIso === undefined) throw usage();
	return budget;
}
