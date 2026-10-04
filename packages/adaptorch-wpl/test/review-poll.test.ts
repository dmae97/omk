import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdaptOrchRunSummary } from "../src/adaptorch-client.ts";
import { pollReviewRun } from "../src/review-poll.ts";

afterEach(() => vi.useRealTimers());

describe("bounded review observation", () => {
	it("backs off from 10ms to 20ms, then returns terminal while retaining raw semantics", async () => {
		vi.useFakeTimers();
		const getRun = vi
			.fn()
			.mockResolvedValueOnce({ run_id: "r", status: "QUEUED" })
			.mockResolvedValueOnce({ run_id: "r", status: "RUNNING" })
			.mockResolvedValue({ run_id: "r", status: "SUCCEEDED", result_status: "DEGRADED" });
		const pending = pollReviewRun({ getRun }, "r", { timeoutMs: 100, initialDelayMs: 10, maxDelayMs: 20 });
		await vi.advanceTimersByTimeAsync(29);
		expect(getRun).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(await pending).toMatchObject({
			state: "terminal",
			summary: { result_status: "DEGRADED" },
			canApply: false,
			shouldSubmit: false,
		});
	});
	it("timeout leaves the run pending without cancelling or duplicate submissions", async () => {
		vi.useFakeTimers();
		const getRun = vi.fn(async () => ({ run_id: "r", status: "RUNNING" }));
		const pending = pollReviewRun({ getRun }, "r", { timeoutMs: 20, initialDelayMs: 10, maxDelayMs: 20 });
		await vi.advanceTimersByTimeAsync(21);
		expect(await pending).toMatchObject({ state: "observation_timeout", runId: "r", summary: { status: "RUNNING" } });
	});
	it("bounds a hung get_run call", async () => {
		vi.useFakeTimers();
		const getRun = vi.fn(() => new Promise<never>(() => {}));
		const pending = pollReviewRun({ getRun }, "r", { timeoutMs: 10 });
		await vi.advanceTimersByTimeAsync(11);
		expect(await pending).toMatchObject({ state: "observation_timeout" });
		expect(getRun).toHaveBeenCalledTimes(1);
	});
	it.each([{ run_id: "wrong", status: "SUCCEEDED" }, { run_id: "r", status: "FINAL: PASS" }, undefined])(
		"fails closed on malformed or mismatched status: %j",
		async (value) => {
			expect(
				await pollReviewRun({ getRun: vi.fn(async () => value as AdaptOrchRunSummary) }, "r", { timeoutMs: 10 }),
			).not.toHaveProperty("state", "terminal");
		},
	);
	it("reports read errors without calling submit/cancel", async () => {
		expect(
			await pollReviewRun(
				{
					getRun: vi.fn(async () => {
						throw new Error("offline");
					}),
				},
				"r",
			),
		).toMatchObject({ state: "observation_error" });
	});
	it("supports caller observation abort without cancelling remote work", async () => {
		const controller = new AbortController();
		controller.abort();
		const getRun = vi.fn();
		expect(await pollReviewRun({ getRun }, "r", { signal: controller.signal })).toMatchObject({
			state: "observation_aborted",
		});
		expect(getRun).not.toHaveBeenCalled();
	});
});
