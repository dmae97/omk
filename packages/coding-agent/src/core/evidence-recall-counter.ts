/**
 * Spec 118 D2 (`OMK_EVIDENCE_LIFECYCLE=delete` only): durable monotonic recall attempt counter.
 *
 * One sidecar JSON per recall folder, `{ "v": 1, "last": { "<stem>": <attempt> } }`, written atomically:
 * a unique tmp file, then `rename` over the sidecar, so a crash leaves either the old or the new file, never
 * a partial one. The counter is written BEFORE the log file is created, so a deleted path is never reused
 * (EV11), across restarts. A corrupt or unparseable sidecar is left untouched and marks the folder
 * `counter-corrupt`: capture continues (nonce + survivor scan), but no lifecycle delete runs there.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RECALL_COUNTER_FILE = ".attempt-counter.json";

interface CounterFile {
	readonly v: 1;
	readonly last: Record<string, number>;
}

/** Test seam: inject a crash between the tmp write and the rename. */
export const recallCounterFs = {
	rename: (from: string, to: string): void => renameSync(from, to),
};

type ReadResult = { readonly ok: true; readonly file: CounterFile } | { readonly ok: false };

function readCounter(dir: string): ReadResult {
	let text: string;
	try {
		text = readFileSync(join(dir, RECALL_COUNTER_FILE), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, file: { v: 1, last: {} } };
		return { ok: false };
	}
	try {
		const parsed = JSON.parse(text) as Partial<CounterFile> | null;
		if (parsed === null || parsed.v !== 1 || typeof parsed.last !== "object" || parsed.last === null) {
			return { ok: false };
		}
		for (const value of Object.values(parsed.last)) {
			if (!Number.isSafeInteger(value) || (value as number) < 0) return { ok: false };
		}
		return { ok: true, file: { v: 1, last: { ...parsed.last } } };
	} catch {
		return { ok: false };
	}
}

/** True when the folder's sidecar exists but cannot be trusted; deletion must not run there. */
export function recallCounterCorrupt(dir: string): boolean {
	return !readCounter(dir).ok;
}

export interface ReservedAttempt {
	readonly attempt: number;
	/** `false` ⇒ the sidecar is corrupt or could not be written; the caller falls back to the scan. */
	readonly durable: boolean;
}

/**
 * Reserves the next attempt for `stem`: max(sidecar, `scanned` survivors) + 1, persisted atomically before
 * the caller creates the file. Never throws.
 */
export function reserveRecallAttempt(dir: string, stem: string, scannedLast: number): ReservedAttempt {
	const current = readCounter(dir);
	if (!current.ok) return { attempt: scannedLast + 1, durable: false };
	const attempt = Math.max(current.file.last[stem] ?? 0, scannedLast) + 1;
	const next: CounterFile = { v: 1, last: { ...current.file.last, [stem]: attempt } };
	const tmp = join(dir, `${RECALL_COUNTER_FILE}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
	try {
		writeFileSync(tmp, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: "wx" });
		recallCounterFs.rename(tmp, join(dir, RECALL_COUNTER_FILE));
		return { attempt, durable: true };
	} catch {
		try {
			rmSync(tmp, { force: true });
		} catch {
			// best effort
		}
		return { attempt, durable: false };
	}
}
