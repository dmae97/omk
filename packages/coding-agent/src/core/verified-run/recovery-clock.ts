import { readFileSync } from "node:fs";
import { uptime } from "node:os";
import { performance } from "node:perf_hooks";
import type { RunPhaseBudget } from "omk-protocol";
import { VerifiedRunError } from "./storage.ts";

export interface RunClock {
	readonly bootId: string;
	readonly nowMs: number;
}
export interface RecoveryBudget {
	readonly bootId: string;
	readonly startedMs: number;
	readonly workDeadlineMs: number;
	readonly verifyCapMs: number;
	readonly cleanupDeadlineMs: number;
}
const BOOT_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function readRunClock(): RunClock {
	if (process.platform !== "linux") throw new VerifiedRunError("clock_unavailable");
	const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
	const nowMs = Math.floor(uptime() * 1000);
	if (!BOOT_ID.test(bootId) || !Number.isSafeInteger(nowMs) || nowMs < 0)
		throw new VerifiedRunError("clock_unavailable");
	return Object.freeze({ bootId, nowMs });
}

export function anchorRunBudget(limits: RunPhaseBudget, clock: RunClock): RecoveryBudget {
	return parseRecoveryBudget({
		bootId: clock.bootId,
		startedMs: clock.nowMs,
		workDeadlineMs: clock.nowMs + limits.workMs,
		verifyCapMs: clock.nowMs + limits.workMs + limits.verifyMs,
		cleanupDeadlineMs: clock.nowMs + limits.workMs + limits.verifyMs + limits.cleanupMs,
	});
}

export function parseRecoveryBudget(raw: unknown): RecoveryBudget {
	if (
		typeof raw !== "object" ||
		raw === null ||
		!("bootId" in raw) ||
		typeof raw.bootId !== "string" ||
		!BOOT_ID.test(raw.bootId) ||
		!("startedMs" in raw) ||
		typeof raw.startedMs !== "number" ||
		!("workDeadlineMs" in raw) ||
		typeof raw.workDeadlineMs !== "number" ||
		!("verifyCapMs" in raw) ||
		typeof raw.verifyCapMs !== "number" ||
		!("cleanupDeadlineMs" in raw) ||
		typeof raw.cleanupDeadlineMs !== "number"
	)
		throw new VerifiedRunError("integrity");
	const values = [raw.startedMs, raw.workDeadlineMs, raw.verifyCapMs, raw.cleanupDeadlineMs];
	if (
		values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
		raw.workDeadlineMs <= raw.startedMs ||
		raw.verifyCapMs <= raw.workDeadlineMs ||
		raw.cleanupDeadlineMs <= raw.verifyCapMs
	)
		throw new VerifiedRunError("integrity");
	return Object.freeze({
		bootId: raw.bootId,
		startedMs: raw.startedMs,
		workDeadlineMs: raw.workDeadlineMs,
		verifyCapMs: raw.verifyCapMs,
		cleanupDeadlineMs: raw.cleanupDeadlineMs,
	});
}

export function remainingVerification(budget: RecoveryBudget, deadlineMs: number, clock = readRunClock()): number {
	if (clock.bootId !== budget.bootId) throw new VerifiedRunError("clock_changed");
	if (clock.nowMs < budget.startedMs) throw new VerifiedRunError("clock_rollback");
	if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= budget.startedMs || deadlineMs > budget.verifyCapMs)
		throw new VerifiedRunError("integrity");
	return Math.max(0, deadlineMs - clock.nowMs);
}

export function localVerificationDeadline(budget: RecoveryBudget, deadlineMs: number): number {
	const remaining = remainingVerification(budget, deadlineMs);
	if (remaining <= 0) throw new VerifiedRunError("deadline");
	return performance.now() + remaining;
}
