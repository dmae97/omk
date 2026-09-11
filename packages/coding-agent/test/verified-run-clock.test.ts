import { describe, expect, it, vi } from "vitest";
import {
	anchorRunBudget,
	parseRecoveryBudget,
	remainingVerification,
} from "../src/core/verified-run/recovery-clock.ts";

const limits = { workMs: 5000, verifyMs: 8000, cleanupMs: 1000, maxOutputBytes: 1024, maxFiles: 10, maxBytes: 1024 };
const clock = { bootId: "00000000-0000-0000-0000-000000000001", nowMs: 2500 };

describe("restart-safe phase budget", () => {
	it("pins disjoint work, verification and cleanup windows once", () => {
		const budget = anchorRunBudget(limits, clock);
		expect(budget).toEqual({
			bootId: clock.bootId,
			startedMs: 2500,
			workDeadlineMs: 7500,
			verifyCapMs: 15500,
			cleanupDeadlineMs: 16500,
		});
		expect(Object.isFrozen(budget)).toBe(true);
	});
	it("charges paused time and never renews a stored verification deadline", () => {
		const budget = anchorRunBudget(limits, clock);
		expect(remainingVerification(budget, 10000, { ...clock, nowMs: 4000 })).toBe(6000);
		expect(remainingVerification(budget, 10000, { ...clock, nowMs: 9500 })).toBe(500);
		expect(remainingVerification(budget, 10000, { ...clock, nowMs: 11000 })).toBe(0);
	});
	it("rejects a different boot or a clock moving behind the persisted start", () => {
		const budget = anchorRunBudget(limits, clock);
		expect(() =>
			remainingVerification(budget, 10000, { ...clock, bootId: "00000000-0000-0000-0000-000000000002" }),
		).toThrow(/clock_changed/);
		expect(() => remainingVerification(budget, 10000, { ...clock, nowMs: 2000 })).toThrow(/clock_rollback/);
	});
	it("does not let a wall-clock change extend the monotonic allowance", () => {
		const budget = anchorRunBudget(limits, clock);
		const wall = vi.spyOn(Date, "now").mockReturnValue(0);
		try {
			expect(remainingVerification(budget, 10000, { ...clock, nowMs: 9000 })).toBe(1000);
		} finally {
			wall.mockRestore();
		}
	});
	it.each([0, -1, NaN, Infinity, 15501])("rejects an invalid verification deadline %s", (deadline) => {
		expect(() => remainingVerification(anchorRunBudget(limits, clock), deadline, clock)).toThrow(/integrity/);
	});
	it("rejects malformed and reordered budget snapshots", () => {
		const budget = anchorRunBudget(limits, clock);
		expect(() => parseRecoveryBudget({ ...budget, bootId: "unknown" })).toThrow();
		expect(() => parseRecoveryBudget({ ...budget, verifyCapMs: budget.workDeadlineMs })).toThrow();
	});
});
