/**
 * The project trust store (spec 053): `~/.omk/project-trust.json`, owner-only.
 *
 * It sits next to the MCP trust store (`~/.omk/mcp-trust.json`) and is keyed on the home
 * directory, not on the agent dir (`OMK_CODING_AGENT_DIR`): one answer per project covers
 * every agent dir the user runs with (bench and test runs point the agent dir at throwaway
 * directories), and the file is outside any repository, so a project cannot write its own
 * trust. Writes are read-merge-write under a lock directory, through a fresh 0600 temp file
 * that is renamed into place.
 */
import { randomBytes } from "node:crypto";
import {
	closeSync,
	existsSync,
	fchmodSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_DIR_NAME } from "../config.ts";
import { fileErrorCode } from "./durable-file-lock-owner.ts";
import { processIsLive } from "./durable-file-lock-storage.ts";
import { canonicalDir, type ProjectCodeSurface } from "./project-code-fingerprint.ts";

export type ProjectTrustDecision = "trusted" | "denied";

export interface StoredProjectTrust {
	decision: ProjectTrustDecision;
	fingerprint: string;
	decidedAt: string;
}

interface TrustStoreFile {
	version: 1;
	projects: Record<string, StoredProjectTrust>;
}

const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 10_000;

export function projectTrustStorePath(home: string = os.homedir()): string {
	return path.join(home, CONFIG_DIR_NAME, "project-trust.json");
}

function readStore(home: string): TrustStoreFile {
	const file = projectTrustStorePath(home);
	if (!existsSync(file)) return { version: 1, projects: {} };
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<TrustStoreFile>;
		if (parsed.version !== 1 || typeof parsed.projects !== "object" || parsed.projects === null) {
			return { version: 1, projects: {} };
		}
		return { version: 1, projects: parsed.projects };
	} catch {
		// A corrupt store decides nothing: every project is asked again.
		return { version: 1, projects: {} };
	}
}

/** The stored answer for one canonical project path, if any. */
export function readStoredProjectTrust(
	projectKey: string,
	home: string = os.homedir(),
): StoredProjectTrust | undefined {
	return readStore(home).projects[projectKey];
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

interface TrustLockOwner {
	readonly pid: number;
	readonly host: string;
	readonly token: string;
}
interface HeldTrustLock {
	readonly path: string;
	readonly token: string;
}

/** Missing owner records are legacy locks; malformed or unreadable records are never reclaimed. */
function readLockOwner(lock: string): { readonly owner?: TrustLockOwner; readonly legacy: boolean } {
	let raw: string;
	try {
		raw = readFileSync(path.join(lock, "owner.json"), "utf8");
	} catch (error) {
		if (fileErrorCode(error) === "ENOENT") return { legacy: true };
		return { legacy: false };
	}
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null) return { legacy: false };
		const { pid, host, token } = value as Record<string, unknown>;
		if (
			!Number.isSafeInteger(pid) ||
			Number(pid) <= 0 ||
			typeof host !== "string" ||
			host.length === 0 ||
			typeof token !== "string" ||
			token.length === 0
		)
			return { legacy: false };
		return { owner: { pid: Number(pid), host, token }, legacy: false };
	} catch {
		return { legacy: false };
	}
}

/**
 * Create the directory exclusively, then record its owner. Ownerless leftovers use the legacy age fallback.
 * `busy` means another lock exists; `unavailable` keeps the old unlocked-write fallback for other errors.
 */
function createLock(lock: string): HeldTrustLock | "busy" | "unavailable" {
	const token = randomBytes(16).toString("hex");
	try {
		mkdirSync(lock, { mode: 0o700 });
	} catch (error) {
		return fileErrorCode(error) === "EEXIST" ? "busy" : "unavailable";
	}
	try {
		const fd = openSync(path.join(lock, "owner.json"), "wx", 0o600);
		try {
			writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), token }));
		} finally {
			closeSync(fd);
		}
		return { path: lock, token };
	} catch {
		rmSync(lock, { recursive: true, force: true });
		return "unavailable";
	}
}

/**
 * Take the lock directory. A recorded live owner is never reclaimed because of its mtime;
 * a dead owner is reclaimed only after its token is re-read. Ownerless directories from the
 * old protocol retain the age-based fallback. Give up (unlocked write) after LOCK_WAIT_MS.
 */
function acquireLock(lock: string): HeldTrustLock | undefined {
	const deadline = performance.now() + LOCK_WAIT_MS;
	for (;;) {
		const held = createLock(lock);
		if (held === "unavailable") return undefined;
		if (held !== "busy") return held;
		const observed = readLockOwner(lock);
		const owner = observed.owner;
		if (owner && owner.host === os.hostname() && !processIsLive(owner.pid)) {
			// Re-read before removal: another process may have reclaimed and reused the path.
			if (readLockOwner(lock).owner?.token === owner.token) {
				rmSync(lock, { recursive: true, force: true });
				continue;
			}
		} else if (observed.legacy) {
			try {
				// No pid exists to check in the legacy format. Check once more for a newly published owner.
				// wall-clock: a legacy lock has only its directory mtime, which the kernel stamps from the wall clock
				if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS && readLockOwner(lock).legacy) {
					rmSync(lock, { recursive: true, force: true });
					continue;
				}
			} catch {
				// Released between the owner check and stat: retry after the deadline check below.
			}
		}
		if (performance.now() >= deadline) return undefined;
		sleepSync(25);
	}
}

/** Never remove a replacement owner's lock after ours was reclaimed or the owner file changed. */
function releaseLock(held: HeldTrustLock | undefined): void {
	if (!held) return;
	if (readLockOwner(held.path).owner?.token === held.token) rmSync(held.path, { recursive: true, force: true });
}

function writeStoreFile(file: string, store: TrustStoreFile): void {
	// A fresh, exclusively created temp file, forced to 0600 before any content lands in it.
	const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
	const fd = openSync(temp, "wx", 0o600);
	try {
		fchmodSync(fd, 0o600);
		writeSync(fd, `${JSON.stringify(store, null, "\t")}\n`);
	} finally {
		closeSync(fd);
	}
	try {
		renameSync(temp, file);
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
}

/** Read, change and write the store under the lock, so concurrent omk processes do not drop each other's entries. */
function updateStore(home: string, change: (store: TrustStoreFile) => boolean): void {
	const file = projectTrustStorePath(home);
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const lock = `${file}.lock`;
	const locked = acquireLock(lock);
	try {
		const store = readStore(home);
		if (change(store)) writeStoreFile(file, store);
	} finally {
		releaseLock(locked);
	}
}

/** Store the user's answer for this exact code surface. */
export function recordProjectTrustDecision(
	surface: ProjectCodeSurface,
	decision: ProjectTrustDecision,
	home: string = os.homedir(),
	now: Date = new Date(),
): void {
	updateStore(home, (store) => {
		store.projects[surface.projectKey] = { decision, fingerprint: surface.fingerprint, decidedAt: now.toISOString() };
		return true;
	});
}

/** Forget the stored answer, so the next interactive run asks again. */
export function forgetProjectTrustDecision(cwd: string, home: string = os.homedir()): void {
	const key = canonicalDir(cwd);
	updateStore(home, (store) => {
		if (!(key in store.projects)) return false;
		delete store.projects[key];
		return true;
	});
}
