/**
 * Credential storage for API keys and OAuth tokens.
 * Handles loading, saving, and refreshing credentials from auth.json.
 *
 * Uses file locking to prevent race conditions when multiple OMK instances
 * try to refresh tokens simultaneously.
 */

import {
	findEnvKeys,
	getEnvApiKey,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
	type OAuthProviderId,
	type OAuthProviderInterface,
} from "omk-ai";
import { getOAuthApiKey, getOAuthProvider, getOAuthProviders } from "omk-ai/oauth";
import { join } from "path";
import { getAgentDir } from "../config.ts";
import {
	type AuthStorageBackend,
	FileAuthStorageBackend,
	InMemoryAuthStorageBackend,
	type LockResult,
} from "./auth-storage-backend.ts";
import {
	findMatchingOAuthAccount,
	findOAuthAccountMatch,
	getOAuthAccountDisplayLabel,
	mergeImportedCredential,
	type OAuthAccountImport,
	type OAuthAccountSummary,
	previewOAuthAccountImport,
} from "./oauth-account-import.ts";
import {
	createOAuthCredential,
	getOAuthAccounts,
	getSelectedOAuthAccountIndex,
	type OAuthCredential,
} from "./oauth-credential.ts";
import { resolveConfigValue } from "./resolve-config-value.ts";

const RETIRED_GROK_OAUTH_PROXY = "grok-oauth-proxy";

function omitRetiredGrokOAuthProxy(data: AuthStorageData): AuthStorageData {
	if (!(RETIRED_GROK_OAUTH_PROXY in data)) return data;
	const { [RETIRED_GROK_OAUTH_PROXY]: _retired, ...kept } = data;
	return kept;
}

export type ApiKeyCredential = {
	type: "api_key";
	key: string;
};

export type { OAuthAccountImport, OAuthAccountSummary } from "./oauth-account-import.ts";
export type { OAuthCredential } from "./oauth-credential.ts";

export type AuthCredential = ApiKeyCredential | OAuthCredential;

export type AuthStorageData = Record<string, AuthCredential>;

export type AuthStatus = {
	configured: boolean;
	source?: "stored" | "runtime" | "environment" | "fallback" | "models_json_key" | "models_json_command";
	label?: string;
};

export { type AuthStorageBackend, FileAuthStorageBackend, InMemoryAuthStorageBackend } from "./auth-storage-backend.ts";

/** Mirrors the cases in which `resolveAccountToken` goes to the network. */
function oauthAccountNeedsRefresh(
	provider: OAuthProviderInterface,
	account: OAuthCredentials,
	minRemainingMs: number,
	rejectedApiKey: string | undefined,
): boolean {
	// wall-clock: account.expires is a persisted absolute expiry
	if (Date.now() + minRemainingMs >= account.expires) return true;
	return rejectedApiKey !== undefined && provider.getApiKey(account) === rejectedApiKey;
}

/**
 * Credential storage backed by a JSON file.
 */
export class AuthStorage {
	private data: AuthStorageData = {};
	private runtimeOverrides: Map<string, string> = new Map();
	private fallbackResolver?: (provider: string) => string | undefined;
	private loadError: Error | null = null;
	private errors: Error[] = [];
	private storage: AuthStorageBackend;

	private constructor(storage: AuthStorageBackend) {
		this.storage = storage;
		this.reload();
	}

	static create(authPath?: string): AuthStorage {
		return new AuthStorage(new FileAuthStorageBackend(authPath ?? join(getAgentDir(), "auth.json")));
	}

	static fromStorage(storage: AuthStorageBackend): AuthStorage {
		return new AuthStorage(storage);
	}

	static inMemory(data: AuthStorageData = {}): AuthStorage {
		const storage = new InMemoryAuthStorageBackend();
		storage.withLock(() => ({ result: undefined, next: JSON.stringify(data, null, 2) }));
		return AuthStorage.fromStorage(storage);
	}

	/**
	 * Set a runtime API key override (not persisted to disk).
	 * Used for CLI --api-key flag.
	 */
	setRuntimeApiKey(provider: string, apiKey: string): void {
		this.runtimeOverrides.set(provider, apiKey);
	}

	/**
	 * Remove a runtime API key override.
	 */
	removeRuntimeApiKey(provider: string): void {
		this.runtimeOverrides.delete(provider);
	}

	/**
	 * Set a fallback resolver for API keys not found in auth.json or env vars.
	 * Used for custom provider keys from models.json.
	 */
	setFallbackResolver(resolver: (provider: string) => string | undefined): void {
		this.fallbackResolver = resolver;
	}

	private recordError(error: unknown): void {
		const normalizedError = error instanceof Error ? error : new Error(String(error));
		this.errors.push(normalizedError);
	}

	private parseStorageData(content: string | undefined): AuthStorageData {
		if (!content) {
			return {};
		}
		try {
			return omitRetiredGrokOAuthProxy(JSON.parse(content) as AuthStorageData);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to parse auth storage: ${message}`);
		}
	}

	/**
	 * Reload credentials from storage.
	 */
	reload(): void {
		let content: string | undefined;
		try {
			this.storage.withLock((current) => {
				content = current;
				return { result: undefined };
			});
			this.data = this.parseStorageData(content);
			this.loadError = null;
		} catch (error) {
			this.loadError = error as Error;
			this.recordError(error);
		}
	}

	private persistProviderChange(provider: string, credential: AuthCredential | undefined): void {
		if (this.loadError) {
			return;
		}

		try {
			this.storage.withLock((current) => {
				const currentData = this.parseStorageData(current);
				const merged: AuthStorageData = { ...currentData };
				if (provider === RETIRED_GROK_OAUTH_PROXY) {
					delete merged[provider];
				} else if (credential) {
					merged[provider] = credential;
				} else {
					delete merged[provider];
				}
				return { result: undefined, next: JSON.stringify(merged, null, 2) };
			});
		} catch (error) {
			this.recordError(error);
		}
	}

	/**
	 * Get credential for a provider.
	 */
	get(provider: string): AuthCredential | undefined {
		if (provider === RETIRED_GROK_OAUTH_PROXY) return undefined;
		return this.data[provider] ?? undefined;
	}

	/**
	 * Set credential for a provider.
	 */
	set(provider: string, credential: AuthCredential): void {
		if (provider === RETIRED_GROK_OAUTH_PROXY) {
			delete this.data[provider];
			this.persistProviderChange(provider, undefined);
			return;
		}
		this.data[provider] = credential;
		this.persistProviderChange(provider, credential);
	}

	/**
	 * Remove credential for a provider.
	 */
	remove(provider: string): void {
		delete this.data[provider];
		this.persistProviderChange(provider, undefined);
	}

	/**
	 * List all providers with credentials.
	 */
	list(): string[] {
		return Object.keys(this.data).filter((provider) => provider !== RETIRED_GROK_OAUTH_PROXY);
	}

	/**
	 * Check if credentials exist for a provider in auth.json.
	 */
	has(provider: string): boolean {
		if (provider === RETIRED_GROK_OAUTH_PROXY) return false;
		return provider in this.data;
	}

	/**
	 * Check if any form of auth is configured for a provider.
	 * Unlike getApiKey(), this doesn't refresh OAuth tokens.
	 */
	hasAuth(provider: string): boolean {
		if (provider === RETIRED_GROK_OAUTH_PROXY) return false;
		if (this.runtimeOverrides.has(provider)) return true;
		if (this.data[provider]) return true;
		if (getEnvApiKey(provider)) return true;
		if (this.fallbackResolver?.(provider)) return true;
		return false;
	}

	/** Return the number of stored OAuth accounts for a provider. */
	getOAuthAccountCount(provider: string): number {
		const credential = this.data[provider];
		return credential?.type === "oauth" ? getOAuthAccounts(credential).length : 0;
	}

	/** Return safe, human-readable labels for every stored OAuth account. */
	listOAuthAccounts(provider: string): OAuthAccountSummary[] {
		const credential = this.data[provider];
		if (credential?.type !== "oauth") return [];
		const accounts = getOAuthAccounts(credential);
		const selectedIndex = getSelectedOAuthAccountIndex(credential, accounts.length);
		return accounts.map((account, index) => ({
			index,
			label: getOAuthAccountDisplayLabel(provider, account) ?? `Account ${index + 1}`,
			selected: index === selectedIndex,
		}));
	}

	/** Return the human-readable label of the selected OAuth account. */
	getOAuthAccountLabel(provider: string): string | undefined {
		return this.listOAuthAccounts(provider).find((account) => account.selected)?.label;
	}

	/**
	 * Explicitly select and persist the OAuth account used by this provider.
	 */
	selectOAuthAccount(provider: string, accountIndex: number): void {
		this.storage.withLock((current) => {
			const currentData = this.parseStorageData(current);
			const credential = currentData[provider];
			if (credential?.type !== "oauth") {
				throw new Error(`No OAuth accounts configured for ${provider}`);
			}
			const accounts = [...getOAuthAccounts(credential)];
			if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex >= accounts.length) {
				throw new Error(`Invalid OAuth account index ${accountIndex} for ${provider}`);
			}
			const merged: AuthStorageData = {
				...currentData,
				[provider]: createOAuthCredential(accounts, accountIndex),
			};
			this.data = merged;
			this.loadError = null;
			return { result: undefined, next: JSON.stringify(merged, null, 2) };
		});
	}

	/** Match, merge and write inside the storage lock (`omk provider adopt`). The active selection never moves. */
	addOAuthAccount(provider: string, credentials: OAuthCredentials): OAuthAccountImport {
		if (this.loadError) {
			return { action: "blocked", reason: "the credential store could not be read" };
		}

		try {
			return this.storage.withLock<OAuthAccountImport>((current) => {
				const currentData = this.parseStorageData(current);
				const existing = currentData[provider];
				const accounts = existing?.type === "oauth" ? [...getOAuthAccounts(existing)] : [];
				const activeIndex =
					existing?.type === "oauth" ? getSelectedOAuthAccountIndex(existing, accounts.length) : 0;
				const matchIndex = findOAuthAccountMatch(accounts, credentials);

				if (matchIndex >= 0) {
					const current_ = accounts[matchIndex];
					// wall-clock: expires is a persisted absolute expiry shared with other sessions
					if (current_ && typeof current_.expires === "number" && current_.expires > Date.now()) {
						this.data = currentData;
						return {
							result: {
								action: "unchanged",
								accountIndex: matchIndex,
								reason: "the stored account is still valid",
							},
						};
					}
					accounts[matchIndex] = mergeImportedCredential(current_, credentials);
					const merged: AuthStorageData = {
						...currentData,
						[provider]: createOAuthCredential(accounts, accounts.length === 1 ? 0 : activeIndex),
					};
					this.data = merged;
					this.loadError = null;
					return {
						result: { action: "updated", accountIndex: matchIndex },
						next: JSON.stringify(merged, null, 2),
					};
				}

				accounts.push(credentials);
				const merged: AuthStorageData = {
					...currentData,
					[provider]: createOAuthCredential(accounts, accounts.length === 1 ? 0 : activeIndex),
				};
				this.data = merged;
				this.loadError = null;
				return {
					result: { action: "imported", accountIndex: accounts.length - 1 },
					next: JSON.stringify(merged, null, 2),
				};
			});
		} catch (error) {
			this.recordError(error);
			return {
				action: "blocked",
				reason: `the credential store could not be written: ${error instanceof Error ? error.message : error}`,
			};
		}
	}

	/** Predict what `addOAuthAccount` would do, without writing. */
	previewOAuthAccountImport(provider: string, credentials: OAuthCredentials): OAuthAccountImport {
		const existing = this.data[provider];
		return previewOAuthAccountImport({
			loadError: this.loadError !== null,
			existing,
			accounts: existing?.type === "oauth" ? getOAuthAccounts(existing) : [],
			credentials,
		});
	}

	/**
	 * Return the explicitly selected OAuth credentials without refreshing tokens.
	 * Used by provider model customization hooks.
	 */
	getOAuthCredentials(provider: string): OAuthCredentials | undefined {
		const credential = this.data[provider];
		if (credential?.type !== "oauth") {
			return undefined;
		}
		const accounts = getOAuthAccounts(credential);
		return accounts[getSelectedOAuthAccountIndex(credential, accounts.length)];
	}

	/**
	 * Return auth status without exposing credential values or refreshing tokens.
	 */
	getAuthStatus(provider: string): AuthStatus {
		if (provider === RETIRED_GROK_OAUTH_PROXY) {
			return { configured: false };
		}
		if (this.data[provider]) {
			return { configured: true, source: "stored" };
		}

		if (this.runtimeOverrides.has(provider)) {
			return { configured: false, source: "runtime", label: "--api-key" };
		}

		const envKeys = findEnvKeys(provider);
		if (envKeys?.[0]) {
			return { configured: false, source: "environment", label: envKeys[0] };
		}

		if (this.fallbackResolver?.(provider)) {
			return { configured: false, source: "fallback", label: "custom provider config" };
		}

		return { configured: false };
	}

	/**
	 * Get all credentials (for passing to getOAuthApiKey).
	 */
	getAll(): AuthStorageData {
		return omitRetiredGrokOAuthProxy({ ...this.data });
	}

	drainErrors(): Error[] {
		const drained = [...this.errors];
		this.errors = [];
		return drained;
	}

	/**
	 * True when the credential store could not be read (for example, lock contention with another
	 * session). Callers must not substitute a different credential source while this is set.
	 */
	hasLoadError(): boolean {
		return this.loadError !== null;
	}

	/**
	 * Login to an OAuth provider. Repeated logins append distinct accounts and
	 * update an existing account when the provider exposes a stable identity.
	 */
	async login(providerId: OAuthProviderId, callbacks: OAuthLoginCallbacks): Promise<void> {
		const provider = getOAuthProvider(providerId);
		if (!provider) {
			throw new Error(`Unknown OAuth provider: ${providerId}`);
		}

		const credentials = await provider.login(callbacks);
		if (this.loadError) {
			this.data[providerId] = { type: "oauth", ...credentials };
			return;
		}

		try {
			this.storage.withLock((current) => {
				const currentData = this.parseStorageData(current);
				const existing = currentData[providerId];
				let credential: OAuthCredential;

				if (existing?.type === "oauth") {
					const accounts = [...getOAuthAccounts(existing)];
					const matchingIndex = findMatchingOAuthAccount(accounts, credentials);
					let activeAccount: number;
					if (matchingIndex >= 0) {
						accounts[matchingIndex] = credentials;
						activeAccount = matchingIndex;
					} else {
						accounts.push(credentials);
						activeAccount = accounts.length - 1;
					}
					credential = createOAuthCredential(accounts, activeAccount);
				} else {
					credential = createOAuthCredential([credentials]);
				}

				const merged: AuthStorageData = { ...currentData, [providerId]: credential };
				this.data = merged;
				this.loadError = null;
				return { result: undefined, next: JSON.stringify(merged, null, 2) };
			});
		} catch (error) {
			this.recordError(error);
		}
	}

	/**
	 * Logout from a provider.
	 */
	logout(provider: string): void {
		this.remove(provider);
	}

	/**
	 * Resolve the explicitly selected account, refreshing it when it needs to be.
	 *
	 * The store lock is held only to read and to write. The refresh request runs under the
	 * provider's own refresh lock: sessions share one auth.json, and a refresh inside the store lock
	 * let one slow provider, or a dead login every session retried, keep all of them from reading
	 * credentials that were still valid.
	 *
	 * `minRemainingMs` lets a long operation demand headroom. An access token is
	 * resolved once and then reused for the whole request, so a token that is
	 * merely "not expired yet" can still expire mid-flight and come back as a
	 * provider 401. Callers that run for minutes (compaction) ask for a margin.
	 */
	private async resolveOAuthTokenWithLock(
		providerId: OAuthProviderId,
		minRemainingMs = 0,
		rejectedApiKey?: string,
	): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null> {
		const provider = getOAuthProvider(providerId);
		if (!provider) return null;

		const stored = await this.readSelectedOAuthAccount(providerId);
		if (!stored) return null;
		if (!oauthAccountNeedsRefresh(provider, stored, minRemainingMs, rejectedApiKey)) {
			return { apiKey: provider.getApiKey(stored), newCredentials: stored };
		}

		const refresh = async () => {
			// Another process may have refreshed while this one waited for the refresh lock;
			// resolveAccountToken re-checks the account as it is stored now.
			const account = await this.readSelectedOAuthAccount(providerId);
			if (!account) return null;
			const resolved = await this.resolveAccountToken(provider, providerId, account, minRemainingMs, rejectedApiKey);
			if (!resolved || resolved.newCredentials === account) return resolved;
			return this.storeRefreshedOAuthAccount(providerId, account, resolved);
		};
		return this.storage.withRefreshLock ? this.storage.withRefreshLock(providerId, refresh) : refresh();
	}

	/**
	 * Run a read-modify-write of the store without yielding while the lock is held.
	 *
	 * A session resolves its key at request start, right before it assembles the prompt. The async
	 * lock spans event-loop turns, so it stayed held for as long as that synchronous work ran and
	 * every other session waited. The synchronous lock is taken and released within one turn; the
	 * async one is the fallback for the instant another process holds it.
	 */
	private async withStoreLock<T>(fn: (current: string | undefined) => LockResult<T>): Promise<T> {
		try {
			return this.storage.withLock(fn);
		} catch (error) {
			if ((error as { code?: unknown } | null)?.code !== "ELOCKED") throw error;
			return this.storage.withLockAsync(async (current) => fn(current));
		}
	}

	/** Selected account as stored right now; refreshes the in-memory credential map. */
	private readSelectedOAuthAccount(providerId: OAuthProviderId): Promise<OAuthCredentials | undefined> {
		return this.withStoreLock((current) => {
			this.data = this.parseStorageData(current);
			this.loadError = null;
			return { result: this.getOAuthCredentials(providerId) };
		});
	}

	/**
	 * Write a refreshed account back. The store may have changed during the refresh: the account is
	 * found again by the refresh token that was spent, the stored selection is kept, and an account
	 * a newer login replaced is left alone.
	 */
	private storeRefreshedOAuthAccount(
		providerId: OAuthProviderId,
		refreshedFrom: OAuthCredentials,
		resolved: { apiKey: string; newCredentials: OAuthCredentials },
	): Promise<{ apiKey: string; newCredentials: OAuthCredentials }> {
		return this.withStoreLock((current) => {
			const currentData = this.parseStorageData(current);
			this.data = currentData;
			this.loadError = null;

			const newCredentials = { ...refreshedFrom, ...resolved.newCredentials };
			const result = { ...resolved, newCredentials };
			const credential = currentData[providerId];
			if (credential?.type !== "oauth") return { result };

			const accounts = [...getOAuthAccounts(credential)];
			const selected = getSelectedOAuthAccountIndex(credential, accounts.length);
			const accountIndex =
				accounts[selected]?.refresh === refreshedFrom.refresh
					? selected
					: accounts.findIndex((account) => account.refresh === refreshedFrom.refresh);
			if (accountIndex < 0) return { result };

			accounts[accountIndex] = newCredentials;
			const merged: AuthStorageData = {
				...currentData,
				[providerId]: createOAuthCredential(accounts, selected),
			};
			this.data = merged;
			return { result, next: JSON.stringify(merged, null, 2) };
		});
	}

	/**
	 * Force-refresh the selected account after the provider rejected `rejectedApiKey`.
	 *
	 * Local expiry is not the last word: ChatGPT/Codex answers `401 token_expired`
	 * for a token whose JWT `exp` and our stored `expires` still lie days ahead
	 * (server-side revocation, rotation from another login). Refreshing only on
	 * the local clock would keep replaying the dead token until that date.
	 *
	 * Several omk processes share auth.json. If the stored token no longer equals
	 * the rejected one, another process already rotated it and the current token
	 * is returned without a second refresh, which would only burn the new refresh
	 * token. A failed refresh propagates so the caller can ask for `/login`; the
	 * credential is left in place for that login to replace.
	 */
	async refreshRejectedOAuthToken(providerId: OAuthProviderId, rejectedApiKey: string): Promise<string | undefined> {
		return (await this.resolveOAuthTokenWithLock(providerId, 0, rejectedApiKey))?.apiKey;
	}

	/**
	 * Token for one account, refreshing when it is expired or too close to it.
	 *
	 * Hard expiry must refresh, and a refresh failure there is fatal. A margin
	 * miss is only a precaution: the token is still valid, so a failed proactive
	 * refresh falls back to it instead of breaking a working session. A token the
	 * provider already rejected (`rejectedApiKey`) is refreshed unconditionally,
	 * and that failure is fatal too.
	 */
	private async resolveAccountToken(
		provider: OAuthProviderInterface,
		providerId: OAuthProviderId,
		account: OAuthCredentials,
		minRemainingMs: number,
		rejectedApiKey?: string,
	): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null> {
		const now = Date.now();
		// wall-clock: account.expires is a persisted absolute expiry
		if (now >= account.expires) {
			return await getOAuthApiKey(providerId, { [providerId]: account });
		}
		if (rejectedApiKey !== undefined && provider.getApiKey(account) === rejectedApiKey) {
			const refreshed = await provider.refreshToken(account);
			return { apiKey: provider.getApiKey(refreshed), newCredentials: refreshed };
		}
		if (minRemainingMs > 0 && now + minRemainingMs >= account.expires) {
			try {
				const refreshed = await provider.refreshToken(account);
				return { apiKey: provider.getApiKey(refreshed), newCredentials: refreshed };
			} catch {
				// Still valid right now; prefer a usable token over a hard failure.
			}
		}
		return { apiKey: provider.getApiKey(account), newCredentials: account };
	}

	/**
	 * Get API key for a provider.
	 * Priority:
	 * 1. Runtime override (CLI --api-key)
	 * 2. API key from auth.json
	 * 3. OAuth token from auth.json (auto-refreshed with locking)
	 * 4. Environment variable
	 * 5. Fallback resolver (models.json custom providers)
	 */
	async getApiKey(
		providerId: string,
		options?: { includeFallback?: boolean; minRemainingMs?: number },
	): Promise<string | undefined> {
		// Runtime override takes highest priority
		const runtimeKey = this.runtimeOverrides.get(providerId);
		if (runtimeKey) {
			return runtimeKey;
		}

		// Lock contention with another session leaves the credential map unread (reload() records the
		// failure and keeps the previous data). Retry the read here so one transient failure at startup
		// does not decide how this process authenticates for its whole lifetime.
		if (this.loadError) {
			this.reload();
		}

		const cred = this.data[providerId];

		if (cred?.type === "api_key") {
			return resolveConfigValue(cred.key);
		}

		if (cred?.type === "oauth") {
			try {
				const result = await this.resolveOAuthTokenWithLock(providerId, options?.minRemainingMs ?? 0);
				if (result) {
					return result.apiKey;
				}
			} catch (error) {
				this.recordError(error);
				// Credentials are preserved so a later request or /login can recover.
				this.reload();
				return undefined;
			}
		}

		// A store that could not be read is not the same as a provider with no credential. Substituting
		// an environment key here replaced a stored OAuth credential with a stale OAuth token from
		// ANTHROPIC_API_KEY, and the provider answered 401 "OAuth access token is invalid" — an error
		// /login could never clear, because the stored credential was never used.
		if (this.loadError) {
			this.recordError(this.loadError);
			return undefined;
		}

		// Fall back to environment variable
		const envKey = getEnvApiKey(providerId);
		if (envKey) return envKey;

		// Fall back to custom resolver (e.g., models.json custom providers)
		if (options?.includeFallback !== false) {
			return this.fallbackResolver?.(providerId) ?? undefined;
		}

		return undefined;
	}

	/**
	 * Get all registered OAuth providers
	 */
	getOAuthProviders() {
		return getOAuthProviders();
	}
}
