import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewSha256 } from "../src/review-evidence.ts";
import {
	type AuthorizedReviewTestExecutor,
	createReviewRevalidationPlan,
	type ExecutedBoundaryTest,
	type PreparedBoundaryTest,
	runReviewRevalidation,
} from "../src/review-revalidation.ts";
import { reviewFixture } from "./review-fixtures.ts";

function setup() {
	const plan = createReviewRevalidationPlan(reviewFixture());
	const tests: PreparedBoundaryTest[] = [
		{
			id: "zero",
			specItemId: "bounds",
			boundary: "below lower bound",
			testSource: "assert.equal(valid(0), false)",
			command: "npm test -- boundary-zero",
		},
		{
			id: "one",
			specItemId: "bounds",
			boundary: "valid lower bound",
			testSource: "assert.equal(valid(1), true)",
			command: "npm test -- boundary-one",
		},
	];
	const prepare = vi.fn(async () => tests);
	const execute = vi.fn(
		async (test: PreparedBoundaryTest): Promise<ExecutedBoundaryTest> => ({
			testId: test.id,
			testSourceSha256: reviewSha256(test.testSource),
			command: test.command,
			output: "synthetic runner result",
			exitCode: 0,
			outcome: "passed",
			assertionCount: 1,
			executedAt: "2026-10-04T00:00:00Z",
		}),
	);
	const executor: AuthorizedReviewTestExecutor = {
		authorization: {
			packetId: plan.packetId,
			specRevision: plan.specRevision,
			specSha256: plan.specSha256,
			diffSha256: plan.diffSha256,
			writeAndExecuteAllowed: true,
		},
		prepare,
		execute,
	};
	return { plan, tests, executor, prepare, execute };
}
afterEach(() => vi.useRealTimers());

describe("per-spec authorized revalidation", () => {
	it("stays blocked without an executor and never reports a fabricated pass", async () => {
		const { plan } = setup();
		const result = await runReviewRevalidation(plan);
		expect(result).toMatchObject({
			state: "blocked",
			prepared: [],
			executions: [],
			canApply: false,
			shouldSubmit: false,
		});
	});
	it("writes and runs every spec's distinct boundaries only through the authorized hooks", async () => {
		const { plan, executor, prepare, execute } = setup();
		const result = await runReviewRevalidation(plan, executor);
		expect(result).toMatchObject({ state: "evidence_ready", canApply: false, shouldSubmit: false });
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledTimes(2);
		expect(result.executions).toHaveLength(2);
		expect(result.executions[0].command).toBe("npm test -- boundary-zero");
	});
	it("refuses authorization for another spec revision before any tool work", async () => {
		const { plan, executor, prepare, execute } = setup();
		const result = await runReviewRevalidation(plan, {
			...executor,
			authorization: { ...executor.authorization, specRevision: "other" },
		});
		expect(result.state).toBe("blocked");
		expect(prepare).not.toHaveBeenCalled();
		expect(execute).not.toHaveBeenCalled();
	});
	it("refuses empty, incomplete, or mutated plans instead of vacuous test success", async () => {
		const { plan, executor, execute } = setup();
		for (const items of [[], [{ ...plan.items[0], spec: { id: "changed", text: "weakened requirement" } }]]) {
			expect((await runReviewRevalidation({ ...plan, items }, executor)).state).toBe("blocked");
		}
		expect(execute).not.toHaveBeenCalled();
	});
	it("rejects incomplete or duplicate boundary-case preparation", async () => {
		const { plan, tests, executor, execute } = setup();
		for (const prepared of [
			[],
			[tests[0]],
			[tests[0], { ...tests[0], id: "duplicate" }],
			[tests[0], { ...tests[1], specItemId: "unknown" }],
		]) {
			expect((await runReviewRevalidation(plan, { ...executor, prepare: async () => prepared })).state).toBe(
				"blocked",
			);
		}
		expect(execute).not.toHaveBeenCalled();
	});
	it.each([
		{ exitCode: 1, outcome: "failed" },
		{ outcome: "skipped", assertionCount: 0 },
		{ outcome: "passed", assertionCount: 0 },
	])("never reports evidence_ready for failed/skipped/empty tests: %j", async (patch) => {
		const { plan, executor, execute } = setup();
		const result = await runReviewRevalidation(plan, {
			...executor,
			execute: async (test) => ({ ...(await execute(test)), ...patch }) as ExecutedBoundaryTest,
		});
		expect(result.state).toBe("tests_failed");
		expect(result.canApply).toBe(false);
	});
	it.each([
		{ testId: "different" },
		{ testSourceSha256: "not-the-source" },
		{ command: "some other command" },
		{ executedAt: "bad time" },
		{ outcome: undefined },
	])("rejects unbound or invented execution records: %j", async (patch) => {
		const { plan, executor, execute } = setup();
		const result = await runReviewRevalidation(plan, {
			...executor,
			execute: async (test) => ({ ...(await execute(test)), ...patch }) as ExecutedBoundaryTest,
		});
		expect(result.state).toBe("blocked");
	});
	it("times out a hung test without declaring failure, cancellation, or retrying", async () => {
		vi.useFakeTimers();
		const { plan, executor } = setup();
		const execute = vi.fn(() => new Promise<never>(() => {}));
		const pending = runReviewRevalidation(plan, { ...executor, execute }, 10);
		await vi.advanceTimersByTimeAsync(11);
		expect(await pending).toMatchObject({ state: "execution_unknown", executions: [] });
		expect(execute).toHaveBeenCalledTimes(1);
	});
});

describe("revalidation async mutation isolation", () => {
	it("retains authoritative spec coverage when the caller mutates the original plan during prepare", async () => {
		const { plan, executor, execute } = setup();
		const result = await runReviewRevalidation(plan, {
			...executor,
			prepare: async () => {
				(plan.items as unknown[]).splice(0);
				return [];
			},
		});
		expect(result.state).toBe("blocked");
		expect(result.plan.items).toHaveLength(1);
		expect(execute).not.toHaveBeenCalled();
	});
	it("isolates nested requirement mutation in the executor's plan copy", async () => {
		const { plan, executor, tests } = setup();
		const result = await runReviewRevalidation(plan, {
			...executor,
			prepare: async (provided) => {
				(provided.items[0].spec as { id: string }).id = "tampered";
				return tests;
			},
		});
		expect(result.state).toBe("evidence_ready");
		expect(result.plan.items[0].spec.id).toBe("bounds");
	});
	it("isolates prepared collections and prior execution receipts across awaits", async () => {
		const { plan, executor, tests, execute } = setup();
		let prior: ExecutedBoundaryTest | undefined;
		let call = 0;
		const result = await runReviewRevalidation(plan, {
			...executor,
			execute: async (test) => {
				call++;
				(tests[1] as { command: string }).command = "tampered external command";
				if (prior) (prior as { exitCode: number }).exitCode = 55;
				const receipt = await execute(test);
				prior = receipt;
				(test as { command: string }).command = "tampered input copy";
				return receipt;
			},
		});
		expect(call).toBe(2);
		expect(result.state).toBe("evidence_ready");
		expect(result.prepared[1].command).toBe("npm test -- boundary-one");
		expect(result.executions.map((item) => item.exitCode)).toEqual([0, 0]);
	});
});
