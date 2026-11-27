import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { fsyncDirectorySync } from "./durable-file-directory.ts";
import { parseMemoryRecord } from "./verified-memory-record.ts";
import { createMemorySourceBatch } from "./verified-memory-source.ts";

export interface MemoryPruneResult {
	readonly removedExpired: number;
	readonly removedRevoked: number;
	readonly removedStale: number;
	readonly kept: number;
}

export interface MemoryPruneContext {
	readonly workspaceRoot: string;
	readonly directory: string;
	readonly filenames: readonly string[];
	readonly nowMs: number;
	readonly hasTombstone: (path: string) => boolean;
	readonly readPrivateRecord: (path: string) => unknown;
}

/**
 * Reclaim expired, revoked (tombstoned), and source-drifted memory records on disk
 * while keeping all still-valid verified records intact.
 */
export function pruneVerifiedMemoryDirectory(ctx: MemoryPruneContext): MemoryPruneResult {
	let removedExpired = 0;
	let removedRevoked = 0;
	let removedStale = 0;
	let kept = 0;
	const readSource = createMemorySourceBatch(ctx.workspaceRoot);

	for (const filename of ctx.filenames) {
		const recordPath = join(ctx.directory, filename);
		const id = filename.slice(0, -5);
		const tombstonePath = join(ctx.directory, `${id}.revoked.json`);
		const revoked = ctx.hasTombstone(tombstonePath);
		let expired = false;
		let stale = false;
		if (!revoked) {
			try {
				const rec = parseMemoryRecord(ctx.readPrivateRecord(recordPath));
				if (rec.expiresAt <= ctx.nowMs) expired = true;
				else {
					const src = readSource(rec.path, rec.startLine, rec.endLine);
					if (src.contentHash !== rec.contentHash || src.quote !== rec.quote) stale = true;
				}
			} catch {
				stale = true;
			}
		}
		if (revoked || expired || stale) {
			unlinkSync(recordPath);
			if (revoked) unlinkSync(tombstonePath);
			if (revoked) removedRevoked += 1;
			else if (expired) removedExpired += 1;
			else removedStale += 1;
		} else {
			kept += 1;
		}
	}

	if (removedExpired + removedRevoked + removedStale > 0) fsyncDirectorySync(ctx.directory);
	return { removedExpired, removedRevoked, removedStale, kept };
}
