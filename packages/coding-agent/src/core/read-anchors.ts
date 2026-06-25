/**
 * `omk.read-anchor` — pure hash-anchored read/edit primitives.
 *
 * A read anchor binds a read result to the exact bytes the model saw: the
 * newline-normalized SHA-256 of the whole file plus the SHA-256 of the specific
 * line block that was read. Edits can then carry the anchor so the core can
 * reject stale edits (the file changed under the model) before applying them.
 *
 * All hashing in this module is performed on newline-normalized (LF) UTF-8
 * content so anchors are robust to CRLF/CR differences, matching the edit
 * pipeline which normalizes to LF before matching.
 *
 * Side-effect free: no filesystem access; `node:crypto` only.
 *
 * Derived clean-room from the lane C plan
 * (`.omk/runs/omk-pi-package-hardening-plan/recovery-readseek.md`); no legacy
 * package source is imported or copied.
 */

import { createHash, randomUUID } from "node:crypto";

export const READ_ANCHOR_SCHEMA_VERSION = "omk.read-anchor.v1";

export interface ReadAnchorRange {
	/** 1-indexed start line (resolved). */
	readonly offset: number;
	/** Number of lines included in the block (resolved). */
	readonly limit: number;
	/** 1-indexed last line included, inclusive. Equals `offset - 1` for an empty block. */
	readonly endLine: number;
}

export interface ReadAnchor {
	readonly schemaVersion: typeof READ_ANCHOR_SCHEMA_VERSION;
	readonly readId: string;
	readonly path: string;
	/** SHA-256 (hex) of the newline-normalized full file content. */
	readonly fileSha256: string;
	readonly range: ReadAnchorRange;
	/** SHA-256 (hex) of the newline-normalized read block content. */
	readonly blockSha256: string;
}

const HEX64 = /^[0-9a-f]{64}$/i;

function normalizeNewlines(content: string): string {
	return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function sha256Hex(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

interface ExtractedBlock {
	readonly text: string;
	readonly range: ReadAnchorRange;
}

/**
 * Extract a line block from already newline-normalized content using read-tool
 * semantics: `offset` is a 1-indexed start line, `limit` is the maximum number
 * of lines. Out-of-range requests clamp to an empty block at the end of file.
 */
function extractBlock(normalized: string, offset: number | undefined, limit: number | undefined): ExtractedBlock {
	const lines = normalized.split("\n");
	const start = Math.max(1, Math.floor(offset ?? 1));
	if (start > lines.length) {
		return { text: "", range: { offset: start, limit: 0, endLine: start - 1 } };
	}
	const available = lines.length - (start - 1);
	const count = limit === undefined ? available : Math.max(0, Math.min(Math.floor(limit), available));
	const blockLines = lines.slice(start - 1, start - 1 + count);
	return {
		text: blockLines.join("\n"),
		range: { offset: start, limit: count, endLine: start - 1 + count },
	};
}

export interface CreateReadAnchorInput {
	readonly path: string;
	/** Full file content as read. */
	readonly content: string;
	/** 1-indexed start line; defaults to 1 (whole file). */
	readonly offset?: number;
	/** Maximum number of lines; defaults to the rest of the file. */
	readonly limit?: number;
	/** Optional deterministic id (otherwise a UUID is generated). */
	readonly readId?: string;
}

/**
 * Create a hash anchor for a read. Hashes both the full (normalized) file and
 * the specific line block so a later edit can prove it is operating on the same
 * bytes the model saw.
 */
export function createReadAnchor(input: CreateReadAnchorInput): ReadAnchor {
	const normalized = normalizeNewlines(input.content);
	const block = extractBlock(normalized, input.offset, input.limit);
	return {
		schemaVersion: READ_ANCHOR_SCHEMA_VERSION,
		readId: input.readId ?? randomUUID(),
		path: input.path,
		fileSha256: sha256Hex(normalized),
		range: block.range,
		blockSha256: sha256Hex(block.text),
	};
}

export interface ReadAnchorVerification {
	readonly ok: boolean;
	readonly fileMatches: boolean;
	readonly blockMatches: boolean;
	readonly currentFileSha256: string;
	readonly currentBlockSha256: string;
}

/**
 * Verify an anchor against the current file content. `fileMatches` is the strict
 * whole-file check; `blockMatches` re-extracts the anchored range and compares
 * the block hash (useful for lenient relocation diagnostics).
 */
export function verifyReadAnchor(anchor: ReadAnchor, currentContent: string): ReadAnchorVerification {
	const normalized = normalizeNewlines(currentContent);
	const currentFileSha256 = sha256Hex(normalized);
	const block = extractBlock(normalized, anchor.range.offset, anchor.range.limit);
	const currentBlockSha256 = sha256Hex(block.text);
	const fileMatches = currentFileSha256 === anchor.fileSha256;
	const blockMatches = currentBlockSha256 === anchor.blockSha256;
	return {
		ok: fileMatches && blockMatches,
		fileMatches,
		blockMatches,
		currentFileSha256,
		currentBlockSha256,
	};
}

/** Validate an untrusted value as a {@link ReadAnchor}. Pure and fail-closed. */
export function validateReadAnchor(value: unknown): { ok: boolean; errors: readonly string[]; anchor?: ReadAnchor } {
	const errors: string[] = [];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, errors: ["anchor must be an object"] };
	}
	const anchor = value as Record<string, unknown>;
	if (anchor.schemaVersion !== READ_ANCHOR_SCHEMA_VERSION) {
		errors.push(`schemaVersion must be ${READ_ANCHOR_SCHEMA_VERSION}`);
	}
	if (typeof anchor.readId !== "string" || anchor.readId.length === 0)
		errors.push("readId must be a non-empty string");
	if (typeof anchor.path !== "string" || anchor.path.length === 0) errors.push("path must be a non-empty string");
	if (typeof anchor.fileSha256 !== "string" || !HEX64.test(anchor.fileSha256)) {
		errors.push("fileSha256 must be a 64-char hex digest");
	}
	if (typeof anchor.blockSha256 !== "string" || !HEX64.test(anchor.blockSha256)) {
		errors.push("blockSha256 must be a 64-char hex digest");
	}
	const range = anchor.range;
	if (typeof range !== "object" || range === null || Array.isArray(range)) {
		errors.push("range must be an object");
	} else {
		const r = range as Record<string, unknown>;
		for (const key of ["offset", "limit", "endLine"]) {
			if (typeof r[key] !== "number" || !Number.isInteger(r[key]) || (r[key] as number) < 0) {
				errors.push(`range.${key} must be a non-negative integer`);
			}
		}
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, errors: [], anchor: value as unknown as ReadAnchor };
}

export type AnchoredEditMode = "strict" | "lenient";

export type AnchoredEditVerdict = "allow" | "allow-lenient" | "reject-stale";

export interface AnchoredEditDecisionInput {
	readonly anchor: ReadAnchor;
	/** Current full file content at edit time. */
	readonly currentContent: string;
	/** Defaults to `strict`. */
	readonly mode?: AnchoredEditMode;
	/**
	 * The exact anchored block text (typically the edit's `oldText`). Required
	 * for lenient relocation when the file has changed; must hash to
	 * `anchor.blockSha256` to be trusted.
	 */
	readonly anchoredBlockText?: string;
}

export interface AnchoredEditDecision {
	readonly verdict: AnchoredEditVerdict;
	readonly reason: string;
	readonly currentFileSha256: string;
	readonly fileChanged: boolean;
	/** Lenient mode only: whether the anchored block was uniquely relocated. */
	readonly blockRelocated?: boolean;
	/** Lenient mode only: occurrences of the anchored block in current content. */
	readonly occurrences?: number;
}

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

const STALE_REREAD_HINT = "stale read: the file changed since it was read; re-read the file before editing";

/**
 * Decide whether an anchored edit may proceed.
 *
 *  - Unchanged file -> `allow` (the common fast path).
 *  - Changed file, strict mode -> `reject-stale` (the default; forces a re-read).
 *  - Changed file, lenient mode -> `allow-lenient` only when the anchored block
 *    text is supplied, hashes to the recorded `blockSha256`, and still occurs
 *    exactly once in the current content (unique, non-overlapping relocation).
 *    Zero or multiple occurrences -> `reject-stale`.
 */
export function decideAnchoredEdit(input: AnchoredEditDecisionInput): AnchoredEditDecision {
	const mode = input.mode ?? "strict";
	const normalized = normalizeNewlines(input.currentContent);
	const currentFileSha256 = sha256Hex(normalized);
	const fileChanged = currentFileSha256 !== input.anchor.fileSha256;

	if (!fileChanged) {
		return { verdict: "allow", reason: "current file hash matches the anchor", currentFileSha256, fileChanged };
	}

	if (mode === "strict") {
		return { verdict: "reject-stale", reason: STALE_REREAD_HINT, currentFileSha256, fileChanged };
	}

	const blockText = input.anchoredBlockText;
	if (blockText === undefined || blockText.length === 0) {
		return {
			verdict: "reject-stale",
			reason: "lenient relocation requires the anchored block text",
			currentFileSha256,
			fileChanged,
		};
	}

	const normalizedBlock = normalizeNewlines(blockText);
	if (sha256Hex(normalizedBlock) !== input.anchor.blockSha256) {
		return {
			verdict: "reject-stale",
			reason: "supplied block text does not match the anchored block hash",
			currentFileSha256,
			fileChanged,
		};
	}

	const occurrences = countOccurrences(normalized, normalizedBlock);
	if (occurrences === 1) {
		return {
			verdict: "allow-lenient",
			reason: "file changed but the anchored block is still uniquely locatable",
			currentFileSha256,
			fileChanged,
			blockRelocated: true,
			occurrences,
		};
	}
	return {
		verdict: "reject-stale",
		reason:
			occurrences === 0
				? "anchored block no longer exists in the current file"
				: "anchored block is ambiguous (multiple matches) in the current file",
		currentFileSha256,
		fileChanged,
		blockRelocated: false,
		occurrences,
	};
}
