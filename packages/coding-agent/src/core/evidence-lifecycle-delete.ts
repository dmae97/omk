/**
 * Spec 118 D2: recall delete-after-use, default on (`OMK_EVIDENCE_LIFECYCLE` unset, `1` or `delete`; `observe` or `0` keep files).
 *
 * Only `goal-recall` artifacts are deletable, and only when every required consumer ACKed (a settled
 * re-run, never a read), the re-run verified a pass, no hold or reader lease remains, and the goal was not
 * blocked/exhausted (failure diagnostics of terminal goals are never deleted in D2; no TTL).
 * Delete is restartable: intent is appended to a per-session `evidence-deletions-<sha>.jsonl` (ids, sha256
 * of path, bytes, reason; no path text, no content) before `unlink`; failures become `delete_pending` with a
 * reason, retried at most 3 times, never reported as deleted. The API takes an artifact id, not a path.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
	evidenceHoldsOf,
	evidenceLifecycleDeleteEnabled,
	evidenceRecordOfPath,
	evidenceRecordsOf,
	type MutableRecord,
} from "./evidence-lifecycle.ts";
import { currentEvidenceSession } from "./evidence-lifecycle-scope.ts";
import { recallCounterCorrupt } from "./evidence-recall-counter.ts";

export const EVIDENCE_DELETE_MAX_ATTEMPTS = 3;
const RECALL_NAME = /^acceptance-[a-zA-Z0-9_-]+-\d+-\d+-\d+(?:-[0-9a-f]{8})?\.log$/u;

/** Test seams: inject fs faults (EACCES/EBUSY/EIO, metadata write failure). */
export const evidenceDeleteFs = {
	unlink: (path: string): void => unlinkSync(path),
	append: (path: string, line: string): void => appendFileSync(path, line, { mode: 0o600 }),
};

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export function evidenceDeletionLogPath(dir: string, sessionId: string): string {
	return join(dir, `evidence-deletions-${sha256(sessionId).slice(0, 16)}.jsonl`);
}

interface Held {
	readonly bytes: number;
	readonly reasons: readonly string[];
}
/** Per session: artifacts an existing pruner kept only because of a hold or lease (deduped by id). */
const heldBySession = new Map<string, Map<string, Held>>();

export interface DeleteOutcome {
	readonly deleted: boolean;
	readonly reason?: string;
}

/** Why `record` may not be deleted, or undefined when it may. */
function ineligible(record: MutableRecord): string | undefined {
	if (record.producer !== "goal-recall") return "producer";
	if (record.status !== "present" && record.status !== "delete_pending") return `status-${record.status}`;
	const holds = evidenceHoldsOf(record);
	if (holds.length > 0) return `hold-${holds[0]}`;
	if (record.leases > 0) return "lease";
	if (record.verified !== true) return "not-verified";
	if (record.blockedExhausted) return "terminal-diagnostic";
	if (record.path === undefined || record.ino === undefined) return "unregistered-path";
	return undefined;
}

function verifyPath(record: MutableRecord): string | undefined {
	const path = record.path as string;
	const dir = dirname(resolve(path));
	if (!dir.endsWith(`${sep}.omk${sep}goals${sep}recall`) || !RECALL_NAME.test(basename(path))) return "outside";
	// `.omk`, `goals` and `recall` must be real directories: a symlinked one could point outside the workspace.
	try {
		for (const d of [dir, dirname(dir), dirname(dirname(dir))]) if (lstatSync(d).isSymbolicLink()) return "outside";
	} catch {
		return "missing";
	}
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) return "symlink";
		if (stat.ino !== record.ino || stat.size !== record.bytes) return "swapped";
	} catch {
		return "missing";
	}
	return undefined;
}

function logLine(record: MutableRecord, sessionId: string, event: string, reason?: string): string {
	const { artifactId, pathSha256, bytes } = record;
	const entry = { v: 1, event, artifactId, sessionSha256: sha256(sessionId), pathSha256, bytes, reason };
	return `${JSON.stringify(entry)}\n`;
}

function pend(record: MutableRecord, reason: string, log?: string, sessionId?: string): DeleteOutcome {
	if (log !== undefined && sessionId !== undefined) {
		try {
			evidenceDeleteFs.append(log, logLine(record, sessionId, "aborted", reason));
		} catch {
			// recovery re-verifies size before finishing an intent
		}
	}
	record.status = "delete_pending";
	record.deleteReason = reason;
	record.version += 1;
	return { deleted: false, reason };
}

/**
 * Deletes one artifact of the current session by id. `expectedVersion` (CAS): a consumer that changed the
 * record since the caller looked wins, and nothing is deleted.
 *
 * G2 / EV4 consistency assumption: the registry is in-process memory and this function is fully
 * synchronous from the eligibility check through `unlink` and the final status write (sync fs calls, no
 * `await`, no callback). Node runs it to completion on one thread, so no consumer update, new lease or
 * pruner can interleave between "eligible" and "deleted". Every state change bumps `record.version`, so a
 * caller that read the record earlier (across an `await`) passes `expectedVersion` and loses with `cas` if
 * anything changed. This does NOT cover other processes or worker threads sharing the recall dir; there,
 * the inode/size re-check before `unlink` is the only guard. Making any step async breaks the assumption.
 */
export function deleteEvidenceArtifact(artifactId: string, expectedVersion?: number): DeleteOutcome {
	if (!evidenceLifecycleDeleteEnabled()) return { deleted: false, reason: "flag-off" };
	const sessionId = currentEvidenceSession();
	const record = evidenceRecordsOf(sessionId).find((r) => r.artifactId === artifactId);
	if (record === undefined) return { deleted: false, reason: "not-found" };
	if (expectedVersion !== undefined && record.version !== expectedVersion) return { deleted: false, reason: "cas" };
	const blocked = ineligible(record);
	if (blocked !== undefined) return { deleted: false, reason: blocked };
	if (record.deleteAttempts >= EVIDENCE_DELETE_MAX_ATTEMPTS) return { deleted: false, reason: "retries-exhausted" };
	const dir = dirname(record.path as string);
	if (recallCounterCorrupt(dir)) {
		record.deleteReason = "counter-corrupt";
		return { deleted: false, reason: "counter-corrupt" };
	}
	record.deleteAttempts += 1;
	const log = evidenceDeletionLogPath(dir, sessionId);
	record.status = "deleting";
	try {
		evidenceDeleteFs.append(log, logLine(record, sessionId, "intent", "after-use"));
	} catch {
		return pend(record, "metadata-write-failed");
	}
	const unsafe = verifyPath(record);
	if (unsafe !== undefined) return pend(record, unsafe, log, sessionId);
	try {
		evidenceDeleteFs.unlink(record.path as string);
	} catch (error) {
		return pend(record, (error as NodeJS.ErrnoException).code ?? "unlink-failed", log, sessionId);
	}
	record.status = "deleted_after_use";
	record.deleteReason = undefined;
	record.version += 1;
	heldBySession.get(sessionId)?.delete(artifactId);
	try {
		evidenceDeleteFs.append(log, logLine(record, sessionId, "deleted"));
	} catch {
		// The file is gone; restart recovery re-appends `deleted` for an intent with no matching file.
	}
	return { deleted: true };
}

/** After a verified pass of `goalId`: delete every eligible recall artifact of it in this session. */
export function deleteSettledRecall(ownerSha256: string): number {
	if (!evidenceLifecycleDeleteEnabled()) return 0;
	let deleted = 0;
	for (const record of evidenceRecordsOf(currentEvidenceSession())) {
		if (record.ownerSha256 !== ownerSha256 || ineligible(record) !== undefined) continue;
		if (deleteEvidenceArtifact(record.artifactId).deleted) deleted += 1;
	}
	return deleted;
}

/** A reader holds the artifact open; delete and hold-aware pruners skip it until released. */
export function acquireEvidenceLease(path: string): () => void {
	const record = evidenceLifecycleDeleteEnabled() ? evidenceRecordOfPath(path) : undefined;
	if (record === undefined) return () => {};
	record.leases += 1;
	record.version += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		record.leases -= 1;
		record.version += 1;
	};
}

/**
 * Owner check for existing pruners (`delete` mode only). Returns the hold reasons that forbid removing
 * `path` (and records its bytes as `heldBytes`), or undefined when the pruner may proceed as before.
 */
export function evidencePruneHold(path: string): readonly string[] | undefined {
	if (!evidenceLifecycleDeleteEnabled()) return undefined;
	const record = evidenceRecordOfPath(path);
	if (record === undefined || (record.status !== "present" && record.status !== "delete_pending")) return undefined;
	const reasons: string[] = [...evidenceHoldsOf(record), ...(record.leases > 0 ? ["lease"] : [])];
	if (reasons.length === 0) return undefined;
	const sessionId = currentEvidenceSession();
	const held = heldBySession.get(sessionId) ?? new Map<string, Held>();
	heldBySession.set(sessionId, held);
	held.set(record.artifactId, { bytes: record.bytes, reasons });
	return reasons;
}

export function evidenceHeldStats(sessionId: string): {
	heldBytes: number;
	heldCount: number;
	heldReasons: Record<string, number>;
} {
	const heldReasons: Record<string, number> = {};
	let heldBytes = 0;
	const held = [...(heldBySession.get(sessionId)?.values() ?? [])];
	for (const entry of held) {
		heldBytes += entry.bytes;
		for (const reason of entry.reasons) heldReasons[reason] = (heldReasons[reason] ?? 0) + 1;
	}
	return { heldBytes, heldCount: held.length, heldReasons };
}

export type EvidenceLookupState = "present" | "deleted_after_use" | "missing_unexpectedly";

/** What a recall reader sees for `path` (EV9): a deleted artifact is never shown as a live link. */
export function lookupEvidence(path: string): EvidenceLookupState {
	if (evidenceRecordOfPath(path)?.status === "deleted_after_use") return "deleted_after_use";
	if (existsSync(path)) return "present";
	// After a restart the registry is empty: the durable deletion log is the record (EV9 on resume).
	return loggedAsDeleted(path) ? "deleted_after_use" : "missing_unexpectedly";
}

function loggedAsDeleted(path: string): boolean {
	const dir = dirname(path);
	const needle = `"pathSha256":"${sha256(path)}"`;
	try {
		return readdirSync(dir)
			.filter((name) => /^evidence-deletions-[0-9a-f]{16}\.jsonl$/u.test(name))
			.some((name) =>
				readFileSync(join(dir, name), "utf8")
					.split("\n")
					.some((line) => line.includes(needle) && line.includes('"event":"deleted"')),
			);
	} catch {
		return false;
	}
}

/**
 * Restart convergence (EV5): every `intent` without a `deleted` entry is finished — the file whose path
 * sha256 matches is unlinked (if still a regular file) and `deleted` is appended. Returns intents converged.
 */
export function recoverEvidenceDeletions(dir: string): number {
	if (!evidenceLifecycleDeleteEnabled()) return 0;
	let converged = 0;
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return 0;
	}
	for (const log of names.filter((name) => /^evidence-deletions-[0-9a-f]{16}\.jsonl$/u.test(name))) {
		const open = new Map<string, Record<string, unknown>>();
		for (const line of readFileSync(join(dir, log), "utf8").split("\n")) {
			try {
				const entry = JSON.parse(line) as Record<string, unknown>;
				if (entry.event === "intent") open.set(String(entry.pathSha256), entry);
				else if (entry.event === "deleted" || entry.event === "aborted") open.delete(String(entry.pathSha256));
			} catch {
				// partial last line after a crash
			}
		}
		for (const [pathSha256, entry] of open) {
			const name = names.find((n) => RECALL_NAME.test(n) && sha256(join(dir, n)) === pathSha256);
			try {
				const stat = name === undefined ? undefined : lstatSync(join(dir, name));
				if (stat !== undefined && (stat.isSymbolicLink() || stat.size !== entry.bytes)) continue;
				if (name !== undefined) evidenceDeleteFs.unlink(join(dir, name));
				evidenceDeleteFs.append(
					join(dir, log),
					`${JSON.stringify({ ...entry, event: "deleted", reason: "recovered" })}\n`,
				);
				converged += 1;
			} catch {
				// stays open; the next recovery retries
			}
		}
	}
	return converged;
}

/** Test seam. */
export function resetEvidenceDeleteForTest(): void {
	heldBySession.clear();
}
