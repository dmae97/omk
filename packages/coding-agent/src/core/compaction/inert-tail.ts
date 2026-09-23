/**
 * Rebase a compaction commit over an append-only, context-inert tail.
 *
 * Extensions persist their own state with `appendEntry` (`custom` entries) at any
 * time; pi-landstrip snapshots every background task every few seconds. Such an
 * entry is neither a message nor a cut point, so the built-in summarizer never
 * reads it, and unless preserved provenance cites its type it never changes the
 * envelope either. A summary generated before those entries landed is the summary
 * that would have been generated after, so the commit may bind it to the new head
 * instead of discarding minutes of summarization. Without this, a steady extension
 * writer livelocks every threshold, overflow and manual compaction.
 *
 * Anything else — a message, a model or provenance change, a rewritten or replaced
 * file, a branch move — is not provably inert and keeps the exact-match discard.
 */
import { createHash } from "node:crypto";
import { PROVENANCE_CUSTOM_TYPE_SET } from "./provenance.ts";
import {
	type CompactionCommitDecision,
	type CompactionSourceIdentity,
	type CompactionTransaction,
	createCompactionTransaction,
	type DecideCompactionCommitInput,
	decideCompactionCommit,
	type SessionRevisionToken,
} from "./transaction.ts";

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** Parse complete appended records; null unless every one is an inert `custom` entry. */
function inertTailIds(tail: Uint8Array, expectedCount: number): string[] | null {
	let text: string;
	try {
		// Keep a byte-order mark so it fails JSON.parse, as it does in the integrity scan.
		text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(tail);
	} catch {
		return null;
	}
	const lines = text.split("\n");
	if (lines.pop() !== "" || lines.length !== expectedCount) return null;
	const ids: string[] = [];
	for (const line of lines) {
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			return null;
		}
		if (typeof record !== "object" || record === null) return null;
		const { type, id, customType } = record as Record<string, unknown>;
		if (type !== "custom" || typeof id !== "string" || typeof customType !== "string") return null;
		if (PROVENANCE_CUSTOM_TYPE_SET.has(customType)) return null;
		ids.push(id);
	}
	return ids;
}

/**
 * `transaction` rebased onto `head` when the only change since its capture is an
 * appended run of inert `custom` entries ending the source window; otherwise null.
 */
export function rebaseOverInertTail(
	transaction: CompactionTransaction,
	headBytes: Uint8Array,
	head: SessionRevisionToken,
	headSource: CompactionSourceIdentity,
): CompactionTransaction | null {
	const base = transaction.baseRevision;
	if (head.sessionId !== base.sessionId) return null;
	if (head.fileIdentity?.dev !== base.fileIdentity?.dev || head.fileIdentity?.ino !== base.fileIdentity?.ino) {
		return null;
	}
	const appendedCount = head.recordCount - base.recordCount;
	if (appendedCount <= 0 || head.completeBytes <= base.completeBytes) return null;
	if (headBytes.byteLength !== head.completeBytes) return null;
	if (base.completeBytes > 0 && headBytes[base.completeBytes - 1] !== 0x0a) return null;

	// One pass: the captured prefix must survive byte-for-byte, and the bytes being
	// parsed must be exactly the bytes the head revision attests.
	const hash = createHash("sha256").update(headBytes.subarray(0, base.completeBytes));
	if (hash.copy().digest("hex") !== base.completePrefixSha256) return null;
	const tail = headBytes.subarray(base.completeBytes);
	if (hash.update(tail).digest("hex") !== head.completePrefixSha256) return null;

	const appendedIds = inertTailIds(tail, appendedCount);
	if (appendedIds === null) return null;
	// The appended entries must be exactly the new tail of the source window. Entries
	// are immutable, so an unchanged window start pins the whole active branch: this
	// also rejects a branch move and an entry landing elsewhere in the tree.
	if (!sameIds(headSource.entryIds, [...transaction.source.entryIds, ...appendedIds])) return null;
	return createCompactionTransaction({ ...transaction, baseRevision: head, source: headSource });
}

export interface InertTailCommitInput extends DecideCompactionCommitInput {
	/** Durable session bytes attested by `currentRevision`, read under the commit lock. */
	readonly currentBytes: Uint8Array;
	/** False for an extension-provided summary, which may summarize its own custom state. */
	readonly rebaseAllowed: boolean;
}

/**
 * `decideCompactionCommit`, retried once over an inert tail on `revision_mismatch`.
 * The retry is built from the head, so it cannot fail on revision or source:
 * `rebaseOverInertTail` is the gate, and the retry only re-applies the barrier and
 * duplicate-source checks.
 */
export function decideCommitOverInertTail(input: InertTailCommitInput): {
	readonly transaction: CompactionTransaction;
	readonly decision: CompactionCommitDecision;
} {
	const { currentBytes, rebaseAllowed, ...decideInput } = input;
	const decision = decideCompactionCommit(decideInput);
	if (!rebaseAllowed || decision.decision !== "stale" || decision.reason !== "revision_mismatch") {
		return { transaction: input.transaction, decision };
	}
	const rebased = rebaseOverInertTail(input.transaction, currentBytes, input.currentRevision, input.currentSource);
	if (rebased === null) return { transaction: input.transaction, decision };
	return { transaction: rebased, decision: decideCompactionCommit({ ...decideInput, transaction: rebased }) };
}
