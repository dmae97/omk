import { type SessionListProgress, SessionManager, type SessionMetadata } from "../../../core/session-manager.ts";

type MetadataLoader = (onProgress?: SessionListProgress) => Promise<SessionMetadata[]>;

export const DEFAULT_RESUME_SESSION_LIMIT = 50;

export function resolveResumeSessionLimit(env: NodeJS.ProcessEnv = process.env): number {
	const parsed = Number.parseInt(String(env.OMK_RESUME_MAX_SESSIONS ?? "").trim(), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESUME_SESSION_LIMIT;
}

export function limitRecentSessions(
	sessions: readonly SessionMetadata[],
	limit: number = resolveResumeSessionLimit(),
): SessionMetadata[] {
	if (sessions.length <= limit) {
		return [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime());
	}
	return [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime()).slice(0, limit);
}

/** /resume and --resume share lightweight listing capped to the newest N sessions. */
export function createSessionMetadataLoaders(
	cwd: string,
	sessionDir?: string,
	allProjects = false,
): [MetadataLoader, MetadataLoader] {
	const limit = resolveResumeSessionLimit();
	return [
		async (progress) =>
			limitRecentSessions(await SessionManager.list(cwd, sessionDir, progress, { metadataOnly: true }), limit),
		async (progress) =>
			limitRecentSessions(
				await SessionManager.listAll(allProjects ? undefined : sessionDir, progress, { metadataOnly: true }),
				limit,
			),
	];
}
