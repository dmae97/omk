/**
 * Migrates legacy JSON storage (settings.json, auth.json) to SQLite-based agent.db.
 * Settings migrate only when the DB has no settings; auth merges per-provider when missing.
 * Original JSON files are backed up to .bak and removed after successful migration.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { getAgentDbPath } from "$c/config";
import type { Settings } from "$c/config/settings-manager";
import { AgentStorage } from "./agent-storage";
import type { AuthCredential, AuthCredentialEntry, AuthStorageData } from "./auth-storage";

/** Paths configuration for the storage migration process. */
type MigrationPaths = {
	/** Directory containing agent.db */
	agentDir: string;
	/** Path to legacy settings.json file */
	settingsPath: string;
	/** Candidate paths to search for auth.json (checked in order) */
	authPaths: string[];
};

/** Result of the JSON-to-SQLite storage migration. */
export interface StorageMigrationResult {
	/** Whether settings.json was migrated to agent.db */
	migratedSettings: boolean;
	/** Whether auth.json was migrated to agent.db */
	migratedAuth: boolean;
	/** Non-fatal issues encountered during migration */
	warnings: string[];
}

/**
 * Type guard for plain objects.
 * @param value - Value to check
 * @returns True if value is a non-null, non-array object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Transforms legacy settings to current schema (e.g., queueMode -> steeringMode).
 * @param settings - Settings object potentially containing deprecated keys
 * @returns Settings with deprecated keys renamed to current equivalents
 */
function migrateLegacySettings(settings: Settings): Settings {
	const migrated = { ...settings } as Record<string, unknown>;
	if ("queueMode" in migrated && !("steeringMode" in migrated)) {
		migrated.steeringMode = migrated.queueMode;
		delete migrated.queueMode;
	}
	return migrated as Settings;
}

/**
 * Normalizes credential entries to array format (legacy stored single credentials).
 * @param entry - Single credential or array of credentials
 * @returns Array of credentials (empty if entry is undefined)
 */
function normalizeCredentialEntry(entry: AuthCredentialEntry | undefined): AuthCredential[] {
	if (!entry) return [];
	return Array.isArray(entry) ? entry : [entry];
}

/**
 * Reads and parses a JSON file.
 * @param path - Path to the JSON file
 * @returns Parsed JSON content, or null if file doesn't exist or parsing fails
 */
async function readJsonFile<T>(path: string): Promise<T | null> {
	try {
		const file = Bun.file(path);
		if (!(await file.exists())) return null;
		const content = await file.text();
		return JSON.parse(content) as T;
	} catch (error) {
		logger.warn("Storage migration failed to read JSON", { path, error: String(error) });
		return null;
	}
}

/**
 * Backs up a JSON file to .bak and removes the original.
 * Prevents re-migration on subsequent runs.
 * @param path - Path to the JSON file to backup
 */
async function backupJson(path: string): Promise<void> {
	const file = Bun.file(path);
	if (!(await file.exists())) return;

	const backupPath = `${path}.bak`;
	try {
		const content = await file.arrayBuffer();
		await Bun.write(backupPath, content);
		await file.unlink();
	} catch (error) {
		logger.warn("Storage migration failed to backup JSON", { path, error: String(error) });
	}
}

/**
 * Migrates settings.json to SQLite storage if DB is empty.
 * @param storage - AgentStorage instance to migrate into
 * @param settingsPath - Path to legacy settings.json
 * @param warnings - Array to collect non-fatal warnings
 * @returns True if migration was performed
 */
async function migrateSettings(storage: AgentStorage, settingsPath: string, warnings: string[]): Promise<boolean> {
	const settingsFile = Bun.file(settingsPath);
	const settingsExists = await settingsFile.exists();
	const hasDbSettings = storage.getSettings() !== null;

	if (!settingsExists) return false;
	if (hasDbSettings) {
		warnings.push(`settings.json exists but agent.db is authoritative: ${settingsPath}`);
		return false;
	}

	const settingsJson = await readJsonFile<Settings>(settingsPath);
	if (!settingsJson) return false;

	storage.saveSettings(migrateLegacySettings(settingsJson));
	await backupJson(settingsPath);
	return true;
}

/**
 * Finds the first valid auth.json from candidate paths (checked in priority order).
 * @param authPaths - Candidate paths to search (e.g., project-local before global)
 * @returns First valid auth file with its path and parsed data, or null if none found
 */
async function findFirstAuthJson(authPaths: string[]): Promise<{ path: string; data: AuthStorageData } | null> {
	for (const authPath of authPaths) {
		const data = await readJsonFile<AuthStorageData>(authPath);
		if (data && isRecord(data)) {
			return { path: authPath, data };
		}
	}
	return null;
}

/**
 * Validates that a credential has a recognized type.
 * @param entry - Credential to validate
 * @returns True if credential type is api_key or oauth
 */
function isValidCredential(entry: AuthCredential): boolean {
	return entry.type === "api_key" || entry.type === "oauth";
}

/**
 * Migrates auth.json to SQLite storage for providers missing in agent.db.
 * @param storage - AgentStorage instance to migrate into
 * @param authPaths - Candidate paths to search for auth.json
 * @param warnings - Array to collect non-fatal warnings
 * @returns True if migration was performed
 */
async function migrateAuth(storage: AgentStorage, authPaths: string[], warnings: string[]): Promise<boolean> {
	const authJson = await findFirstAuthJson(authPaths);
	if (!authJson) return false;

	let sawValid = false;
	let migratedAny = false;

	for (const [provider, entry] of Object.entries(authJson.data)) {
		const credentials = normalizeCredentialEntry(entry)
			.filter(isValidCredential)
			.map((credential) => credential);

		if (credentials.length === 0) continue;
		sawValid = true;

		if (storage.listAuthCredentials(provider).length > 0) {
			continue;
		}

		storage.replaceAuthCredentialsForProvider(provider, credentials);
		migratedAny = true;
	}

	if (sawValid) {
		await backupJson(authJson.path);
	}

	if (!migratedAny && sawValid) {
		warnings.push(`auth.json entries already present in agent.db: ${authJson.path}`);
	}

	return migratedAny;
}

/**
 * Migrates legacy JSON files (settings.json, auth.json) to SQLite-based agent.db.
 * Settings migrate only when the DB has no settings; auth merges per-provider when missing.
 * @param paths - Configuration specifying locations of legacy files and target DB
 * @returns Result indicating what was migrated and any warnings encountered
 */
export async function migrateJsonStorage(paths: MigrationPaths): Promise<StorageMigrationResult> {
	const storage = AgentStorage.open(getAgentDbPath(paths.agentDir));
	const warnings: string[] = [];

	const [migratedSettings, migratedAuth] = await Promise.all([
		migrateSettings(storage, paths.settingsPath, warnings),
		migrateAuth(storage, paths.authPaths, warnings),
	]);

	if (warnings.length > 0) {
		for (const warning of warnings) {
			logger.warn("Storage migration warning", { warning });
		}
	}

	return { migratedSettings, migratedAuth, warnings };
}
