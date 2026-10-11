import { describe, expect, it } from "vitest";
import finishCheck from "../src/core/extensions/builtin/finish-check.ts";
import type { FinishCheckBudget } from "../src/core/extensions/builtin/finish-check-reverify-stage.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { FINISH_CHECK_SAVE_NOW_MESSAGE } from "../src/core/finish-check.ts";

// spec 032: finish-check reads the budget through one injectable reader; by default the shared run clock (spec 036), else its own clock.

type Handler = (event: unknown, ctx: unknown) => unknown;

function setup(options: Parameters<typeof finishCheck>[1]) {
	const handlers = new Map<string, Handler[]>();
	const sent: string[] = [];
	const omk = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: (text: string) => sent.push(text),
		appendEntry: () => {},
		events: { emit: () => {}, on: () => () => {} },
	} as unknown as ExtensionAPI;
	finishCheck(omk, options);
	const fire = async (name: string, event: unknown) => {
		for (const handler of handlers.get(name) ?? [])
			await handler(event, { hasUI: false, hasPendingMessages: () => false });
	};
	return { fire, sent };
}

describe("finish-check budget reader", () => {
	it("takes thresholds from an injected reader instead of OMK_TIME_BUDGET_SEC", async () => {
		let budget: FinishCheckBudget | undefined = { budgetMs: 1000, elapsedMs: 100, elapsedFraction: 0.1 };
		const run = setup({ env: {}, readBudget: () => budget });
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.sent).toEqual([]);
		budget = { budgetMs: 1000, elapsedMs: 760, elapsedFraction: 0.76 };
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.sent).toEqual([FINISH_CHECK_SAVE_NOW_MESSAGE]);
	});

	it("falls back to OMK_TIME_BUDGET_SEC and the extension's own clock when no run clock is bound", async () => {
		let clock = 0;
		const run = setup({ env: { OMK_TIME_BUDGET_SEC: "100" }, now: () => clock });
		clock = 74_000;
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.sent).toEqual([]);
		clock = 75_000;
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.sent).toEqual([FINISH_CHECK_SAVE_NOW_MESSAGE]);
	});
});
