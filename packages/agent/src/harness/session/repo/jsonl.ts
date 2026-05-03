import { constants } from "node:fs";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	JsonlSessionCreateOptions,
	JsonlSessionListOptions,
	JsonlSessionMetadata,
	JsonlSessionRepoApi,
	Session,
} from "../../types.js";
import { JsonlSessionStorage, loadJsonlSessionMetadata } from "../storage/jsonl.js";
import { createSessionId, createTimestamp, getEntriesToFork, toSession } from "./shared.js";

async function exists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function encodeCwd(cwd: string): string {
	return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export class JsonlSessionRepo implements JsonlSessionRepoApi {
	private sessionsRoot: string;

	constructor(options: { sessionsRoot: string }) {
		this.sessionsRoot = resolve(options.sessionsRoot);
	}

	private getSessionDir(cwd: string): string {
		return join(this.sessionsRoot, encodeCwd(cwd));
	}

	private createSessionFilePath(cwd: string, sessionId: string, timestamp: string): string {
		return join(this.getSessionDir(cwd), `${timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`);
	}

	async create(options: JsonlSessionCreateOptions): Promise<Session<JsonlSessionMetadata>> {
		await mkdir(this.sessionsRoot, { recursive: true });
		const id = options.id ?? createSessionId();
		const createdAt = createTimestamp();
		const filePath = this.createSessionFilePath(options.cwd, id, createdAt);
		const storage = await JsonlSessionStorage.create(filePath, {
			cwd: options.cwd,
			sessionId: id,
			parentSessionPath: options.parentSessionPath,
		});
		return toSession(storage);
	}

	async open(metadata: JsonlSessionMetadata): Promise<Session<JsonlSessionMetadata>> {
		if (!(await exists(metadata.path))) {
			throw new Error(`Session not found: ${metadata.path}`);
		}
		const storage = await JsonlSessionStorage.open(metadata.path);
		return toSession(storage);
	}

	async list(options: JsonlSessionListOptions = {}): Promise<JsonlSessionMetadata[]> {
		const dirs = options.cwd ? [this.getSessionDir(options.cwd)] : await this.listSessionDirs();
		const sessions: JsonlSessionMetadata[] = [];
		for (const dir of dirs) {
			if (!(await exists(dir))) continue;
			const files = (await readdir(dir)).filter((file) => file.endsWith(".jsonl")).map((file) => join(dir, file));
			for (const filePath of files) {
				try {
					sessions.push(await loadJsonlSessionMetadata(filePath));
				} catch {
					// Ignore invalid session files when listing a directory.
				}
			}
		}
		sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
		return sessions;
	}

	async delete(metadata: JsonlSessionMetadata): Promise<void> {
		await rm(metadata.path, { force: true });
	}

	async fork(
		sourceMetadata: JsonlSessionMetadata,
		options: JsonlSessionCreateOptions & { entryId?: string; position?: "before" | "at"; id?: string },
	): Promise<Session<JsonlSessionMetadata>> {
		const source = await this.open(sourceMetadata);
		const forkedEntries = await getEntriesToFork(source.getStorage(), options);
		const id = options.id ?? createSessionId();
		const createdAt = createTimestamp();
		const storage = await JsonlSessionStorage.create(this.createSessionFilePath(options.cwd, id, createdAt), {
			cwd: options.cwd,
			sessionId: id,
			parentSessionPath: options.parentSessionPath ?? sourceMetadata.path,
		});
		for (const entry of forkedEntries) {
			await storage.appendEntry(entry);
		}
		return toSession(storage);
	}

	private async listSessionDirs(): Promise<string[]> {
		if (!(await exists(this.sessionsRoot))) return [];
		const entries = await readdir(this.sessionsRoot, { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => join(this.sessionsRoot, entry.name));
	}
}
