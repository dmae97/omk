import { readSessionInfo, type SessionInfo, type SessionListEntry } from "../../../core/session-listing.ts";
import { filterAndSortSessions, matchSession, parseSearchQuery, type SortMode } from "./session-selector-search.ts";

export type SessionSearchReader = (path: string, signal: AbortSignal) => Promise<SessionInfo | null>;
const readSource: SessionSearchReader = (path, signal) => readSessionInfo(path, { signal });
export interface SessionSearchResult {
	sessions: SessionListEntry[];
	unreadable: number;
}

/** At most two full transcripts are held temporarily; returned rows remain metadata-only. */
export async function searchSessionEntries(
	sessions: SessionListEntry[],
	query: string,
	sortMode: SortMode,
	signal: AbortSignal,
	read: SessionSearchReader = readSource,
): Promise<SessionSearchResult> {
	const parsed = parseSearchQuery(query);
	if (parsed.error || signal.aborted) return { sessions: [], unreadable: 0 };
	if (!query.trim()) return { sessions, unreadable: 0 };
	const scored: ({ session: SessionListEntry; score: number } | undefined)[] = new Array(sessions.length);
	let next = 0;
	let unreadable = 0;
	const worker = async (): Promise<void> => {
		while (!signal.aborted) {
			const index = next++;
			const session = sessions[index];
			if (!session) return;
			let info: SessionInfo | null;
			try {
				info =
					typeof session.allMessagesText === "string"
						? { ...session, allMessagesText: session.allMessagesText }
						: await read(session.path, signal);
			} catch {
				info = null;
			}
			if (signal.aborted) return;
			if (!info || info.id !== session.id) {
				unreadable++;
				continue;
			}
			const match = matchSession({ ...session, allMessagesText: info.allMessagesText }, parsed);
			if (match.matches) scored[index] = { session, score: match.score };
		}
	};
	await Promise.all([worker(), worker()]);
	const matches = scored.filter((item): item is NonNullable<typeof item> => item !== undefined);
	if (sortMode !== "recent")
		matches.sort((a, b) => a.score - b.score || b.session.modified.getTime() - a.session.modified.getTime());
	return { sessions: matches.map((item) => item.session), unreadable };
}

interface SearchRequest {
	revision: number;
	sessions: SessionListEntry[];
	query: string;
	sortMode: SortMode;
	publish: (result: SessionSearchResult) => void;
}

/** Latest query wins; an aborted scan must settle before its replacement starts. */
export class SessionSearchController {
	private revision = 0;
	private pending?: SearchRequest;
	private active?: AbortController;
	private running?: Promise<void>;
	private disposed = false;
	private readonly read: SessionSearchReader;
	searching = false;

	constructor(read: SessionSearchReader = readSource) {
		this.read = read;
	}

	update(sessions: SessionListEntry[], query: string, sortMode: SortMode, publish: SearchRequest["publish"]): void {
		if (this.disposed) return;
		this.revision++;
		this.active?.abort();
		this.pending = undefined;
		this.searching = false;
		if (!query.trim() || parseSearchQuery(query).error) {
			publish({ sessions: query.trim() ? [] : sessions, unreadable: 0 });
			return;
		}
		if (sessions.every((entry): entry is SessionInfo => typeof entry.allMessagesText === "string")) {
			publish({ sessions: filterAndSortSessions(sessions, query, sortMode), unreadable: 0 });
			return;
		}
		this.pending = { revision: this.revision, sessions, query, sortMode, publish };
		this.searching = true;
		if (!this.running) this.running = this.drain();
	}

	dispose(): void {
		this.disposed = true;
		this.revision++;
		this.pending = undefined;
		this.active?.abort();
		this.searching = false;
	}

	async whenSettled(): Promise<void> {
		await this.running;
	}

	private async drain(): Promise<void> {
		try {
			while (this.pending && !this.disposed) {
				const request = this.pending;
				this.pending = undefined;
				const controller = new AbortController();
				this.active = controller;
				const result = await searchSessionEntries(
					request.sessions,
					request.query,
					request.sortMode,
					controller.signal,
					this.read,
				);
				if (request.revision === this.revision && !this.disposed && !controller.signal.aborted) {
					this.searching = false;
					request.publish(result);
				}
			}
		} finally {
			this.running = undefined;
			this.active = undefined;
		}
	}
}
