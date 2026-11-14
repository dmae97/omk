import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fsyncDirectorySync } from "../durable-file-directory.ts";
import {
	acquireSessionOwnerLeaseSync,
	type SessionOwnerLease,
	SessionOwnerLeaseHeldError,
} from "../session-owner-lease.ts";
import { type JournalSnapshot, journalPath, readRunJournal } from "./journal.ts";
import { type NativeRecordGc, withNativeRecordGc } from "./native-record-gc.ts";
import type { NativeRecordGcEntry, RunGcEntry, RunGcOptions, RunGcReport } from "./run-gc-types.ts";

export type { NativeRecordGcEntry, RunGcEntry, RunGcOptions, RunGcReport } from "./run-gc-types.ts";

import { runRecoveryHold } from "./run-retention.ts";
import type { RunProjection } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";

/**
 * Verified-run GC removes derived workspaces and independently proven, retired native records.
 * Journals, authority, issuer keys, manifests, blobs, receipts and attestations remain intact,
 * so evidence, artifacts, publication and completed command replay keep working.
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DERIVED = /^(?:(?:writer|candidate)(?:-[1-9][0-9]*)?|tasks)$/;
const UNITS: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

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

function keepReason(runPath: string, state: RunProjection, olderThanMs: number): string | null {
	const hold = runRecoveryHold(state);
	if (hold) return hold;
	// wall-clock: compared with the journal's file mtime, which the kernel stamps from the wall clock
	if (Date.now() - lstatSync(journalPath(runPath)).mtimeMs < olderThanMs) return "recent";
	return null;
}

function collectRun(runPath: string, runId: string, options: RunGcOptions, native: NativeRecordGc): RunGcEntry {
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
		let snapshot: JournalSnapshot | null;
		try {
			snapshot = readRunJournal(runPath);
		} catch (error) {
			if (error instanceof VerifiedRunError) return kept("integrity");
			throw error;
		}
		if (!snapshot || snapshot.state.runId !== runId) return kept("integrity");
		const reason = keepReason(runPath, snapshot.state, options.olderThanMs);
		const nativeReason = native.visit(runPath, snapshot, reason);
		if (reason || nativeReason) return kept(reason ?? nativeReason ?? "native_unknown");
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
	if (
		!Number.isSafeInteger(options.olderThanMs) ||
		options.olderThanMs < 0 ||
		typeof options.execute !== "boolean" ||
		(options.obsolete !== undefined && typeof options.obsolete !== "boolean")
	)
		throw new VerifiedRunError("usage");
	const root = resolve(stateRoot);
	return withNativeRecordGc(root, options, (native) => {
		const runs: RunGcEntry[] = [];
		const names = existsSync(root) ? readdirSync(root).sort() : [];
		for (const name of names) {
			if (!RUN_ID.test(name) || !lstatSync(join(root, name)).isDirectory()) continue;
			if ((name === "native-exec" || name === "native-witness") && !existsSync(journalPath(join(root, name))))
				continue;
			runs.push(collectRun(join(root, name), name, options, native));
		}
		const sum = (action: RunGcEntry["action"]) =>
			runs.filter((entry) => entry.action === action).reduce((total, entry) => total + entry.bytes, 0);
		native.finish();
		const nativeSum = (action: NativeRecordGcEntry["action"]) =>
			native.entries.filter((entry) => entry.action === action).reduce((total, entry) => total + entry.bytes, 0);
		return Object.freeze({
			stateRoot: root,
			execute: options.execute,
			olderThanMs: options.olderThanMs,
			runs: Object.freeze(runs),
			prunedBytes: sum("pruned"),
			prunableBytes: sum("prunable"),
			nativeRecords: Object.freeze(native.entries),
			prunedNativeBytes: nativeSum("pruned"),
			prunableNativeBytes: nativeSum("prunable"),
		});
	});
}
