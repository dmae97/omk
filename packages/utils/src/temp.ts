import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export class TempDir {
	#path: string;
	private constructor(path: string) {
		this.#path = path;
	}

	static createSync(prefix?: string): TempDir {
		return new TempDir(fs.mkdtempSync(normalizePrefix(prefix)));
	}

	static async create(prefix?: string): Promise<TempDir> {
		return new TempDir(await fs.promises.mkdtemp(normalizePrefix(prefix)));
	}

	#removePromise: Promise<void> | null = null;

	path(): string {
		return this.#path;
	}

	absolute(): string {
		return path.resolve(this.#path);
	}

	remove(): Promise<void> {
		if (this.#removePromise) {
			return this.#removePromise;
		}
		const removePromise = fs.promises.rm(this.#path, { recursive: true, force: true });
		this.#removePromise = removePromise;
		return removePromise;
	}

	removeSync(): void {
		fs.rmSync(this.#path, { recursive: true, force: true });
		this.#removePromise = Promise.resolve();
	}

	toString(): string {
		return this.#path;
	}

	join(...paths: string[]): string {
		return path.join(this.#path, ...paths);
	}

	async [Symbol.asyncDispose](): Promise<void> {
		try {
			await this.remove();
		} catch {
			// Ignore cleanup errors
		}
	}

	[Symbol.dispose](): void {
		try {
			this.removeSync();
		} catch {
			// Ignore cleanup errors
		}
	}
}

const kTempDir = os.tmpdir();

function normalizePrefix(prefix?: string): string {
	if (!prefix) {
		return `${kTempDir}${path.sep}pi-temp-`;
	} else if (prefix.startsWith("@")) {
		return path.join(kTempDir, prefix.slice(1));
	}
	return prefix;
}
