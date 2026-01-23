import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";

export interface FileLockOptions {
	staleMs?: number;
	retries?: number;
	retryDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<FileLockOptions> = {
	staleMs: 10_000,
	retries: 50,
	retryDelayMs: 100,
};

interface LockInfo {
	pid: number;
	timestamp: number;
}

function getLockPath(filePath: string): string {
	return `${filePath}.lock`;
}

async function writeLockInfo(lockPath: string): Promise<void> {
	const info: LockInfo = { pid: process.pid, timestamp: Date.now() };
	await Bun.write(`${lockPath}/info`, JSON.stringify(info));
}

async function readLockInfo(lockPath: string): Promise<LockInfo | null> {
	try {
		const content = await readFile(`${lockPath}/info`, "utf-8");
		return JSON.parse(content) as LockInfo;
	} catch {
		return null;
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function isLockStale(lockPath: string, staleMs: number): Promise<boolean> {
	const info = await readLockInfo(lockPath);
	if (!info) return true;

	if (!isProcessAlive(info.pid)) return true;

	if (Date.now() - info.timestamp > staleMs) return true;

	return false;
}

async function tryAcquireLock(lockPath: string): Promise<boolean> {
	try {
		await mkdir(lockPath);
		await writeLockInfo(lockPath);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			return false;
		}
		throw error;
	}
}

async function releaseLock(lockPath: string): Promise<void> {
	try {
		await rm(lockPath, { recursive: true });
	} catch {
		// Ignore errors on release
	}
}

async function acquireLock(filePath: string, options: FileLockOptions = {}): Promise<() => Promise<void>> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const lockPath = getLockPath(filePath);

	for (let attempt = 0; attempt < opts.retries; attempt++) {
		if (await tryAcquireLock(lockPath)) {
			return () => releaseLock(lockPath);
		}

		if (existsSync(lockPath) && (await isLockStale(lockPath, opts.staleMs))) {
			await releaseLock(lockPath);
			continue;
		}

		await new Promise((resolve) => setTimeout(resolve, opts.retryDelayMs));
	}

	throw new Error(`Failed to acquire lock for ${filePath} after ${opts.retries} attempts`);
}

export async function withFileLock<T>(
	filePath: string,
	fn: () => Promise<T>,
	options: FileLockOptions = {},
): Promise<T> {
	const release = await acquireLock(filePath, options);
	try {
		return await fn();
	} finally {
		await release();
	}
}
