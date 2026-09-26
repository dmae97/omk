import { Agent } from "omk-agent-core";
import { expect, it, vi } from "vitest";
import { RunBudget } from "../src/core/run-budget.ts";
import { SessionRunBudget } from "../src/core/session-run-budget.ts";

it("keeps same-producer preflight compaction inside the existing budget", async () => {
	vi.stubEnv("OMK_REQUEST_ADMISSION_MODE", "off");
	vi.stubEnv("OMK_EVAL_TRACE", undefined);
	try {
		const agent = new Agent();
		const budget = new SessionRunBudget(agent, { assertIdle() {}, stop() {}, reject() {} });
		const abort = vi.fn(async () => {});
		await budget.execute(undefined, async () => {
			await budget.abortAndJoin(false, abort);
			budget.assertActive();
			await expect(budget.abortAndJoin(true, abort)).rejects.toThrow("own active");
		});
		expect(abort).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllEnvs();
	}
});
it("scope close does not settle an active logical stream", async () => {
	const budget = new RunBudget(undefined, () => {});
	const release = budget.admit();
	budget.close();
	let idle = false;
	const waiting = budget.waitForIdle().then(() => {
		idle = true;
	});
	await Promise.resolve();
	expect(idle).toBe(false);
	release();
	await waiting;
	expect(idle).toBe(true);
});
