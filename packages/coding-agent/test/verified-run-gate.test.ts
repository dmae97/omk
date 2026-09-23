import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSandbox } from "../src/core/verified-run/broker.ts";
import { type NamespaceIdentity, probeNamespace } from "../src/core/verified-run/namespace-identity.ts";
import { waitForNamespaceGone } from "./verified-run-namespace-wait.ts";

let workspace: string;
beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "process-gate-"));
});
afterEach(() => {
	vi.useRealTimers();
	rmSync(workspace, { recursive: true, force: true });
});
const request = () => ({
	workspace,
	writable: true,
	timeoutMs: 5000,
	cleanupMs: 1000,
	maxOutputBytes: 4096,
	argv: ["/bin/sh", "-c", "printf executed > output"],
});

function deferred<T>() {
	let settle: (value: T) => void = () => {
		throw new Error("not initialized");
	};
	const promise = new Promise<T>((resolve) => {
		settle = resolve;
	});
	return { promise, resolve: (value: T) => settle(value) };
}

describe("durable process gate", () => {
	it("waits for the ready commit before permitting candidate code to execute", async () => {
		const ready = deferred<NamespaceIdentity>();
		const gate = deferred<void>();
		const execution = executeSandbox({
			...request(),
			onReady: (identity) => {
				ready.resolve(identity);
				return gate.promise;
			},
		});
		const identity = await Promise.race([
			ready.promise,
			execution.then(() => {
				throw new Error("process exited before ready");
			}),
		]);
		try {
			expect(existsSync(join(workspace, "output"))).toBe(false);
			expect(probeNamespace(identity)).toBe("alive");
			// A startTicks mismatch proves the recorded init is gone (PID reused
			// or fabricated): the described boundary no longer exists, and the
			// real boundary still probes alive below.
			const reused = { ...identity, startTicks: `${identity.startTicks}0` };
			expect(probeNamespace(reused)).toBe("gone");
			expect(probeNamespace(identity)).toBe("alive");
		} finally {
			gate.resolve();
			await execution;
		}
		expect((await execution).failure).toBeNull();
		expect(readFileSync(join(workspace, "output"), "utf8")).toBe("executed");
		// Bounded: a resolved execution does not synchronize with PID namespace
		// teardown, so probing at that instant intermittently observes "alive".
		expect(await waitForNamespaceGone(identity)).toBe("gone");
	});

	it.each([false, true])("keeps receipt time ordered when wall-clock regression is %s", async (regress) => {
		if (regress) {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		}
		const result = await executeSandbox({
			...request(),
			onReady: () => {
				if (regress) vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
			},
		});
		expect(result.failure).toBeNull();
		expect(Date.parse(result.finishedAt)).toBeGreaterThanOrEqual(Date.parse(result.startedAt));
		expect(Date.parse(result.finishedAt) - Date.parse(result.startedAt)).toBe(result.durationMs);
	});

	it("does not release the gate after a mandatory ready append fails", async () => {
		await expect(
			executeSandbox({
				...request(),
				onReady: () => {
					throw new Error("injected fsync failure");
				},
			}),
		).rejects.toThrow(/fsync/);
		expect(existsSync(join(workspace, "output"))).toBe(false);
	});

	it("ignores a late ready callback after cancellation and confirmed close", async () => {
		const ready = deferred<void>();
		const gate = deferred<void>();
		const controller = new AbortController();
		const execution = executeSandbox({
			...request(),
			signal: controller.signal,
			onReady: () => {
				ready.resolve();
				return gate.promise;
			},
		});
		await Promise.race([
			ready.promise,
			execution.then(() => {
				throw new Error("process exited before ready");
			}),
		]);
		controller.abort();
		expect((await execution).failure).toBe("cancelled");
		gate.resolve();
		await gate.promise;
		expect(existsSync(join(workspace, "output"))).toBe(false);
	});
});
