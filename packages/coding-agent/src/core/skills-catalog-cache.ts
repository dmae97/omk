/**
 * Persistent skill-catalog cache (startup fast path).
 *
 * A full scan walks every skill dir reading and frontmatter-parsing each
 * SKILL.md; on this host that is 800+ file reads per session start. The cache
 * replaces that with a fingerprint walk (readdir/stat only, no file reads).
 * The digest includes every relative path and its size, mtime, ctime, and inode,
 * so edits cannot hide behind aggregate count/size/max-mtime collisions. Any
 * add/edit/delete under a completely fingerprinted tree invalidates reuse.
 * Ignore controls are inputs too. Incomplete or changing walks never authorize
 * reuse: the original scanner still returns the complete skill inventory.
 *
 * Fail-soft: a corrupt or unreadable cache is a miss, never an error. Writes
 * are atomic (tmp + rename). Cross-instance safety relies on the fingerprint,
 * not on the file: another process editing skills between our write and our
 * read still invalidates on the next fingerprint walk.
 */
import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	type Dirent,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	type Stats,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

export interface SkillDirFingerprint {
	readonly files: number;
	readonly maxMtimeMs: number;
	readonly totalSize: number;
	readonly digest: string;
	/** Only a complete fingerprint can authorize cache reuse. */
	readonly complete?: boolean;
}

export interface SkillCatalogCacheEntry<T> {
	readonly fingerprint: SkillDirFingerprint;
	readonly result: T;
}

type CatalogStore = Record<string, SkillCatalogCacheEntry<unknown>>;

const CACHE_FILE_NAME = "skill-catalog-v2.json";
const MAX_ENTRIES = 64;
const MAX_WALK_DEPTH = 8;
const MAX_WALK_ENTRIES = 20_000;
const IGNORE_CONTROLS = new Set([".gitignore", ".ignore", ".fdignore"]);

/** Fingerprint walk: readdir/stat only, no file reads. Over-inclusive is safe. */
export function fingerprintSkillDir(root: string): SkillDirFingerprint {
	let files = 0;
	let maxMtimeMs = 0;
	let totalSize = 0;
	let walked = 0;
	const activeDirectories = new Set<string>();
	let complete = true;
	const digest = createHash("sha256");

	const walk = (dir: string, depth: number): void => {
		if (depth > MAX_WALK_DEPTH || walked >= MAX_WALK_ENTRIES) {
			complete = false;
			return;
		}
		let real: string;
		try {
			real = realpathSync(dir);
		} catch {
			complete = false;
			return;
		}
		if (activeDirectories.has(real)) {
			complete = false;
			return;
		}
		activeDirectories.add(real);
		digest.update(JSON.stringify([relative(root, dir), real]));
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			activeDirectories.delete(real);
			complete = false;
			return;
		}
		for (const entry of entries) {
			if (walked >= MAX_WALK_ENTRIES) {
				complete = false;
				break;
			}
			walked++;
			if ((entry.name.startsWith(".") && !IGNORE_CONTROLS.has(entry.name)) || entry.name === "node_modules")
				continue;
			const fullPath = join(dir, entry.name);
			let stats: Stats;
			try {
				stats = statSync(fullPath);
			} catch {
				complete = false;
				continue; // unreadable input or raced delete
			}
			if (stats.isDirectory()) {
				walk(fullPath, depth + 1);
				continue;
			}
			if (!stats.isFile()) continue;
			files++;
			totalSize += stats.size;
			if (stats.mtimeMs > maxMtimeMs) maxMtimeMs = stats.mtimeMs;
			digest.update(relative(root, fullPath));
			digest.update(`\0${stats.size}\0${stats.mtimeMs}\0${stats.ctimeMs}\0${stats.ino}\0`);
		}
		activeDirectories.delete(real);
	};

	walk(root, 0);
	return { files, maxMtimeMs, totalSize, digest: digest.digest("hex"), complete };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSkillDirFingerprint(value: unknown): value is SkillDirFingerprint {
	if (!isRecord(value)) return false;
	return (
		Number.isSafeInteger(value.files) &&
		(value.files as number) >= 0 &&
		typeof value.maxMtimeMs === "number" &&
		Number.isFinite(value.maxMtimeMs) &&
		typeof value.totalSize === "number" &&
		Number.isFinite(value.totalSize) &&
		(value.totalSize as number) >= 0 &&
		typeof value.digest === "string" &&
		/^[a-f0-9]{64}$/u.test(value.digest) &&
		typeof value.complete === "boolean"
	);
}

function isSkillCatalogCacheEntry(value: unknown): value is SkillCatalogCacheEntry<unknown> {
	return (
		isRecord(value) &&
		isSkillDirFingerprint(value.fingerprint) &&
		Object.getOwnPropertyDescriptor(value, "result") !== undefined
	);
}

export function readSkillCatalog(agentDir: string): CatalogStore {
	try {
		const raw = readFileSync(join(agentDir, "cache", CACHE_FILE_NAME), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return {};
		const catalog: CatalogStore = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (isSkillCatalogCacheEntry(value)) catalog[key] = value;
		}
		return catalog;
	} catch {}
	return {};
}

export function writeSkillCatalog(agentDir: string, store: CatalogStore): void {
	let ownedTemp: string | undefined;
	try {
		const cacheDir = join(agentDir, "cache");
		mkdirSync(cacheDir, { recursive: true });
		const keys = Object.keys(store);
		const trimmed: CatalogStore =
			keys.length <= MAX_ENTRIES ? store : Object.fromEntries(keys.slice(-MAX_ENTRIES).map((k) => [k, store[k]]));
		const data = JSON.stringify(trimmed);
		const tmp = join(cacheDir, `${CACHE_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`);
		const fd = openSync(tmp, "wx", 0o600);
		ownedTemp = tmp;
		try {
			writeFileSync(fd, data, "utf8");
		} finally {
			closeSync(fd);
		}
		renameSync(tmp, join(cacheDir, CACHE_FILE_NAME));
		ownedTemp = undefined;
	} catch {
		// cache is an optimization; never fail the scan
	} finally {
		if (ownedTemp !== undefined) {
			try {
				unlinkSync(ownedTemp);
			} catch {
				// Only clean up a temporary file acquired by this writer.
			}
		}
	}
}

function fingerprintEquals(a: SkillDirFingerprint, b: SkillDirFingerprint): boolean {
	return (
		a.complete === true &&
		b.complete === true &&
		a.files === b.files &&
		a.maxMtimeMs === b.maxMtimeMs &&
		a.totalSize === b.totalSize &&
		a.digest === b.digest
	);
}

/**
 * Cache-guarded scan: returns the cached result when the fingerprint matches,
 * otherwise runs `scan`, stores, and returns its fresh result. The result must
 * be JSON-serializable (skills and diagnostics are plain data).
 */
export function cachedSkillScan<T>(
	agentDir: string | undefined,
	dir: string,
	scan: () => T,
	store?: CatalogStore,
): { result: T; store?: CatalogStore } {
	if (!agentDir || !existsSync(dir)) {
		return { result: scan(), store };
	}
	const catalog = store ?? readSkillCatalog(agentDir);
	const fingerprint = fingerprintSkillDir(dir);
	const key = resolve(dir);
	if (fingerprint.complete !== true) {
		delete catalog[key];
		return { result: scan(), store: catalog };
	}
	const hit = catalog[key];
	if (isSkillCatalogCacheEntry(hit) && fingerprintEquals(hit.fingerprint, fingerprint)) {
		return { result: structuredClone(hit.result) as T, store: catalog };
	}
	const result = scan();
	const afterScan = fingerprintSkillDir(dir);
	if (fingerprintEquals(fingerprint, afterScan)) {
		catalog[key] = { fingerprint: afterScan, result };
	} else {
		delete catalog[key];
	}
	return { result, store: catalog };
}
