import type { Session, SessionMetadata, SessionRepo } from "../types.js";
import { InMemorySessionStorage } from "./memory-session-storage.js";
import { createSessionId, createTimestamp, getPathEntriesToFork, toSession } from "./session-repo.js";

export class InMemorySessionRepo implements SessionRepo<SessionMetadata, { id?: string }, string, void> {
	private sessions = new Map<string, Session<SessionMetadata>>();

	async create(options: { id?: string } = {}): Promise<Session<SessionMetadata>> {
		const info: SessionMetadata = {
			id: options.id ?? createSessionId(),
			createdAt: createTimestamp(),
		};
		const storage = new InMemorySessionStorage({ metadata: info });
		const session = toSession(storage);
		this.sessions.set(info.id, session);
		return session;
	}

	async open(ref: string): Promise<Session<SessionMetadata>> {
		const session = this.sessions.get(ref);
		if (!session) {
			throw new Error(`Session not found: ${ref}`);
		}
		return session;
	}

	async list(): Promise<SessionMetadata[]> {
		return Promise.all([...this.sessions.values()].map((session) => session.getMetadata()));
	}

	async delete(ref: string): Promise<void> {
		this.sessions.delete(ref);
	}

	async fork(
		ref: string,
		options: { entryId: string; position?: "before" | "at"; id?: string },
	): Promise<Session<SessionMetadata>> {
		const source = await this.open(ref);
		const forkedEntries = await getPathEntriesToFork(
			source.getStorage(),
			options.entryId,
			options.position ?? "before",
		);
		const info: SessionMetadata = {
			id: options.id ?? createSessionId(),
			createdAt: createTimestamp(),
		};
		const leafId = forkedEntries[forkedEntries.length - 1]?.id ?? null;
		const storage = new InMemorySessionStorage({ metadata: info, entries: forkedEntries, leafId });
		const session = toSession(storage);
		this.sessions.set(info.id, session);
		return session;
	}
}
