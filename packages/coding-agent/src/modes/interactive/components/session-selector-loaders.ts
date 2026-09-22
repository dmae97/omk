import { type SessionListProgress, SessionManager, type SessionMetadata } from "../../../core/session-manager.ts";

type MetadataLoader = (onProgress?: SessionListProgress) => Promise<SessionMetadata[]>;

/** /resume and --resume share lightweight listing; full text is read only for a query. */
export function createSessionMetadataLoaders(
	cwd: string,
	sessionDir?: string,
	allProjects = false,
): [MetadataLoader, MetadataLoader] {
	return [
		(progress) => SessionManager.list(cwd, sessionDir, progress, { metadataOnly: true }),
		(progress) => SessionManager.listAll(allProjects ? undefined : sessionDir, progress, { metadataOnly: true }),
	];
}
