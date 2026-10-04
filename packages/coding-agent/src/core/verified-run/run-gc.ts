import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fsyncDirectorySync } from "../durable-file-directory.ts";
import {
	acquireSessionOwnerLeaseSync,
	type SessionOwnerLease,
	SessionOwnerLeaseHeldError,
} from "../session-owner-lease.ts";
import { journalPath, readRunJournal } from "./journal.ts";
import { readRunClock, remainingRunTime } from "./recovery-clock.ts";
import type { RunProjection } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";

/**
 * Verified-run artifact GC. It removes only derived workspaces — materialized copies that can be
 * rebuilt from content-addressed blobs — and never the journal, issuer key, candidate manifests,
 * blobs, receipts or attestations, so `evidence`, `artifact`, `status` and `publish` keep working.
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DERIVED = /^(?:(?:writer|candidate)(?:-[1-9][0-9]*)?|tasks)$/;
const UNITS: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export interface RunGcOptions {
	/** Minimum age of the run's last journal write, in milliseconds. */
	readonly olderThanMs: number;
	/** False reports what would be removed without touching the file system. */
	readonly execute: boolean;
}

export interface RunGcEntry {
	readonly runId: string;
	readonly action: "pruned" | "prunable" | "kept";
	/** Why a run was kept; null when it was (or would be) pruned. */
	readonly reason: string | null;
	/** Derived workspace names (relative to the run) that were or would be removed. */
	readonly paths: readonly string[];
	readonly bytes: number;
}

export interface RunGcReport {
	readonly stateRoot: string;
	readonly execute: boolean;
	readonly olderThanMs: number;
	readonly runs: readonly RunGcEntry[];
	readonly prunedBytes: number;
	readonly prunableBytes: number;
}

/** `<integer><unit>` with unit ms, s, m, h or d. */
export function parseRetention(text: string): number {
	const match = /^(0|[1-9][0-9]{0,15})(ms|s|m|h|d)$/.exec(text);
	const ms = match ? Number(match[1]) * (UNITS[match[2]] ?? Number.NaN) : Number.NaN;
	if (!Number.isSafeInteger(ms)) throw new VerifiedRunError("usage");
	return ms;
}

/** Bytes held by regular files under `path`, without following symlinks. */
function treeBytes(path: string): number {
	let total = 0;
	const pending = [path];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		const stat = lstatSync(next);
		if (stat.isDirectory()) for (const name of readdirSync(next)) pending.push(join(next, name));
		else if (stat.isFile()) total += stat.size;
	}
	return total;
}

/**
 * No recovery command can ever succeed: no anchored budget, a past budget cap, or another boot.
 * Null when the run clock cannot decide (rollback, unavailable, damaged budget): keep the run.
 */
function unrecoverable(state: RunProjection): boolean | null {
	if (state.execution === "succeeded" || state.execution === "failed" || !state.budget) return true;
	try {
		return remainingRunTime(state.budget, state.budget.verifyCapMs, readRunClock()) === 0;
	} catch (error) {
		if (!(error instanceof VerifiedRunError)) throw error;
		return error.code === "clock_changed" ? true : null;
	}
}

function keepReason(runPath: string, state: RunProjection, olderThanMs: number): string | null {
	if (state.activeExecutionIds.length || state.writerOpen || state.settlement !== "settled") return "unsettled";
	if (state.publication === "intent" || state.publication === "reconciliation_required") return "publication_open";
	const done = unrecoverable(state);
	if (done === null) return "clock_unknown";
	if (!done) return "recoverable";
	if (Date.now() - lstatSync(journalPath(runPath)).mtimeMs < olderThanMs) return "recent";
	return null;
}

function collectRun(runPath: string, runId: string, options: RunGcOptions): RunGcEntry {
	const kept = (reason: string): RunGcEntry => Object.freeze({ runId, action: "kept", reason, paths: [], bytes: 0 });
	if (!existsSync(journalPath(runPath))) return kept("missing_journal");
	let owner: SessionOwnerLease;
	try {
		owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
	} catch (error) {
		if (error instanceof SessionOwnerLeaseHeldError) return kept("owner_live");
		return kept("owner_unknown");
	}
	try {
		let state: RunProjection | undefined;
		try {
			state = readRunJournal(runPath)?.state;
		} catch (error) {
			if (error instanceof VerifiedRunError) return kept("integrity");
			throw error;
		}
		if (!state || state.runId !== runId) return kept("integrity");
		const reason = keepReason(runPath, state, options.olderThanMs);
		if (reason) return kept(reason);
		const paths = readdirSync(runPath)
			.filter((name) => DERIVED.test(name) && lstatSync(join(runPath, name)).isDirectory())
			.sort();
		if (!paths.length) return kept("already_pruned");
		const bytes = paths.reduce((sum, name) => sum + treeBytes(join(runPath, name)), 0);
		if (options.execute) {
			try {
				for (const name of paths) rmSync(join(runPath, name), { recursive: true });
				fsyncDirectorySync(runPath);
			} catch {
				// Derived data only: a partial removal loses nothing, and the next GC retries the rest.
				return Object.freeze({ runId, action: "kept", reason: "remove_failed", paths, bytes: 0 });
			}
		}
		return Object.freeze({ runId, action: options.execute ? "pruned" : "prunable", reason: null, paths, bytes });
	} finally {
		owner.release();
	}
}

/** Inspect every run directory directly under the state root, holding each run's owner lease. */
export function collectVerifiedRuns(stateRoot: string, options: RunGcOptions): RunGcReport {
	const root = resolve(stateRoot);
	const runs: RunGcEntry[] = [];
	const names = existsSync(root) ? readdirSync(root).sort() : [];
	for (const name of names) {
		if (!RUN_ID.test(name) || !lstatSync(join(root, name)).isDirectory()) continue;
		runs.push(collectRun(join(root, name), name, options));
	}
	const sum = (action: RunGcEntry["action"]) =>
		runs.filter((entry) => entry.action === action).reduce((total, entry) => total + entry.bytes, 0);
	return Object.freeze({
		stateRoot: root,
		execute: options.execute,
		olderThanMs: options.olderThanMs,
		runs: Object.freeze(runs),
		prunedBytes: sum("pruned"),
		prunableBytes: sum("prunable"),
	});
}
