import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { rename as renameAsync } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface SessionStorageStat {
	size: number;
	mtimeMs: number;
	mtime: Date;
}

export interface SessionStorageWriter {
	writeLine(line: string): Promise<void>;
	flush(): Promise<void>;
	fsync(): Promise<void>;
	close(): Promise<void>;
	getError(): Error | undefined;
}

export interface SessionStorage {
	ensureDirSync(dir: string): void;
	existsSync(path: string): boolean;
	readTextSync(path: string): string;
	readTextPrefixSync(path: string, buf: Buffer): number;
	writeTextSync(path: string, content: string): void;
	statSync(path: string): SessionStorageStat;
	listFilesSync(dir: string, pattern: string): string[];

	exists(path: string): Promise<boolean>;
	readText(path: string): Promise<string>;
	writeText(path: string, content: string): Promise<void>;
	rename(path: string, nextPath: string): Promise<void>;
	unlink(path: string): Promise<void>;
	fsyncDirSync(dir: string): void;
	openWriter(path: string, options?: { flags?: "a" | "w"; onError?: (err: Error) => void }): SessionStorageWriter;
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

// FinalizationRegistry to clean up leaked file descriptors
const writerRegistry = new FinalizationRegistry<number>((fd) => {
	try {
		closeSync(fd);
	} catch {
		// Ignore - fd may already be closed or invalid
	}
});

class FileSessionStorageWriter implements SessionStorageWriter {
	private fd: number;
	private closed = false;
	private error: Error | undefined;
	private onError: ((err: Error) => void) | undefined;

	constructor(path: string, options?: { flags?: "a" | "w"; onError?: (err: Error) => void }) {
		this.onError = options?.onError;
		const flags = options?.flags ?? "a";
		// Ensure parent directory exists
		const dir = dirname(path);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		// Open file once, keep fd for lifetime
		this.fd = openSync(path, flags === "w" ? "w" : "a");
		// Register for cleanup if abandoned without close()
		writerRegistry.register(this, this.fd, this);
	}

	private recordError(err: unknown): Error {
		const error = toError(err);
		if (!this.error) this.error = error;
		this.onError?.(error);
		return error;
	}

	async writeLine(line: string): Promise<void> {
		if (this.closed) throw new Error("Writer closed");
		if (this.error) throw this.error;
		try {
			const buf = Buffer.from(line, "utf-8");
			let offset = 0;
			while (offset < buf.length) {
				const written = writeSync(this.fd, buf, offset, buf.length - offset);
				if (written === 0) {
					throw new Error("Short write");
				}
				offset += written;
			}
		} catch (err) {
			throw this.recordError(err);
		}
	}

	async flush(): Promise<void> {
		if (this.error) throw this.error;
		// OS buffers are flushed on fsync, nothing to do here
	}

	async fsync(): Promise<void> {
		if (this.closed) throw new Error("Writer closed");
		if (this.error) throw this.error;
		try {
			fsyncSync(this.fd);
		} catch (err) {
			throw this.recordError(err);
		}
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		// Unregister from finalization - we're closing properly
		writerRegistry.unregister(this);
		try {
			closeSync(this.fd);
		} catch {
			// Ignore close errors
		}
	}

	getError(): Error | undefined {
		return this.error;
	}
}

export class FileSessionStorage implements SessionStorage {
	ensureDirSync(dir: string): void {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}

	existsSync(path: string): boolean {
		return existsSync(path);
	}

	readTextSync(path: string): string {
		return readFileSync(path, "utf-8");
	}

	readTextPrefixSync(path: string, buf: Buffer): number {
		const fd = openSync(path, "r");
		try {
			const bytesRead = readSync(fd, buf, 0, buf.length, 0);
			return bytesRead;
		} finally {
			closeSync(fd);
		}
	}

	writeTextSync(path: string, content: string): void {
		this.ensureDirSync(dirname(path));
		writeFileSync(path, content);
	}

	statSync(path: string): SessionStorageStat {
		const stats = statSync(path);
		return { size: stats.size, mtimeMs: stats.mtimeMs, mtime: stats.mtime };
	}

	listFilesSync(dir: string, pattern: string): string[] {
		try {
			return Array.from(new Bun.Glob(pattern).scanSync(dir)).map((name) => join(dir, name));
		} catch {
			return [];
		}
	}

	exists(path: string): Promise<boolean> {
		return Bun.file(path).exists();
	}

	readText(path: string): Promise<string> {
		return Bun.file(path).text();
	}

	async writeText(path: string, content: string): Promise<void> {
		await Bun.write(path, content, { createPath: true });
	}

	async rename(path: string, nextPath: string): Promise<void> {
		try {
			await renameAsync(path, nextPath);
		} catch (err) {
			throw toError(err);
		}
	}

	unlink(path: string): Promise<void> {
		return Bun.file(path).unlink();
	}

	fsyncDirSync(dir: string): void {
		try {
			const fd = openSync(dir, "r");
			try {
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
		} catch {
			// Best-effort: some platforms/filesystems don't support fsync on directories.
		}
	}

	openWriter(path: string, options?: { flags?: "a" | "w"; onError?: (err: Error) => void }): SessionStorageWriter {
		return new FileSessionStorageWriter(path, options);
	}
}

function matchesPattern(name: string, pattern: string): boolean {
	if (pattern === "*") return true;
	if (pattern.startsWith("*.")) {
		return name.endsWith(pattern.slice(1));
	}
	return name === pattern;
}

class MemorySessionStorageWriter implements SessionStorageWriter {
	private storage: MemorySessionStorage;
	private path: string;
	private closed = false;
	private error: Error | undefined;
	private onError: ((err: Error) => void) | undefined;
	private ready: Promise<void>;

	constructor(
		storage: MemorySessionStorage,
		path: string,
		options?: { flags?: "a" | "w"; onError?: (err: Error) => void },
	) {
		this.storage = storage;
		this.path = path;
		this.onError = options?.onError;
		this.ready = this.initialize(options?.flags ?? "a");
	}

	private async initialize(flags: "a" | "w"): Promise<void> {
		if (flags === "w") {
			await this.storage.writeText(this.path, "");
		}
	}

	private recordError(err: unknown): Error {
		const error = toError(err);
		if (!this.error) this.error = error;
		this.onError?.(error);
		return error;
	}

	async writeLine(line: string): Promise<void> {
		if (this.closed) throw new Error("Writer closed");
		await this.ready;
		if (this.error) throw this.error;
		try {
			const existing = this.storage.existsSync(this.path) ? this.storage.readTextSync(this.path) : "";
			await this.storage.writeText(this.path, `${existing}${line}`);
		} catch (err) {
			throw this.recordError(err);
		}
	}

	async flush(): Promise<void> {
		await this.ready;
		if (this.error) throw this.error;
	}

	async fsync(): Promise<void> {
		// No-op for in-memory storage
		await this.ready;
		if (this.error) throw this.error;
	}

	async close(): Promise<void> {
		if (this.closed) return;
		await this.ready;
		this.closed = true;
	}

	getError(): Error | undefined {
		return this.error;
	}
}

export class MemorySessionStorage implements SessionStorage {
	private files = new Map<string, { content: string; mtimeMs: number }>();

	ensureDirSync(_dir: string): void {
		// No-op for in-memory storage.
	}

	existsSync(path: string): boolean {
		return this.files.has(path);
	}

	readTextSync(path: string): string {
		const entry = this.files.get(path);
		if (!entry) throw new Error(`File not found: ${path}`);
		return entry.content;
	}

	readTextPrefixSync(path: string, buf: Buffer): number {
		const content = this.readTextSync(path);
		return buf.write(content, 0, buf.length, "utf-8");
	}

	writeTextSync(path: string, content: string): void {
		this.files.set(path, { content, mtimeMs: Date.now() });
	}

	statSync(path: string): SessionStorageStat {
		const entry = this.files.get(path);
		if (!entry) throw new Error(`File not found: ${path}`);
		return {
			size: entry.content.length,
			mtimeMs: entry.mtimeMs,
			mtime: new Date(entry.mtimeMs),
		};
	}

	listFilesSync(dir: string, pattern: string): string[] {
		const prefix = dir.endsWith("/") ? dir : `${dir}/`;
		const files: string[] = [];
		for (const path of this.files.keys()) {
			if (!path.startsWith(prefix)) continue;
			const name = path.slice(prefix.length);
			if (name.includes("/") || name.includes("\\")) continue;
			if (!matchesPattern(name, pattern)) continue;
			files.push(path);
		}
		return files;
	}

	exists(path: string): Promise<boolean> {
		return Promise.resolve(this.existsSync(path));
	}

	readText(path: string): Promise<string> {
		return Promise.resolve(this.readTextSync(path));
	}

	writeText(path: string, content: string): Promise<void> {
		this.writeTextSync(path, content);
		return Promise.resolve();
	}

	rename(path: string, nextPath: string): Promise<void> {
		const entry = this.files.get(path);
		if (!entry) return Promise.reject(new Error(`File not found: ${path}`));
		this.files.set(nextPath, entry);
		this.files.delete(path);
		return Promise.resolve();
	}

	unlink(path: string): Promise<void> {
		this.files.delete(path);
		return Promise.resolve();
	}

	fsyncDirSync(_dir: string): void {
		// No-op for in-memory storage.
	}

	openWriter(path: string, options?: { flags?: "a" | "w"; onError?: (err: Error) => void }): SessionStorageWriter {
		return new MemorySessionStorageWriter(this, path, options);
	}
}
