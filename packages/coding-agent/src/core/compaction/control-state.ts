/**
 * Host control snapshot bound into a compaction envelope's preserved provenance.
 *
 * A natural-language summary cannot restore the obligation set: if the only
 * record of "what is still open" is prose the summarizer wrote, a dropped line
 * silently closes real work. The host supplies this structured snapshot
 * instead, and the compaction commit compares its digest so a summary generated
 * under different control state is discarded rather than committed.
 *
 * Producer output is untrusted input here: malformed shapes fail closed instead
 * of degrading into an empty-but-valid checkpoint, which would look like
 * "nothing was open" to every later reader.
 */

import { createHash } from "node:crypto";
import { sanitizeBinaryOutput } from "../../utils/shell.ts";
import { redactSensitiveTextForced } from "../redaction.ts";
import { redactCredentialShapedContent } from "./transaction.ts";

/** Envelope validators reject credential shapes and control characters outright. */
const MAX_PROVENANCE_TEXT = 4096;

export interface CompactionControlState {
	readonly openTasks: readonly string[];
	readonly blockerReasons: readonly string[];
	readonly branch: string | null;
}

const MAX_CONTROL_STATE_ITEMS = 1024;
const MAX_CONTROL_STATE_TEXT = 16_384;

function assertControlStateText(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || value.length > MAX_CONTROL_STATE_TEXT) {
		throw new TypeError(`control state ${field} must be a bounded string`);
	}
}

/** Validate producer output; malformed input fails closed, never degrades to an empty checkpoint. */
export function validateControlState(value: CompactionControlState | null): CompactionControlState | null {
	if (value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new TypeError("control state must be an object or null");
	}
	for (const field of ["openTasks", "blockerReasons"] as const) {
		const list = value[field];
		if (!Array.isArray(list) || list.length > MAX_CONTROL_STATE_ITEMS) {
			throw new TypeError(`control state ${field} must be a bounded array`);
		}
		for (const item of list) assertControlStateText(item, `${field} item`);
	}
	if (value.branch !== null) assertControlStateText(value.branch, "branch");
	return value;
}

/**
 * Digest the snapshot deterministically. Null stays null so "no control
 * authority attached" stays distinguishable from "authority reporting nothing
 * open" — the transition between them is itself a change worth discarding on.
 */
/**
 * Make one control-state string safe for the envelope validators.
 *
 * Returns `[REDACTED]` rather than an empty string when sanitization consumes
 * everything: the validators reject empty entries, and dropping the entry would
 * quietly reduce the open-task count instead of preserving that work exists.
 */
export function sanitizeProvenanceText(value: string): string {
	const sanitized = redactCredentialShapedContent(
		sanitizeBinaryOutput(redactSensitiveTextForced(value.trim()))
			.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
			.slice(0, MAX_PROVENANCE_TEXT),
	);
	return sanitized.length > 0 ? sanitized : "[REDACTED]";
}

/** Project a control snapshot onto the envelope's preserved-provenance fields. */
export function controlStateProvenance(state: CompactionControlState | null): {
	readonly openTasks: readonly string[];
	readonly blockerReasons: readonly string[];
	readonly branch: string | null;
} {
	if (state === null) return { openTasks: [], blockerReasons: [], branch: null };
	return {
		openTasks: state.openTasks.map(sanitizeProvenanceText),
		blockerReasons: state.blockerReasons.map(sanitizeProvenanceText),
		branch: state.branch == null ? null : sanitizeProvenanceText(state.branch),
	};
}

export function controlStateDigest(state: CompactionControlState | null): string | null {
	if (state === null) return null;
	return createHash("sha256")
		.update(
			JSON.stringify({
				openTasks: [...state.openTasks],
				blockerReasons: [...state.blockerReasons],
				branch: state.branch,
			}),
			"utf8",
		)
		.digest("hex");
}
