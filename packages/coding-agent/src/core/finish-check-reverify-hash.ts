/**
 * Deliverable fingerprints around the spec 032 verifier turn. A verifier that
 * changes a deliverable is void; omk records the change but does not restore it.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

/** Files above this size are compared by size only. */
export const FINISH_CHECK_REVERIFY_MAX_HASH_BYTES = 64 * 1024 * 1024;

async function fingerprint(path: string, maxBytes: number): Promise<string> {
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(path);
	} catch {
		return "missing";
	}
	if (info.isDirectory()) return "directory";
	if (info.size > maxBytes) return `${info.size}:too-large`;
	const hash = createHash("sha256");
	try {
		for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	} catch {
		return `${info.size}:unreadable`;
	}
	return `${info.size}:${hash.digest("hex")}`;
}

/** `size:sha256` per path (relative paths resolved against `cwd`), or `missing`, `directory`, `<size>:too-large`. */
export async function hashDeliverables(
	paths: readonly string[],
	cwd: string,
	maxBytes = FINISH_CHECK_REVERIFY_MAX_HASH_BYTES,
): Promise<Record<string, string>> {
	const entries = await Promise.all(
		paths.map(async (path) => [path, await fingerprint(resolve(cwd, path), maxBytes)]),
	);
	return Object.fromEntries(entries);
}

/** Paths whose fingerprint differs between two snapshots. */
export function changedDeliverables(before: Record<string, string>, after: Record<string, string>): string[] {
	return Object.keys(before).filter((path) => before[path] !== after[path]);
}
