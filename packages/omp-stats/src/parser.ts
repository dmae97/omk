import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type { MessageStats, SessionEntry, SessionMessageEntry } from "./types";

const SESSIONS_DIR = join(homedir(), ".omp", "agent", "sessions");

/**
 * Extract folder name from session filename.
 * Session files are named like: --work--pi--/timestamp_uuid.jsonl
 * The folder part uses -- as path separator.
 */
function extractFolderFromPath(sessionPath: string): string {
	const dir = basename(sessionPath.replace(/\/[^/]+\.jsonl$/, ""));
	// Convert --work--pi-- to /work/pi
	return dir.replace(/^--/, "/").replace(/--/g, "/");
}

/**
 * Parse a single JSONL line into a session entry.
 */
function parseLine(line: string): SessionEntry | null {
	const trimmed = line.trim();
	if (!trimmed) return null;

	try {
		return JSON.parse(trimmed) as SessionEntry;
	} catch {
		return null;
	}
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
		if (currentOffset >= fromOffset && line.trim()) {
			const entry = parseLine(line);
			if (entry && isAssistantMessage(entry)) {
				const msgStats = extractStats(sessionPath, folder, entry);
				if (msgStats) {
					stats.push(msgStats);
				}
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
		const entries = await readdir(SESSIONS_DIR, { withFileTypes: true });
		return entries.filter((e) => e.isDirectory()).map((e) => join(SESSIONS_DIR, e.name));
	} catch {
		return [];
	}
}

/**
 * List all session files in a folder.
 */
export async function listSessionFiles(folderPath: string): Promise<string[]> {
	try {
		const entries = await readdir(folderPath, { withFileTypes: true });
		return entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => join(folderPath, e.name));
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
 * Get session directory path.
 */
export function getSessionsDir(): string {
	return SESSIONS_DIR;
}
