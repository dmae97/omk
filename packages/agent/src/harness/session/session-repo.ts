import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { v7 as uuidv7 } from "uuid";
import type {
	JsonlSessionInfo,
	JsonlSessionRepo,
	Session,
	SessionInfo,
	SessionRepo,
	SessionTreeEntry,
	SessionTreeStorage,
} from "../types.js";
import { JsonlSessionTreeStorage } from "./jsonl-session-storage.js";
import { InMemorySessionTreeStorage } from "./memory-session-storage.js";
import { DefaultSessionTree } from "./session-tree.js";

function createSessionId(): string {
	return uuidv7();
}

function createTimestamp(): string {
	return new Date().toISOString();
}

function toSession<TInfo extends SessionInfo>(
	storage: SessionTreeStorage<TInfo>,
	tree: DefaultSessionTree<TInfo>,
): Session<TInfo> {
	return { storage, tree };
}

function getPathEntriesToFork(
	entries: SessionTreeEntry[],
	entryId: string,
	position: "before" | "at",
): SessionTreeEntry[] {
	const byId = new Map<string, SessionTreeEntry>(entries.map((entry) => [entry.id, entry]));
	const target = byId.get(entryId);
	if (!target) {
		throw new Error(`Entry ${entryId} not found`);
	}
	let effectiveLeafId: string | null;
	if (position === "at") {
		effectiveLeafId = target.id;
	} else {
		if (target.type !== "message" || target.message.role !== "user") {
			throw new Error(`Entry ${entryId} is not a user message`);
		}
		effectiveLeafId = target.parentId;
	}
	if (effectiveLeafId === null) {
		return [];
	}
	const path: SessionTreeEntry[] = [];
	let current = byId.get(effectiveLeafId);
	while (current) {
		path.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path;
}

export class InMemorySessionRepo implements SessionRepo<string> {
	private sessions = new Map<string, Session<SessionInfo>>();

	async create(options?: { id?: string }): Promise<Session<SessionInfo>> {
		const info: SessionInfo = {
			id: options?.id ?? createSessionId(),
			createdAt: createTimestamp(),
		};
		const storage = new InMemorySessionTreeStorage({ sessionInfo: info });
		const session = toSession(storage, new DefaultSessionTree(storage));
		this.sessions.set(info.id, session);
		return session;
	}

	async open(ref: string): Promise<Session<SessionInfo>> {
		const session = this.sessions.get(ref);
		if (!session) {
			throw new Error(`Session not found: ${ref}`);
		}
		return session;
	}

	async list(): Promise<Array<Session<SessionInfo>>> {
		return [...this.sessions.values()];
	}

	async delete(ref: string): Promise<void> {
		this.sessions.delete(ref);
	}

	async fork(
		ref: string,
		options: { entryId: string; position?: "before" | "at"; id?: string },
	): Promise<Session<SessionInfo>> {
		const source = await this.open(ref);
		const entries = await source.tree.getEntries();
		const forkedEntries = getPathEntriesToFork(entries, options.entryId, options.position ?? "before");
		const info: SessionInfo = {
			id: options.id ?? createSessionId(),
			createdAt: createTimestamp(),
		};
		const leafId = forkedEntries[forkedEntries.length - 1]?.id ?? null;
		const storage = new InMemorySessionTreeStorage({ sessionInfo: info, entries: forkedEntries, leafId });
		const session = toSession(storage, new DefaultSessionTree(storage));
		this.sessions.set(info.id, session);
		return session;
	}
}

export class JsonlSessionFileRepo implements JsonlSessionRepo<string> {
	private sessionDir: string;
	private cwd: string;

	constructor(options: { sessionDir: string; cwd: string }) {
		this.sessionDir = resolve(options.sessionDir);
		this.cwd = options.cwd;
		mkdirSync(this.sessionDir, { recursive: true });
	}

	private createSessionFilePath(sessionId: string, timestamp: string): string {
		return join(this.sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`);
	}

	async create(options?: { id?: string; parentSessionPath?: string }): Promise<Session<JsonlSessionInfo>> {
		const id = options?.id ?? createSessionId();
		const createdAt = createTimestamp();
		const filePath = this.createSessionFilePath(id, createdAt);
		const storage = await JsonlSessionTreeStorage.create(filePath, {
			cwd: this.cwd,
			sessionId: id,
			parentSessionPath: options?.parentSessionPath,
		});
		return toSession(storage, new DefaultSessionTree(storage));
	}

	async open(ref: string): Promise<Session<JsonlSessionInfo>> {
		const filePath = ref.includes("/") || ref.endsWith(".jsonl") ? resolve(ref) : join(this.sessionDir, ref);
		if (!existsSync(filePath)) {
			throw new Error(`Session not found: ${ref}`);
		}
		const storage = await JsonlSessionTreeStorage.open(filePath);
		return toSession(storage, new DefaultSessionTree(storage));
	}

	async list(): Promise<Array<Session<JsonlSessionInfo>>> {
		if (!existsSync(this.sessionDir)) {
			return [];
		}
		const files = readdirSync(this.sessionDir)
			.filter((file) => file.endsWith(".jsonl"))
			.map((file) => join(this.sessionDir, file));
		const sessions: Array<Session<JsonlSessionInfo>> = [];
		for (const filePath of files) {
			try {
				const storage = await JsonlSessionTreeStorage.open(filePath);
				sessions.push(toSession(storage, new DefaultSessionTree(storage)));
			} catch {
				// Ignore invalid session files when listing a directory.
			}
		}
		return sessions;
	}

	async listByCwd(cwd: string): Promise<Array<Session<JsonlSessionInfo>>> {
		const sessions = await this.list();
		const result: Array<Session<JsonlSessionInfo>> = [];
		for (const session of sessions) {
			if ((await session.storage.getSessionInfo()).cwd === cwd) {
				result.push(session);
			}
		}
		return result;
	}

	async getMostRecentByCwd(cwd: string): Promise<Session<JsonlSessionInfo> | undefined> {
		const sessionsWithInfo = await Promise.all(
			(await this.listByCwd(cwd)).map(async (session) => ({
				session,
				info: await session.storage.getSessionInfo(),
			})),
		);
		sessionsWithInfo.sort((a, b) => new Date(b.info.createdAt).getTime() - new Date(a.info.createdAt).getTime());
		return sessionsWithInfo[0]?.session;
	}

	async delete(ref: string): Promise<void> {
		const filePath = ref.includes("/") || ref.endsWith(".jsonl") ? resolve(ref) : join(this.sessionDir, ref);
		if (existsSync(filePath)) {
			rmSync(filePath, { force: true });
		}
	}

	async fork(
		ref: string,
		options: { entryId: string; position?: "before" | "at"; id?: string },
	): Promise<Session<JsonlSessionInfo>> {
		const source = await this.open(ref);
		const entries = await source.tree.getEntries();
		const forkedEntries = getPathEntriesToFork(entries, options.entryId, options.position ?? "before");
		const id = options.id ?? createSessionId();
		const createdAt = createTimestamp();
		const filePath = this.createSessionFilePath(id, createdAt);
		const sourceInfo = await source.storage.getSessionInfo();
		const storage = await JsonlSessionTreeStorage.create(filePath, {
			cwd: sourceInfo.cwd,
			sessionId: id,
			parentSessionPath: sourceInfo.path,
		});
		for (const entry of forkedEntries) {
			await storage.appendEntry(entry);
		}
		if (forkedEntries.length === 0) {
			await storage.getSessionInfo();
		}
		return toSession(storage, new DefaultSessionTree(storage));
	}
}
