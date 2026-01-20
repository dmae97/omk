import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

export interface AsyncTempDir {
	path: string;
	remove(): Promise<void>;
	toString(): string;
	[Symbol.asyncDispose](): Promise<void>;
}

export interface SyncTempDir {
	path: string;
	remove(): void;
	toString(): string;
	[Symbol.dispose](): void;
}

const kTempDir = tmpdir();

function normalizePrefix(prefix?: string): string {
	if (!prefix) {
		return `${kTempDir}${sep}pi-temp-`;
	} else if (prefix.startsWith("@")) {
		return join(kTempDir, prefix.slice(1));
	}
	return prefix;
}

export async function createTempDir(prefix?: string): Promise<AsyncTempDir> {
	const path = await mkdtemp(normalizePrefix(prefix));

	let promise: Promise<void> | null = null;
	const remove = () => {
		if (promise) {
			return promise;
		}
		promise = rm(path, { recursive: true, force: true }).catch(() => {});
		return promise;
	};

	return {
		path: path!,
		remove,
		toString: () => path,
		[Symbol.asyncDispose]: remove,
	};
}

export function createTempDirSync(prefix?: string): SyncTempDir {
	const path = mkdtempSync(normalizePrefix(prefix));

	let done = false;
	const remove = () => {
		if (done) {
			return;
		}
		done = true;
		try {
			rmSync(path, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	};

	return {
		path,
		toString: () => path,
		remove,
		[Symbol.dispose]: remove,
	};
}
