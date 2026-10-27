/**
 * Spec 117 observe log `<OMK_RUN_LOG_DIR>/skill-autoload.jsonl` (no flag): shared seq counter, hashing and the
 * `kind: "read"` line. Hashes, numbers and session ids only; every error is swallowed.
 */
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { appendRunLog, RUN_LOG_DIR_ENV, type RunLogRecord } from "./run-log.ts";
import type { SessionEntry } from "./session-manager.ts";
import type { Skill } from "./skills.ts";
import { resolveReadPath } from "./tools/path-utils.ts";

export const SKILL_AUTOLOAD_RUN_LOG = "skill-autoload";
/** Max sessions whose seq counter is kept (LRU). */
export const SKILL_AUTOLOAD_SEQ_SESSION_CAP = 1000;

export interface AutoLoadStore {
	getEntries(): readonly SessionEntry[];
	appendCustomEntry(customType: string, data?: unknown): unknown;
	getSessionId?(): string | undefined;
}

const seqBySession = new Map<string | null, number>();

export function skillAutoLoadSeqSessionCount(): number {
	return seqBySession.size;
}

export function nextSkillAutoloadSeq(sessionId: string | null): number {
	const seq = (seqBySession.get(sessionId) ?? 0) + 1;
	seqBySession.delete(sessionId);
	seqBySession.set(sessionId, seq);
	while (seqBySession.size > SKILL_AUTOLOAD_SEQ_SESSION_CAP) {
		seqBySession.delete(seqBySession.keys().next().value as string | null);
	}
	return seq;
}

export function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

export function skillAutoloadSessionId(store: AutoLoadStore): string | null {
	try {
		return store.getSessionId?.() || null;
	} catch {
		return null;
	}
}

export function logSkillAutoload(record: RunLogRecord, env: NodeJS.ProcessEnv): void {
	try {
		appendRunLog(SKILL_AUTOLOAD_RUN_LOG, record, { env });
	} catch {
		// Observation never changes the prompt.
	}
}

/** `kind: "read"` line for a model `read` of any file under a skill directory. No-op without the run log. */
export function observeSkillRead(
	store: AutoLoadStore,
	skills: () => readonly Skill[],
	cwd: string,
	toolName: string,
	args: unknown,
	isError: boolean,
	env: NodeJS.ProcessEnv = process.env,
): void {
	if (toolName !== "read" || isError || !env[RUN_LOG_DIR_ENV]?.trim()) return;
	try {
		const rawPath = (args as { path?: unknown } | undefined)?.path;
		if (typeof rawPath !== "string") return;
		const filePath = resolve(resolveReadPath(rawPath, cwd));
		const skill = skills().find((s) => filePath.startsWith(resolve(s.baseDir) + sep));
		if (!skill) return;
		let turn = 0;
		for (const entry of store.getEntries()) if (entry.type === "message" && entry.message.role === "user") turn++;
		const sessionId = skillAutoloadSessionId(store);
		logSkillAutoload(
			{ kind: "read", sessionId, seq: nextSkillAutoloadSeq(sessionId), nameSha256: sha256(skill.name), turn },
			env,
		);
	} catch {
		// Observation never changes the tool result.
	}
}
