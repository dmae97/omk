import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { readRunClock } from "./recovery-clock.ts";
import {
	nativeExecutionDir,
	nativeRequestId,
	type RustExecutionRecord,
	readRustExecutionRecord,
	requestRustCancel,
} from "./rust-host-record.ts";
import type { SandboxOutcome } from "./sandbox-types.ts";
import { VerifiedRunError } from "./storage.ts";
import { awaitBoundaryDrained } from "./supervisor-adapter.ts";

function hostAlive(host: RustExecutionRecord["host"]): boolean {
	if (!host.bootId || readRunClock().bootId !== host.bootId) return false;
	try {
		const stat = readFileSync(`/proc/${host.pid}/stat`, "utf8");
		const fields = stat
			.slice(stat.lastIndexOf(")") + 2)
			.trim()
			.split(/\s+/);
		return fields[19] === host.ticks && fields[0] !== "Z" && fields[0] !== "X";
	} catch {
		return false;
	}
}

export interface ReattachOptions {
	readonly maxOutputBytes: number;
	readonly cleanupMs: number;
	/** Original budget mapped to this process's monotonic clock, never a new budget. */
	readonly deadline: number;
	readonly signal?: AbortSignal;
	/** Production caller revalidates its leases, original grant and exact record binding. */
	readonly assertBinding?: (
		record: RustExecutionRecord,
	) => "authorization_revoked" | "authorization_expired" | undefined;
}

/** Observation/cancel only: never spawns, acquires a grant or releases the execution gate. */
export async function reattachRustExecution(
	stateRoot: string,
	executionId: string,
	options: ReattachOptions,
): Promise<SandboxOutcome> {
	const dir = nativeExecutionDir(stateRoot);
	const requestId = nativeRequestId(executionId);
	let cancelledAt: number | undefined;
	let revoked: "authorization_revoked" | "authorization_expired" | undefined;
	for (;;) {
		const record = readRustExecutionRecord(dir, requestId, options.maxOutputBytes);
		if (!record) throw new VerifiedRunError("missing_record");
		revoked = options.assertBinding?.(record) ?? revoked;
		const terminal = record.terminal;
		if (terminal?.kind === "error") throw new VerifiedRunError(terminal.code);
		if (terminal?.kind === "finished" && !terminal.output) throw new VerifiedRunError("outcome_unknown");
		if (!record.durable || !record.host.bootId || record.startedAtMs === null)
			throw new VerifiedRunError("recovery_legacy");
		if (readRunClock().bootId !== record.host.bootId) throw new VerifiedRunError("clock_changed");
		if (terminal) {
			if (!record.identity || (await awaitBoundaryDrained(record.identity, options.cleanupMs)) !== "drained")
				throw new VerifiedRunError("termination_unverified");
			revoked = options.assertBinding?.(record) ?? revoked;
			const finishedAtMs = record.startedAtMs + terminal.durationMs;
			if (!terminal.output || !Number.isSafeInteger(finishedAtMs) || finishedAtMs > 8_640_000_000_000_000)
				throw new VerifiedRunError("integrity");
			return {
				stdout: terminal.output.stdout,
				stderr: terminal.output.stderr,
				exitCode: terminal.exitCode,
				failure: revoked ?? terminal.failure,
				startedAt: new Date(record.startedAtMs).toISOString(),
				finishedAt: new Date(finishedAtMs).toISOString(),
				durationMs: terminal.durationMs,
			};
		}
		if (!record.committed) throw new VerifiedRunError("unsettled");
		if (!hostAlive(record.host)) {
			// The host may have committed its terminal between our read and its exit.
			if (readRustExecutionRecord(dir, requestId, options.maxOutputBytes)?.terminal) continue;
			throw new VerifiedRunError("unsettled");
		}
		const now = performance.now();
		if (cancelledAt === undefined && (revoked || options.signal?.aborted || now >= options.deadline)) {
			requestRustCancel(dir, requestId);
			cancelledAt = now;
		}
		if (cancelledAt !== undefined && now - cancelledAt > options.cleanupMs + 1000)
			throw new VerifiedRunError("unsettled");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
