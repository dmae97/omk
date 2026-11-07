import { describe, expect, it } from "vitest";
import { createDurableGoal } from "../src/core/durable-goal.ts";
import { GoalAutonomy } from "../src/core/extensions/builtin/goal-autonomy.ts";
import { GoalAcceptance } from "../src/core/goal-acceptance.ts";

const goal = createDurableGoal({ id: "session", objective: "fixture", maxRounds: 8, now: "2026-10-01T00:00:00.000Z" });
const message = (cost: number) => [{ role: "assistant", usage: { cost: { total: cost } } }];
function setup() {
	const entries: unknown[] = [];
	const fresh = () =>
		new GoalAutonomy(
			{
				appendEntry: (customType, data) => {
					entries.push({ type: "custom", customType, data });
				},
			},
			new GoalAcceptance(),
		);
	return { entries, fresh };
}
describe("durable goal budget recovery", () => {
	it("restores cap, original deadline, spend and processed settlement IDs", () => {
		const { fresh, entries } = setup();
		const original = fresh();
		original.setBudget(goal, { maxCostUsd: 0.5, deadlineIso: "2026-10-02T00:00:00.000Z" });
		original.observe(goal, message(0.4), 0, "run-1");
		const restarted = fresh();
		restarted.restore(entries);
		expect(restarted.observe(goal, message(0.4), 0, "run-1")).toMatchObject({
			spentUsd: 0.4,
			budget: { maxCostUsd: 0.5, deadlineIso: "2026-10-02T00:00:00.000Z" },
		});
		expect(restarted.observe(goal, message(0.2), 0, "run-2").spentUsd).toBeCloseTo(0.6);
	});
	it("preserves unknown spend and does not apply it to a replacement goal", () => {
		const { fresh, entries } = setup();
		const original = fresh();
		original.setBudget(goal, { maxCostUsd: 0.5 });
		original.observe(goal, [{ role: "assistant" }], 0, "unknown");
		const restarted = fresh();
		restarted.restore(entries);
		expect(restarted.observe(goal, message(0.1), 0, "later").spentUsd).toBeUndefined();
		const replacement = createDurableGoal({
			id: "session",
			objective: "new",
			maxRounds: 8,
			now: "2026-10-03T00:00:00.000Z",
		});
		expect(restarted.observe(replacement, [], 0, "new").budget).toBeUndefined();
	});
	it("replays an explicit clear and fails closed on legacy budgets without accounting", () => {
		const { fresh, entries } = setup();
		const original = fresh();
		original.setBudget(goal, { maxCostUsd: 0.5 });
		original.setBudget(goal, null);
		const restarted = fresh();
		restarted.restore(entries);
		expect(restarted.observe(goal, [], 0).budget).toBeUndefined();
		restarted.restore([
			{
				type: "custom",
				customType: "goal_autonomy_budget",
				data: { goalId: goal.ref.id, createdAt: goal.createdAt, maxCostUsd: 0.5 },
			},
		]);
		expect(restarted.observe(goal, [], 0).spentUsd).toBeUndefined();
	});
});
