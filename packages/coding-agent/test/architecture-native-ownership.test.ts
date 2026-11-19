import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { failedResult, laneResult } from "../examples/extensions/subagent/graph-result.ts";
import { type ManagedProcessResult, runManagedProcess } from "../examples/extensions/subagent/managed-process.ts";
import * as processTree from "../examples/extensions/subagent/managed-process-tree.ts";
import { emptyUsage, type SingleResult } from "../examples/extensions/subagent/subagent-runtime-types.ts";
import type { PromptSettledEvent } from "../src/core/prompt-settlement.ts";
import { SessionPromptLifecycle } from "../src/core/session-prompt-lifecycle.ts";
import { createSubagentLaneAuthority } from "../src/core/subagent-lane-authority.ts";
import type { SubagentLaneSpec } from "../src/core/subagent-lane-contract.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

const fixturePath = fileURLToPath(new URL("./fixtures/architecture-owned-process.mjs", import.meta.url));
const lanes: readonly SubagentLaneSpec[] = [{ id: "native", role: "security", task: "observe owned local fixture" }];

interface NativeClose {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
}

interface OwnedChild {
	readonly handle: ChildProcessByStdio<null, Readable, Readable>;
	readonly closed: Promise<NativeClose>;
	closeCount: number;
	close?: NativeClose;
}

async function watched<T>(pending: Promise<T>, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`native ownership watchdog: ${label}`)), 10_000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function compose(
	mode: "success" | "wait",
	options: { pool?: WorkloadPermitPool; signal?: AbortSignal; cutoffMs?: number } = {},
) {
	const pool = options.pool ?? new WorkloadPermitPool({ capacity: 1 });
	const lifecycle = new SessionPromptLifecycle();
	const prompt = lifecycle.begin(`native-${mode}`);
	const receipts: PromptSettledEvent[] = [];
	const children: OwnedChild[] = [];
	const cleanupController = new AbortController();
	const trace: string[] = [];
	const counts = { started: 0, children: 0, releases: 0, settlements: 0, idle: 0 };
	const idle = lifecycle.waitForIdle().then(() => {
		counts.idle++;
		trace.push("idle");
	});
	const notify = (event: PromptSettledEvent): void => {
		receipts.push(event);
		trace.push(`prompt:${event.outcome}`);
	};
	let stdout = "";
	let signalReady = () => {};
	const ready = new Promise<void>((resolve) => {
		signalReady = resolve;
	});
	let result: ManagedProcessResult | undefined;
	let single: SingleResult | undefined;
	const authority = (signal?: AbortSignal) =>
		createSubagentLaneAuthority({
			runId: `native-${mode}`,
			promptRunId: lifecycle.activePromptRunId,
			decision: null,
			permitPool: pool,
			inventory: { tools: [], skills: [], mcp: [], hooks: [] },
			signal: signal ? AbortSignal.any([signal, cleanupController.signal]) : cleanupController.signal,
			noteDetachedChild: () => {
				const release = lifecycle.noteDetachedChild();
				counts.started++;
				counts.children++;
				return () => {
					counts.releases++;
					counts.children--;
					trace.push("child-release");
					release();
				};
			},
		});
	const dispatch = authority(options.signal).dispatchLanes({
		lanes,
		heavyLaneIds: new Set(["native"]),
		launchLane: async ({ signal }) => {
			result = await runManagedProcess({
				command: process.execPath,
				args: [fixturePath, mode],
				cwd: process.cwd(),
				env: {},
				signal,
				cutoffMs: options.cutoffMs ?? 0,
				terminationGraceMs: 250,
				forceSettleMs: 500,
				onStdout: (chunk) => {
					stdout += chunk;
					if (stdout === `READY ${children[0]?.handle.pid}\n`) {
						trace.push("ready");
						signalReady();
					}
				},
				spawnProcess: (command, args, spawnOptions) => {
					const handle = spawn(command, [...args], spawnOptions);
					const child: OwnedChild = {
						handle,
						closeCount: 0,
						closed: new Promise<NativeClose>((resolve) => {
							handle.once("close", (code, closeSignal) => {
								child.closeCount++;
								child.close = { code, signal: closeSignal };
								trace.push("close");
								resolve(child.close);
							});
						}),
					};
					children.push(child);
					trace.push("spawn");
					return handle;
				},
			});
			trace.push(`response:${result.reason}`);
			void result.settlement.then(() => {
				counts.settlements++;
				trace.push("settlement");
			});
			single = {
				agent: "native-fixture",
				agentSource: "project",
				task: lanes[0].task,
				exitCode: result.exitCode,
				process: result,
				messages: [],
				stderr: "",
				usage: emptyUsage(),
			};
			return laneResult(single);
		},
	});
	return {
		pool,
		lifecycle,
		prompt,
		notify,
		receipts,
		children,
		trace,
		counts,
		idle,
		ready,
		dispatch,
		authority,
		get child(): OwnedChild {
			if (children.length !== 1) throw new Error("expected one owned direct child");
			return children[0];
		},
		get result(): ManagedProcessResult {
			if (!result) throw new Error("managed response not observed");
			return result;
		},
		get single(): SingleResult {
			if (!single) throw new Error("lane projection not observed");
			return single;
		},
		async cleanup(): Promise<void> {
			try {
				cleanupController.abort();
				await Promise.resolve();
				for (const child of children) {
					if (!child.closeCount && child.handle.exitCode === null && child.handle.signalCode === null)
						child.handle.kill("SIGKILL");
					await watched(child.closed, "cleanup native close");
				}
				await watched(dispatch, "cleanup dispatch");
				if (result) await watched(result.settlement, "cleanup original settlement");
				prompt.finish("aborted", notify);
				await watched(idle, "cleanup prompt idle");
			} finally {
				console.info(
					"native-ownership",
					JSON.stringify({
						mode,
						node: process.version,
						children: children.map((child) => ({
							pid: child.handle.pid,
							closeCount: child.closeCount,
							close: child.close,
						})),
						counts,
						pool: pool.snapshot(),
						doubleReleases: pool.doubleReleaseCount,
						trace,
					}),
				);
				lifecycle.dispose();
			}
		},
	};
}

function expectReleased(run: ReturnType<typeof compose>): void {
	expect(run.counts).toEqual({ started: 1, children: 0, releases: 1, settlements: 1, idle: 1 });
	expect(run.child.closeCount).toBe(1);
	expect(run.pool.snapshot()).toEqual({ capacity: 1, activeWeight: 0, queuedCount: 0 });
	expect(run.pool.doubleReleaseCount).toBe(0);
	expect(run.lifecycle.active).toBe(false);
	expect(run.receipts).toHaveLength(1);
	run.prompt.finish("completed", run.notify);
	run.lifecycle.flush();
	expect(run.receipts).toHaveLength(1);
}

// POSIX cooperative SIGTERM is required; this is component composition, not every CLI/OS/tree adapter.
describe.skipIf(process.platform === "win32")("native direct-child ownership composition", () => {
	it("completes only after native exit0 and positive close", async () => {
		const run = compose("success");
		try {
			await watched(run.ready, "success READY");
			run.prompt.finish("completed", run.notify);
			const dispatch = await watched(run.dispatch, "success dispatch");
			expect(await watched(run.child.closed, "success close")).toEqual({ code: 0, signal: null });
			await watched(run.result.settlement, "success settlement");
			await watched(run.idle, "success idle");
			expect(run.result).toMatchObject({ reason: "completed", exitCode: 0, terminationObserved: true });
			expect(run.result.cleanup).toMatchObject({ termSent: false, killSent: false });
			expect(failedResult(run.single)).toBe(false);
			expect(laneResult(run.single)).toBeUndefined();
			expect(dispatch.outcomes).toEqual([{ laneId: "native", status: "completed" }]);
			expect(run.receipts[0]).toMatchObject({ type: "prompt_settled", outcome: "completed" });
			expectReleased(run);
		} finally {
			await run.cleanup();
		}
	});

	it("keeps parent cancellation non-successful even when the cooperative child exits0", async () => {
		const parent = new AbortController();
		const run = compose("wait", { signal: parent.signal });
		try {
			await watched(run.ready, "cancel READY");
			run.prompt.finish("aborted", run.notify);
			expect(run.receipts).toEqual([]);
			parent.abort();
			const dispatch = await watched(run.dispatch, "cancel dispatch");
			expect(await watched(run.child.closed, "cancel close")).toEqual({ code: 0, signal: null });
			await watched(run.result.settlement, "cancel settlement");
			await watched(run.idle, "cancel idle");
			expect(run.result).toMatchObject({ reason: "aborted", exitCode: 130, terminationObserved: true });
			expect(failedResult(run.single)).toBe(true);
			expect(laneResult(run.single)).toEqual({ status: "failed" });
			expect(dispatch.outcomes).toEqual([{ laneId: "native", status: "cancelled" }]);
			expect(run.receipts[0]).toMatchObject({ outcome: "aborted" });
			expectReleased(run);
		} finally {
			await run.cleanup();
		}
	});

	it("retains ownership after fault-injected missing signal delivery until late native close", async () => {
		// Only request delivery is suppressed; native liveness, close and original settlement stay real.
		const delivery = vi.spyOn(processTree, "signalProcessTree").mockImplementation(() => {});
		const parent = new AbortController();
		const run = compose("wait", { signal: parent.signal, cutoffMs: 1_000 });
		try {
			await watched(run.ready, "late-close READY");
			const dispatch = await watched(run.dispatch, "unsettled cutoff response");
			const snapshot = run.result;
			run.prompt.finish("aborted", run.notify);
			expect(snapshot).toMatchObject({ reason: "cutoff", exitCode: 124, terminationObserved: false });
			expect(dispatch.outcomes).toEqual([{ laneId: "native", status: "unsettled" }]);
			expect(delivery.mock.calls.map(([child, signal]) => [child === run.child.handle, signal])).toEqual([
				[true, "SIGTERM"],
				[true, "SIGKILL"],
			]);
			expect(processTree.processGroupState(snapshot.pid)).toBe("alive");
			expect(run.child.closeCount).toBe(0);
			expect(run.counts.releases).toBe(0);
			expect({ ...run.counts }).toEqual({ started: 1, children: 1, releases: 0, settlements: 0, idle: 0 });
			expect(run.pool.snapshot().activeWeight).toBe(1);
			expect(run.receipts).toEqual([]);
			let attempted = 0;
			const blocked = await watched(
				run.authority().dispatchLanes({
					lanes,
					heavyLaneIds: new Set(),
					launchLane: async () => {
						attempted++;
					},
				}),
				"fresh authority quarantine",
			);
			expect(blocked.blockers).toEqual(["ownership.unsettled"]);
			expect(attempted).toBe(0);
			parent.abort();
			const afterAbort = await watched(
				run.authority().dispatchLanes({
					lanes,
					heavyLaneIds: new Set(),
					launchLane: async () => {
						attempted++;
					},
				}),
				"abort does not discharge ownership",
			);
			expect(afterAbort.blockers).toEqual(["ownership.unsettled"]);
			expect(attempted).toBe(0);
			expect(processTree.processGroupState(snapshot.pid)).toBe("alive");
			expect(run.child.closeCount).toBe(0);
			expect(run.counts.releases).toBe(0);
			expect(run.pool.snapshot().activeWeight).toBe(1);
			expect(run.lifecycle.active).toBe(true);
			expect(run.receipts).toEqual([]);
			expect(run.child.handle.kill("SIGTERM")).toBe(true);
			expect(await watched(run.child.closed, "late native close")).toEqual({ code: 0, signal: null });
			await watched(snapshot.settlement, "original native settlement");
			await watched(run.idle, "late prompt idle");
			expectReleased(run);
			expect(run.receipts[0]).toMatchObject({ outcome: "aborted" });
			expect(run.trace.indexOf("close")).toBeLessThan(run.trace.indexOf("settlement"));
			expect(run.trace.indexOf("settlement")).toBeLessThan(run.trace.indexOf("child-release"));
			expect(run.result).toBe(snapshot);
			expect(snapshot).toMatchObject({ exitCode: 124, terminationObserved: false });
			expect(failedResult(run.single)).toBe(true);
			expect(laneResult(run.single)).toEqual({ status: "unsettled", settlement: snapshot.settlement });
			expect(dispatch.outcomes).toEqual([{ laneId: "native", status: "unsettled" }]);
			const next = compose("success", { pool: run.pool });
			try {
				await watched(next.ready, "readmission READY");
				next.prompt.finish("completed", next.notify);
				expect((await watched(next.dispatch, "readmission dispatch")).outcomes).toEqual([
					{ laneId: "native", status: "completed" },
				]);
				await watched(next.idle, "readmission idle");
				expectReleased(next);
			} finally {
				await next.cleanup();
			}
		} finally {
			try {
				await run.cleanup();
			} finally {
				delivery.mockRestore();
			}
		}
	});
});
