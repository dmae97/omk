import { existsSync } from "node:fs";
import { join } from "node:path";
import { acquireDurableFileMutationLockSync } from "../durable-file-identity.ts";
import { appendFileDurablySync } from "../durable-file-io.ts";
import { canonicalJson } from "../run-journal.ts";
import type { SessionOwnerLease } from "../session-owner-lease.ts";
import { parseRunEvent, projectRun, type RunEvent, type RunProjection } from "./events.ts";
import { digestBytes, digestObject, readRegularFile, VerifiedRunError } from "./storage.ts";

interface RecordV2 {
	readonly version: 2;
	readonly seq: number;
	readonly generation: number;
	readonly previous: string;
	readonly event: RunEvent;
	readonly hash: string;
}
export interface JournalSnapshot {
	readonly records: readonly RecordV2[];
	readonly state: RunProjection;
	readonly bytesDigest: string;
}
export const journalPath = (runPath: string): string => join(runPath, "journal.v2.jsonl");

/** Read-only: no implicit recovery, tail truncation, mode changes, or model calls. */
export function readRunJournal(runPath: string): JournalSnapshot | null {
	const path = journalPath(runPath);
	if (!existsSync(path)) return null;
	const bytes = readRegularFile(path, 8388608);
	if (!bytes.length || bytes.at(-1) !== 10) throw new VerifiedRunError("journal_truncated");
	const lines = new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, -1).split("\n");
	const records: RecordV2[] = [];
	let previous = "0".repeat(64);
	let generation = 1;
	for (const [index, line] of lines.entries()) {
		let raw: unknown;
		try {
			raw = JSON.parse(line);
		} catch {
			throw new VerifiedRunError("integrity");
		}
		if (typeof raw !== "object" || raw === null || !("event" in raw)) throw new VerifiedRunError("integrity");
		const event = parseRunEvent(raw.event);
		if (event.kind === "resumed" || event.kind === "writer_restarted" || event.kind === "tasks_retried")
			generation += 1;
		const material = { version: 2 as const, seq: index + 1, generation, previous, event };
		const record = Object.freeze({ ...material, hash: digestObject(material) });
		if (canonicalJson(raw) !== canonicalJson(record)) throw new VerifiedRunError("integrity");
		records.push(record);
		previous = record.hash;
	}
	return {
		records: Object.freeze(records),
		state: projectRun(records.map((record) => record.event)),
		bytesDigest: digestBytes(bytes),
	};
}

/** v2 event store reuses the v1 durable append and mutation/owner locking primitives. */
export class VerifiedRunJournal {
	private head: JournalSnapshot | null;
	private poisoned = false;
	private readonly runPath: string;
	private readonly owner: SessionOwnerLease;
	private readonly persist: (path: string, bytes: Uint8Array) => void;

	constructor(runPath: string, owner: SessionOwnerLease, persist = appendFileDurablySync) {
		this.runPath = runPath;
		this.owner = owner;
		this.persist = persist;
		this.head = readRunJournal(runPath);
	}

	get state(): RunProjection {
		if (!this.head) throw new VerifiedRunError("missing_run");
		return this.head.state;
	}

	append(event: RunEvent): RunProjection {
		const path = journalPath(this.runPath);
		if (this.poisoned || !this.owner.owns(path)) throw new VerifiedRunError("stale_owner");
		const lock = acquireDurableFileMutationLockSync(path);
		try {
			const current = readRunJournal(this.runPath);
			if (current?.bytesDigest !== this.head?.bytesDigest) throw new VerifiedRunError("stale_revision");
			const records = current?.records ?? [];
			const candidate = projectRun([...records.map((record) => record.event), event]);
			const material = {
				version: 2 as const,
				seq: records.length + 1,
				generation: candidate.generation,
				previous: records.at(-1)?.hash ?? "0".repeat(64),
				event,
			};
			const record: RecordV2 = { ...material, hash: digestObject(material) };
			try {
				this.persist(path, Buffer.from(`${canonicalJson(record)}\n`));
				const next = readRunJournal(this.runPath);
				if (!next || next.records.at(-1)?.hash !== record.hash) throw new VerifiedRunError("integrity");
				this.owner.refresh(true);
				this.head = next;
			} catch (error) {
				this.poisoned = true;
				throw error;
			}
			return this.state;
		} finally {
			lock.release();
		}
	}
}
