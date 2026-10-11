/**
 * Per-file entries of the skill catalog cache. Auto-discovery passes one
 * SKILL.md path per skill, so these entries scale with the skill count. Kept
 * apart from the directory cache, which holds the store, caps and dirty state.
 */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import {
	type CatalogStore,
	dropSkillCatalogEntry,
	FILE_KEY_PREFIX,
	fingerprintEquals,
	markSkillCatalogDirty,
	type SkillDirFingerprint,
} from "./skills-catalog-cache.ts";

/** One stat, no read: path identity plus size, mtime, ctime and inode, as for directories. */
function fingerprintSkillFile(filePath: string): SkillDirFingerprint | undefined {
	try {
		const stats = statSync(filePath);
		if (!stats.isFile()) return undefined;
		const digest = createHash("sha256")
			.update(JSON.stringify([filePath, stats.size, stats.mtimeMs, stats.ctimeMs, stats.ino, stats.dev]))
			.digest("hex");
		return { files: 1, maxMtimeMs: stats.mtimeMs, totalSize: stats.size, digest, complete: true };
	} catch {
		return undefined;
	}
}

/**
 * Per-file counterpart of `cachedSkillScan` for the one-SKILL.md-per-skill
 * paths auto-discovery produces. Mutates `store`. A result is kept only when
 * the file did not change while `load` ran and `valid` accepts it; a stored
 * result that `valid` rejects is a miss.
 */
export function cachedSkillFileLoad<T>(
	store: CatalogStore,
	filePath: string,
	load: () => T,
	valid: (result: unknown) => result is T,
): T {
	const key = `${FILE_KEY_PREFIX}${resolve(filePath)}`;
	const fingerprint = fingerprintSkillFile(resolve(filePath));
	const hit = store[key];
	if (fingerprint && hit && fingerprintEquals(hit.fingerprint, fingerprint) && valid(hit.result)) {
		delete store[key];
		store[key] = hit; // most recently used end; saved only if this start writes anyway
		return structuredClone(hit.result) as T;
	}
	dropSkillCatalogEntry(store, key);
	const result = load();
	const after = fingerprintSkillFile(resolve(filePath));
	if (fingerprint && after && fingerprintEquals(fingerprint, after) && valid(result)) {
		store[key] = { fingerprint: after, result };
		markSkillCatalogDirty(store);
	}
	return result;
}
