import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import deliverableGuard from "../src/core/extensions/builtin/deliverable-guard.ts";
import type { ExtensionAPI, SessionShutdownEvent } from "../src/core/extensions/types.ts";
import { bindActiveRemainingBudget } from "../src/core/remaining-budget.ts";
import type { RunLogRecord } from "../src/core/run-log.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";
import { createAssistantMessage, createRuntimeHost } from "./print-mode-fixtures.ts";

// Review of b0998ee, minor 1: on SIGTERM in print mode the copy must be put back before the store is deleted.
vi.mock("../src/core/output-guard.js", () => ({ flushRawStdout: vi.fn(async () => {}), writeRawStdout: () => {} }));

type Handler = (event: unknown, ctx: unknown) => unknown;
type Listener = (...args: unknown[]) => void;

let work: string;
let storeRoot: string;
beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), "omk-guard-sigterm-"));
	storeRoot = join(work, "store");
});
afterEach(() => {
	vi.restoreAllMocks();
	bindActiveRemainingBudget(undefined);
	rmSync(work, { recursive: true, force: true });
});

/**
 * Captures SIGTERM listeners instead of registering them, so the test can fire them the way
 * `process.emit` does (registration order, on a copy) without signalling the test worker.
 */
function captureSigterm(): () => void {
	const listeners: Listener[] = [];
	const realOn = process.on.bind(process);
	const realOff = process.off.bind(process);
	vi.spyOn(process, "on").mockImplementation(((event: string, listener: Listener) => {
		if (event === "SIGTERM") listeners.push(listener);
		else if (event !== "SIGHUP") realOn(event, listener);
		return process;
	}) as never);
	vi.spyOn(process, "off").mockImplementation(((event: string, listener: Listener) => {
		if (event === "SIGTERM") listeners.splice(listeners.indexOf(listener), 1);
		else if (event !== "SIGHUP") realOff(event, listener);
		return process;
	}) as never);
	return () => {
		for (const listener of [...listeners]) listener("SIGTERM");
	};
}

describe("deliverable guard on the print-mode SIGTERM path", () => {
	it("restores a missing deliverable, then deletes the copy store", async () => {
		const emitSigterm = captureSigterm();
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
		const records: RunLogRecord[] = [];
		const ctx = { hasUI: false, cwd: work, hasPendingMessages: () => false };
		const fire = async (name: string, event: unknown) => {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		};

		deliverableGuard(omk, { env: { OMK_DELIVERABLE_GUARD: "on" }, storeRoot, runLog: (r) => records.push(r) });

		const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
		// As ExtensionRunner.emit: handlers in load order, each awaited before the next.
		runtimeHost.session.extensionRunner.emit.mockImplementation(async (event: SessionShutdownEvent) => {
			await fire(event.type, event);
		});
		const path = join(work, "out.c");
		runtimeHost.session.prompt.mockImplementation(async () => {
			// The guard adds its SIGTERM listener on the task's input, after print mode's own, as in a real run.
			await fire("input", { type: "input", text: `Write a C program ${path}.`, source: "cli" });
			writeFileSync(path, "int a;\n");
			await fire("tool_execution_end", { toolName: "write" });
			expect(existsSync(storeRoot)).toBe(true);
			unlinkSync(path);
			emitSigterm();
			await exitCode;
		});

		await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "text",
			initialMessage: "task",
		});

		expect(await exitCode).toBe(143);
		expect(readFileSync(path, "utf8")).toBe("int a;\n");
		expect(existsSync(storeRoot)).toBe(false);
		expect(records.filter((r) => r.type === "restore")).toEqual([
			expect.objectContaining({ path, outcome: "restored", reason: "missing", point: "shutdown" }),
		]);
	});
});
