import * as os from "node:os";
import { type SessionListProgress, SessionManager, type SessionMetadata } from "../../../core/session-manager.ts";

export interface SessionListCapInfo {
	readonly shownCount: number;
	readonly totalCount: number;
	readonly limit: number;
	readonly truncated: boolean;
	readonly expanded: boolean;
}

export interface SessionMetadataLoader {
	(onProgress?: SessionListProgress): Promise<SessionMetadata[]>;
	readonly loadUncapped?: (onProgress?: SessionListProgress) => Promise<SessionMetadata[]>;
	readonly getCapInfo?: () => SessionListCapInfo | undefined;
}

export const DEFAULT_RESUME_SESSION_LIMIT = 50;

export function resolveResumeSessionLimit(env: NodeJS.ProcessEnv = process.env): number {
	const parsed = Number.parseInt(String(env.OMK_RESUME_MAX_SESSIONS ?? "").trim(), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESUME_SESSION_LIMIT;
}

export function limitRecentSessions(
	sessions: readonly SessionMetadata[],
	limit: number = resolveResumeSessionLimit(),
): SessionMetadata[] {
	const sorted = [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime());
	return sorted.length <= limit ? sorted : sorted.slice(0, limit);
}

export function formatSessionCapNotice(cap: SessionListCapInfo | undefined): string | undefined {
	if (!cap) return undefined;
	if (cap.truncated) {
		return `Showing newest ${cap.shownCount} of ${cap.totalCount} sessions · type to search older`;
	}
	if (cap.expanded) {
		return `Showing all ${cap.totalCount} sessions (including older)`;
	}
	return undefined;
}

export function createCappedSessionLoader(
	fetchAll: (onProgress?: SessionListProgress) => Promise<SessionMetadata[]>,
	limit: number = resolveResumeSessionLimit(),
): SessionMetadataLoader {
	let cachedAll: SessionMetadata[] | undefined;
	let capInfo: SessionListCapInfo | undefined;

	const loader = (async (progress?: SessionListProgress): Promise<SessionMetadata[]> => {
		const raw = await fetchAll(progress);
		const sorted = [...raw].sort((a, b) => b.modified.getTime() - a.modified.getTime());
		cachedAll = sorted;
		const truncated = sorted.length > limit;
		const shown = truncated ? sorted.slice(0, limit) : sorted;
		capInfo = {
			shownCount: shown.length,
			totalCount: sorted.length,
			limit,
			truncated,
			expanded: false,
		};
		return shown;
	}) as SessionMetadataLoader & {
		loadUncapped: (onProgress?: SessionListProgress) => Promise<SessionMetadata[]>;
		getCapInfo: () => SessionListCapInfo | undefined;
	};

	loader.loadUncapped = async (progress?: SessionListProgress): Promise<SessionMetadata[]> => {
		const all =
			cachedAll ?? [...(await fetchAll(progress))].sort((a, b) => b.modified.getTime() - a.modified.getTime());
		cachedAll = all;
		capInfo = {
			shownCount: all.length,
			totalCount: all.length,
			limit,
			truncated: false,
			expanded: all.length > limit,
		};
		return all;
	};

	loader.getCapInfo = () => capInfo;
	return loader;
}

export function shortenSessionPath(path: string): string {
	const home = os.homedir();
	if (!path) return path;
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function formatSessionDate(date: Date): string {
	// wall-clock: relative age compared against session file wall-clock timestamp
	const diffMs = Date.now() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);
	if (diffMins < 1) return "now";
	if (diffMins < 60) return `${diffMins}m`;
	if (diffHours < 24) return `${diffHours}h`;
	if (diffDays < 7) return `${diffDays}d`;
	if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
	if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
	return `${Math.floor(diffDays / 365)}y`;
}

/** /resume and --resume share lightweight listing capped to the newest N sessions, expandable on search. */
export function createSessionMetadataLoaders(
	cwd: string,
	sessionDir?: string,
	allProjects = false,
): [SessionMetadataLoader, SessionMetadataLoader] {
	const limit = resolveResumeSessionLimit();
	return [
		createCappedSessionLoader(
			(progress) => SessionManager.list(cwd, sessionDir, progress, { metadataOnly: true }),
			limit,
		),
		createCappedSessionLoader(
			(progress) => SessionManager.listAll(allProjects ? undefined : sessionDir, progress, { metadataOnly: true }),
			limit,
		),
	];
}

function cleanSingleLine(text: string): string {
	return text
		.replace(/[\x00-\x1f\x7f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Compact preview lines for the highlighted session so similarly named sessions are immediately distinguishable. */
export function formatSelectedSessionPreview(
	session: {
		readonly firstMessage: string;
		readonly lastUserMessage?: string;
		readonly branchCount?: number;
		readonly parentSessionPath?: string;
		readonly lastBranchSummary?: string;
	},
	width: number,
	truncate: (s: string, w: number, ellipsis: string) => string,
	fg: (color: "dim" | "muted" | "accent", s: string) => string,
): string[] {
	const lastReq = cleanSingleLine(session.lastUserMessage || session.firstMessage || "(no messages)");
	const branches = session.branchCount ?? 1;
	const branchLabel = branches > 1 ? `${branches} branches` : "1 linear branch";
	const metaParts = [branchLabel];
	if (session.parentSessionPath) {
		const parentBase = session.parentSessionPath.split(/[\\/]/).pop() ?? session.parentSessionPath;
		metaParts.push(`forked from ${parentBase}`);
	}
	if (session.lastBranchSummary) {
		metaParts.push(`branch: ${cleanSingleLine(session.lastBranchSummary)}`);
	}
	return [
		truncate(`${fg("dim", "  Last: ")}${fg("muted", lastReq)}`, width, "…"),
		truncate(`${fg("dim", "  Tree: ")}${fg("dim", metaParts.join(" · "))}`, width, "…"),
	];
}
