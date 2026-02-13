import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { getSessionsDir } from "@oh-my-pi/pi-utils/dirs";
import type { MessageStats, SessionEntry, SessionMessageEntry } from "./types";

/**
 * Extract folder name from session filename.
 * Session files are named like: --work--pi--/timestamp_uuid.jsonl
 * The folder part uses -- as path separator.
 */
function extractFolderFromPath(sessionPath: string): string {
	const dir = path.basename(sessionPath.replace(/\/[^/]+\.jsonl$/, ""));
	// Convert --work--pi-- to /work/pi
	return dir.replace(/^--/, "/").replace(/--/g, "/");
}

/**
 * Check if an entry is an assistant message.
 */
function isAssistantMessage(entry: SessionEntry): entry is SessionMessageEntry {
	if (entry.type !== "message") return false;
	const msgEntry = entry as SessionMessageEntry;
	return msgEntry.message?.role === "assistant";
}

/**
 * Extract stats from an assistant message entry.
 */
function extractStats(sessionFile: string, folder: string, entry: SessionMessageEntry): MessageStats | null {
	const msg = entry.message as AssistantMessage;
	if (!msg || msg.role !== "assistant") return null;

	return {
		sessionFile,
		entryId: entry.id,
		folder,
		model: msg.model,
		provider: msg.provider,
		api: msg.api,
		timestamp: msg.timestamp,
		duration: msg.duration ?? null,
		ttft: msg.ttft ?? null,
		stopReason: msg.stopReason,
		errorMessage: msg.errorMessage ?? null,
		usage: msg.usage,
	};
}

/**
 * Parse a session file and extract all assistant message stats.
 * Uses incremental reading with offset tracking.
 */
export async function parseSessionFile(
	sessionPath: string,
	fromOffset = 0,
): Promise<{ stats: MessageStats[]; newOffset: number }> {
	const file = Bun.file(sessionPath);
	const exists = await file.exists();
	if (!exists) {
		return { stats: [], newOffset: fromOffset };
	}

	const text = await file.text();
	const lines = text.split("\n");
	const folder = extractFolderFromPath(sessionPath);
	const stats: MessageStats[] = [];

	let currentOffset = 0;
	for (const line of lines) {
		const lineLength = line.length + 1; // +1 for newline
		if (line.trim()) {
			try {
				const entry = JSON.parse(line) as SessionEntry;
				if (currentOffset >= fromOffset && entry && isAssistantMessage(entry)) {
					const msgStats = extractStats(sessionPath, folder, entry);
					if (msgStats) {
						stats.push(msgStats);
					}
				}
			} catch {
				// Skip malformed JSONL lines
			}
		}
		currentOffset += lineLength;
	}

	return { stats, newOffset: currentOffset };
}

/**
 * List all session directories (folders).
 */
export async function listSessionFolders(): Promise<string[]> {
	try {
		const sessionsDir = getSessionsDir();
		const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
		return entries.filter(e => e.isDirectory()).map(e => path.join(sessionsDir, e.name));
	} catch {
		return [];
	}
}

/**
 * List all session files in a folder.
 */
export async function listSessionFiles(folderPath: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(folderPath, { withFileTypes: true });
		return entries.filter(e => e.isFile() && e.name.endsWith(".jsonl")).map(e => path.join(folderPath, e.name));
	} catch {
		return [];
	}
}

/**
 * List all session files across all folders.
 */
export async function listAllSessionFiles(): Promise<string[]> {
	const folders = await listSessionFolders();
	const allFiles: string[] = [];

	for (const folder of folders) {
		const files = await listSessionFiles(folder);
		allFiles.push(...files);
	}

	return allFiles;
}

/**
 * Find a specific entry in a session file.
 */
export async function getSessionEntry(sessionPath: string, entryId: string): Promise<SessionEntry | null> {
	const file = Bun.file(sessionPath);
	if (!(await file.exists())) return null;

	const text = await file.bytes();
	const entries = Bun.JSONL.parse(text) as SessionEntry[];

	for (const entry of entries) {
		if ("id" in entry && entry.id === entryId) {
			return entry;
		}
	}
	return null;
}
