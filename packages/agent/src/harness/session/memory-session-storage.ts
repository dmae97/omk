import { v7 as uuidv7 } from "uuid";
import type { SessionInfo, SessionTreeEntry, SessionTreeStorage } from "../types.js";

export class InMemorySessionTreeStorage implements SessionTreeStorage {
	private readonly sessionInfo: SessionInfo;
	private entries: SessionTreeEntry[];
	private byId: Map<string, SessionTreeEntry>;
	private leafId: string | null;

	constructor(options?: { entries?: SessionTreeEntry[]; leafId?: string | null; sessionInfo?: SessionInfo }) {
		this.entries = options?.entries ? [...options.entries] : [];
		this.byId = new Map(this.entries.map((entry) => [entry.id, entry]));
		this.leafId = options?.leafId ?? this.entries[this.entries.length - 1]?.id ?? null;
		if (this.leafId !== null && !this.byId.has(this.leafId)) {
			throw new Error(`Entry ${this.leafId} not found`);
		}
		this.sessionInfo = options?.sessionInfo ?? { id: uuidv7(), createdAt: new Date().toISOString() };
	}

	async getSessionInfo(): Promise<SessionInfo> {
		return this.sessionInfo;
	}

	async getLeafId(): Promise<string | null> {
		return this.leafId;
	}

	async setLeafId(leafId: string | null): Promise<void> {
		if (leafId !== null && !this.byId.has(leafId)) {
			throw new Error(`Entry ${leafId} not found`);
		}
		this.leafId = leafId;
	}

	async appendEntry(entry: SessionTreeEntry): Promise<void> {
		this.entries.push(entry);
		this.byId.set(entry.id, entry);
		this.leafId = entry.id;
	}

	async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
		return this.byId.get(id);
	}

	async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
		if (leafId === null) return [];
		const path: SessionTreeEntry[] = [];
		let current = this.byId.get(leafId);
		while (current) {
			path.unshift(current);
			current = current.parentId ? this.byId.get(current.parentId) : undefined;
		}
		return path;
	}

	async getEntries(): Promise<SessionTreeEntry[]> {
		return [...this.entries];
	}
}
