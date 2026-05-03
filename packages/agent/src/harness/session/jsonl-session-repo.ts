import { constants } from "node:fs";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	JsonlSessionCreateOptions,
	JsonlSessionListQuery,
	JsonlSessionMetadata,
	JsonlSessionRef,
	JsonlSessionRepoApi,
	JsonlSessionResolveOptions,
	Session,
} from "../types.js";
import { JsonlSessionStorage, loadJsonlSessionMetadata } from "./jsonl-session-storage.js";
import { createSessionId, createTimestamp, getPathEntriesToFork, toSession } from "./session-repo.js";

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

	private refPath(ref: JsonlSessionRef): string {
		return resolve(ref.path);
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

	async open(ref: JsonlSessionRef): Promise<Session<JsonlSessionMetadata>> {
		const filePath = this.refPath(ref);
		if (!(await exists(filePath))) {
			throw new Error(`Session not found: ${filePath}`);
		}
		const storage = await JsonlSessionStorage.open(filePath);
		return toSession(storage);
	}

	async list(query: JsonlSessionListQuery = {}): Promise<JsonlSessionMetadata[]> {
		const dirs = query.cwd ? [this.getSessionDir(query.cwd)] : await this.listSessionDirs();
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

	async resolve(ref: string, options: JsonlSessionResolveOptions = {}): Promise<JsonlSessionMetadata[]> {
		if (ref.includes("/") || ref.includes("\\") || ref.endsWith(".jsonl")) {
			try {
				return [await loadJsonlSessionMetadata(resolve(ref))];
			} catch {
				return [];
			}
		}

		const local = options.cwd
			? (await this.list({ cwd: options.cwd })).filter((session) => session.id.startsWith(ref))
			: [];
		if (local.length > 0 || !options.searchAll) return local;
		return (await this.list()).filter((session) => session.id.startsWith(ref));
	}

	async getMostRecent(query: JsonlSessionListQuery = {}): Promise<JsonlSessionMetadata | undefined> {
		return (await this.list(query))[0];
	}

	async delete(ref: JsonlSessionRef): Promise<void> {
		const filePath = this.refPath(ref);
		await rm(filePath, { force: true });
	}

	async fork(
		ref: JsonlSessionRef,
		options: JsonlSessionCreateOptions & { entryId: string; position?: "before" | "at"; id?: string },
	): Promise<Session<JsonlSessionMetadata>> {
		const source = await this.open(ref);
		const forkedEntries = await getPathEntriesToFork(
			source.getStorage(),
			options.entryId,
			options.position ?? "before",
		);
		const sourceInfo = await source.getMetadata();
		const id = options.id ?? createSessionId();
		const createdAt = createTimestamp();
		const storage = await JsonlSessionStorage.create(this.createSessionFilePath(options.cwd, id, createdAt), {
			cwd: options.cwd,
			sessionId: id,
			parentSessionPath: options.parentSessionPath ?? sourceInfo.path,
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
