import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { JsonlSessionInfo, SessionTreeEntry, SessionTreeStorage } from "../types.js";

interface SessionHeader {
	type: "session";
	version: 3;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

function headerToSessionInfo(header: SessionHeader, path: string): JsonlSessionInfo {
	return {
		id: header.id,
		createdAt: header.timestamp,
		cwd: header.cwd,
		path,
		parentSessionPath: header.parentSession,
	};
}

export async function loadJsonlSessionInfo(filePath: string): Promise<JsonlSessionInfo> {
	const stream = createReadStream(filePath, { encoding: "utf8" });
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	try {
		for await (const line of lines) {
			if (!line.trim()) break;
			try {
				const header = JSON.parse(line) as SessionHeader;
				return headerToSessionInfo(header, resolve(filePath));
			} catch {
				throw new Error(`Invalid JSONL session file ${filePath}: first line is not a valid session header`);
			}
		}
		throw new Error(`Invalid JSONL session file ${filePath}: missing session header`);
	} finally {
		lines.close();
		stream.destroy();
	}
}

async function loadJsonlStorage(filePath: string): Promise<{
	header: SessionHeader;
	entries: SessionTreeEntry[];
	leafId: string | null;
}> {
	const content = await readFile(filePath, "utf8");
	const lines = content.split("\n").filter((line) => line.trim());
	if (lines.length === 0) {
		throw new Error(`Invalid JSONL session file ${filePath}: missing session header`);
	}

	let header: SessionHeader;
	try {
		header = JSON.parse(lines[0]!) as SessionHeader;
	} catch {
		throw new Error(`Invalid JSONL session file ${filePath}: first line is not a valid session header`);
	}

	const entries: SessionTreeEntry[] = [];
	let leafId: string | null = null;
	for (const line of lines.slice(1)) {
		try {
			const entry = JSON.parse(line) as SessionTreeEntry;
			entries.push(entry);
			leafId = entry.id;
		} catch {
			// ignore malformed entry lines
		}
	}
	return { header, entries, leafId };
}

export class JsonlSessionTreeStorage implements SessionTreeStorage<JsonlSessionInfo> {
	private readonly filePath: string;
	private readonly header: SessionHeader;
	private readonly sessionInfo: JsonlSessionInfo;
	private entries: SessionTreeEntry[];
	private byId: Map<string, SessionTreeEntry>;
	private currentLeafId: string | null;
	private headerWritten: boolean;

	private constructor(
		filePath: string,
		header: SessionHeader,
		entries: SessionTreeEntry[],
		leafId: string | null,
		headerWritten: boolean,
	) {
		this.filePath = resolve(filePath);
		this.header = header;
		this.sessionInfo = headerToSessionInfo(header, this.filePath);
		this.entries = entries;
		this.byId = new Map(entries.map((entry) => [entry.id, entry]));
		this.currentLeafId = leafId;
		this.headerWritten = headerWritten;
	}

	static async open(filePath: string): Promise<JsonlSessionTreeStorage> {
		const resolvedPath = resolve(filePath);
		const loaded = await loadJsonlStorage(resolvedPath);
		return new JsonlSessionTreeStorage(resolvedPath, loaded.header, loaded.entries, loaded.leafId, true);
	}

	static async create(
		filePath: string,
		options: {
			cwd: string;
			sessionId: string;
			parentSessionPath?: string;
		},
	): Promise<JsonlSessionTreeStorage> {
		const resolvedPath = resolve(filePath);
		const header: SessionHeader = {
			type: "session",
			version: 3,
			id: options.sessionId,
			timestamp: new Date().toISOString(),
			cwd: options.cwd,
			parentSession: options.parentSessionPath,
		};
		return new JsonlSessionTreeStorage(resolvedPath, header, [], null, false);
	}

	async getSessionInfo(): Promise<JsonlSessionInfo> {
		return this.sessionInfo;
	}

	async getLeafId(): Promise<string | null> {
		return this.currentLeafId;
	}

	async setLeafId(leafId: string | null): Promise<void> {
		if (leafId !== null && !this.byId.has(leafId)) {
			throw new Error(`Entry ${leafId} not found`);
		}
		this.currentLeafId = leafId;
	}

	async appendEntry(entry: SessionTreeEntry): Promise<void> {
		if (!this.headerWritten) {
			await mkdir(dirname(this.filePath), { recursive: true });
			await writeFile(this.filePath, `${JSON.stringify(this.header)}\n`);
			this.headerWritten = true;
		}
		await appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
		this.entries.push(entry);
		this.byId.set(entry.id, entry);
		this.currentLeafId = entry.id;
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
