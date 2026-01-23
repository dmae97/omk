import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { getAgentDbPath } from "$c/config";
import type { Settings } from "$c/config/settings-manager";
import type { AuthCredential } from "./auth-storage";

/** Prepared SQLite statement type from bun:sqlite */
type Statement = ReturnType<Database["prepare"]>;

/** Row shape for settings table queries */
type SettingsRow = {
	key: string;
	value: string;
};

/** Row shape for auth_credentials table queries */
type AuthRow = {
	id: number;
	provider: string;
	credential_type: string;
	data: string;
};

/**
 * Auth credential with database row ID for updates/deletes.
 * Wraps AuthCredential with storage metadata.
 */
export interface StoredAuthCredential {
	id: number;
	provider: string;
	credential: AuthCredential;
}

/** Bump when schema changes require migration */
const SCHEMA_VERSION = 2;

/**
 * Type guard for plain objects.
 * @param value - Value to check
 * @returns True if value is a non-null, non-array object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Converts credential to DB format, stripping the type discriminant from the data blob.
 * @param credential - The credential to serialize
 * @returns Object with credentialType and JSON data string, or null for unknown types
 */
function serializeCredential(
	credential: AuthCredential,
): { credentialType: AuthCredential["type"]; data: string } | null {
	if (credential.type === "api_key") {
		return {
			credentialType: "api_key",
			data: JSON.stringify({ key: credential.key }),
		};
	}
	if (credential.type === "oauth") {
		const { type: _type, ...rest } = credential;
		return {
			credentialType: "oauth",
			data: JSON.stringify(rest),
		};
	}
	return null;
}

/**
 * Reconstructs credential from DB row, re-adding the type discriminant.
 * @param row - Database row containing credential data
 * @returns Reconstructed AuthCredential, or null if parsing fails or type is unknown
 */
function deserializeCredential(row: AuthRow): AuthCredential | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.data);
	} catch (error) {
		logger.warn("AgentStorage failed to parse auth credential", {
			provider: row.provider,
			id: row.id,
			error: String(error),
		});
		return null;
	}
	if (!isRecord(parsed)) {
		logger.warn("AgentStorage auth credential data invalid", {
			provider: row.provider,
			id: row.id,
		});
		return null;
	}
	if (row.credential_type === "api_key") {
		return { type: "api_key", ...(parsed as Record<string, unknown>) } as AuthCredential;
	}
	if (row.credential_type === "oauth") {
		return { type: "oauth", ...(parsed as Record<string, unknown>) } as AuthCredential;
	}
	logger.warn("AgentStorage unknown credential type", {
		provider: row.provider,
		id: row.id,
		type: row.credential_type,
	});
	return null;
}

/**
 * Unified SQLite storage for agent settings and auth credentials.
 * Uses singleton pattern per database path; access via AgentStorage.open().
 */
export class AgentStorage {
	private db: Database;
	private static instances = new Map<string, AgentStorage>();

	private listSettingsStmt: Statement;
	private getCacheStmt: Statement;
	private upsertCacheStmt: Statement;
	private deleteExpiredCacheStmt: Statement;
	private listAuthStmt: Statement;
	private listAuthByProviderStmt: Statement;
	private insertAuthStmt: Statement;
	private updateAuthStmt: Statement;
	private deleteAuthStmt: Statement;
	private deleteAuthByProviderStmt: Statement;
	private countAuthStmt: Statement;

	private constructor(dbPath: string) {
		this.ensureDir(dbPath);
		this.db = new Database(dbPath);

		this.initializeSchema();
		this.hardenPermissions(dbPath);

		this.listSettingsStmt = this.db.prepare("SELECT key, value FROM settings");

		this.getCacheStmt = this.db.prepare("SELECT value FROM cache WHERE key = ? AND expires_at > unixepoch()");
		this.upsertCacheStmt = this.db.prepare(
			"INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
		);
		this.deleteExpiredCacheStmt = this.db.prepare("DELETE FROM cache WHERE expires_at <= unixepoch()");

		this.listAuthStmt = this.db.prepare(
			"SELECT id, provider, credential_type, data FROM auth_credentials ORDER BY id ASC",
		);
		this.listAuthByProviderStmt = this.db.prepare(
			"SELECT id, provider, credential_type, data FROM auth_credentials WHERE provider = ? ORDER BY id ASC",
		);
		this.insertAuthStmt = this.db.prepare(
			"INSERT INTO auth_credentials (provider, credential_type, data) VALUES (?, ?, ?) RETURNING id",
		);
		this.updateAuthStmt = this.db.prepare(
			"UPDATE auth_credentials SET credential_type = ?, data = ?, updated_at = unixepoch() WHERE id = ?",
		);
		this.deleteAuthStmt = this.db.prepare("DELETE FROM auth_credentials WHERE id = ?");
		this.deleteAuthByProviderStmt = this.db.prepare("DELETE FROM auth_credentials WHERE provider = ?");
		this.countAuthStmt = this.db.prepare("SELECT COUNT(*) as count FROM auth_credentials");
	}

	/**
	 * Creates tables if missing and migrates legacy single-blob settings to key-value format.
	 * Handles v1 to v2 schema migration for settings table.
	 */
	private initializeSchema(): void {
		this.db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS auth_credentials (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	provider TEXT NOT NULL,
	credential_type TEXT NOT NULL,
	data TEXT NOT NULL,
	created_at INTEGER NOT NULL DEFAULT (unixepoch()),
	updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_auth_provider ON auth_credentials(provider);

CREATE TABLE IF NOT EXISTS cache (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
`);

		const settingsInfo = this.db.prepare("PRAGMA table_info(settings)").all() as Array<{ name?: string }>;
		const hasSettingsTable = settingsInfo.length > 0;
		const hasKey = settingsInfo.some((column) => column.name === "key");
		const hasValue = settingsInfo.some((column) => column.name === "value");

		if (!hasSettingsTable) {
			this.db.exec(`
CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);
		} else if (!hasKey || !hasValue) {
			// Migrate v1 schema: single JSON blob in `data` column → per-key rows
			let legacySettings: Record<string, unknown> | null = null;
			const row = this.db.prepare("SELECT data FROM settings WHERE id = 1").get() as { data?: string } | undefined;
			if (row?.data) {
				try {
					const parsed = JSON.parse(row.data);
					if (isRecord(parsed)) {
						legacySettings = parsed;
					} else {
						logger.warn("AgentStorage legacy settings invalid shape");
					}
				} catch (error) {
					logger.warn("AgentStorage failed to parse legacy settings", { error: String(error) });
				}
			}

			const migrate = this.db.transaction((settings: Record<string, unknown> | null) => {
				this.db.exec("DROP TABLE settings");
				this.db.exec(`
CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);
				if (settings) {
					const insert = this.db.prepare(
						"INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())",
					);
					for (const [key, value] of Object.entries(settings)) {
						if (value === undefined) continue;
						const serialized = JSON.stringify(value);
						if (serialized === undefined) continue;
						insert.run(key, serialized);
					}
				}
			});

			migrate(legacySettings);
		}

		const versionRow = this.db.prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get() as
			| { version?: number }
			| undefined;
		if (versionRow?.version !== undefined && versionRow.version !== SCHEMA_VERSION) {
			logger.warn("AgentStorage schema version mismatch", {
				current: versionRow.version,
				expected: SCHEMA_VERSION,
			});
		}
		this.db.prepare("INSERT OR REPLACE INTO schema_version(version) VALUES (?)").run(SCHEMA_VERSION);
	}

	/**
	 * Returns singleton instance for the given database path, creating if needed.
	 * @param dbPath - Path to the SQLite database file (defaults to config path)
	 * @returns AgentStorage instance for the given path
	 */
	static open(dbPath: string = getAgentDbPath()): AgentStorage {
		const existing = AgentStorage.instances.get(dbPath);
		if (existing) return existing;
		const storage = new AgentStorage(dbPath);
		AgentStorage.instances.set(dbPath, storage);
		return storage;
	}

	/**
	 * Retrieves all settings from storage (legacy, for migration only).
	 * Settings are now stored in config.yml. This method is only used
	 * during migration from agent.db to config.yml.
	 * @returns Settings object, or null if no settings are stored
	 * @deprecated Use config.yml instead. This is only for migration.
	 */
	getSettings(): Settings | null {
		const rows = (this.listSettingsStmt.all() as SettingsRow[]) ?? [];
		if (rows.length === 0) return null;
		const settings: Record<string, unknown> = {};
		for (const row of rows) {
			try {
				settings[row.key] = JSON.parse(row.value) as unknown;
			} catch (error) {
				logger.warn("AgentStorage failed to parse setting", {
					key: row.key,
					error: String(error),
				});
			}
		}
		return settings as Settings;
	}

	/**
	 * @deprecated Settings are now stored in config.yml, not agent.db.
	 * This method is kept for backward compatibility but does nothing.
	 */
	saveSettings(settings: Settings): void {
		logger.warn("AgentStorage.saveSettings is deprecated - settings are now stored in config.yml", {
			keys: Object.keys(settings),
		});
	}

	/**
	 * Gets a cached value by key. Returns null if not found or expired.
	 */
	getCache(key: string): string | null {
		try {
			const row = this.getCacheStmt.get(key) as { value?: string } | undefined;
			return row?.value ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Sets a cached value with expiry time (unix seconds).
	 */
	setCache(key: string, value: string, expiresAtSec: number): void {
		try {
			this.upsertCacheStmt.run(key, value, expiresAtSec);
		} catch (error) {
			logger.warn("AgentStorage failed to set cache", { key, error: String(error) });
		}
	}

	/**
	 * Deletes expired cache entries. Call periodically for cleanup.
	 */
	cleanExpiredCache(): void {
		try {
			this.deleteExpiredCacheStmt.run();
		} catch {
			// Ignore cleanup errors
		}
	}

	/**
	 * Checks if any auth credentials exist in storage.
	 * @returns True if at least one credential is stored
	 */
	hasAuthCredentials(): boolean {
		const row = this.countAuthStmt.get() as { count?: number } | undefined;
		return (row?.count ?? 0) > 0;
	}

	/**
	 * Lists auth credentials, optionally filtered by provider.
	 * @param provider - Optional provider name to filter by
	 * @returns Array of stored credentials with their database IDs
	 */
	listAuthCredentials(provider?: string): StoredAuthCredential[] {
		const rows =
			(provider
				? (this.listAuthByProviderStmt.all(provider) as AuthRow[])
				: (this.listAuthStmt.all() as AuthRow[])) ?? [];

		const results: StoredAuthCredential[] = [];
		for (const row of rows) {
			const credential = deserializeCredential(row);
			if (!credential) continue;
			results.push({ id: row.id, provider: row.provider, credential });
		}
		return results;
	}

	/**
	 * Atomically replaces all credentials for a provider.
	 * Useful for OAuth token refresh where old tokens should be discarded.
	 * @param provider - Provider name (e.g., "anthropic", "openai")
	 * @param credentials - New credentials to store
	 * @returns Array of newly stored credentials with their database IDs
	 */
	replaceAuthCredentialsForProvider(provider: string, credentials: AuthCredential[]): StoredAuthCredential[] {
		const replace = this.db.transaction((providerName: string, items: AuthCredential[]) => {
			this.deleteAuthByProviderStmt.run(providerName);
			const inserted: StoredAuthCredential[] = [];
			for (const credential of items) {
				const record = this.insertAuthCredential(providerName, credential);
				if (record) inserted.push(record);
			}
			return inserted;
		});

		return replace(provider, credentials);
	}

	/**
	 * Updates an existing auth credential by ID.
	 * @param id - Database row ID of the credential to update
	 * @param credential - New credential data
	 */
	updateAuthCredential(id: number, credential: AuthCredential): void {
		const serialized = serializeCredential(credential);
		if (!serialized) {
			logger.warn("AgentStorage updateAuthCredential invalid type", { id, type: credential.type });
			return;
		}
		try {
			this.updateAuthStmt.run(serialized.credentialType, serialized.data, id);
		} catch (error) {
			logger.warn("AgentStorage updateAuthCredential failed", { id, error: String(error) });
		}
	}

	/**
	 * Deletes an auth credential by ID.
	 * @param id - Database row ID of the credential to delete
	 */
	deleteAuthCredential(id: number): void {
		try {
			this.deleteAuthStmt.run(id);
		} catch (error) {
			logger.warn("AgentStorage deleteAuthCredential failed", { id, error: String(error) });
		}
	}

	/**
	 * Deletes all auth credentials for a provider.
	 * @param provider - Provider name whose credentials should be deleted
	 */
	deleteAuthCredentialsForProvider(provider: string): void {
		try {
			this.deleteAuthByProviderStmt.run(provider);
		} catch (error) {
			logger.warn("AgentStorage deleteAuthCredentialsForProvider failed", {
				provider,
				error: String(error),
			});
		}
	}

	/**
	 * Inserts a new auth credential for a provider.
	 * @param provider - Provider name (e.g., "anthropic", "openai")
	 * @param credential - Credential to insert
	 * @returns Stored credential with database ID, or null on failure
	 */
	private insertAuthCredential(provider: string, credential: AuthCredential): StoredAuthCredential | null {
		const serialized = serializeCredential(credential);
		if (!serialized) {
			logger.warn("AgentStorage insertAuthCredential invalid type", { provider, type: credential.type });
			return null;
		}
		try {
			const row = this.insertAuthStmt.get(provider, serialized.credentialType, serialized.data) as
				| { id?: number }
				| undefined;
			if (!row?.id) {
				logger.warn("AgentStorage insertAuthCredential missing id", { provider });
				return null;
			}
			return { id: row.id, provider, credential };
		} catch (error) {
			logger.warn("AgentStorage insertAuthCredential failed", { provider, error: String(error) });
			return null;
		}
	}

	/**
	 * Ensures the parent directory for the database file exists.
	 * @param dbPath - Path to the database file
	 */
	private ensureDir(dbPath: string): void {
		mkdirSync(dirname(dbPath), { recursive: true });
	}

	private hardenPermissions(dbPath: string): void {
		const dir = dirname(dbPath);
		try {
			chmodSync(dir, 0o700);
		} catch (error) {
			logger.warn("AgentStorage failed to chmod agent dir", { path: dir, error: String(error) });
		}

		if (!existsSync(dbPath)) return;
		try {
			chmodSync(dbPath, 0o600);
		} catch (error) {
			logger.warn("AgentStorage failed to chmod db file", { path: dbPath, error: String(error) });
		}
	}
}
