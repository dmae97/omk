import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import deliverableGuard from "../src/core/extensions/builtin/deliverable-guard.ts";
import finishCheck from "../src/core/extensions/builtin/finish-check.ts";
import type { ExtensionAPI, SessionShutdownEvent } from "../src/core/extensions/types.ts";
import { bindActiveRemainingBudget } from "../src/core/remaining-budget.ts";
import type { RunLogRecord } from "../src/core/run-log.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";
import { createAssistantMessage, createRuntimeHost } from "./print-mode-fixtures.ts";

// Spec 032 decision 10 (option 3): a held no-check-turn line is written exactly once on the real print-mode
// SIGTERM path (print mode's listener → disposeRuntime() → session_shutdown), after spec 034's restore.
// Modeled on deliverable-guard-sigterm.test.ts.
vi.mock("../src/core/output-guard.js", () => ({ flushRawStdout: vi.fn(async () => {}), writeRawStdout: () => {} }));

type Handler = (event: unknown, ctx: unknown) => unknown;
type Listener = (...args: unknown[]) => void;

let work: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), "omk-fc-sigterm-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	bindActiveRemainingBudget(undefined);
	rmSync(work, { recursive: true, force: true });
});

/** Captures SIGTERM listeners and fires them as `process.emit` does (registration order, on a copy). */
function captureSigterm(): { emit: () => void } {
	const listeners: Listener[] = [];
	const realOn = process.on.bind(process);
	const realOff = process.off.bind(process);
	vi.spyOn(process, "on").mockImplementation(((event: string, listener: Listener) => {
		if (event === "SIGTERM") listeners.push(listener);
		else if (event !== "SIGHUP") realOn(event, listener);
		return process;
	}) as never);
	vi.spyOn(process, "off").mockImplementation(((event: string, listener: Listener) => {
		if (event === "SIGTERM") {
			const index = listeners.indexOf(listener);
			if (index >= 0) listeners.splice(index, 1);
		} else if (event !== "SIGHUP") realOff(event, listener);
		return process;
	}) as never);
	const realCount = process.listenerCount.bind(process);
	vi.spyOn(process, "listenerCount").mockImplementation(((event: string) =>
		event === "SIGTERM" ? listeners.length : realCount(event)) as never);
	return {
		emit: () => {
			for (const listener of [...listeners]) listener("SIGTERM");
		},
	};
}

describe("finish-check run log on the print-mode SIGTERM path", () => {
	it("writes the held no-check-turn line exactly once, after the guard's restore", async () => {
		const sigterm = captureSigterm();
		const kill = vi.spyOn(process, "kill").mockImplementation((() => true) as never);
		let exited: (code: number) => void = () => {};
		const exitCode = new Promise<number>((resolve) => {
			exited = resolve;
		});
		vi.spyOn(process, "exit").mockImplementation(((code: number) => exited(code)) as never);

		const handlers = new Map<string, Handler[]>();
		const omk = {
			on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
			sendUserMessage: () => {},
			appendEntry: () => {},
			events: { emit: () => {}, on: () => () => {} },
		} as unknown as ExtensionAPI;
		const order: string[] = [];
		const records: RunLogRecord[] = [];
		const ctx = { hasUI: false, cwd: work, hasPendingMessages: () => false };
		const fire = async (name: string, event: unknown) => {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		};

		// Load order as in harness-factories: the guard before finish-check.
		deliverableGuard(omk, {
			env: { OMK_DELIVERABLE_GUARD: "on" },
			storeRoot: join(work, "store"),
			runLog: (record) => order.push(`guard:${String(record.type)}`),
		});
		finishCheck(omk, {
			env: { OMK_TIME_BUDGET_SEC: "900", OMK_FINISH_CHECK_REVERIFY: "on", OMK_FINISH_CHECK_EXTRA_TURN: "on" },
			runLog: (record) => {
				records.push(record);
				order.push(`finish-check:${String(record.type)}`);
			},
		});

		const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
		runtimeHost.session.extensionRunner.emit.mockImplementation(async (event: SessionShutdownEvent) => {
			await fire(event.type, event);
		});
		const path = join(work, "out.c");
		runtimeHost.session.prompt.mockImplementation(async () => {
			await fire("input", { type: "input", text: `Write a C program ${path}.`, source: "cli" });
			writeFileSync(path, "int a;\n");
			await fire("tool_execution_end", { toolName: "write" });
			// A settle with a pending user message runs no check turn; the trigger line is held.
			ctx.hasPendingMessages = () => true;
			await fire("agent_settled", { messages: [{ role: "assistant", stopReason: "stop", content: [] }] });
			expect(records).toEqual([]);
			unlinkSync(path);
			sigterm.emit();
			await exitCode;
		});

		await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "text",
			initialMessage: "task",
		});

		expect(await exitCode).toBe(143);
		expect(records.filter((record) => record.type === "reverify-trigger")).toEqual([
			expect.objectContaining({ fired: false, reason: "no-check-turn", checkSkipReason: "pending-input" }),
		]);
		expect(order.indexOf("guard:restore")).toBeGreaterThanOrEqual(0);
		expect(order.indexOf("guard:restore")).toBeLessThan(order.indexOf("finish-check:reverify-trigger"));
		expect(kill).not.toHaveBeenCalled();
	});
});
