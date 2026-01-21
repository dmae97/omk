import { stat } from "node:fs/promises";
import {
	getFileOffset,
	getMessageCount,
	getOverallStats,
	getStatsByFolder,
	getStatsByModel,
	getTimeSeries,
	initDb,
	insertMessageStats,
	setFileOffset,
} from "./db";
import { listAllSessionFiles, parseSessionFile } from "./parser";
import type { DashboardStats } from "./types";

/**
 * Sync a single session file to the database.
 * Only processes new entries since the last sync.
 */
async function syncSessionFile(sessionFile: string): Promise<number> {
	// Get file stats
	let fileStats: Awaited<ReturnType<typeof stat>>;
	try {
		fileStats = await stat(sessionFile);
	} catch {
		return 0;
	}

	const lastModified = fileStats.mtimeMs;

	// Check if file has changed since last sync
	const stored = getFileOffset(sessionFile);
	if (stored && stored.lastModified >= lastModified) {
		return 0; // File hasn't changed
	}

	// Parse file from last offset
	const fromOffset = stored?.offset ?? 0;
	const { stats, newOffset } = await parseSessionFile(sessionFile, fromOffset);

	if (stats.length > 0) {
		insertMessageStats(stats);
	}

	// Update offset tracker
	setFileOffset(sessionFile, newOffset, lastModified);

	return stats.length;
}

/**
 * Sync all session files to the database.
 * Returns the number of new entries processed.
 */
export async function syncAllSessions(): Promise<{ processed: number; files: number }> {
	await initDb();

	const files = await listAllSessionFiles();
	let totalProcessed = 0;
	let filesProcessed = 0;

	for (const file of files) {
		const count = await syncSessionFile(file);
		if (count > 0) {
			totalProcessed += count;
			filesProcessed++;
		}
	}

	return { processed: totalProcessed, files: filesProcessed };
}

/**
 * Get all dashboard stats.
 */
export async function getDashboardStats(): Promise<DashboardStats> {
	await initDb();

	return {
		overall: getOverallStats(),
		byModel: getStatsByModel(),
		byFolder: getStatsByFolder(),
		timeSeries: getTimeSeries(24),
	};
}

/**
 * Get the current message count in the database.
 */
export async function getTotalMessageCount(): Promise<number> {
	await initDb();
	return getMessageCount();
}
