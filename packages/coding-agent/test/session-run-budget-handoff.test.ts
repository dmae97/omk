import { Agent } from "omk-agent-core";
import { describe, expect, it, vi } from "vitest";
import { SessionRunBudget } from "../src/core/session-run-budget.ts";
import { phase3Gate } from "./fixtures/phase3-gate.ts";

function fixture() {
	const agent = new Agent();
	const scope = new SessionRunBudget(agent, { assertIdle: () => {}, stop: () => {}, reject: () => {} });
	return { agent, scope };
}

describe("manual compaction budget handoff", () => {
	it("waits for externally aborted preflight to restore its wrappers", async () => {
		const { agent, scope } = fixture();
		const original = agent.streamFn;
		const entered = phase3Gate<void>();
		const release = phase3Gate<void>();
		const stopped = phase3Gate<void>();
		const work = scope.execute(undefined, async () => {
			entered.resolve();
			await release.promise;
		});
		const rejected = expect(work).rejects.toMatchObject({ name: "AbortError" });
		await entered.promise;
		let joined = false;
		const handoff = scope
			.abortAndJoin(false, async () => {
				scope.cancelPreflight();
				stopped.resolve();
			})
			.then(() => {
				joined = true;
			});
		try {
			await stopped.promise;
			await Promise.resolve();
			await Promise.resolve();
			expect(joined).toBe(false);
			expect(agent.streamFn).not.toBe(original);
		} finally {
			release.resolve();
			await rejected;
			await handoff;
		}
		expect(agent.streamFn).toBe(original);
	});

	it("joins the captured execution rather than a later prompt", async () => {
		const { scope } = fixture();
		const first = phase3Gate<void>();
		const second = phase3Gate<void>();
		const started = phase3Gate<void>();
		const original = scope.execute(undefined, async () => {
			await first.promise;
		});
		let replacement: Promise<void> | undefined;
		let joined = false;
		const handoff = scope
			.abortAndJoin(false, async () => {
				first.resolve();
				await original;
				replacement = scope.execute(undefined, async () => {
					started.resolve();
					await second.promise;
				});
				await started.promise;
			})
			.then(() => {
				joined = true;
			});
		try {
			await started.promise;
			for (let i = 0; i < 8; i++) await Promise.resolve();
			expect(joined).toBe(true);
		} finally {
			second.resolve();
			await replacement;
			await handoff;
		}
	});

	it("shares the current preflight budget instead of aborting itself", async () => {
		const { scope } = fixture();
		const abort = vi.fn(async () => {
			scope.cancelPreflight();
		});
		await scope.execute({ maxRequests: 2 }, async () => {
			await scope.abortAndJoin(false, abort);
			scope.assertAdmission();
		});
		expect(abort).not.toHaveBeenCalled();
	});

	it("rejects compaction from its own active agent operation without self-waiting", async () => {
		const { scope } = fixture();
		const abort = vi.fn(async () => {});
		await scope.execute(undefined, async () => {
			await expect(scope.abortAndJoin(true, abort)).rejects.toThrow(/own active/);
		});
		expect(abort).not.toHaveBeenCalled();
	});
});
