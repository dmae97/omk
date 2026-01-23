import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { getAgentDir } from "$c/config";

export interface HistoryEntry {
	id: number;
	prompt: string;
	created_at: number;
	cwd?: string;
}

type Statement = ReturnType<Database["prepare"]>;

type HistoryRow = {
	id: number;
	prompt: string;
	created_at: number;
	cwd: string | null;
};

export class HistoryStorage {
	private db: Database;
	private static instance?: HistoryStorage;

	// Prepared statements
	private insertStmt: Statement;
	private recentStmt: Statement;
	private searchStmt: Statement;
	private lastPromptStmt: Statement;

	// In-memory cache of last prompt to avoid sync DB reads on add
	private lastPromptCache: string | null = null;

	private constructor(dbPath: string) {
		this.ensureDir(dbPath);

		this.db = new Database(dbPath);

		const hasFts = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='history_fts'").get();

		this.db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	prompt TEXT NOT NULL,
	created_at INTEGER NOT NULL DEFAULT (unixepoch()),
	cwd TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(prompt, content='history', content_rowid='id');

CREATE TRIGGER IF NOT EXISTS history_ai AFTER INSERT ON history BEGIN
	INSERT INTO history_fts(rowid, prompt) VALUES (new.id, new.prompt);
END;
`);

		if (!hasFts) {
			try {
				this.db.run("INSERT INTO history_fts(history_fts) VALUES('rebuild')");
			} catch (error) {
				logger.warn("HistoryStorage FTS rebuild failed", { error: String(error) });
			}
		}

		this.insertStmt = this.db.prepare("INSERT INTO history (prompt, cwd) VALUES (?, ?)");
		this.recentStmt = this.db.prepare(
			"SELECT id, prompt, created_at, cwd FROM history ORDER BY created_at DESC, id DESC LIMIT ?",
		);
		this.searchStmt = this.db.prepare(
			"SELECT h.id, h.prompt, h.created_at, h.cwd FROM history_fts f JOIN history h ON h.id = f.rowid WHERE history_fts MATCH ? ORDER BY h.created_at DESC, h.id DESC LIMIT ?",
		);
		this.lastPromptStmt = this.db.prepare("SELECT prompt FROM history ORDER BY id DESC LIMIT 1");

		const last = this.lastPromptStmt.get() as { prompt?: string } | undefined;
		this.lastPromptCache = last?.prompt ?? null;
	}

	static open(dbPath: string = join(getAgentDir(), "history.db")): HistoryStorage {
		if (!HistoryStorage.instance) {
			HistoryStorage.instance = new HistoryStorage(dbPath);
		}
		return HistoryStorage.instance;
	}

	add(prompt: string, cwd?: string): void {
		const trimmed = prompt.trim();
		if (!trimmed) return;
		if (this.lastPromptCache === trimmed) return;

		this.lastPromptCache = trimmed;

		setImmediate(() => {
			try {
				this.insertStmt.run(trimmed, cwd ?? null);
			} catch (error) {
				logger.error("HistoryStorage add failed", { error: String(error) });
			}
		});
	}

	getRecent(limit: number): HistoryEntry[] {
		const safeLimit = this.normalizeLimit(limit);
		if (safeLimit === 0) return [];

		try {
			const rows = this.recentStmt.all(safeLimit) as HistoryRow[];
			return rows.map((row) => this.toEntry(row));
		} catch (error) {
			logger.error("HistoryStorage getRecent failed", { error: String(error) });
			return [];
		}
	}

	search(query: string, limit: number): HistoryEntry[] {
		const safeLimit = this.normalizeLimit(limit);
		if (safeLimit === 0) return [];

		const ftsQuery = this.buildFtsQuery(query);
		if (!ftsQuery) return [];

		try {
			const rows = this.searchStmt.all(ftsQuery, safeLimit) as HistoryRow[];
			return rows.map((row) => this.toEntry(row));
		} catch (error) {
			logger.error("HistoryStorage search failed", { error: String(error) });
			return [];
		}
	}

	private ensureDir(dbPath: string): void {
		const dir = dirname(dbPath);
		mkdirSync(dir, { recursive: true });
	}

	private normalizeLimit(limit: number): number {
		if (!Number.isFinite(limit)) return 0;
		const clamped = Math.max(0, Math.floor(limit));
		return Math.min(clamped, 1000);
	}

	private buildFtsQuery(query: string): string | null {
		const tokens = query
			.trim()
			.split(/\s+/)
			.map((token) => token.trim())
			.filter(Boolean);

		if (tokens.length === 0) return null;

		return tokens
			.map((token) => {
				const escaped = token.replace(/"/g, '""');
				return `"${escaped}"*`;
			})
			.join(" ");
	}

	private toEntry(row: HistoryRow): HistoryEntry {
		return {
			id: row.id,
			prompt: row.prompt,
			created_at: row.created_at,
			cwd: row.cwd ?? undefined,
		};
	}
}
