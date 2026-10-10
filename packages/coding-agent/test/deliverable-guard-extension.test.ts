import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import deliverableGuard, {
	DELIVERABLE_GUARD_ENTRY,
	DELIVERABLE_GUARD_EVENT,
	type DeliverableGuardOptions,
	unrefInterval,
} from "../src/core/extensions/builtin/deliverable-guard.ts";
import finishCheck from "../src/core/extensions/builtin/finish-check.ts";
import { HARNESS_FACTORIES } from "../src/core/extensions/builtin/harness-factories.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { findOnPath } from "../src/core/fast-check.ts";

// spec 034 acceptance 8-17: the guard on a fake clock with a 900 s budget.
type Handler = (event: unknown, ctx: unknown) => unknown;
const SEC = 1000;

let work: string;
let storeRoot: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), "omk-guard-work-"));
	storeRoot = join(mkdtempSync(join(tmpdir(), "omk-guard-store-")), "store");
});
afterEach(() => {
	rmSync(work, { recursive: true, force: true });
	rmSync(join(storeRoot, ".."), { recursive: true, force: true });
});

interface Harness {
	fire: (name: string, event?: unknown, ctx?: unknown) => Promise<void>;
	at: (seconds: number) => void;
	tick: () => Promise<void>;
	steers: () => string[];
	sent: { text: string; deliverAs?: string; existsAtSend?: boolean }[];
	entries: { type: string; data: Record<string, unknown> }[];
	events: { channel: string; data: Record<string, unknown> }[];
	handlerCount: () => number;
	intervals: { active: boolean; fn: () => unknown }[];
	signalHandlers: (() => void)[];
}

function harness(
	env: NodeJS.ProcessEnv,
	options: Partial<DeliverableGuardOptions> & { withFinishCheck?: boolean; watch?: string } = {},
): Harness {
	const handlers = new Map<string, Handler[]>();
	const sent: Harness["sent"] = [];
	const entries: Harness["entries"] = [];
	const events: Harness["events"] = [];
	const intervals: Harness["intervals"] = [];
	const signalHandlers: (() => void)[] = [];
	let clock = 0;
	const omk = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: (text: string, opts?: { deliverAs?: string }) =>
			sent.push({
				text,
				deliverAs: opts?.deliverAs,
				existsAtSend: options.watch ? existsSync(options.watch) : undefined,
			}),
		appendEntry: (type: string, data: Record<string, unknown>) => entries.push({ type, data }),
		events: {
			emit: (channel: string, data: Record<string, unknown>) => events.push({ channel, data }),
			on: () => () => {},
		},
	} as unknown as ExtensionAPI;
	const now = () => clock;
	deliverableGuard(omk, {
		env,
		now,
		storeRoot,
		timers: {
			setInterval: (fn) => {
				const handle = { active: true, fn };
				intervals.push(handle);
				return handle;
			},
			clearInterval: (handle) => {
				(handle as { active: boolean }).active = false;
			},
		},
		onTerminate: (handler) => {
			signalHandlers.push(handler);
			return () => signalHandlers.splice(signalHandlers.indexOf(handler), 1);
		},
		...options,
	});
	if (options.withFinishCheck) finishCheck(omk, { env, now });
	const ctx = { hasUI: false, cwd: work, hasPendingMessages: () => false };
	return {
		fire: async (name, event = {}, context = ctx) => {
			for (const handler of handlers.get(name) ?? []) await handler(event, context);
		},
		at: (seconds) => {
			clock = seconds * SEC;
		},
		tick: async () => {
			for (const interval of intervals) if (interval.active) await interval.fn();
		},
		steers: () => sent.filter((m) => m.deliverAs === "steer").map((m) => m.text),
		sent,
		entries,
		events,
		handlerCount: () => [...handlers.values()].reduce((n, list) => n + list.length, 0),
		intervals,
		signalHandlers,
	};
}

const ON = { OMK_DELIVERABLE_GUARD: "on", OMK_TIME_BUDGET_SEC: "900" };
const task = (path: string, extra = "") => ({
	type: "input",
	text: `Write a C program ${path}.${extra}`,
	source: "cli",
});
const tool = { toolName: "write" };
const settled = { messages: [{ role: "assistant", stopReason: "stop", content: [] }] };
const restores = (h: Harness) => h.entries.filter((e) => e.type === DELIVERABLE_GUARD_ENTRY).map((e) => e.data);

describe("deliverable guard: flag off is main", () => {
	it("is a built-in harness extension loaded before finish-check", () => {
		const vars = HARNESS_FACTORIES.map((entry) => entry.envVar);
		expect(vars).toContain("OMK_DELIVERABLE_GUARD");
		expect(vars.indexOf("OMK_DELIVERABLE_GUARD")).toBeLessThan(vars.indexOf("OMK_FINISH_CHECK"));
	});

	it("registers no handlers, timers or signal handlers when OMK_DELIVERABLE_GUARD is unset or off", () => {
		for (const value of [undefined, "", "0", "off", "false"]) {
			const h = harness({ OMK_TIME_BUDGET_SEC: "900", OMK_DELIVERABLE_GUARD: value });
			expect(h.handlerCount()).toBe(0);
			expect(h.intervals).toHaveLength(0);
			expect(h.signalHandlers).toHaveLength(0);
		}
	});

	it("does nothing with a UI when the flag is on (headless only)", async () => {
		const h = harness(ON);
		const path = join(work, "out.c");
		await h.fire("input", task(path), { hasUI: true, cwd: work, hasPendingMessages: () => false });
		h.at(400);
		await h.fire("tool_execution_end", tool);
		await h.tick();
		await h.fire("agent_settled", settled);
		expect(h.sent).toEqual([]);
		expect(h.entries).toEqual([]);
		expect(existsSync(storeRoot)).toBe(false);
	});
});

describe("deliverable guard: watchdog at 40%", () => {
	it("steers once naming a missing deliverable at 360 s, nothing more at 400 s", async () => {
		const h = harness(ON);
		const path = join(work, "gpt2.c");
		await h.fire("input", task(path));
		h.at(300);
		await h.fire("tool_execution_end", tool);
		expect(h.steers()).toEqual([]);
		h.at(360);
		await h.fire("tool_execution_end", tool);
		expect(h.steers()).toHaveLength(1);
		expect(h.steers()[0]).toContain(path);
		expect(h.steers()[0]).toContain("Write a simple working version");
		h.at(400);
		await h.fire("tool_execution_end", tool);
		expect(h.steers()).toHaveLength(1);
	});

	it("sends no steer when the deliverable exists at 360 s", async () => {
		const h = harness(ON);
		const path = join(work, "gpt2.c");
		await h.fire("input", task(path));
		writeFileSync(path, "int main(void) { return 0; }\n");
		h.at(360);
		await h.fire("tool_execution_end", tool);
		expect(h.steers()).toEqual([]);
	});

	it("long stream: no tool event from 300 s to 800 s, the timer catches 40%", async () => {
		const h = harness(ON);
		await h.fire("input", task(join(work, "data.c")));
		h.at(300);
		await h.fire("tool_execution_end", tool);
		h.at(370);
		await h.tick();
		expect(h.steers()).toHaveLength(1);
		h.at(800);
		await h.fire("message_end", { message: { role: "assistant" } });
		expect(h.steers()).toHaveLength(1);
	});

	it("reads time from an injected budget fraction (the #63 readRunBudget().elapsedFraction shape)", async () => {
		let fraction: number | undefined;
		const h = harness({ OMK_DELIVERABLE_GUARD: "on" }, { budgetFraction: () => fraction });
		await h.fire("input", task(join(work, "x.c")));
		fraction = 0.39;
		await h.fire("tool_execution_end", tool);
		expect(h.steers()).toEqual([]);
		fraction = 0.41;
		await h.fire("tool_execution_end", tool);
		expect(h.steers()).toHaveLength(1);
	});
});

describe("deliverable guard: restore", () => {
	it("gpt2 r1: 4,900-byte copy saved, file grows to 5,069 bytes, restored at 810 s with one steer", async () => {
		const h = harness(ON);
		const path = join(work, "gpt2.c");
		await h.fire("input", task(path, " Your c program must be <5000 bytes."));
		writeFileSync(path, `/*${"x".repeat(4894)}*/\n\n`);
		h.at(558);
		await h.fire("tool_execution_end", tool);
		writeFileSync(path, `/*${"y".repeat(5063)}*/\n\n`);
		h.at(700);
		await h.fire("tool_execution_end", tool);
		h.at(810);
		await h.fire("tool_execution_end", tool);
		expect(statSync(path).size).toBe(4900);
		expect(h.steers()).toHaveLength(1);
		expect(h.steers()[0]).toContain("was 5069 bytes, over the 5000-byte limit; restored the 4900-byte copy from 62%");
		expect(restores(h)).toEqual([
			expect.objectContaining({
				path,
				reason: "invalid:size",
				point: "budget",
				restoredSize: 4900,
				savedAtFraction: 0.62,
			}),
		]);
		expect(restores(h)[0].sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(h.events.some((e) => e.channel === DELIVERABLE_GUARD_EVENT && e.data.reason === "invalid:size")).toBe(
			true,
		);
	});

	it.skipIf(!findOnPath("cc"))(
		"ptr r2-retry: a compiling copy is restored at settle when the file stops compiling",
		async () => {
			const h = harness(ON);
			const path = join(work, "mystery.c");
			await h.fire("input", task(path));
			writeFileSync(path, "int main(void) { return 0; }\n");
			h.at(100);
			await h.fire("tool_execution_end", tool);
			writeFileSync(path, "int main(void) { return 0 \n");
			h.at(200);
			await h.fire("tool_execution_end", tool);
			await h.fire("agent_settled", settled);
			expect(readFileSync(path, "utf8")).toBe("int main(void) { return 0; }\n");
			expect(restores(h)).toEqual([expect.objectContaining({ reason: "invalid:syntax:cc", point: "settle" })]);
			expect(h.steers()).toEqual([]);
		},
	);

	it("train-fasttext r3: a deleted file is restored at settle with reason missing", async () => {
		const h = harness(ON);
		const path = join(work, "model.bin");
		await h.fire("input", { type: "input", text: `The model should be saved as ${path}`, source: "cli" });
		writeFileSync(path, "weights");
		await h.fire("tool_execution_end", tool);
		unlinkSync(path);
		await h.fire("tool_execution_end", tool);
		await h.fire("agent_settled", settled);
		expect(readFileSync(path, "utf8")).toBe("weights");
		expect(restores(h)).toEqual([expect.objectContaining({ path, reason: "missing", point: "settle" })]);
	});

	it("never downgrades: a valid current file different from the copy is kept at 90% and at settle", async () => {
		const h = harness(ON);
		const path = join(work, "out.c");
		await h.fire("input", task(path));
		writeFileSync(path, "int a;\n");
		await h.fire("tool_execution_end", tool);
		writeFileSync(path, "int better;\n");
		h.at(850);
		await h.fire("message_end", { message: { role: "assistant" } });
		await h.fire("agent_settled", settled);
		expect(readFileSync(path, "utf8")).toBe("int better;\n");
		expect(restores(h)).toEqual([]);
	});

	it("records missing_no_copy and restores nothing when there was never a valid copy", async () => {
		const h = harness(ON);
		const path = join(work, "solution.txt");
		await h.fire("input", task(path));
		await h.fire("agent_settled", settled);
		expect(existsSync(path)).toBe(false);
		expect(restores(h)).toEqual([expect.objectContaining({ path, outcome: "missing_no_copy" })]);
	});

	it("without a budget: no steer and no 90% restore, settle restore still works", async () => {
		const h = harness({ OMK_DELIVERABLE_GUARD: "on" });
		const path = join(work, "out.c");
		await h.fire("input", task(path));
		expect(h.intervals).toHaveLength(0);
		writeFileSync(path, "int a;\n");
		await h.fire("tool_execution_end", tool);
		unlinkSync(path);
		h.at(10_000);
		await h.fire("tool_execution_end", tool);
		expect(h.steers()).toEqual([]);
		expect(existsSync(path)).toBe(false);
		await h.fire("agent_settled", settled);
		expect(existsSync(path)).toBe(true);
	});

	it("restores at settle before the finish-check turn is sent", async () => {
		const path = join(work, "out.c");
		const env = { ...ON, OMK_FINISH_CHECK: "on" };
		const h = harness(env, { withFinishCheck: true, watch: path });
		await h.fire("input", task(path));
		writeFileSync(path, "int a;\n");
		await h.fire("tool_execution_end", tool);
		unlinkSync(path);
		h.at(300);
		await h.fire("agent_settled", settled);
		const followUp = h.sent.find((m) => m.deliverAs === "followUp");
		expect(followUp?.existsAtSend).toBe(true);
	});

	it("best effort on SIGTERM: a missing file with a copy is put back synchronously", async () => {
		const h = harness(ON);
		const path = join(work, "out.c");
		await h.fire("input", task(path));
		writeFileSync(path, "int a;\n");
		await h.fire("tool_execution_end", tool);
		unlinkSync(path);
		expect(h.signalHandlers).toHaveLength(1);
		h.signalHandlers[0]();
		expect(readFileSync(path, "utf8")).toBe("int a;\n");
	});
});

describe("deliverable guard: cleanup", () => {
	it("deletes the store and clears timers and signal handlers on session shutdown", async () => {
		const h = harness(ON);
		const path = join(work, "out.c");
		await h.fire("input", task(path));
		writeFileSync(path, "int a;\n");
		await h.fire("tool_execution_end", tool);
		expect(existsSync(storeRoot)).toBe(true);
		await h.fire("session_shutdown", { type: "session_shutdown", reason: "quit" });
		expect(existsSync(storeRoot)).toBe(false);
		expect(h.intervals.every((i) => !i.active)).toBe(true);
		expect(h.signalHandlers).toHaveLength(0);
	});

	it("the default timer does not keep the process alive", () => {
		const handle = unrefInterval(() => {}, 60_000);
		expect(handle.hasRef()).toBe(false);
		clearInterval(handle);
	});

	it("reports guard time in a summary event at settle", async () => {
		const h = harness(ON);
		await h.fire("input", task(join(work, "out.c")));
		await h.fire("agent_settled", settled);
		const summary = h.events.find((e) => e.channel === DELIVERABLE_GUARD_EVENT && e.data.type === "summary");
		expect(summary?.data).toMatchObject({ steers: 0, restores: 0 });
		expect(typeof summary?.data.guardMs).toBe("number");
	});
});
