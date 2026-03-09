import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthCredentialStore, AuthStorage, type OAuthCredential } from "../src/auth-storage";

function createCredential(args: { suffix: string; accountId: string; email: string }): OAuthCredential {
	return {
		type: "oauth",
		access: `access-${args.suffix}`,
		refresh: `refresh-${args.suffix}`,
		expires: Date.now() + 60_000,
		accountId: args.accountId,
		email: args.email,
	};
}

function createCodexToken(args: { accountId: string; email: string }): string {
	const payload = {
		"https://api.openai.com/auth": { chatgpt_account_id: args.accountId },
		"https://api.openai.com/profile": { email: args.email },
	};
	const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.sig`;
}

function createJwtOnlyCredential(args: { suffix: string; accountId: string; email: string }): OAuthCredential {
	return {
		type: "oauth",
		access: createCodexToken({ accountId: args.accountId, email: args.email }),
		refresh: `refresh-${args.suffix}`,
		expires: Date.now() + 60_000,
		accountId: args.accountId,
	};
}

function countCredentialRows(dbPath: string, provider: string): number {
	const db = new Database(dbPath, { readonly: true });
	try {
		const row = db.prepare("SELECT COUNT(*) AS count FROM auth_credentials WHERE provider = ?").get(provider) as
			| { count?: number }
			| undefined;
		return row?.count ?? 0;
	} finally {
		db.close();
	}
}

function readDisabledCauses(dbPath: string, provider: string): string[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		const rows = db
			.prepare(
				"SELECT disabled_cause FROM auth_credentials WHERE provider = ? AND disabled_cause IS NOT NULL ORDER BY id ASC",
			)
			.all(provider) as Array<{ disabled_cause?: string | null }>;
		return rows.flatMap(row => (typeof row.disabled_cause === "string" ? [row.disabled_cause] : []));
	} finally {
		db.close();
	}
}

function readStoredIdentityRows(
	dbPath: string,
	provider: string,
): Array<{ identity_key: string | null; disabled_cause: string | null }> {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.prepare("SELECT identity_key, disabled_cause FROM auth_credentials WHERE provider = ? ORDER BY id ASC")
			.all(provider) as Array<{ identity_key: string | null; disabled_cause: string | null }>;
	} finally {
		db.close();
	}
}

function readAuthSchemaVersion(dbPath: string): number | null {
	const db = new Database(dbPath, { readonly: true });
	try {
		const row = db.prepare("SELECT version FROM auth_schema_version WHERE id = 1").get() as
			| { version?: number }
			| undefined;
		return typeof row?.version === "number" ? row.version : null;
	} finally {
		db.close();
	}
}

describe("AuthStorage openai-codex email dedupe", () => {
	let tempDir = "";
	let dbPath = "";
	let store: AuthCredentialStore | null = null;
	let authStorage: AuthStorage | null = null;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-auth-email-dedupe-"));
		dbPath = path.join(tempDir, "agent.db");
		store = await AuthCredentialStore.open(dbPath);
		authStorage = new AuthStorage(store);
	});

	afterEach(async () => {
		store?.close();
		store = null;
		authStorage = null;
		dbPath = "";
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
			tempDir = "";
		}
	});

	it("keeps both openai-codex credentials when accountId matches but emails differ", async () => {
		if (!authStorage || !store || !dbPath) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			createCredential({ suffix: "first", accountId: "shared-team", email: "first.user@example.com" }),
			createCredential({ suffix: "second", accountId: "shared-team", email: "second.user@example.com" }),
		]);

		const credentials = store.listAuthCredentials("openai-codex");
		expect(credentials).toHaveLength(2);
		expect(readDisabledCauses(dbPath, "openai-codex")).toEqual([]);
	});

	it("dedupes openai-codex credentials when email matches but accountId differs", async () => {
		if (!authStorage || !store) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			createCredential({ suffix: "first", accountId: "account-a", email: "shared.user@example.com" }),
			createCredential({ suffix: "second", accountId: "account-b", email: "shared.user@example.com" }),
		]);

		const credentials = store.listAuthCredentials("openai-codex");
		expect(credentials).toHaveLength(1);
		const [remaining] = credentials;
		expect(remaining?.credential.type).toBe("oauth");
		if (!remaining || remaining.credential.type !== "oauth") throw new Error("expected oauth credential");
		expect(remaining.credential.accountId).toBe("account-b");
		expect(remaining.credential.email).toBe("shared.user@example.com");
	});

	it("dedupes openai-codex credentials when matching email exists only in JWT profile claim but accountId differs", async () => {
		if (!authStorage || !store) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			createJwtOnlyCredential({ suffix: "first", accountId: "account-a", email: "shared.user@example.com" }),
			createJwtOnlyCredential({ suffix: "second", accountId: "account-b", email: "shared.user@example.com" }),
		]);

		const credentials = store.listAuthCredentials("openai-codex");
		expect(credentials).toHaveLength(1);
		const [remaining] = credentials;
		expect(remaining?.credential.type).toBe("oauth");
		if (!remaining || remaining.credential.type !== "oauth") throw new Error("expected oauth credential");
		expect(remaining.credential.accountId).toBe("account-b");
	});

	it("soft-disables a different codex account when the email matches", async () => {
		if (!store || !dbPath) throw new Error("test setup failed");

		store.replaceAuthCredentialsForProvider("openai-codex", [
			createJwtOnlyCredential({ suffix: "first", accountId: "account-a", email: "shared.user@example.com" }),
		]);
		store.replaceAuthCredentialsForProvider("openai-codex", [
			createJwtOnlyCredential({ suffix: "second", accountId: "account-b", email: "shared.user@example.com" }),
		]);

		expect(countCredentialRows(dbPath, "openai-codex")).toBe(2);
		const credentials = store.listAuthCredentials("openai-codex");
		expect(credentials).toHaveLength(1);
		expect(readDisabledCauses(dbPath, "openai-codex")).toEqual(["replaced by newer credential"]);
	});

	it("hard deletes disabled codex rows once a replacement for the same email becomes active", async () => {
		if (!authStorage || !store || !dbPath) throw new Error("test setup failed");

		await authStorage.set(
			"openai-codex",
			createCredential({ suffix: "first", accountId: "account-a", email: "shared.user@example.com" }),
		);
		await authStorage.set(
			"openai-codex",
			createCredential({ suffix: "second", accountId: "account-b", email: "shared.user@example.com" }),
		);

		expect(countCredentialRows(dbPath, "openai-codex")).toBe(2);
		const credentials = store.listAuthCredentials("openai-codex");
		expect(credentials).toHaveLength(1);
		const [remaining] = credentials;
		expect(remaining?.credential.type).toBe("oauth");
		if (!remaining || remaining.credential.type !== "oauth") throw new Error("expected oauth credential");
		expect(remaining.credential.accountId).toBe("account-b");
		expect(remaining.credential.email).toBe("shared.user@example.com");
		expect(readDisabledCauses(dbPath, "openai-codex")).toEqual(["replaced by newer credential"]);
	});

	it("prunes existing JWT-only codex duplicates on reload when email matches", async () => {
		if (!store) throw new Error("test setup failed");

		store.replaceAuthCredentialsForProvider("openai-codex", [
			createJwtOnlyCredential({ suffix: "first", accountId: "account-a", email: "shared.user@example.com" }),
			createJwtOnlyCredential({ suffix: "second", accountId: "account-b", email: "shared.user@example.com" }),
		]);

		const reloaded = new AuthStorage(store);
		await reloaded.reload();

		const credentials = store.listAuthCredentials("openai-codex");
		expect(credentials).toHaveLength(1);
		const [remaining] = credentials;
		expect(remaining?.credential.type).toBe("oauth");
		if (!remaining || remaining.credential.type !== "oauth") throw new Error("expected oauth credential");
		expect(remaining.credential.accountId).toBe("account-b");
	});

	it("dedupes openai-codex credentials after reload when email matches even if accountId differs", async () => {
		if (!store) throw new Error("test setup failed");

		store.replaceAuthCredentialsForProvider("openai-codex", [
			createCredential({ suffix: "first", accountId: "account-a", email: "shared.user@example.com" }),
			createCredential({ suffix: "second", accountId: "account-b", email: "shared.user@example.com" }),
		]);

		const reloaded = new AuthStorage(store);
		await reloaded.reload();

		const credentials = store.listAuthCredentials("openai-codex");
		expect(credentials).toHaveLength(1);
		const [remaining] = credentials;
		expect(remaining?.credential.type).toBe("oauth");
		if (!remaining || remaining.credential.type !== "oauth") throw new Error("expected oauth credential");
		expect(remaining.credential.accountId).toBe("account-b");
		expect(remaining.credential.email).toBe("shared.user@example.com");
	});

	describe("AuthStorage anthropic email identity", () => {
		it("keeps both anthropic credentials when accountId matches but emails differ", async () => {
			if (!authStorage || !store || !dbPath) throw new Error("test setup failed");

			await authStorage.set("anthropic", [
				createCredential({ suffix: "first", accountId: "shared-org", email: "first.user@example.com" }),
				createCredential({ suffix: "second", accountId: "shared-org", email: "second.user@example.com" }),
			]);

			const credentials = store.listAuthCredentials("anthropic");
			expect(credentials).toHaveLength(2);
			expect(readDisabledCauses(dbPath, "anthropic")).toEqual([]);
		});

		it("dedupes anthropic credentials when email matches but accountId differs", async () => {
			if (!authStorage || !store) throw new Error("test setup failed");

			await authStorage.set("anthropic", [
				createCredential({ suffix: "first", accountId: "org-a", email: "shared.user@example.com" }),
				createCredential({ suffix: "second", accountId: "org-b", email: "shared.user@example.com" }),
			]);

			const credentials = store.listAuthCredentials("anthropic");
			expect(credentials).toHaveLength(1);
			const [remaining] = credentials;
			expect(remaining?.credential.type).toBe("oauth");
			if (!remaining || remaining.credential.type !== "oauth") throw new Error("expected oauth credential");
			expect(remaining.credential.accountId).toBe("org-b");
			expect(remaining.credential.email).toBe("shared.user@example.com");
		});

		it("backfills anthropic identity_key from email when migrating v1 auth schema", async () => {
			if (!tempDir) throw new Error("test setup failed");

			const legacyDbPath = path.join(tempDir, "legacy-v1-anthropic-agent.db");
			const legacyDb = new Database(legacyDbPath);
			legacyDb.exec(`
				CREATE TABLE auth_schema_version (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					version INTEGER NOT NULL
				);
				INSERT INTO auth_schema_version(id, version) VALUES (1, 1);
				CREATE TABLE auth_credentials (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					provider TEXT NOT NULL,
					credential_type TEXT NOT NULL,
					data TEXT NOT NULL,
					disabled_cause TEXT DEFAULT NULL,
					created_at INTEGER NOT NULL DEFAULT (unixepoch()),
					updated_at INTEGER NOT NULL DEFAULT (unixepoch())
				);
			`);
			legacyDb
				.prepare(
					"INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause) VALUES (?, ?, ?, ?)",
				)
				.run(
					"anthropic",
					"oauth",
					JSON.stringify(
						createCredential({
							suffix: "legacy-v1-anthropic",
							accountId: "legacy-org",
							email: "legacy-anthropic@example.com",
						}),
					),
					null,
				);
			legacyDb.close();

			const migratedStore = await AuthCredentialStore.open(legacyDbPath);
			try {
				expect(readStoredIdentityRows(legacyDbPath, "anthropic")).toEqual([
					{ identity_key: "email:legacy-anthropic@example.com", disabled_cause: null },
				]);
			} finally {
				migratedStore.close();
			}
		});
	});
	it("stores the disable cause when a credential is soft-disabled", async () => {
		if (!store || !dbPath) throw new Error("test setup failed");

		store.replaceAuthCredentialsForProvider("openai-codex", [
			createCredential({ suffix: "only", accountId: "account-a", email: "only@example.com" }),
		]);

		const [credential] = store.listAuthCredentials("openai-codex");
		if (!credential) throw new Error("expected stored credential");

		const disabledCause = "oauth refresh failed: invalid_grant";
		store.deleteAuthCredential(credential.id, disabledCause);

		expect(store.listAuthCredentials("openai-codex")).toHaveLength(0);
		expect(readDisabledCauses(dbPath, "openai-codex")).toEqual([disabledCause]);
	});

	it("preserves newer auth schema versions instead of downgrading them", async () => {
		if (!tempDir) throw new Error("test setup failed");

		const futureDbPath = path.join(tempDir, "future-schema-agent.db");
		const futureDb = new Database(futureDbPath);
		futureDb.exec(`
			CREATE TABLE auth_schema_version (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				version INTEGER NOT NULL
			);
			INSERT INTO auth_schema_version(id, version) VALUES (1, 4);
			CREATE TABLE auth_credentials (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				provider TEXT NOT NULL,
				credential_type TEXT NOT NULL,
				data TEXT NOT NULL,
				disabled_cause TEXT DEFAULT NULL,
				identity_key TEXT DEFAULT NULL,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				updated_at INTEGER NOT NULL DEFAULT (unixepoch())
			);
		`);
		futureDb.close();

		const reopenedStore = await AuthCredentialStore.open(futureDbPath);
		try {
			expect(readAuthSchemaVersion(futureDbPath)).toBe(4);
		} finally {
			reopenedStore.close();
		}
	});

	it("backfills identity_key when migrating v1 auth schema", async () => {
		if (!tempDir) throw new Error("test setup failed");

		const legacyDbPath = path.join(tempDir, "legacy-v1-agent.db");
		const legacyDb = new Database(legacyDbPath);
		legacyDb.exec(`
			CREATE TABLE auth_schema_version (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				version INTEGER NOT NULL
			);
			INSERT INTO auth_schema_version(id, version) VALUES (1, 1);
			CREATE TABLE auth_credentials (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				provider TEXT NOT NULL,
				credential_type TEXT NOT NULL,
				data TEXT NOT NULL,
				disabled_cause TEXT DEFAULT NULL,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				updated_at INTEGER NOT NULL DEFAULT (unixepoch())
			);
		`);
		legacyDb
			.prepare("INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause) VALUES (?, ?, ?, ?)")
			.run(
				"openai-codex",
				"oauth",
				JSON.stringify(
					createCredential({
						suffix: "legacy-v1",
						accountId: "legacy-v1-account",
						email: "legacy-v1@example.com",
					}),
				),
				null,
			);
		legacyDb.close();

		const migratedStore = await AuthCredentialStore.open(legacyDbPath);
		try {
			expect(readStoredIdentityRows(legacyDbPath, "openai-codex")).toEqual([
				{ identity_key: "email:legacy-v1@example.com", disabled_cause: null },
			]);
		} finally {
			migratedStore.close();
		}
	});

	it("backfills disabled cause and identity_key when migrating legacy disabled rows", async () => {
		if (!tempDir) throw new Error("test setup failed");

		const legacyDbPath = path.join(tempDir, "legacy-agent.db");
		const legacyDb = new Database(legacyDbPath);
		legacyDb.exec(`
			CREATE TABLE auth_credentials (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				provider TEXT NOT NULL,
				credential_type TEXT NOT NULL,
				data TEXT NOT NULL,
				disabled INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				updated_at INTEGER NOT NULL DEFAULT (unixepoch())
			);
		`);
		legacyDb
			.prepare("INSERT INTO auth_credentials (provider, credential_type, data, disabled) VALUES (?, ?, ?, ?)")
			.run(
				"openai-codex",
				"oauth",
				JSON.stringify(
					createCredential({ suffix: "legacy", accountId: "legacy-account", email: "legacy@example.com" }),
				),
				1,
			);
		legacyDb.close();

		const migratedStore = await AuthCredentialStore.open(legacyDbPath);
		try {
			expect(migratedStore.listAuthCredentials("openai-codex")).toHaveLength(0);
			expect(readStoredIdentityRows(legacyDbPath, "openai-codex")).toEqual([
				{ identity_key: "email:legacy@example.com", disabled_cause: "disabled" },
			]);
		} finally {
			migratedStore.close();
		}
	});
});
