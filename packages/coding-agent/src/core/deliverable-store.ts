/**
 * Last-good copies of deliverables (spec 034 requirement 3 and 5). Copies live
 * outside the workspace under one directory per process and are deleted on
 * session shutdown. A valid current file is never replaced.
 */
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Deliverable } from "./deliverable-guard.ts";
import { type FastCheckResult, fastCheckFile } from "./fast-check.ts";

/** Files above this are not copied (recorded as `too_large`). */
export const DELIVERABLE_MAX_COPY_BYTES = 256 * 1024 * 1024;

export interface LastGoodCopy {
	readonly file: string;
	readonly size: number;
	readonly sha256: string;
	readonly savedAtFraction?: number;
}

export type RestoreDecision = "keep" | "restore" | "no_copy";

export interface RestoreRecord {
	readonly path: string;
	readonly outcome: "restored" | "missing_no_copy" | "invalid_no_copy" | "too_large";
	/** `missing` or `invalid:<fast-check reason>`. */
	readonly reason: string;
	readonly currentSize?: number;
	readonly restoredSize?: number;
	readonly sha256?: string;
	readonly savedAtFraction?: number;
}

interface Seen {
	readonly size: number;
	readonly mtimeMs: number;
	readonly check: FastCheckResult;
}

/** Streams the file through the hash, so a copy near the 256 MiB cap is never held in memory. */
async function sha256Of(file: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

const roundFraction = (fraction: number | undefined) =>
	fraction === undefined ? undefined : Math.round(fraction * 100) / 100;

/**
 * All file work is sequential: `observe`, `restoreBroken` and `restoreSync` walk at most
 * four deliverables one at a time, and the extension runs them through one serial chain.
 */
export class DeliverableStore {
	private readonly copies = new Map<number, LastGoodCopy>();
	private readonly seen = new Map<number, Seen>();
	private readonly tooLarge = new Set<number>();
	/** Milliseconds spent on stats, checks and copies since the last {@link takeGuardMs}. */
	private guardMs = 0;

	private readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	/** Forgets copies of the previous task; the files are overwritten by index. */
	reset(): void {
		this.copies.clear();
		this.seen.clear();
		this.tooLarge.clear();
	}

	takeGuardMs(): number {
		const ms = this.guardMs;
		this.guardMs = 0;
		return Math.round(ms);
	}

	/** The fast check of the current file, reusing the last result while size and mtime are unchanged. */
	private async check(index: number, deliverable: Deliverable): Promise<{ check: FastCheckResult; changed: boolean }> {
		let info: Awaited<ReturnType<typeof stat>>;
		try {
			info = await stat(deliverable.path);
		} catch {
			const changed = this.seen.has(index);
			this.seen.delete(index);
			return { check: { ok: false, reason: "missing", ms: 0 }, changed };
		}
		const size = Number(info.size);
		const mtimeMs = Number(info.mtimeMs);
		const previous = this.seen.get(index);
		if (previous && previous.size === size && previous.mtimeMs === mtimeMs)
			return { check: previous.check, changed: false };
		const check = await fastCheckFile(deliverable.path, { sizeLimit: deliverable.sizeLimit });
		this.seen.set(index, { size, mtimeMs, check });
		return { check, changed: true };
	}

	/** After a tool call: saves a copy of each deliverable that changed and passes the fast check. */
	async observe(deliverables: readonly Deliverable[], fraction: number | undefined): Promise<void> {
		const started = performance.now();
		for (const [index, deliverable] of deliverables.entries()) {
			const { check, changed } = await this.check(index, deliverable);
			if (!changed || !check.ok) continue;
			if ((check.size ?? 0) > DELIVERABLE_MAX_COPY_BYTES) {
				this.tooLarge.add(index);
				continue;
			}
			const file = join(this.root, `${index}-${basename(deliverable.path)}`);
			try {
				await mkdir(this.root, { recursive: true, mode: 0o700 });
				await copyFile(deliverable.path, file);
				const size = Number((await stat(file)).size);
				this.copies.set(index, {
					file,
					size,
					sha256: await sha256Of(file),
					savedAtFraction: roundFraction(fraction),
				});
				this.tooLarge.delete(index);
			} catch {
				// The file moved under us; the next tool call looks again.
			}
		}
		this.guardMs += performance.now() - started;
	}

	/** Paths of deliverables that do not exist. */
	missing(deliverables: readonly Deliverable[]): string[] {
		return deliverables.filter((deliverable) => !existsSync(deliverable.path)).map((deliverable) => deliverable.path);
	}

	/**
	 * Restores each deliverable that is missing or fails the fast check and has a last-good copy.
	 * `onVerdict` sees each deliverable's check and the decision taken.
	 */
	async restoreBroken(
		deliverables: readonly Deliverable[],
		onVerdict?: (path: string, check: FastCheckResult, decision: RestoreDecision) => void,
	): Promise<RestoreRecord[]> {
		const started = performance.now();
		const records: RestoreRecord[] = [];
		for (const [index, deliverable] of deliverables.entries()) {
			const { check } = await this.check(index, deliverable);
			const copy = this.copies.get(index);
			onVerdict?.(deliverable.path, check, check.ok ? "keep" : copy ? "restore" : "no_copy");
			if (check.ok) continue;
			const reason = check.reason === "missing" ? "missing" : `invalid:${check.reason}`;
			if (!copy) {
				const outcome = this.tooLarge.has(index)
					? "too_large"
					: reason === "missing"
						? "missing_no_copy"
						: "invalid_no_copy";
				records.push({ path: deliverable.path, outcome, reason, currentSize: check.size });
				continue;
			}
			try {
				await mkdir(dirname(deliverable.path), { recursive: true });
				await copyFile(copy.file, deliverable.path);
			} catch {
				continue;
			}
			this.seen.delete(index);
			records.push({
				path: deliverable.path,
				outcome: "restored",
				reason,
				currentSize: check.size,
				restoredSize: copy.size,
				sha256: copy.sha256,
				savedAtFraction: copy.savedAtFraction,
			});
		}
		this.guardMs += performance.now() - started;
		return records;
	}

	/**
	 * Best effort on SIGTERM: synchronous, existence and size only (no checker
	 * processes while the process is going down).
	 */
	restoreSync(deliverables: readonly Deliverable[]): RestoreRecord[] {
		const records: RestoreRecord[] = [];
		for (const [index, deliverable] of deliverables.entries()) {
			const copy = this.copies.get(index);
			if (!copy) continue;
			try {
				const size = existsSync(deliverable.path) ? statSync(deliverable.path).size : undefined;
				const limit = deliverable.sizeLimit;
				const overLimit =
					size !== undefined &&
					limit !== undefined &&
					(limit.inclusive ? size > limit.bytes : size >= limit.bytes);
				if (size !== undefined && size > 0 && !overLimit) continue;
				mkdirSync(dirname(deliverable.path), { recursive: true });
				copyFileSync(copy.file, deliverable.path);
				records.push({
					path: deliverable.path,
					outcome: "restored",
					reason: size === undefined ? "missing" : size === 0 ? "invalid:empty" : "invalid:size",
					currentSize: size,
					restoredSize: copy.size,
					sha256: copy.sha256,
					savedAtFraction: copy.savedAtFraction,
				});
			} catch {
				// Nothing more to do while shutting down.
			}
		}
		return records;
	}

	dispose(): void {
		this.reset();
		rmSync(this.root, { recursive: true, force: true });
	}
}
