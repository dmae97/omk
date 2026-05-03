import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { JsonlSessionMetadata, SessionStorage, SessionTreeEntry } from "../../types.js";

interface SessionHeader {
	type: "session";
	version: 3;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

function updateLabelCache(labelsById: Map<string, string>, entry: SessionTreeEntry): void {
	if (entry.type !== "label") return;
	const label = entry.label?.trim();
	if (label) {
		labelsById.set(entry.targetId, label);
	} else {
		labelsById.delete(entry.targetId);
	}
}

function buildLabelsById(entries: SessionTreeEntry[]): Map<string, string> {
	const labelsById = new Map<string, string>();
	for (const entry of entries) {
		updateLabelCache(labelsById, entry);
	}
	return labelsById;
}

function generateEntryId(byId: { has(id: string): boolean }): string {
	for (let i = 0; i < 100; i++) {
		const id = randomUUID().slice(0, 8);
		if (!byId.has(id)) return id;
	}
	return randomUUID();
}

function headerToSessionMetadata(header: SessionHeader, path: string): JsonlSessionMetadata {
	return {
		id: header.id,
		createdAt: header.timestamp,
		cwd: header.cwd,
		path,
		parentSessionPath: header.parentSession,
	};
}

export async function loadJsonlSessionMetadata(filePath: string): Promise<JsonlSessionMetadata> {
	const stream = createReadStream(filePath, { encoding: "utf8" });
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	try {
		for await (const line of lines) {
			if (!line.trim()) break;
			try {
				const header = JSON.parse(line) as SessionHeader;
				return headerToSessionMetadata(header, resolve(filePath));
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

export class JsonlSessionStorage implements SessionStorage<JsonlSessionMetadata> {
	private readonly filePath: string;
	private readonly metadata: JsonlSessionMetadata;
	private entries: SessionTreeEntry[];
	private byId: Map<string, SessionTreeEntry>;
	private labelsById: Map<string, string>;
	private currentLeafId: string | null;

	private constructor(filePath: string, header: SessionHeader, entries: SessionTreeEntry[], leafId: string | null) {
		this.filePath = resolve(filePath);
		this.metadata = headerToSessionMetadata(header, this.filePath);
		this.entries = entries;
		this.byId = new Map(entries.map((entry) => [entry.id, entry]));
		this.labelsById = buildLabelsById(entries);
		this.currentLeafId = leafId;
	}

	static async open(filePath: string): Promise<JsonlSessionStorage> {
		const resolvedPath = resolve(filePath);
		const loaded = await loadJsonlStorage(resolvedPath);
		return new JsonlSessionStorage(resolvedPath, loaded.header, loaded.entries, loaded.leafId);
	}

	static async create(
		filePath: string,
		options: {
			cwd: string;
			sessionId: string;
			parentSessionPath?: string;
		},
	): Promise<JsonlSessionStorage> {
		const resolvedPath = resolve(filePath);
		const header: SessionHeader = {
			type: "session",
			version: 3,
			id: options.sessionId,
			timestamp: new Date().toISOString(),
			cwd: options.cwd,
			parentSession: options.parentSessionPath,
		};
		await mkdir(dirname(resolvedPath), { recursive: true });
		await writeFile(resolvedPath, `${JSON.stringify(header)}\n`);
		return new JsonlSessionStorage(resolvedPath, header, [], null);
	}

	async getMetadata(): Promise<JsonlSessionMetadata> {
		return this.metadata;
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

	async createEntryId(): Promise<string> {
		return generateEntryId(this.byId);
	}

	async appendEntry(entry: SessionTreeEntry): Promise<void> {
		await appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
		this.entries.push(entry);
		this.byId.set(entry.id, entry);
		updateLabelCache(this.labelsById, entry);
		this.currentLeafId = entry.id;
	}

	async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
		return this.byId.get(id);
	}

	async findEntries<TType extends SessionTreeEntry["type"]>(
		type: TType,
	): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
		return this.entries.filter((entry): entry is Extract<SessionTreeEntry, { type: TType }> => entry.type === type);
	}

	async getLabel(id: string): Promise<string | undefined> {
		return this.labelsById.get(id);
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
