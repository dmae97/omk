/**
 * Edit match observation (run log only, no flag): `<OMK_RUN_LOG_DIR>/edit-match.jsonl`.
 * Success lines record which stage matched each edit (1 = exact, 2 = normalized/fuzzy).
 * Failure lines record a reason class computed only on the failure path, so a successful
 * edit pays nothing beyond one log append. Never changes the tool result or model input.
 * Lines hold enums, numbers and a short path hash only (no paths, no file text).
 */
import { createHash } from "node:crypto";
import { normalize } from "node:path";
import { appendRunLog, RUN_LOG_DIR_ENV, type RunLogValue, runLogRole } from "../run-log.ts";
import { normalizeForFuzzyMatch, normalizeToLF } from "./edit-diff.ts";

export const EDIT_MATCH_RUN_LOG = "edit-match";
/** Set by the subagent worker env (`subagentWorkerEnv`) to the spawning session's id. */
export const RUN_LOG_PARENT_SESSION_ENV = "OMK_RUN_LOG_PARENT_SESSION";

/** Lead's session id in a worker process; null for the lead or when unknown. */
export function editParentSessionId(env: NodeJS.ProcessEnv): string | null {
	if (runLogRole(env) !== "worker") return null;
	return env[RUN_LOG_PARENT_SESSION_ENV]?.trim() || null;
}

export type EditMatchFailureReason = "indent_only" | "multiple_matches" | "not_found" | "unknown";

interface EditLike {
	oldText: string;
	newText: string;
}

/** sha256 of the normalized path, first 16 hex chars. */
export function editPathHash(path: string): string {
	return createHash("sha256").update(normalize(path)).digest("hex").slice(0, 16);
}

function countFuzzy(content: string, oldText: string): number {
	return normalizeForFuzzyMatch(content).split(normalizeForFuzzyMatch(oldText)).length - 1;
}

/** True when oldText matches a run of whole file lines once each line is trimmed on both sides. */
function matchesIgnoringIndent(content: string, oldText: string): boolean {
	const trim = (line: string) => normalizeForFuzzyMatch(line).trim();
	const want = oldText.split("\n").map(trim);
	while (want.length > 1 && want[want.length - 1] === "") want.pop();
	if (want.every((line) => line === "")) return false;
	const lines = content.split("\n").map(trim);
	for (let start = 0; start + want.length <= lines.length; start++) {
		let ok = true;
		for (let j = 0; j < want.length; j++) {
			if (lines[start + j] !== want[j]) {
				ok = false;
				break;
			}
		}
		if (ok) return true;
	}
	return false;
}

/** Classify why an edit call failed. `content` is BOM-stripped, LF-normalized file text. */
export function classifyEditMatchFailure(
	content: string,
	edits: readonly EditLike[],
): { reason: EditMatchFailureReason; editIndex: number | null } {
	for (let i = 0; i < edits.length; i++) {
		const oldText = normalizeToLF(edits[i].oldText);
		if (oldText.length === 0) return { reason: "unknown", editIndex: i };
		const occurrences = countFuzzy(content, oldText);
		if (occurrences > 1) return { reason: "multiple_matches", editIndex: i };
		if (occurrences === 1 || content.includes(oldText)) continue;
		return { reason: matchesIgnoringIndent(content, oldText) ? "indent_only" : "not_found", editIndex: i };
	}
	// Every edit matched uniquely: the failure was elsewhere (overlap, no-op, ...).
	return { reason: "unknown", editIndex: null };
}

type EditCtx = { sessionManager?: { getSessionId?: () => string } };

/** Session id from the tool context (the task identifier in run-log lines), or null. */
export function editSessionId(ctx: EditCtx | undefined): string | null {
	try {
		return ctx?.sessionManager?.getSessionId?.() ?? null;
	} catch {
		return null;
	}
}

/**
 * Per-session line counters, in memory. `seq` is 1, 2, ... per sessionId within this process,
 * so (sessionId, seq) is unique even when lead and worker append to the same file.
 * LRU-capped so a long-running process does not grow without bound.
 */
const seqBySession = new Map<string | null, number>();

/** Max sessions whose seq counter is kept; least recently used is evicted beyond this. */
export const EDIT_SEQ_SESSION_CAP = 1000;

function nextSeq(sessionId: string | null): number {
	const seq = (seqBySession.get(sessionId) ?? 0) + 1;
	// Re-insert so this session becomes most recently used.
	seqBySession.delete(sessionId);
	seqBySession.set(sessionId, seq);
	while (seqBySession.size > EDIT_SEQ_SESSION_CAP) {
		const oldest = seqBySession.keys().next().value as string | null;
		seqBySession.delete(oldest);
	}
	return seq;
}

/** Test hook: number of sessions currently tracked. */
export function editSeqSessionCount(): number {
	return seqBySession.size;
}

function write(
	env: NodeJS.ProcessEnv,
	sessionId: string | null,
	record: { readonly [key: string]: RunLogValue },
): void {
	appendRunLog(
		EDIT_MATCH_RUN_LOG,
		{
			event: "edit_match",
			seq: nextSeq(sessionId),
			ts: new Date().toISOString(),
			sessionId,
			parentSessionId: editParentSessionId(env),
			...record,
		},
		{ env },
	);
}

const runLogOn = (env: NodeJS.ProcessEnv): boolean => Boolean(env[RUN_LOG_DIR_ENV]?.trim());

/** Methods live on an object so tests can spy on them. All are no-ops (no extra work) when the run log is off. */
export const editMatchObserver = {
	classify: classifyEditMatchFailure,
	/**
	 * Stage per edit: 1 when oldText occurs verbatim, else 2. Mirrors fuzzyFindText's
	 * exact-first order, so it equals its usedFuzzyMatch for every edit that applied.
	 */
	stages(content: string, edits: readonly EditLike[]): number[] {
		return edits.map((edit) => (content.includes(normalizeToLF(edit.oldText)) ? 1 : 2));
	},
	logSuccess(
		path: string,
		content: string,
		edits: readonly EditLike[],
		ctx?: EditCtx,
		env: NodeJS.ProcessEnv = process.env,
	): void {
		if (!runLogOn(env)) return;
		try {
			const matchStages = editMatchObserver.stages(content, edits);
			write(env, editSessionId(ctx), {
				ok: true,
				pathHash: editPathHash(path),
				edits: matchStages.length,
				edit_match_stage: Math.max(...matchStages),
				matchStages,
			});
		} catch {
			// Observation must never change the tool outcome.
		}
	},
	logFailure(
		path: string,
		content: string,
		edits: readonly EditLike[],
		ctx?: EditCtx,
		env: NodeJS.ProcessEnv = process.env,
	): void {
		if (!runLogOn(env)) return;
		try {
			const list = Array.isArray(edits) ? edits : [];
			const { reason, editIndex } = editMatchObserver.classify(content, list);
			write(env, editSessionId(ctx), {
				ok: false,
				pathHash: editPathHash(path),
				edits: list.length,
				reason,
				editIndex,
			});
		} catch {
			// Observation must never change the tool outcome.
		}
	},
};
