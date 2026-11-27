import { describe, expect, it } from "vitest";
import type { BashExecutionMessage } from "../src/core/messages.ts";
import { SessionBashService, type SessionBashServiceDeps } from "../src/core/session-bash-service.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

function makeHarness(options: {
	streaming?: boolean;
	failAppendOn?: (msg: BashExecutionMessage, callIndex: number) => boolean;
}) {
	let streaming = options.streaming ?? false;
	const inMemory: BashExecutionMessage[] = [];
	const persisted: BashExecutionMessage[] = [];
	let appendCalls = 0;

	const deps: SessionBashServiceDeps = {
		settings: SettingsManager.inMemory({}),
		runtime: {
			sandboxPreflight: () => undefined,
			executeVerified: async () => undefined,
		} as never,
		loadoutPolicy: undefined,
		getCwd: () => process.cwd(),
		emit: () => {},
		isStreaming: () => streaming,
		pushMessage: (msg) => {
			inMemory.push(msg);
		},
		appendMessage: (msg) => {
			appendCalls += 1;
			if (options.failAppendOn?.(msg, appendCalls)) {
				throw new Error(`append failed at call ${appendCalls}`);
			}
			persisted.push(msg);
		},
	};

	return {
		service: new SessionBashService(deps),
		inMemory,
		persisted,
		setStreaming: (v: boolean) => {
			streaming = v;
		},
	};
}

describe("N08: bash result persistence deduplication, idle recovery queue, and shutdown resilience", () => {
	it("does not duplicate confirmed results or in-memory pushes when flushPending fails mid-batch and retries", () => {
		let failSecond = true;
		const h = makeHarness({
			streaming: true,
			failAppendOn: (msg) => failSecond && msg.command === "cmd-2",
		});

		h.service.recordBashResult("cmd-1", { output: "out-1", exitCode: 0, cancelled: false, truncated: false });
		h.service.recordBashResult("cmd-2", { output: "out-2", exitCode: 0, cancelled: false, truncated: false });
		expect(h.service.hasPendingBashMessages).toBe(true);

		expect(() => h.service.flushPending()).toThrow(/append failed/);
		expect(h.inMemory.map((m) => m.command)).toEqual(["cmd-1", "cmd-2"]);
		expect(h.persisted.map((m) => m.command)).toEqual(["cmd-1"]);
		expect(h.service.hasPendingBashMessages).toBe(true);

		// Retry after storage recovers: cmd-1 must NOT be re-persisted, cmd-2 must NOT be re-pushed in memory.
		failSecond = false;
		h.service.flushPending();
		expect(h.inMemory.map((m) => m.command)).toEqual(["cmd-1", "cmd-2"]);
		expect(h.persisted.map((m) => m.command)).toEqual(["cmd-1", "cmd-2"]);
		expect(h.service.hasPendingBashMessages).toBe(false);
	});

	it("enqueues idle persistence failures for recovery without duplicating in-memory messages on retry", () => {
		let shouldFail = true;
		const h = makeHarness({
			streaming: false,
			failAppendOn: () => shouldFail,
		});

		expect(() =>
			h.service.recordBashResult("idle-cmd", { output: "ok", exitCode: 0, cancelled: false, truncated: false }),
		).toThrow(/append failed/);

		expect(h.inMemory.map((m) => m.command)).toEqual(["idle-cmd"]);
		expect(h.persisted).toEqual([]);
		expect(h.service.hasPendingBashMessages).toBe(true);

		shouldFail = false;
		h.service.flushPending();
		expect(h.inMemory.map((m) => m.command)).toEqual(["idle-cmd"]);
		expect(h.persisted.map((m) => m.command)).toEqual(["idle-cmd"]);
		expect(h.service.hasPendingBashMessages).toBe(false);
	});

	it("tracks stable result IDs so an already-confirmed result is never re-persisted", () => {
		const h = makeHarness({ streaming: false });
		const res = { output: "done", exitCode: 0, cancelled: false, truncated: false };
		h.service.recordBashResult("once", res, { recordId: "bash-stable-1" });
		h.service.recordBashResult("once", res, { recordId: "bash-stable-1" });
		expect(h.inMemory).toHaveLength(1);
		expect(h.persisted).toHaveLength(1);
	});

	it("flushPendingSafe isolates storage failures so session settlement/shutdown still proceeds", () => {
		const h = makeHarness({
			streaming: true,
			failAppendOn: () => true,
		});
		h.service.recordBashResult("shutdown-cmd", { output: "x", exitCode: 0, cancelled: false, truncated: false });

		const errors: unknown[] = [];
		let shutdownCompleted = false;
		try {
			const failed = h.service.flushPendingForShutdown((err) => errors.push(err));
			expect(failed).toBe(true);
		} finally {
			shutdownCompleted = true;
		}
		expect(shutdownCompleted).toBe(true);
		expect(errors).toHaveLength(1);
		// Record remains queued for future recovery until confirmed persisted.
		expect(h.service.hasPendingBashMessages).toBe(true);
	});
});
