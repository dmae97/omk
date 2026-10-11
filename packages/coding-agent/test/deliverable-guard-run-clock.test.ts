import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import deliverableGuard from "../src/core/extensions/builtin/deliverable-guard.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { bindActiveRemainingBudget, RemainingBudget } from "../src/core/remaining-budget.ts";

// spec 034 on the spec 036 run clock: the 40% steer and 90% restore read readRunBudget(),
// whose origin is run start, not the time the extension loaded.
const BUDGET_SEC = 100;
type Handler = (event: unknown, ctx: unknown) => unknown;

let clock = 0;
const dirs: string[] = [];
afterEach(() => {
	bindActiveRemainingBudget(undefined);
	while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** Binds the shared clock at t=0, then loads the guard at `loadAtMs` with a local clock that never moves. */
function loadAt(loadAtMs: number, env: NodeJS.ProcessEnv = { OMK_DELIVERABLE_GUARD: "on" }) {
	clock = 0;
	bindActiveRemainingBudget(new RemainingBudget({ budgetMs: BUDGET_SEC * 1000, now: () => clock, startedAt: 0 }));
	clock = loadAtMs;
	const work = mkdtempSync(join(tmpdir(), "omk-guard-clock-"));
	dirs.push(work);
	const handlers = new Map<string, Handler[]>();
	const steers: string[] = [];
	const omk = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: (text: string, options?: { deliverAs?: string }) => {
			if (options?.deliverAs === "steer") steers.push(text);
		},
		appendEntry: () => {},
		events: { emit: () => {}, on: () => () => {} },
	} as unknown as ExtensionAPI;
	deliverableGuard(omk, {
		env: { OMK_TIME_BUDGET_SEC: String(BUDGET_SEC), ...env },
		now: () => 0,
		storeRoot: join(work, "store"),
		timers: { setInterval: () => ({}), clearInterval: () => {} },
		onTerminate: () => () => {},
	});
	const ctx = { hasUI: false, cwd: work, hasPendingMessages: () => false };
	const fire = async (name: string, event: unknown = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	return { fire, steers, work, handlers };
}

describe("deliverable guard on the shared run clock", () => {
	it("steers on the first tool event when loaded at 60% of the run budget", async () => {
		const run = loadAt(60_000);
		await run.fire("input", { type: "input", text: `Write ${join(run.work, "out.c")}.`, source: "cli" });
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.steers).toHaveLength(1);
		expect(run.steers[0]).toContain("out.c");
	});

	it("steers at 41 s and not at 39 s of run time", async () => {
		const run = loadAt(0);
		await run.fire("input", { type: "input", text: `Write ${join(run.work, "out.c")}.`, source: "cli" });
		clock = 39_000;
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.steers).toEqual([]);
		clock = 41_000;
		await run.fire("tool_execution_end", { toolName: "bash" });
		expect(run.steers).toHaveLength(1);
	});

	it("restores at 91 s of run time with the extension's own clock still at 0", async () => {
		const run = loadAt(0);
		const path = join(run.work, "gpt2.c");
		await run.fire("input", {
			type: "input",
			text: `Call your program ${path}. Must be <5000 bytes.`,
			source: "cli",
		});
		writeFileSync(path, `/*${"x".repeat(4894)}*/\n\n`);
		clock = 10_000;
		await run.fire("tool_execution_end", { toolName: "write" });
		writeFileSync(path, `/*${"y".repeat(5063)}*/\n\n`);
		clock = 91_000;
		await run.fire("message_end", { message: { role: "assistant" } });
		expect(statSync(path).size).toBe(4900);
		expect(run.steers.at(-1)).toContain("restored the 4900-byte copy from 10%");
	});

	it("registers nothing with the flag off, clock bound or not", () => {
		expect(loadAt(60_000, {}).handlers.size).toBe(0);
	});
});
