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
		if (!authStorage || !store) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			createCredential({ suffix: "first", accountId: "shared-team", email: "first.user@example.com" }),
			createCredential({ suffix: "second", accountId: "shared-team", email: "second.user@example.com" }),
		]);

		const credentials = store.listAuthCredentials("openai-codex");
		expect(credentials).toHaveLength(2);
	});

	it("dedupes openai-codex credentials when email matches", async () => {
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
		expect(remaining.credential.email).toBe("shared.user@example.com");
		expect(remaining.credential.accountId).toBe("account-b");
	});

	it("dedupes openai-codex credentials when matching email exists only in JWT profile claim", async () => {
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

	it("hard deletes disabled codex rows once a replacement with the same email becomes active", async () => {
		if (!authStorage || !store || !dbPath) throw new Error("test setup failed");

		await authStorage.set(
			"openai-codex",
			createJwtOnlyCredential({ suffix: "first", accountId: "account-a", email: "shared.user@example.com" }),
		);
		await authStorage.set(
			"openai-codex",
			createJwtOnlyCredential({ suffix: "second", accountId: "account-b", email: "shared.user@example.com" }),
		);

		expect(countCredentialRows(dbPath, "openai-codex")).toBe(1);
		const credentials = store.listAuthCredentials("openai-codex");
		expect(credentials).toHaveLength(1);
		const [remaining] = credentials;
		expect(remaining?.credential.type).toBe("oauth");
		if (!remaining || remaining.credential.type !== "oauth") throw new Error("expected oauth credential");
		expect(remaining.credential.accountId).toBe("account-b");
	});

	it("prunes existing JWT-only codex duplicates on reload", async () => {
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

	it("keeps both openai-codex credentials after reload when accountId matches but emails differ", async () => {
		if (!store) throw new Error("test setup failed");

		store.replaceAuthCredentialsForProvider("openai-codex", [
			createCredential({ suffix: "first", accountId: "shared-team", email: "first.user@example.com" }),
			createCredential({ suffix: "second", accountId: "shared-team", email: "second.user@example.com" }),
		]);

		const reloaded = new AuthStorage(store);
		await reloaded.reload();

		const credentials = store.listAuthCredentials("openai-codex");
		expect(credentials).toHaveLength(2);
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

	it("backfills a default disabled cause when migrating legacy disabled rows", async () => {
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
			expect(readDisabledCauses(legacyDbPath, "openai-codex")).toEqual(["disabled"]);
		} finally {
			migratedStore.close();
		}
	});
});
