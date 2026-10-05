import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type Lockfile = typeof import("proper-lockfile");

let lockfileModule: Lockfile | undefined;

function getLockfile(): Lockfile {
	lockfileModule ??= require("proper-lockfile") as Lockfile;
	return lockfileModule;
}

/** Test helper: whether proper-lockfile has been required. */
export function isSettingsLockfileLoaded(): boolean {
	return lockfileModule !== undefined;
}

/** Test helper: drop the memoized require. */
export function resetSettingsLockfileForTest(): void {
	lockfileModule = undefined;
}

/** Sync lock with short ELOCKED retry; loads proper-lockfile on first call only. */
export function acquireSettingsLockSyncWithRetry(path: string): () => void {
	const lockfile = getLockfile();
	const maxAttempts = 10;
	const delayMs = 20;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return lockfile.lockSync(path, { realpath: false });
		} catch (error) {
			const code =
				typeof error === "object" && error !== null && "code" in error
					? String((error as { code?: unknown }).code)
					: undefined;
			if (code !== "ELOCKED" || attempt === maxAttempts) {
				throw error;
			}
			lastError = error;
			const start = Date.now();
			while (Date.now() - start < delayMs) {
				// Sleep synchronously to avoid changing callers to async.
			}
		}
	}

	throw (lastError as Error) ?? new Error("Failed to acquire settings lock");
}
