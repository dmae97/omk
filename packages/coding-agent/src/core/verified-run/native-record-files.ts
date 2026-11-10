import { lstatSync, readdirSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { fsyncDirectorySync } from "../durable-file-directory.ts";
import { digestBytes, readRegularFile, VerifiedRunError } from "./storage.ts";

export interface NativeRecordFile {
	readonly name: string;
	readonly identity: string;
	readonly digest: string;
	readonly bytes: number;
	readonly mtimeMs: number;
}

export function nativeRecordInventory(dir: string): Map<string, readonly string[]> {
	const directory = lstatSync(dir);
	if (
		!directory.isDirectory() ||
		directory.uid !== process.getuid?.() ||
		(directory.mode & 0o077) !== 0 ||
		resolve(dir) !== dir ||
		realpathSync(dir) !== dir
	)
		throw new VerifiedRunError("native_storage");
	const groups = new Map<string, string[]>();
	for (const name of readdirSync(dir).sort()) {
		const match = /^(?:([a-f0-9]{32})\.(?:jsonl|gc\.jsonl|head|cancel)|\.([a-f0-9]{32})\.head\.tmp)$/.exec(name);
		const id = match?.[1] ?? match?.[2] ?? name;
		const names = groups.get(id) ?? [];
		names.push(name);
		groups.set(id, names);
	}
	return groups;
}

/** GC takes no-follow, single-link, bounded snapshots, including every deletion companion. */
export function snapshotNativeFiles(
	dir: string,
	names: readonly string[],
	maxBytes: number,
): readonly NativeRecordFile[] {
	return names.map((name) => {
		const path = join(dir, name);
		const stat = lstatSync(path, { bigint: true });
		if (
			!stat.isFile() ||
			stat.nlink !== 1n ||
			stat.uid !== BigInt(process.getuid?.() ?? -1) ||
			(stat.mode & 0o077n) !== 0n
		)
			throw new VerifiedRunError("native_storage");
		const bytes = readRegularFile(path, maxBytes);
		return {
			name,
			identity: `${stat.dev}:${stat.ino}`,
			digest: digestBytes(bytes),
			bytes: bytes.length,
			mtimeMs: Number(stat.mtimeMs),
		};
	});
}

export function assertNativeFiles(dir: string, files: readonly NativeRecordFile[], maxBytes: number): void {
	const current = snapshotNativeFiles(
		dir,
		files.map((file) => file.name),
		maxBytes,
	);
	if (
		current.some(
			(file, i) =>
				file.identity !== files[i].identity ||
				file.digest !== files[i].digest ||
				file.bytes !== files[i].bytes ||
				file.mtimeMs !== files[i].mtimeMs,
		)
	)
		throw new VerifiedRunError("native_changed");
}

/** Retire the payload durably first and unlink it last, so an interrupted sweep is retryable. */
export function removeNativeFiles(
	dir: string,
	requestId: string,
	files: readonly NativeRecordFile[],
	maxBytes: number,
): void {
	assertNativeFiles(dir, files, maxBytes);
	const retired = `${requestId}.gc.jsonl`;
	const payload = files.find((file) => file.name.endsWith(".jsonl"));
	if (payload) {
		if (payload.name !== retired) {
			if (readdirSync(dir).includes(retired)) throw new VerifiedRunError("native_changed");
			renameSync(join(dir, payload.name), join(dir, retired));
			fsyncDirectorySync(dir);
		}
	}
	for (const file of files.filter((file) => file !== payload)) {
		assertNativeFiles(dir, [file], maxBytes);
		unlinkSync(join(dir, file.name));
	}
	fsyncDirectorySync(dir);
	assertNativeFiles(dir, [{ ...payload!, name: retired }], maxBytes);
	unlinkSync(join(dir, retired));
	fsyncDirectorySync(dir);
}
