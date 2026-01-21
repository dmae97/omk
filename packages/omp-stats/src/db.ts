import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AggregatedStats, FolderStats, MessageStats, ModelStats, TimeSeriesPoint } from "./types";

const DB_PATH = join(homedir(), ".omp", "stats.db");

let db: Database | null = null;

/**
 * Initialize the database and create tables.
 */
export async function initDb(): Promise<Database> {
	if (db) return db;

	// Ensure directory exists
	await mkdir(join(homedir(), ".omp"), { recursive: true });

	db = new Database(DB_PATH);
	db.exec("PRAGMA journal_mode = WAL");

	// Create tables
	db.exec(`
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_file TEXT NOT NULL,
			entry_id TEXT NOT NULL,
			folder TEXT NOT NULL,
			model TEXT NOT NULL,
			provider TEXT NOT NULL,
			api TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			duration INTEGER,
			ttft INTEGER,
			stop_reason TEXT NOT NULL,
			error_message TEXT,
			input_tokens INTEGER NOT NULL,
			output_tokens INTEGER NOT NULL,
			cache_read_tokens INTEGER NOT NULL,
			cache_write_tokens INTEGER NOT NULL,
			total_tokens INTEGER NOT NULL,
			cost_input REAL NOT NULL,
			cost_output REAL NOT NULL,
			cost_cache_read REAL NOT NULL,
			cost_cache_write REAL NOT NULL,
			cost_total REAL NOT NULL,
			UNIQUE(session_file, entry_id)
		);

		CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
		CREATE INDEX IF NOT EXISTS idx_messages_model ON messages(model);
		CREATE INDEX IF NOT EXISTS idx_messages_folder ON messages(folder);
		CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_file);

		CREATE TABLE IF NOT EXISTS file_offsets (
			session_file TEXT PRIMARY KEY,
			offset INTEGER NOT NULL,
			last_modified INTEGER NOT NULL
		);
	`);

	return db;
}

/**
 * Get the stored offset for a session file.
 */
export function getFileOffset(sessionFile: string): { offset: number; lastModified: number } | null {
	if (!db) return null;

	const stmt = db.prepare("SELECT offset, last_modified FROM file_offsets WHERE session_file = ?");
	const row = stmt.get(sessionFile) as { offset: number; last_modified: number } | undefined;

	return row ? { offset: row.offset, lastModified: row.last_modified } : null;
}

/**
 * Update the stored offset for a session file.
 */
export function setFileOffset(sessionFile: string, offset: number, lastModified: number): void {
	if (!db) return;

	const stmt = db.prepare(`
		INSERT OR REPLACE INTO file_offsets (session_file, offset, last_modified)
		VALUES (?, ?, ?)
	`);
	stmt.run(sessionFile, offset, lastModified);
}

/**
 * Insert message stats into the database.
 */
export function insertMessageStats(stats: MessageStats[]): number {
	if (!db || stats.length === 0) return 0;

	const stmt = db.prepare(`
		INSERT OR IGNORE INTO messages (
			session_file, entry_id, folder, model, provider, api, timestamp,
			duration, ttft, stop_reason, error_message,
			input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
			cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	let inserted = 0;
	const insert = db.transaction(() => {
		for (const s of stats) {
			const result = stmt.run(
				s.sessionFile,
				s.entryId,
				s.folder,
				s.model,
				s.provider,
				s.api,
				s.timestamp,
				s.duration,
				s.ttft,
				s.stopReason,
				s.errorMessage,
				s.usage.input,
				s.usage.output,
				s.usage.cacheRead,
				s.usage.cacheWrite,
				s.usage.totalTokens,
				s.usage.cost.input,
				s.usage.cost.output,
				s.usage.cost.cacheRead,
				s.usage.cost.cacheWrite,
				s.usage.cost.total,
			);
			if (result.changes > 0) inserted++;
		}
	});

	insert();
	return inserted;
}

/**
 * Build aggregated stats from query results.
 */
function buildAggregatedStats(rows: any[]): AggregatedStats {
	if (rows.length === 0) {
		return {
			totalRequests: 0,
			successfulRequests: 0,
			failedRequests: 0,
			errorRate: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCacheReadTokens: 0,
			totalCacheWriteTokens: 0,
			cacheRate: 0,
			totalCost: 0,
			avgDuration: null,
			avgTtft: null,
			avgTokensPerSecond: null,
			firstTimestamp: 0,
			lastTimestamp: 0,
		};
	}

	const row = rows[0];
	const totalRequests = row.total_requests || 0;
	const failedRequests = row.failed_requests || 0;
	const successfulRequests = totalRequests - failedRequests;
	const totalInputTokens = row.total_input_tokens || 0;
	const totalCacheReadTokens = row.total_cache_read_tokens || 0;

	return {
		totalRequests,
		successfulRequests,
		failedRequests,
		errorRate: totalRequests > 0 ? failedRequests / totalRequests : 0,
		totalInputTokens,
		totalOutputTokens: row.total_output_tokens || 0,
		totalCacheReadTokens,
		totalCacheWriteTokens: row.total_cache_write_tokens || 0,
		cacheRate:
			totalInputTokens + totalCacheReadTokens > 0
				? totalCacheReadTokens / (totalInputTokens + totalCacheReadTokens)
				: 0,
		totalCost: row.total_cost || 0,
		avgDuration: row.avg_duration,
		avgTtft: row.avg_ttft,
		avgTokensPerSecond: row.avg_tokens_per_second,
		firstTimestamp: row.first_timestamp || 0,
		lastTimestamp: row.last_timestamp || 0,
	};
}

/**
 * Get overall aggregated stats.
 */
export function getOverallStats(): AggregatedStats {
	if (!db) return buildAggregatedStats([]);

	const stmt = db.prepare(`
		SELECT
			COUNT(*) as total_requests,
			SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END) as failed_requests,
			SUM(input_tokens) as total_input_tokens,
			SUM(output_tokens) as total_output_tokens,
			SUM(cache_read_tokens) as total_cache_read_tokens,
			SUM(cache_write_tokens) as total_cache_write_tokens,
			SUM(cost_total) as total_cost,
			AVG(duration) as avg_duration,
			AVG(ttft) as avg_ttft,
			AVG(CASE WHEN duration > 0 THEN output_tokens * 1000.0 / duration ELSE NULL END) as avg_tokens_per_second,
			MIN(timestamp) as first_timestamp,
			MAX(timestamp) as last_timestamp
		FROM messages
	`);

	const rows = stmt.all();
	return buildAggregatedStats(rows);
}

/**
 * Get stats grouped by model.
 */
export function getStatsByModel(): ModelStats[] {
	if (!db) return [];

	const stmt = db.prepare(`
		SELECT
			model,
			provider,
			COUNT(*) as total_requests,
			SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END) as failed_requests,
			SUM(input_tokens) as total_input_tokens,
			SUM(output_tokens) as total_output_tokens,
			SUM(cache_read_tokens) as total_cache_read_tokens,
			SUM(cache_write_tokens) as total_cache_write_tokens,
			SUM(cost_total) as total_cost,
			AVG(duration) as avg_duration,
			AVG(ttft) as avg_ttft,
			AVG(CASE WHEN duration > 0 THEN output_tokens * 1000.0 / duration ELSE NULL END) as avg_tokens_per_second,
			MIN(timestamp) as first_timestamp,
			MAX(timestamp) as last_timestamp
		FROM messages
		GROUP BY model, provider
		ORDER BY total_requests DESC
	`);

	const rows = stmt.all() as any[];
	return rows.map((row) => ({
		model: row.model,
		provider: row.provider,
		...buildAggregatedStats([row]),
	}));
}

/**
 * Get stats grouped by folder.
 */
export function getStatsByFolder(): FolderStats[] {
	if (!db) return [];

	const stmt = db.prepare(`
		SELECT
			folder,
			COUNT(*) as total_requests,
			SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END) as failed_requests,
			SUM(input_tokens) as total_input_tokens,
			SUM(output_tokens) as total_output_tokens,
			SUM(cache_read_tokens) as total_cache_read_tokens,
			SUM(cache_write_tokens) as total_cache_write_tokens,
			SUM(cost_total) as total_cost,
			AVG(duration) as avg_duration,
			AVG(ttft) as avg_ttft,
			AVG(CASE WHEN duration > 0 THEN output_tokens * 1000.0 / duration ELSE NULL END) as avg_tokens_per_second,
			MIN(timestamp) as first_timestamp,
			MAX(timestamp) as last_timestamp
		FROM messages
		GROUP BY folder
		ORDER BY total_requests DESC
	`);

	const rows = stmt.all() as any[];
	return rows.map((row) => ({
		folder: row.folder,
		...buildAggregatedStats([row]),
	}));
}

/**
 * Get hourly time series data.
 */
export function getTimeSeries(hours = 24): TimeSeriesPoint[] {
	if (!db) return [];

	const cutoff = Date.now() - hours * 60 * 60 * 1000;

	const stmt = db.prepare(`
		SELECT
			(timestamp / 3600000) * 3600000 as bucket,
			COUNT(*) as requests,
			SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END) as errors,
			SUM(total_tokens) as tokens,
			SUM(cost_total) as cost
		FROM messages
		WHERE timestamp >= ?
		GROUP BY bucket
		ORDER BY bucket ASC
	`);

	const rows = stmt.all(cutoff) as any[];
	return rows.map((row) => ({
		timestamp: row.bucket,
		requests: row.requests,
		errors: row.errors,
		tokens: row.tokens,
		cost: row.cost,
	}));
}

/**
 * Get total message count.
 */
export function getMessageCount(): number {
	if (!db) return 0;
	const stmt = db.prepare("SELECT COUNT(*) as count FROM messages");
	const row = stmt.get() as { count: number };
	return row.count;
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}
