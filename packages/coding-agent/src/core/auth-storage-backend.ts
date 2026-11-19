/**
 * Storage backends for the credential store.
 *
 * Two locks keep OMK processes that share one auth.json apart. The store lock guards reads and
 * writes of the file and is held for milliseconds. The refresh lock is per provider and is held
 * across the token refresh request, so a slow or failing refresh for one provider cannot keep
 * every other session from reading its own credential.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "../config.ts";
import { normalizePath } from "../utils/paths.ts";

export type LockResult<T> = {
	result: T;
	next?: string;
};

const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;
// Shared by sync and async holders: async refreshes mtime every stale/2 (15 s), so a 10 s sync default took live locks.
const AUTH_LOCK_STALE_MS = 30_000;

const AUTH_LOCK_RETRIES = { retries: 10, factor: 2, minTimeout: 100, maxTimeout: 10000, randomize: true } as const;

export interface AuthStorageBackend {
	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
	withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T>;
	/**
	 * Serialize `fn` with every other holder of the same key, across processes where the backend is
	 * shared. Taken around a token refresh instead of the store lock. A backend without it runs
	 * refreshes unserialized.
	 */
	withRefreshLock?<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export class FileAuthStorageBackend implements AuthStorageBackend {
	private authPath: string;

	constructor(authPath: string = join(getAgentDir(), "auth.json")) {
		this.authPath = normalizePath(authPath);
	}

	private ensureParentDir(): void {
		const dir = dirname(this.authPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
	}

	private ensureFileExists(): void {
		if (!existsSync(this.authPath)) {
			writeFileSync(this.authPath, "{}", AUTH_FILE_WRITE_OPTIONS);
			chmodSync(this.authPath, 0o600);
		}
	}

	private acquireLockSyncWithRetry(path: string): () => void {
		const maxAttempts = 10;
		const delayMs = 20;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return lockfile.lockSync(path, { realpath: false, stale: AUTH_LOCK_STALE_MS });
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				if (code !== "ELOCKED" || attempt === maxAttempts) {
					throw error;
				}
				lastError = error;
				// Sleep without spinning; the wait is monotonic, so a wall-clock step cannot stretch it.
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
			}
		}

		throw (lastError as Error) ?? new Error("Failed to acquire auth storage lock");
	}

	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
		this.ensureParentDir();
		this.ensureFileExists();

		let release: (() => void) | undefined;
		try {
			release = this.acquireLockSyncWithRetry(this.authPath);
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = fn(current);
			if (next !== undefined) {
				writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);
				chmodSync(this.authPath, 0o600);
			}
			return result;
		} finally {
			if (release) {
				release();
			}
		}
	}

	/** Take a proper-lockfile lock, run `fn`, release. `fn` gets a check that throws once the lock was lost. */
	private async runLocked<T>(
		path: string,
		realpath: boolean,
		fn: (throwIfCompromised: () => void) => Promise<T>,
	): Promise<T> {
		let release: (() => Promise<void>) | undefined;
		let lockCompromised = false;
		let lockCompromisedError: Error | undefined;
		const throwIfCompromised = () => {
			if (lockCompromised) {
				throw lockCompromisedError ?? new Error("Auth storage lock was compromised");
			}
		};

		try {
			release = await lockfile.lock(path, {
				...(realpath ? {} : { realpath: false }),
				retries: AUTH_LOCK_RETRIES,
				stale: AUTH_LOCK_STALE_MS,
				onCompromised: (err) => {
					lockCompromised = true;
					lockCompromisedError = err;
				},
			});

			throwIfCompromised();
			const result = await fn(throwIfCompromised);
			throwIfCompromised();
			return result;
		} finally {
			if (release) {
				try {
					await release();
				} catch {
					// Ignore unlock errors when lock is compromised.
				}
			}
		}
	}

	async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
		this.ensureParentDir();
		this.ensureFileExists();

		return this.runLocked(this.authPath, true, async (throwIfCompromised) => {
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = await fn(current);
			throwIfCompromised();
			if (next !== undefined) {
				writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);
				chmodSync(this.authPath, 0o600);
			}
			return result;
		});
	}

	/** The lock target need not exist: `realpath: false` locks the path itself. */
	async withRefreshLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
		this.ensureParentDir();
		return this.runLocked(`${this.authPath}.refresh-${encodeURIComponent(key)}`, false, fn);
	}
}

export class InMemoryAuthStorageBackend implements AuthStorageBackend {
	private value: string | undefined;

	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
		const { result, next } = fn(this.value);
		if (next !== undefined) {
			this.value = next;
		}
		return result;
	}

	async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
		const { result, next } = await fn(this.value);
		if (next !== undefined) {
			this.value = next;
		}
		return result;
	}

	private readonly refreshQueues = new Map<string, Promise<unknown>>();

	withRefreshLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const run = (this.refreshQueues.get(key) ?? Promise.resolve()).then(fn, fn);
		this.refreshQueues.set(
			key,
			run.catch(() => undefined),
		);
		return run;
	}
}
