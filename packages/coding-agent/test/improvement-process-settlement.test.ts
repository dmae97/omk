import type { ChildProcessByStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, type Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runManagedProcess } from "../examples/extensions/subagent/managed-process.ts";

function fakeChild() {
	const child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn(),
	});
	return child as unknown as ChildProcessByStdio<null, Readable, Readable>;
}

describe("managed process observation and ownership", () => {
	it("returns an unsettled cutoff and resolves ownership only on late close", async () => {
		const child = fakeChild();
		const result = await runManagedProcess({
			command: "fixture",
			args: [],
			cwd: process.cwd(),
			cutoffMs: 1,
			terminationGraceMs: 1,
			forceSettleMs: 1,
			spawnProcess: () => child,
		});
		expect(result.terminationObserved).toBe(false);
		expect(result.exitCode).not.toBe(0);
		let released = 0;
		void result.settlement.then(() => {
			released++;
		});
		await Promise.resolve();
		expect(released).toBe(0);
		child.emit("close", null, "SIGKILL");
		await result.settlement;
		expect(released).toBe(1);
		child.emit("close", 0, null);
		await Promise.resolve();
		expect(released).toBe(1);
	});

	it("contains output callback exceptions and still waits for close", async () => {
		const child = fakeChild();
		const pending = runManagedProcess({
			command: "fixture",
			args: [],
			cwd: process.cwd(),
			cutoffMs: 1000,
			terminationGraceMs: 1,
			forceSettleMs: 1,
			spawnProcess: () => child,
			onStdout: () => {
				throw new Error("private callback data");
			},
		});
		expect(() => child.stdout.emit("data", "output")).not.toThrow();
		child.emit("close", 0, null);
		const result = await pending;
		expect(result.reason).toBe("callback-error");
		expect(result.exitCode).not.toBe(0);
		expect(result.terminationObserved).toBe(true);
		await result.settlement;
	});

	it("does not treat a post-spawn error event as termination", async () => {
		const child = fakeChild();
		Object.assign(child, { pid: 2147483647 });
		const pending = runManagedProcess({
			command: "fixture",
			args: [],
			cwd: process.cwd(),
			cutoffMs: 1000,
			terminationGraceMs: 1,
			forceSettleMs: 1,
			spawnProcess: () => child,
		});
		child.emit("error", new Error("kill failed"));
		const result = await pending;
		expect(result.terminationObserved).toBe(false);
		child.emit("close", 7, null);
		await result.settlement;
	});
});
