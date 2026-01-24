/**
 * Simple auth storage for CLI using SQLite.
 * Compatible with coding-agent's agent.db format.
 */

import { Database } from "bun:sqlite";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { OAuthCredentials } from "./utils/oauth/types";

type AuthCredential = { type: "api_key"; key: string } | ({ type: "oauth" } & OAuthCredentials);

type AuthRow = {
	id: number;
	provider: string;
	credential_type: string;
	data: string;
	created_at: number;
	updated_at: number;
};

/**
 * Get the agent config directory (e.g., ~/.omp/agent/)
 */
function getAgentDir(): string {
	const configDir = process.env.OMP_CODING_AGENT_DIR || path.join(os.homedir(), ".omp", "agent");
	return configDir;
}

/**
 * Get path to agent.db
 */
function getAgentDbPath(): string {
	return path.join(getAgentDir(), "agent.db");
}

function serializeCredential(credential: AuthCredential): { credentialType: string; data: string } | null {
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

function deserializeCredential(row: AuthRow): AuthCredential | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.data);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") {
		return null;
	}

	if (row.credential_type === "api_key") {
		const data = parsed as Record<string, unknown>;
		if (typeof data.key === "string") {
			return { type: "api_key", key: data.key };
		}
	}

	if (row.credential_type === "oauth") {
		return { type: "oauth", ...(parsed as Record<string, unknown>) } as AuthCredential;
	}

	return null;
}

/**
 * Simple storage class for CLI auth credentials.
 *
 * Use `CliAuthStorage.create()` to instantiate (async initialization).
 */
export class CliAuthStorage {
	private db: Database;
	private insertStmt: ReturnType<Database["prepare"]>;
	private listByProviderStmt: ReturnType<Database["prepare"]>;
	private listAllStmt: ReturnType<Database["prepare"]>;
	private deleteByProviderStmt: ReturnType<Database["prepare"]>;

	private constructor(db: Database) {
		this.db = db;
		this.initializeSchema();

		this.insertStmt = this.db.prepare(
			"INSERT INTO auth_credentials (provider, credential_type, data) VALUES (?, ?, ?) RETURNING id",
		);
		this.listByProviderStmt = this.db.prepare("SELECT * FROM auth_credentials WHERE provider = ?");
		this.listAllStmt = this.db.prepare("SELECT * FROM auth_credentials");
		this.deleteByProviderStmt = this.db.prepare("DELETE FROM auth_credentials WHERE provider = ?");
	}

	static async create(dbPath: string = getAgentDbPath()): Promise<CliAuthStorage> {
		const dir = path.dirname(dbPath);
		const dirExists = await fs
			.stat(dir)
			.then((s) => s.isDirectory())
			.catch(() => false);
		if (!dirExists) {
			await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		}

		const db = new Database(dbPath);
		try {
			await fs.chmod(dbPath, 0o600);
		} catch {
			// Ignore chmod failures (e.g., Windows)
		}

		return new CliAuthStorage(db);
	}

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
		`);
	}

	/**
	 * Save OAuth credentials for a provider (replaces existing).
	 */
	saveOAuth(provider: string, credentials: OAuthCredentials): void {
		const credential: AuthCredential = { type: "oauth", ...credentials };
		this.replaceForProvider(provider, credential);
	}

	/**
	 * Get OAuth credentials for a provider.
	 */
	getOAuth(provider: string): OAuthCredentials | null {
		const rows = this.listByProviderStmt.all(provider) as AuthRow[];
		for (const row of rows) {
			const credential = deserializeCredential(row);
			if (credential && credential.type === "oauth") {
				const { type: _type, ...oauth } = credential;
				return oauth as OAuthCredentials;
			}
		}
		return null;
	}

	/**
	 * List all providers with credentials.
	 */
	listProviders(): string[] {
		const rows = this.listAllStmt.all() as AuthRow[];
		const providers = new Set<string>();
		for (const row of rows) {
			providers.add(row.provider);
		}
		return Array.from(providers);
	}

	/**
	 * Delete all credentials for a provider.
	 */
	deleteProvider(provider: string): void {
		this.deleteByProviderStmt.run(provider);
	}

	/**
	 * Replace all credentials for a provider with a single credential.
	 */
	private replaceForProvider(provider: string, credential: AuthCredential): void {
		const serialized = serializeCredential(credential);
		if (!serialized) return;

		const replace = this.db.transaction(() => {
			this.deleteByProviderStmt.run(provider);
			this.insertStmt.run(provider, serialized.credentialType, serialized.data);
		});
		replace();
	}

	close(): void {
		this.db.close();
	}
}
