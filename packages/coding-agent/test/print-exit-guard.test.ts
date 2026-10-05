import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_PRINT_EXIT_GRACE_MS,
	resolvePrintExitGraceMs,
	settlePrintModeExit,
	summarizeActiveResources,
} from "../src/modes/print-exit-guard.ts";

function harness(env: Record<string, string | undefined> = {}) {
	const timers: { callback: () => void; ms: number; unref: ReturnType<typeof vi.fn> }[] = [];
	const stderr: string[] = [];
	const exit = vi.fn();
	const deps = {
		env,
		setTimer: (callback: () => void, ms: number) => {
			const timer = { callback, ms, unref: vi.fn() };
			timers.push(timer);
			return timer;
		},
		getActiveResources: () => ["TCPSocketWrap", "Timeout", "ProcessWrap", "TCPSocketWrap"],
		writeStderr: (text: string) => stderr.push(text),
		exit,
	};
	return { deps, timers, stderr, exit };
}

describe("print exit guard", () => {
	const originalExitCode = process.exitCode;
	afterEach(() => {
		process.exitCode = originalExitCode;
	});

	it("arms an unref'd timer so a drained event loop still exits on its own", () => {
		const { deps, timers, exit } = harness();
		settlePrintModeExit(0, deps);
		expect(timers).toHaveLength(1);
		expect(timers[0].ms).toBe(DEFAULT_PRINT_EXIT_GRACE_MS);
		expect(timers[0].unref).toHaveBeenCalledOnce();
		expect(exit).not.toHaveBeenCalled();
	});

	it("reports held resources and exits with the run's code when the loop is still busy", () => {
		const { deps, timers, stderr, exit } = harness();
		settlePrintModeExit(3, deps);
		expect(process.exitCode).toBe(3);
		timers[0].callback();
		expect(exit).toHaveBeenCalledWith(3);
		expect(stderr.join("")).toContain("TCPSocketWrap x2, ProcessWrap x1");
		expect(stderr.join("")).not.toContain("Timeout");
	});

	it("can be disabled with OMK_PRINT_EXIT_GRACE_MS=0", () => {
		const { deps, timers } = harness({ OMK_PRINT_EXIT_GRACE_MS: "0" });
		settlePrintModeExit(0, deps);
		expect(timers).toHaveLength(0);
	});

	it("parses the grace period and falls back on invalid values", () => {
		expect(resolvePrintExitGraceMs({ OMK_PRINT_EXIT_GRACE_MS: "500" })).toBe(500);
		expect(resolvePrintExitGraceMs({ OMK_PRINT_EXIT_GRACE_MS: "-1" })).toBe(DEFAULT_PRINT_EXIT_GRACE_MS);
		expect(resolvePrintExitGraceMs({ OMK_PRINT_EXIT_GRACE_MS: "soon" })).toBe(DEFAULT_PRINT_EXIT_GRACE_MS);
		expect(resolvePrintExitGraceMs({})).toBe(DEFAULT_PRINT_EXIT_GRACE_MS);
	});

	it("summarizes an empty resource list", () => {
		expect(summarizeActiveResources([])).toBe("none reported");
	});
});
