import { canonicalJson } from "../run-journal.ts";
import { AuthorityStoreError } from "./authority-errors.ts";
import {
	type AuthorityEvent,
	type AuthorityProjection,
	type AuthoritySnapshotState,
	applyAuthorityEvents,
	parseAuthorityEvent,
	projectAuthority,
} from "./authority-events.ts";
import { digestObject } from "./storage.ts";

export const GENESIS_PREVIOUS = "0".repeat(64);
export interface AuthorityRecord {
	readonly version: 1;
	readonly seq: number;
	readonly previous: string;
	readonly event: AuthorityEvent;
	readonly hash: string;
}
export interface ParsedAuthority {
	readonly lastSeq: number;
	readonly lastHash: string;
	readonly records: readonly AuthorityRecord[];
	readonly events: readonly AuthorityEvent[];
	readonly state: AuthorityProjection;
	/** Private copy; reuse requires byte equality, not just mtime, size or inode. */
	readonly bytes: Buffer;
	readonly replay: { readonly parsedRecords: number; readonly reusedPrefixRecords: number };
}
export function materializeRecord(seq: number, previous: string, event: AuthorityEvent): AuthorityRecord {
	const material = { version: 1 as const, seq, previous, event };
	return Object.freeze({ ...material, hash: digestObject(material) });
}
export function recordLine(record: AuthorityRecord): string {
	return `${canonicalJson(record)}\n`;
}

/** Inode/head fencing is checked by the owner before offering a prefix. */
export function parseCommitted(bytes: Buffer, prefix?: ParsedAuthority): ParsedAuthority {
	if (prefix && (bytes.length < prefix.bytes.length || !prefix.bytes.equals(bytes.subarray(0, prefix.bytes.length))))
		prefix = undefined;
	if (prefix && bytes.length === prefix.bytes.length)
		return { ...prefix, replay: { parsedRecords: 0, reusedPrefixRecords: prefix.records.length } };
	if (!bytes.length)
		return {
			lastSeq: 0,
			lastHash: GENESIS_PREVIOUS,
			records: Object.freeze([]),
			events: Object.freeze([]),
			state: projectAuthority([]),
			bytes: Buffer.alloc(0),
			replay: { parsedRecords: 0, reusedPrefixRecords: 0 },
		};
	if (bytes.at(-1) !== 10) throw new AuthorityStoreError("corrupt");
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(prefix?.bytes.length ?? 0));
	} catch {
		throw new AuthorityStoreError("corrupt");
	}
	const lines = text.slice(0, -1).split("\n");
	let seed: AuthoritySnapshotState | undefined;
	let previous = prefix?.lastHash ?? GENESIS_PREVIOUS;
	let expectedSeq = (prefix?.lastSeq ?? 0) + 1;
	let lastSeq = prefix?.lastSeq ?? 0;
	const events: AuthorityEvent[] = [];
	const records: AuthorityRecord[] = [];
	for (const [index, line] of lines.entries()) {
		let raw: unknown;
		try {
			raw = JSON.parse(line);
		} catch {
			throw new AuthorityStoreError("corrupt");
		}
		if (typeof raw !== "object" || raw === null || !("event" in raw)) throw new AuthorityStoreError("corrupt");
		const event = parseAuthorityEvent(raw.event);
		const record =
			event.kind === "authority-snapshot"
				? materializeRecord(event.archivedThroughSequence + 1, event.continuesHash, event)
				: materializeRecord(expectedSeq, previous, event);
		if (canonicalJson(raw) !== canonicalJson(record)) throw new AuthorityStoreError("corrupt");
		if (event.kind === "authority-snapshot") {
			if (index !== 0 || (prefix && prefix.records.length > 0)) throw new AuthorityStoreError("corrupt");
			seed = event.state;
		} else events.push(event);
		records.push(record);
		previous = record.hash;
		lastSeq = record.seq;
		expectedSeq = record.seq + 1;
	}
	return {
		lastSeq,
		lastHash: previous,
		records: Object.freeze(prefix ? [...prefix.records, ...records] : records),
		events: Object.freeze(prefix ? [...prefix.events, ...events] : events),
		state: prefix && !seed ? applyAuthorityEvents(prefix.state, events) : projectAuthority(events, seed),
		bytes: Buffer.from(bytes),
		replay: { parsedRecords: records.length, reusedPrefixRecords: prefix?.records.length ?? 0 },
	};
}
