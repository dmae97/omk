import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readSync,
	type Stats,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fsyncDirectorySync } from "./durable-file-directory.ts";
import { acquireDurableFileMutationLockSync } from "./durable-file-identity.ts";
import {
	type MemoryAdmission,
	parseMemoryRecord,
	prepareMemoryRecord,
	type VerifiedMemoryRecord,
} from "./verified-memory-record.ts";
import { createMemorySourceBatch, MEMORY_ID, memoryWorkspace } from "./verified-memory-source.ts";

const MAX_RECORD_BYTES = 16 * 1024;
export const MAX_MEMORY_RECORDS = 32;

function errorCode(error: unknown): unknown {
	return error instanceof Error && "code" in error ? error.code : undefined;
}

function hasTombstone(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return false;
		throw error;
	}
}

function readPrivateRecord(path: string): unknown {
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(fd, { bigint: true });
		if (
			!before.isFile() ||
			before.nlink !== 1n ||
			before.size > BigInt(MAX_RECORD_BYTES) ||
			(before.mode & 0o077n) !== 0n ||
			(process.getuid && before.uid !== BigInt(process.getuid()))
		)
			throw new Error("unsafe memory record");
		const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1);
		let length = 0;
		while (length < bytes.length) {
			const n = readSync(fd, bytes, length, bytes.length - length, null);
			if (n === 0) break;
			length += n;
		}
		const after = fstatSync(fd, { bigint: true });
		const current = lstatSync(path, { bigint: true });
		if (
			length > MAX_RECORD_BYTES ||
			before.ctimeNs !== after.ctimeNs ||
			after.ino !== current.ino ||
			after.dev !== current.dev ||
			after.ctimeNs !== current.ctimeNs
		)
			throw new Error("memory record changed during read");
		return JSON.parse(bytes.subarray(0, length).toString("utf8"));
	} finally {
		closeSync(fd);
	}
}

function publish(directory: string, filename: string, value: unknown): void {
	const bytes = Buffer.from(JSON.stringify(value));
	if (bytes.length > MAX_RECORD_BYTES) throw new Error("memory record too large");
	const temporary = join(directory, `${randomUUID()}.pending`);
	const fd = openSync(temporary, "wx", 0o600);
	try {
		try {
			writeFileSync(fd, bytes);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		linkSync(temporary, join(directory, filename));
		fsyncDirectorySync(directory);
	} finally {
		unlinkSync(temporary);
	}
}

export class VerifiedMemoryStore {
	private readonly workspace: { readonly root: string; readonly id: string };
	constructor(cwd: string) {
		this.workspace = memoryWorkspace(cwd);
	}

	private directory(create: boolean): string | undefined {
		if (process.platform === "win32") throw new Error("memory storage requires POSIX ownership checks");
		let path = this.workspace.root;
		for (const name of [".omk", "verified-memory"]) {
			path = join(path, name);
			if (create) {
				try {
					mkdirSync(path, { mode: 0o700 });
				} catch (error) {
					if (errorCode(error) !== "EEXIST") throw error;
				}
			}
			let stat: Stats;
			try {
				stat = lstatSync(path);
			} catch (error) {
				if (!create && errorCode(error) === "ENOENT") return undefined;
				throw error;
			}
			if (
				!stat.isDirectory() ||
				stat.isSymbolicLink() ||
				(process.getuid && stat.uid !== process.getuid()) ||
				(name === "verified-memory" && (stat.mode & 0o077) !== 0)
			)
				throw new Error("unsafe memory directory");
		}
		return path;
	}

	remember(input: unknown): MemoryAdmission {
		let record: VerifiedMemoryRecord;
		try {
			record = prepareMemoryRecord(this.workspace.root, this.workspace.id, input);
		} catch (error) {
			return {
				verdict:
					error instanceof Error && error.message === "memory source requires review" ? "escalate" : "abstain",
				reason: "source-not-admitted",
			};
		}
		const directory = this.directory(true);
		if (!directory) throw new Error("memory storage unavailable");
		const lock = acquireDurableFileMutationLockSync(join(directory, "store"));
		try {
			if (this.records(directory).length >= MAX_MEMORY_RECORDS)
				return { verdict: "abstain", reason: "record-limit" };
			publish(directory, `${record.id}.json`, record);
			return { verdict: "accept", recordId: record.id };
		} finally {
			lock.release();
		}
	}

	forget(id: string): void {
		if (!MEMORY_ID.test(id)) throw new Error("invalid memory id");
		const directory = this.directory(false);
		if (!directory) return;
		const lock = acquireDurableFileMutationLockSync(join(directory, "store"));
		try {
			if (!existsSync(join(directory, `${id}.json`))) throw new Error("unknown memory id");
			const tombstone = join(directory, `${id}.revoked.json`);
			if (!hasTombstone(tombstone)) publish(directory, `${id}.revoked.json`, { id, revoked: true });
		} finally {
			lock.release();
		}
	}

	private records(directory: string): string[] {
		const entries = readdirSync(directory);
		if (entries.length > MAX_MEMORY_RECORDS * 3) throw new Error("memory directory capacity exceeded");
		const records = entries.filter((name) => name.endsWith(".json") && !name.endsWith(".revoked.json"));
		if (records.length > MAX_MEMORY_RECORDS || records.some((name) => !MEMORY_ID.test(name.slice(0, -5))))
			throw new Error("invalid memory inventory");
		return records.sort();
	}

	retrieve(): { records: VerifiedMemoryRecord[]; omitted: number } {
		const directory = this.directory(false);
		if (!directory) return { records: [], omitted: 0 };
		const records: VerifiedMemoryRecord[] = [];
		const readSource = createMemorySourceBatch(this.workspace.root);
		let omitted = 0;
		for (const filename of this.records(directory)) {
			const record = parseMemoryRecord(readPrivateRecord(join(directory, filename)));
			if (record.id !== filename.slice(0, -5) || record.workspaceId !== this.workspace.id)
				throw new Error("memory scope mismatch");
			if (
				record.createdAt > Date.now() ||
				record.expiresAt <= Date.now() ||
				hasTombstone(join(directory, `${record.id}.revoked.json`))
			) {
				omitted++;
				continue;
			}
			try {
				const source = readSource(record.path, record.startLine, record.endLine);
				if (source.contentHash !== record.contentHash || source.quote !== record.quote) {
					omitted++;
					continue;
				}
			} catch {
				omitted++;
				continue;
			}
			// Disk reading may span revocation or expiry. Recheck before publishing the quote.
			if (record.expiresAt <= Date.now() || hasTombstone(join(directory, `${record.id}.revoked.json`))) {
				omitted++;
				continue;
			}
			records.push(record);
		}
		return { records, omitted };
	}
}
