/**
 * Credential storage for API keys and OAuth tokens.
 * Handles loading, saving, and refreshing credentials from agent.db.
 */

import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import {
	antigravityUsageProvider,
	claudeUsageProvider,
	getEnvApiKey,
	getOAuthApiKey,
	githubCopilotUsageProvider,
	googleGeminiCliUsageProvider,
	loginAnthropic,
	loginAntigravity,
	loginCursor,
	loginGeminiCli,
	loginGitHubCopilot,
	loginOpenAICodex,
	type OAuthController,
	type OAuthCredentials,
	type OAuthProvider,
	openaiCodexUsageProvider,
	type Provider,
	type UsageCache,
	type UsageCacheEntry,
	type UsageCredential,
	type UsageLimit,
	type UsageLogger,
	type UsageProvider,
	type UsageReport,
	zaiUsageProvider,
} from "@oh-my-pi/pi-ai";
import { logger } from "@oh-my-pi/pi-utils";
import { getAgentDbPath, getAuthPath } from "$c/config";
import { AgentStorage } from "./agent-storage";
import { migrateJsonStorage } from "./storage-migration";

export type ApiKeyCredential = {
	type: "api_key";
	key: string;
};

export type OAuthCredential = {
	type: "oauth";
} & OAuthCredentials;

export type AuthCredential = ApiKeyCredential | OAuthCredential;

export type AuthCredentialEntry = AuthCredential | AuthCredential[];

export type AuthStorageData = Record<string, AuthCredentialEntry>;

/**
 * Serialized representation of AuthStorage for passing to subagent workers.
 * Contains only the essential credential data, not runtime state.
 */
export interface SerializedAuthStorage {
	credentials: Record<
		string,
		Array<{
			id: number;
			type: "api_key" | "oauth";
			data: Record<string, unknown>;
		}>
	>;
	runtimeOverrides?: Record<string, string>;
	authPath?: string;
	dbPath?: string;
}

/**
 * In-memory representation pairing DB row ID with credential.
 * The ID is required for update/delete operations against agent.db.
 */
type StoredCredential = { id: number; credential: AuthCredential };

export type AuthStorageOptions = {
	usageProviderResolver?: (provider: Provider) => UsageProvider | undefined;
	usageCache?: UsageCache;
	usageFetch?: typeof fetch;
	usageNow?: () => number;
	usageLogger?: UsageLogger;
};

const DEFAULT_USAGE_PROVIDERS: UsageProvider[] = [
	openaiCodexUsageProvider,
	antigravityUsageProvider,
	googleGeminiCliUsageProvider,
	claudeUsageProvider,
	zaiUsageProvider,
	githubCopilotUsageProvider,
];

const DEFAULT_USAGE_PROVIDER_MAP = new Map<Provider, UsageProvider>(
	DEFAULT_USAGE_PROVIDERS.map((provider) => [provider.id, provider]),
);

const USAGE_CACHE_PREFIX = "usage_cache:";

function resolveDefaultUsageProvider(provider: Provider): UsageProvider | undefined {
	return DEFAULT_USAGE_PROVIDER_MAP.get(provider);
}

function parseUsageCacheEntry(raw: string): UsageCacheEntry | undefined {
	try {
		const parsed = JSON.parse(raw) as { value?: UsageReport | null; expiresAt?: unknown };
		const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : undefined;
		if (!expiresAt || !Number.isFinite(expiresAt)) return undefined;
		return { value: parsed.value ?? null, expiresAt };
	} catch {
		return undefined;
	}
}

class AuthStorageUsageCache implements UsageCache {
	constructor(private storage: AgentStorage) {}

	get(key: string): UsageCacheEntry | undefined {
		const raw = this.storage.getCache(`${USAGE_CACHE_PREFIX}${key}`);
		if (!raw) return undefined;
		const entry = parseUsageCacheEntry(raw);
		if (!entry) return undefined;
		if (entry.expiresAt <= Date.now()) return undefined;
		return entry;
	}

	set(key: string, entry: UsageCacheEntry): void {
		const payload = JSON.stringify({ value: entry.value ?? null, expiresAt: entry.expiresAt });
		this.storage.setCache(`${USAGE_CACHE_PREFIX}${key}`, payload, Math.floor(entry.expiresAt / 1000));
	}

	cleanup(): void {
		this.storage.cleanExpiredCache();
	}
}

/**
 * Credential storage backed by agent.db.
 * Reads from SQLite and migrates legacy auth.json paths.
 */
export class AuthStorage {
	private static readonly defaultBackoffMs = 60_000; // Default backoff when no reset time available

	/** Provider -> credentials cache, populated from agent.db on reload(). */
	private data: Map<string, StoredCredential[]> = new Map();
	private storage: AgentStorage;
	/** Resolved path to agent.db (derived from authPath or used directly if .db). */
	private dbPath: string;
	private runtimeOverrides: Map<string, string> = new Map();
	/** Tracks next credential index per provider:type key for round-robin distribution (non-session use). */
	private providerRoundRobinIndex: Map<string, number> = new Map();
	/** Tracks the last used credential per provider for a session (used for rate-limit switching). */
	private sessionLastCredential: Map<string, Map<string, { type: AuthCredential["type"]; index: number }>> = new Map();
	/** Maps provider:type -> credentialIndex -> blockedUntilMs for temporary backoff. */
	private credentialBackoff: Map<string, Map<number, number>> = new Map();
	private usageProviderResolver?: (provider: Provider) => UsageProvider | undefined;
	private usageCache?: UsageCache;
	private usageFetch: typeof fetch;
	private usageNow: () => number;
	private usageLogger?: UsageLogger;
	private fallbackResolver?: (provider: string) => string | undefined;

	private constructor(
		private authPath: string,
		private fallbackPaths: string[] = [],
		storage: AgentStorage,
		options: AuthStorageOptions = {},
	) {
		this.dbPath = AuthStorage.resolveDbPath(authPath);
		this.storage = storage;
		this.usageProviderResolver = options.usageProviderResolver ?? resolveDefaultUsageProvider;
		this.usageCache = options.usageCache ?? new AuthStorageUsageCache(this.storage);
		this.usageFetch = options.usageFetch ?? fetch;
		this.usageNow = options.usageNow ?? Date.now;
		this.usageLogger =
			options.usageLogger ??
			({
				debug: (message, meta) => logger.debug(message, meta),
				warn: (message, meta) => logger.warn(message, meta),
			} satisfies UsageLogger);
	}

	/**
	 * Create an AuthStorage instance.
	 * @param authPath - Legacy auth.json path used for migration and locating agent.db
	 * @param fallbackPaths - Additional auth.json paths to migrate (legacy support)
	 */
	static async create(
		authPath: string,
		fallbackPaths: string[] = [],
		options: AuthStorageOptions = {},
	): Promise<AuthStorage> {
		const dbPath = AuthStorage.resolveDbPath(authPath);
		const storage = await AgentStorage.open(dbPath);
		return new AuthStorage(authPath, fallbackPaths, storage, options);
	}

	/**
	 * Create an in-memory AuthStorage instance from serialized data.
	 * Used by subagent workers to bypass discovery and use parent's credentials.
	 */
	static async fromSerialized(data: SerializedAuthStorage, options: AuthStorageOptions = {}): Promise<AuthStorage> {
		const authPath = data.authPath ?? data.dbPath ?? getAuthPath();
		const dbPath = data.dbPath ?? AuthStorage.resolveDbPath(authPath);
		const storage = await AgentStorage.open(dbPath);

		const instance = Object.create(AuthStorage.prototype) as AuthStorage;
		instance.authPath = authPath;
		instance.fallbackPaths = [];
		instance.dbPath = dbPath;
		instance.storage = storage;
		instance.data = new Map();
		instance.runtimeOverrides = new Map();
		instance.providerRoundRobinIndex = new Map();
		instance.sessionLastCredential = new Map();
		instance.credentialBackoff = new Map();
		instance.usageProviderResolver = options.usageProviderResolver ?? resolveDefaultUsageProvider;
		instance.usageCache = options.usageCache ?? new AuthStorageUsageCache(instance.storage);
		instance.usageFetch = options.usageFetch ?? fetch;
		instance.usageNow = options.usageNow ?? Date.now;
		instance.usageLogger =
			options.usageLogger ??
			({
				debug: (message, meta) => logger.debug(message, meta),
				warn: (message, meta) => logger.warn(message, meta),
			} satisfies UsageLogger);

		for (const [provider, creds] of Object.entries(data.credentials)) {
			instance.data.set(
				provider,
				creds.map((c) => ({
					id: c.id,
					credential:
						c.type === "api_key"
							? ({ type: "api_key", key: c.data.key as string } satisfies ApiKeyCredential)
							: ({ type: "oauth", ...c.data } as OAuthCredential),
				})),
			);
		}
		if (data.runtimeOverrides) {
			for (const [k, v] of Object.entries(data.runtimeOverrides)) {
				instance.runtimeOverrides.set(k, v);
			}
		}

		return instance;
	}

	/**
	 * Serialize AuthStorage for passing to subagent workers.
	 * Excludes runtime state (round-robin, backoff, usage cache).
	 */
	serialize(): SerializedAuthStorage {
		const credentials: SerializedAuthStorage["credentials"] = {};
		for (const [provider, creds] of this.data.entries()) {
			credentials[provider] = creds.map((c) => ({
				id: c.id,
				type: c.credential.type,
				data: c.credential.type === "api_key" ? { key: c.credential.key } : { ...c.credential },
			}));
		}
		const runtimeOverrides: Record<string, string> = {};
		for (const [k, v] of this.runtimeOverrides.entries()) {
			runtimeOverrides[k] = v;
		}
		return {
			credentials,
			runtimeOverrides: Object.keys(runtimeOverrides).length > 0 ? runtimeOverrides : undefined,
			authPath: this.authPath,
			dbPath: this.dbPath,
		};
	}

	/**
	 * Converts legacy auth.json path to agent.db path, or returns .db path as-is.
	 * @param authPath - Path to auth.json or agent.db
	 * @returns Resolved path to agent.db
	 */
	private static resolveDbPath(authPath: string): string {
		if (authPath.endsWith(".db")) {
			return authPath;
		}
		return getAgentDbPath(dirname(authPath));
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
	 * Set a fallback resolver for API keys not found in agent.db or env vars.
	 * Used for custom provider keys from models.json.
	 */
	setFallbackResolver(resolver: (provider: string) => string | undefined): void {
		this.fallbackResolver = resolver;
	}

	/**
	 * Reload credentials from agent.db.
	 * Migrates legacy auth.json/settings.json on first load.
	 */
	async reload(): Promise<void> {
		const agentDir = dirname(this.dbPath);
		await migrateJsonStorage({
			agentDir,
			settingsPath: join(agentDir, "settings.json"),
			authPaths: [this.authPath, ...this.fallbackPaths],
		});

		const records = this.storage.listAuthCredentials();
		const grouped = new Map<string, StoredCredential[]>();
		for (const record of records) {
			const list = grouped.get(record.provider) ?? [];
			list.push({ id: record.id, credential: record.credential });
			grouped.set(record.provider, list);
		}

		const dedupedGrouped = new Map<string, StoredCredential[]>();
		for (const [provider, entries] of grouped.entries()) {
			const deduped = this.pruneDuplicateStoredCredentials(provider, entries);
			if (deduped.length > 0) {
				dedupedGrouped.set(provider, deduped);
			}
		}
		this.data = dedupedGrouped;
	}

	/**
	 * Gets cached credentials for a provider.
	 * @param provider - Provider name (e.g., "anthropic", "openai")
	 * @returns Array of stored credentials, empty if none exist
	 */
	private getStoredCredentials(provider: string): StoredCredential[] {
		return this.data.get(provider) ?? [];
	}

	/**
	 * Updates in-memory credential cache for a provider.
	 * Removes the provider entry entirely if credentials array is empty.
	 * @param provider - Provider name (e.g., "anthropic", "openai")
	 * @param credentials - Array of stored credentials to cache
	 */
	private setStoredCredentials(provider: string, credentials: StoredCredential[]): void {
		if (credentials.length === 0) {
			this.data.delete(provider);
		} else {
			this.data.set(provider, credentials);
		}
	}

	private getOAuthIdentifiers(credential: OAuthCredential): string[] {
		const identifiers: string[] = [];
		const accountId = credential.accountId?.trim();
		if (accountId) identifiers.push(`account:${accountId}`);
		const email = credential.email?.trim().toLowerCase();
		if (email) identifiers.push(`email:${email}`);
		if (identifiers.length > 0) return identifiers;
		const tokenIdentifiers = this.getOAuthIdentifiersFromToken(credential.access) ?? [];
		for (const identifier of tokenIdentifiers) {
			identifiers.push(identifier);
		}
		if (identifiers.length > 0) return identifiers;
		const refreshIdentifiers = this.getOAuthIdentifiersFromToken(credential.refresh) ?? [];
		for (const identifier of refreshIdentifiers) {
			identifiers.push(identifier);
		}
		return identifiers;
	}

	private getOAuthIdentifiersFromToken(token: string | undefined): string[] | undefined {
		if (!token) return undefined;
		const parts = token.split(".");
		if (parts.length !== 3) return undefined;
		const payloadRaw = parts[1];
		try {
			const payload = JSON.parse(
				Buffer.from(payloadRaw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
			) as Record<string, unknown>;
			if (!payload || typeof payload !== "object") return undefined;
			const identifiers: string[] = [];
			const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : undefined;
			if (email) identifiers.push(`email:${email}`);
			const accountId =
				typeof payload.account_id === "string"
					? payload.account_id
					: typeof payload.accountId === "string"
						? payload.accountId
						: typeof payload.user_id === "string"
							? payload.user_id
							: typeof payload.sub === "string"
								? payload.sub
								: undefined;
			const trimmedAccountId = accountId?.trim();
			if (trimmedAccountId) identifiers.push(`account:${trimmedAccountId}`);
			return identifiers.length > 0 ? identifiers : undefined;
		} catch {
			return undefined;
		}
	}

	private dedupeOAuthCredentials(credentials: AuthCredential[]): AuthCredential[] {
		const seen = new Set<string>();
		const deduped: AuthCredential[] = [];
		for (let index = credentials.length - 1; index >= 0; index -= 1) {
			const credential = credentials[index];
			if (credential.type !== "oauth") {
				deduped.push(credential);
				continue;
			}
			const identifiers = this.getOAuthIdentifiers(credential);
			if (identifiers.length === 0) {
				deduped.push(credential);
				continue;
			}
			if (identifiers.some((identifier) => seen.has(identifier))) {
				continue;
			}
			for (const identifier of identifiers) {
				seen.add(identifier);
			}
			deduped.push(credential);
		}
		return deduped.reverse();
	}

	private pruneDuplicateStoredCredentials(provider: string, entries: StoredCredential[]): StoredCredential[] {
		const seen = new Set<string>();
		const kept: StoredCredential[] = [];
		const removed: StoredCredential[] = [];
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index];
			const credential = entry.credential;
			if (credential.type !== "oauth") {
				kept.push(entry);
				continue;
			}
			const identifiers = this.getOAuthIdentifiers(credential);
			if (identifiers.length === 0) {
				kept.push(entry);
				continue;
			}
			if (identifiers.some((identifier) => seen.has(identifier))) {
				removed.push(entry);
				continue;
			}
			for (const identifier of identifiers) {
				seen.add(identifier);
			}
			kept.push(entry);
		}
		if (removed.length > 0) {
			for (const entry of removed) {
				this.storage.deleteAuthCredential(entry.id);
			}
			this.resetProviderAssignments(provider);
		}
		return kept.reverse();
	}

	/** Returns all credentials for a provider as an array */
	private getCredentialsForProvider(provider: string): AuthCredential[] {
		return this.getStoredCredentials(provider).map((entry) => entry.credential);
	}

	/** Composite key for round-robin tracking: "anthropic:oauth" or "openai:api_key" */
	private getProviderTypeKey(provider: string, type: AuthCredential["type"]): string {
		return `${provider}:${type}`;
	}

	/**
	 * Returns next index in round-robin sequence for load distribution.
	 * Increments stored counter and wraps at total.
	 */
	private getNextRoundRobinIndex(providerKey: string, total: number): number {
		if (total <= 1) return 0;
		const current = this.providerRoundRobinIndex.get(providerKey) ?? -1;
		const next = (current + 1) % total;
		this.providerRoundRobinIndex.set(providerKey, next);
		return next;
	}

	/**
	 * FNV-1a hash for deterministic session-to-credential mapping.
	 * Ensures the same session always starts with the same credential.
	 */
	private getHashedIndex(sessionId: string, total: number): number {
		if (total <= 1) return 0;
		let hash = 2166136261; // FNV offset basis
		for (let i = 0; i < sessionId.length; i++) {
			hash ^= sessionId.charCodeAt(i);
			hash = Math.imul(hash, 16777619); // FNV prime
		}
		return (hash >>> 0) % total;
	}

	/**
	 * Returns credential indices in priority order for selection.
	 * With sessionId: starts from hashed index (consistent per session).
	 * Without sessionId: starts from round-robin index (load balancing).
	 * Order wraps around so all credentials are tried if earlier ones are blocked.
	 */
	private getCredentialOrder(providerKey: string, sessionId: string | undefined, total: number): number[] {
		if (total <= 1) return [0];
		const start = sessionId ? this.getHashedIndex(sessionId, total) : this.getNextRoundRobinIndex(providerKey, total);
		const order: number[] = [];
		for (let i = 0; i < total; i++) {
			order.push((start + i) % total);
		}
		return order;
	}

	/** Checks if a credential is temporarily blocked due to usage limits. */
	private isCredentialBlocked(providerKey: string, credentialIndex: number): boolean {
		const backoffMap = this.credentialBackoff.get(providerKey);
		if (!backoffMap) return false;
		const blockedUntil = backoffMap.get(credentialIndex);
		if (!blockedUntil) return false;
		if (blockedUntil <= Date.now()) {
			backoffMap.delete(credentialIndex);
			if (backoffMap.size === 0) {
				this.credentialBackoff.delete(providerKey);
			}
			return false;
		}
		return true;
	}

	/** Marks a credential as blocked until the specified time. */
	private markCredentialBlocked(providerKey: string, credentialIndex: number, blockedUntilMs: number): void {
		const backoffMap = this.credentialBackoff.get(providerKey) ?? new Map<number, number>();
		const existing = backoffMap.get(credentialIndex) ?? 0;
		backoffMap.set(credentialIndex, Math.max(existing, blockedUntilMs));
		this.credentialBackoff.set(providerKey, backoffMap);
	}

	/** Records which credential was used for a session (for rate-limit switching). */
	private recordSessionCredential(
		provider: string,
		sessionId: string | undefined,
		type: AuthCredential["type"],
		index: number,
	): void {
		if (!sessionId) return;
		const sessionMap = this.sessionLastCredential.get(provider) ?? new Map();
		sessionMap.set(sessionId, { type, index });
		this.sessionLastCredential.set(provider, sessionMap);
	}

	/** Retrieves the last credential used by a session. */
	private getSessionCredential(
		provider: string,
		sessionId: string | undefined,
	): { type: AuthCredential["type"]; index: number } | undefined {
		if (!sessionId) return undefined;
		return this.sessionLastCredential.get(provider)?.get(sessionId);
	}

	/**
	 * Selects a credential of the specified type for a provider.
	 * Returns both the credential and its index in the original array (for updates/removal).
	 * Uses deterministic hashing for session stickiness and skips blocked credentials when possible.
	 */
	private selectCredentialByType<T extends AuthCredential["type"]>(
		provider: string,
		type: T,
		sessionId?: string,
	): { credential: Extract<AuthCredential, { type: T }>; index: number } | undefined {
		const credentials = this.getCredentialsForProvider(provider)
			.map((credential, index) => ({ credential, index }))
			.filter(
				(entry): entry is { credential: Extract<AuthCredential, { type: T }>; index: number } =>
					entry.credential.type === type,
			);

		if (credentials.length === 0) return undefined;
		if (credentials.length === 1) return credentials[0];

		const providerKey = this.getProviderTypeKey(provider, type);
		const order = this.getCredentialOrder(providerKey, sessionId, credentials.length);
		const fallback = credentials[order[0]];

		for (const idx of order) {
			const candidate = credentials[idx];
			if (!this.isCredentialBlocked(providerKey, candidate.index)) {
				return candidate;
			}
		}

		return fallback;
	}

	/**
	 * Clears round-robin and session assignment state for a provider.
	 * Called when credentials are added/removed to prevent stale index references.
	 */
	private resetProviderAssignments(provider: string): void {
		for (const key of this.providerRoundRobinIndex.keys()) {
			if (key.startsWith(`${provider}:`)) {
				this.providerRoundRobinIndex.delete(key);
			}
		}
		this.sessionLastCredential.delete(provider);
		for (const key of this.credentialBackoff.keys()) {
			if (key.startsWith(`${provider}:`)) {
				this.credentialBackoff.delete(key);
			}
		}
	}

	/** Updates credential at index in-place (used for OAuth token refresh) */
	private replaceCredentialAt(provider: string, index: number, credential: AuthCredential): void {
		const entries = this.getStoredCredentials(provider);
		if (index < 0 || index >= entries.length) return;
		const target = entries[index];
		this.storage.updateAuthCredential(target.id, credential);
		const updated = [...entries];
		updated[index] = { id: target.id, credential };
		this.setStoredCredentials(provider, updated);
	}

	/**
	 * Removes credential at index (used when OAuth refresh fails).
	 * Cleans up provider entry if last credential removed.
	 */
	private removeCredentialAt(provider: string, index: number): void {
		const entries = this.getStoredCredentials(provider);
		if (index < 0 || index >= entries.length) return;
		this.storage.deleteAuthCredential(entries[index].id);
		const updated = entries.filter((_value, idx) => idx !== index);
		this.setStoredCredentials(provider, updated);
		this.resetProviderAssignments(provider);
	}

	/**
	 * Get credential for a provider (first entry if multiple).
	 */
	get(provider: string): AuthCredential | undefined {
		return this.getCredentialsForProvider(provider)[0];
	}

	/**
	 * Set credential for a provider.
	 */
	async set(provider: string, credential: AuthCredentialEntry): Promise<void> {
		const normalized = Array.isArray(credential) ? credential : [credential];
		const deduped = this.dedupeOAuthCredentials(normalized);
		const stored = this.storage.replaceAuthCredentialsForProvider(provider, deduped);
		this.setStoredCredentials(
			provider,
			stored.map((record) => ({ id: record.id, credential: record.credential })),
		);
		this.resetProviderAssignments(provider);
	}

	/**
	 * Remove credential for a provider.
	 */
	async remove(provider: string): Promise<void> {
		this.storage.deleteAuthCredentialsForProvider(provider);
		this.data.delete(provider);
		this.resetProviderAssignments(provider);
	}

	/**
	 * List all providers with credentials.
	 */
	list(): string[] {
		return [...this.data.keys()];
	}

	/**
	 * Check if credentials exist for a provider in agent.db.
	 */
	has(provider: string): boolean {
		return this.getCredentialsForProvider(provider).length > 0;
	}

	/**
	 * Check if any form of auth is configured for a provider.
	 * Unlike getApiKey(), this doesn't refresh OAuth tokens.
	 */
	hasAuth(provider: string): boolean {
		if (this.runtimeOverrides.has(provider)) return true;
		if (this.getCredentialsForProvider(provider).length > 0) return true;
		if (getEnvApiKey(provider)) return true;
		if (this.fallbackResolver?.(provider)) return true;
		return false;
	}

	/**
	 * Check if OAuth credentials are configured for a provider.
	 */
	hasOAuth(provider: string): boolean {
		return this.getCredentialsForProvider(provider).some((credential) => credential.type === "oauth");
	}

	/**
	 * Get OAuth credentials for a provider.
	 */
	getOAuthCredential(provider: string): OAuthCredential | undefined {
		return this.getCredentialsForProvider(provider).find(
			(credential): credential is OAuthCredential => credential.type === "oauth",
		);
	}

	/**
	 * Get all credentials.
	 */
	getAll(): AuthStorageData {
		const result: AuthStorageData = {};
		for (const [provider, entries] of this.data.entries()) {
			const credentials = entries.map((entry) => entry.credential);
			if (credentials.length === 1) {
				result[provider] = credentials[0];
			} else if (credentials.length > 1) {
				result[provider] = credentials;
			}
		}
		return result;
	}

	/**
	 * Login to an OAuth provider.
	 */
	async login(
		provider: OAuthProvider,
		ctrl: OAuthController & {
			/** onAuth is required by auth-storage but optional in OAuthController */
			onAuth: (info: { url: string; instructions?: string }) => void;
			/** onPrompt is required for some providers (github-copilot, openai-codex) */
			onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
		},
	): Promise<void> {
		let credentials: OAuthCredentials;

		switch (provider) {
			case "anthropic":
				credentials = await loginAnthropic({
					...ctrl,
					onManualCodeInput: async () =>
						ctrl.onPrompt({ message: "Paste the authorization code (or full redirect URL):" }),
				});
				break;
			case "github-copilot":
				credentials = await loginGitHubCopilot({
					onAuth: (url, instructions) => ctrl.onAuth({ url, instructions }),
					onPrompt: ctrl.onPrompt,
					onProgress: ctrl.onProgress,
					signal: ctrl.signal,
				});
				break;
			case "google-gemini-cli":
				credentials = await loginGeminiCli(ctrl);
				break;
			case "google-antigravity":
				credentials = await loginAntigravity(ctrl);
				break;
			case "openai-codex":
				credentials = await loginOpenAICodex(ctrl);
				break;
			case "cursor":
				credentials = await loginCursor(
					(url) => ctrl.onAuth({ url }),
					ctrl.onProgress ? () => ctrl.onProgress?.("Waiting for browser authentication...") : undefined,
				);
				break;
			default:
				throw new Error(`Unknown OAuth provider: ${provider}`);
		}

		const newCredential: OAuthCredential = { type: "oauth", ...credentials };
		const existing = this.getCredentialsForProvider(provider);
		if (existing.length === 0) {
			await this.set(provider, newCredential);
			return;
		}

		await this.set(provider, [...existing, newCredential]);
	}

	/**
	 * Logout from a provider.
	 */
	async logout(provider: string): Promise<void> {
		await this.remove(provider);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Usage API Integration
	// Queries provider usage endpoints to detect rate limits before they occur.
	// ─────────────────────────────────────────────────────────────────────────────

	private buildUsageCredential(credential: OAuthCredential): UsageCredential {
		return {
			type: "oauth",
			accessToken: credential.access,
			refreshToken: credential.refresh,
			expiresAt: credential.expires,
			accountId: credential.accountId,
			projectId: credential.projectId,
			email: credential.email,
			enterpriseUrl: credential.enterpriseUrl,
		};
	}

	private getUsageReportMetadataValue(report: UsageReport, key: string): string | undefined {
		const metadata = report.metadata;
		if (!metadata || typeof metadata !== "object") return undefined;
		const value = metadata[key];
		return typeof value === "string" ? value.trim() : undefined;
	}

	private getUsageReportScopeAccountId(report: UsageReport): string | undefined {
		const ids = new Set<string>();
		for (const limit of report.limits) {
			const accountId = limit.scope.accountId?.trim();
			if (accountId) ids.add(accountId);
		}
		if (ids.size === 1) return [...ids][0];
		return undefined;
	}

	private getUsageReportIdentifiers(report: UsageReport): string[] {
		const identifiers: string[] = [];
		const email = this.getUsageReportMetadataValue(report, "email");
		if (email) identifiers.push(`email:${email.toLowerCase()}`);
		const accountId = this.getUsageReportMetadataValue(report, "accountId");
		if (accountId) identifiers.push(`account:${accountId}`);
		const account = this.getUsageReportMetadataValue(report, "account");
		if (account) identifiers.push(`account:${account}`);
		const user = this.getUsageReportMetadataValue(report, "user");
		if (user) identifiers.push(`account:${user}`);
		const username = this.getUsageReportMetadataValue(report, "username");
		if (username) identifiers.push(`account:${username}`);
		const scopeAccountId = this.getUsageReportScopeAccountId(report);
		if (scopeAccountId) identifiers.push(`account:${scopeAccountId}`);
		return identifiers.map((identifier) => `${report.provider}:${identifier.toLowerCase()}`);
	}

	private mergeUsageReportGroup(reports: UsageReport[]): UsageReport {
		if (reports.length === 1) return reports[0];
		const sorted = [...reports].sort((a, b) => {
			const limitDiff = b.limits.length - a.limits.length;
			if (limitDiff !== 0) return limitDiff;
			return (b.fetchedAt ?? 0) - (a.fetchedAt ?? 0);
		});
		const base = sorted[0];
		const mergedLimits = [...base.limits];
		const limitIds = new Set(mergedLimits.map((limit) => limit.id));
		const mergedMetadata: Record<string, unknown> = { ...(base.metadata ?? {}) };
		let fetchedAt = base.fetchedAt;

		for (const report of sorted.slice(1)) {
			fetchedAt = Math.max(fetchedAt, report.fetchedAt);
			for (const limit of report.limits) {
				if (!limitIds.has(limit.id)) {
					limitIds.add(limit.id);
					mergedLimits.push(limit);
				}
			}
			if (report.metadata) {
				for (const [key, value] of Object.entries(report.metadata)) {
					if (mergedMetadata[key] === undefined) {
						mergedMetadata[key] = value;
					}
				}
			}
		}

		return {
			...base,
			fetchedAt,
			limits: mergedLimits,
			metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
		};
	}

	private dedupeUsageReports(reports: UsageReport[]): UsageReport[] {
		const groups: UsageReport[][] = [];
		const idToGroup = new Map<string, number>();

		for (const report of reports) {
			const identifiers = this.getUsageReportIdentifiers(report);
			let groupIndex: number | undefined;
			for (const identifier of identifiers) {
				const existing = idToGroup.get(identifier);
				if (existing !== undefined) {
					groupIndex = existing;
					break;
				}
			}
			if (groupIndex === undefined) {
				groupIndex = groups.length;
				groups.push([]);
			}
			groups[groupIndex].push(report);
			for (const identifier of identifiers) {
				idToGroup.set(identifier, groupIndex);
			}
		}

		const deduped = groups.map((group) => this.mergeUsageReportGroup(group));
		if (deduped.length !== reports.length) {
			this.usageLogger?.debug("Usage reports deduped", {
				before: reports.length,
				after: deduped.length,
			});
		}
		return deduped;
	}

	private isUsageLimitExhausted(limit: UsageLimit): boolean {
		if (limit.status === "exhausted") return true;
		const amount = limit.amount;
		if (amount.usedFraction !== undefined && amount.usedFraction >= 1) return true;
		if (amount.remainingFraction !== undefined && amount.remainingFraction <= 0) return true;
		if (amount.used !== undefined && amount.limit !== undefined && amount.used >= amount.limit) return true;
		if (amount.remaining !== undefined && amount.remaining <= 0) return true;
		if (amount.unit === "percent" && amount.used !== undefined && amount.used >= 100) return true;
		return false;
	}

	/** Returns true if usage indicates rate limit has been reached. */
	private isUsageLimitReached(report: UsageReport): boolean {
		return report.limits.some((limit) => this.isUsageLimitExhausted(limit));
	}

	/** Extracts the earliest reset timestamp from exhausted windows (in ms). */
	private getUsageResetAtMs(report: UsageReport, nowMs: number): number | undefined {
		const candidates: number[] = [];
		for (const limit of report.limits) {
			if (!this.isUsageLimitExhausted(limit)) continue;
			const window = limit.window;
			if (window?.resetsAt && window.resetsAt > nowMs) {
				candidates.push(window.resetsAt);
			}
			if (window?.resetInMs && window.resetInMs > 0) {
				const resetAt = nowMs + window.resetInMs;
				if (resetAt > nowMs) candidates.push(resetAt);
			}
		}
		if (candidates.length === 0) return undefined;
		return Math.min(...candidates);
	}

	private async getUsageReport(
		provider: Provider,
		credential: OAuthCredential,
		options?: { baseUrl?: string },
	): Promise<UsageReport | null> {
		const resolver = this.usageProviderResolver;
		const cache = this.usageCache;
		if (!resolver || !cache) return null;

		const providerImpl = resolver(provider);
		if (!providerImpl) return null;

		const params = {
			provider,
			credential: this.buildUsageCredential(credential),
			baseUrl: options?.baseUrl,
		};

		if (providerImpl.supports && !providerImpl.supports(params)) return null;

		try {
			return await providerImpl.fetchUsage(params, {
				cache,
				fetch: this.usageFetch,
				now: this.usageNow,
				logger: this.usageLogger,
			});
		} catch (error) {
			logger.debug("AuthStorage usage fetch failed", {
				provider,
				error: String(error),
			});
			return null;
		}
	}

	async fetchUsageReports(options?: {
		baseUrlResolver?: (provider: Provider) => string | undefined;
	}): Promise<UsageReport[] | null> {
		const resolver = this.usageProviderResolver;
		const cache = this.usageCache;
		if (!resolver || !cache) return null;

		const tasks: Array<Promise<UsageReport | null>> = [];
		const providers = new Set<string>([
			...this.data.keys(),
			...DEFAULT_USAGE_PROVIDERS.map((provider) => provider.id),
		]);
		this.usageLogger?.debug("Usage fetch requested", {
			providers: Array.from(providers).sort(),
		});
		for (const provider of providers) {
			const providerImpl = resolver(provider as Provider);
			if (!providerImpl) continue;
			const baseUrl = options?.baseUrlResolver?.(provider as Provider);
			let entries = this.getStoredCredentials(provider);
			if (entries.length > 0) {
				const dedupedEntries = this.pruneDuplicateStoredCredentials(provider, entries);
				if (dedupedEntries.length !== entries.length) {
					this.setStoredCredentials(provider, dedupedEntries);
				}
				entries = dedupedEntries;
			}

			if (entries.length === 0) {
				const runtimeKey = this.runtimeOverrides.get(provider);
				const envKey = getEnvApiKey(provider);
				const apiKey = runtimeKey ?? envKey;
				if (!apiKey) {
					continue;
				}
				const params = {
					provider: provider as Provider,
					credential: { type: "api_key", apiKey } satisfies UsageCredential,
					baseUrl,
				};
				if (providerImpl.supports && !providerImpl.supports(params)) {
					continue;
				}
				this.usageLogger?.debug("Usage fetch queued", {
					provider,
					credentialType: "api_key",
					baseUrl,
				});
				tasks.push(
					providerImpl
						.fetchUsage(params, {
							cache,
							fetch: this.usageFetch,
							now: this.usageNow,
							logger: this.usageLogger,
						})
						.catch((error) => {
							logger.debug("AuthStorage usage fetch failed", {
								provider,
								error: String(error),
							});
							return null;
						}),
				);
				continue;
			}

			for (const entry of entries) {
				const credential = entry.credential;
				const usageCredential: UsageCredential =
					credential.type === "api_key"
						? { type: "api_key", apiKey: credential.key }
						: this.buildUsageCredential(credential);
				const params = {
					provider: provider as Provider,
					credential: usageCredential,
					baseUrl,
				};

				if (providerImpl.supports && !providerImpl.supports(params)) {
					continue;
				}

				this.usageLogger?.debug("Usage fetch queued", {
					provider,
					credentialType: usageCredential.type,
					baseUrl,
					accountId: usageCredential.accountId,
					email: usageCredential.email,
				});

				tasks.push(
					providerImpl
						.fetchUsage(params, {
							cache,
							fetch: this.usageFetch,
							now: this.usageNow,
							logger: this.usageLogger,
						})
						.catch((error) => {
							logger.debug("AuthStorage usage fetch failed", {
								provider,
								error: String(error),
							});
							return null;
						}),
				);
			}
		}

		if (tasks.length === 0) return [];
		const results = await Promise.all(tasks);
		const reports = results.filter((report): report is UsageReport => report !== null);
		const deduped = this.dedupeUsageReports(reports);
		this.usageLogger?.debug("Usage fetch resolved", {
			reports: deduped.map((report) => {
				const accountLabel =
					this.getUsageReportMetadataValue(report, "email") ??
					this.getUsageReportMetadataValue(report, "accountId") ??
					this.getUsageReportMetadataValue(report, "account") ??
					this.getUsageReportMetadataValue(report, "user") ??
					this.getUsageReportMetadataValue(report, "username") ??
					this.getUsageReportScopeAccountId(report);
				return {
					provider: report.provider,
					limits: report.limits.length,
					account: accountLabel,
				};
			}),
		});
		return deduped;
	}

	/**
	 * Marks the current session's credential as temporarily blocked due to usage limits.
	 * Uses usage reports to determine accurate reset time when available.
	 * Returns true if a credential was blocked, enabling automatic fallback to the next credential.
	 */
	async markUsageLimitReached(
		provider: string,
		sessionId: string | undefined,
		options?: { retryAfterMs?: number; baseUrl?: string },
	): Promise<boolean> {
		const sessionCredential = this.getSessionCredential(provider, sessionId);
		if (!sessionCredential) return false;

		const providerKey = this.getProviderTypeKey(provider, sessionCredential.type);
		const now = this.usageNow();
		let blockedUntil = now + (options?.retryAfterMs ?? AuthStorage.defaultBackoffMs);

		if (provider === "openai-codex" && sessionCredential.type === "oauth") {
			const credential = this.getCredentialsForProvider(provider)[sessionCredential.index];
			if (credential?.type === "oauth") {
				const report = await this.getUsageReport(provider, credential, options);
				if (report && this.isUsageLimitReached(report)) {
					const resetAtMs = this.getUsageResetAtMs(report, this.usageNow());
					if (resetAtMs && resetAtMs > blockedUntil) {
						blockedUntil = resetAtMs;
					}
				}
			}
		}

		this.markCredentialBlocked(providerKey, sessionCredential.index, blockedUntil);

		const remainingCredentials = this.getCredentialsForProvider(provider)
			.map((credential, index) => ({ credential, index }))
			.filter(
				(entry): entry is { credential: AuthCredential; index: number } =>
					entry.credential.type === sessionCredential.type && entry.index !== sessionCredential.index,
			);

		return remainingCredentials.some((candidate) => !this.isCredentialBlocked(providerKey, candidate.index));
	}

	/**
	 * Resolves an OAuth API key, trying credentials in priority order.
	 * Skips blocked credentials and checks usage limits for providers with usage data.
	 * Falls back to earliest-unblocking credential if all are blocked.
	 */
	private async resolveOAuthApiKey(
		provider: string,
		sessionId?: string,
		options?: { baseUrl?: string },
	): Promise<string | undefined> {
		const credentials = this.getCredentialsForProvider(provider)
			.map((credential, index) => ({ credential, index }))
			.filter((entry): entry is { credential: OAuthCredential; index: number } => entry.credential.type === "oauth");

		if (credentials.length === 0) return undefined;

		const providerKey = this.getProviderTypeKey(provider, "oauth");
		const order = this.getCredentialOrder(providerKey, sessionId, credentials.length);
		const fallback = credentials[order[0]];
		const checkUsage = provider === "openai-codex" && credentials.length > 1;

		for (const idx of order) {
			const selection = credentials[idx];
			const apiKey = await this.tryOAuthCredential(
				provider,
				selection,
				providerKey,
				sessionId,
				options,
				checkUsage,
				false,
			);
			if (apiKey) return apiKey;
		}

		if (fallback && this.isCredentialBlocked(providerKey, fallback.index)) {
			return this.tryOAuthCredential(provider, fallback, providerKey, sessionId, options, checkUsage, true);
		}

		return undefined;
	}

	/** Attempts to use a single OAuth credential, checking usage and refreshing token. */
	private async tryOAuthCredential(
		provider: string,
		selection: { credential: OAuthCredential; index: number },
		providerKey: string,
		sessionId: string | undefined,
		options: { baseUrl?: string } | undefined,
		checkUsage: boolean,
		allowBlocked: boolean,
	): Promise<string | undefined> {
		if (!allowBlocked && this.isCredentialBlocked(providerKey, selection.index)) {
			return undefined;
		}

		let usage: UsageReport | null = null;
		let usageChecked = false;

		if (checkUsage) {
			usage = await this.getUsageReport(provider, selection.credential, options);
			usageChecked = true;
			if (usage && this.isUsageLimitReached(usage)) {
				const resetAtMs = this.getUsageResetAtMs(usage, this.usageNow());
				this.markCredentialBlocked(
					providerKey,
					selection.index,
					resetAtMs ?? this.usageNow() + AuthStorage.defaultBackoffMs,
				);
				return undefined;
			}
		}

		const oauthCreds: Record<string, OAuthCredentials> = {
			[provider]: selection.credential,
		};

		try {
			const result = await getOAuthApiKey(provider as OAuthProvider, oauthCreds);
			if (!result) return undefined;

			const updated: OAuthCredential = {
				type: "oauth",
				access: result.newCredentials.access,
				refresh: result.newCredentials.refresh,
				expires: result.newCredentials.expires,
				accountId: result.newCredentials.accountId ?? selection.credential.accountId,
				email: result.newCredentials.email ?? selection.credential.email,
				projectId: result.newCredentials.projectId ?? selection.credential.projectId,
				enterpriseUrl: result.newCredentials.enterpriseUrl ?? selection.credential.enterpriseUrl,
			};
			this.replaceCredentialAt(provider, selection.index, updated);

			if (checkUsage) {
				const sameAccount = selection.credential.accountId === updated.accountId;
				if (!usageChecked || !sameAccount) {
					usage = await this.getUsageReport(provider, updated, options);
				}
				if (usage && this.isUsageLimitReached(usage)) {
					const resetAtMs = this.getUsageResetAtMs(usage, this.usageNow());
					this.markCredentialBlocked(
						providerKey,
						selection.index,
						resetAtMs ?? this.usageNow() + AuthStorage.defaultBackoffMs,
					);
					return undefined;
				}
			}

			this.recordSessionCredential(provider, sessionId, "oauth", selection.index);
			return result.apiKey;
		} catch (error) {
			logger.warn("OAuth token refresh failed, removing credential", {
				provider,
				index: selection.index,
				error: String(error),
			});
			this.removeCredentialAt(provider, selection.index);
			if (this.getCredentialsForProvider(provider).some((credential) => credential.type === "oauth")) {
				return this.getApiKey(provider, sessionId, options);
			}
		}

		return undefined;
	}

	/**
	 * Get API key for a provider.
	 * Priority:
	 * 1. Runtime override (CLI --api-key)
	 * 2. API key from agent.db
	 * 3. OAuth token from agent.db (auto-refreshed)
	 * 4. Environment variable
	 * 5. Fallback resolver (models.json custom providers)
	 */
	async getApiKey(provider: string, sessionId?: string, options?: { baseUrl?: string }): Promise<string | undefined> {
		// Runtime override takes highest priority
		const runtimeKey = this.runtimeOverrides.get(provider);
		if (runtimeKey) {
			return runtimeKey;
		}

		const apiKeySelection = this.selectCredentialByType(provider, "api_key", sessionId);
		if (apiKeySelection) {
			this.recordSessionCredential(provider, sessionId, "api_key", apiKeySelection.index);
			return apiKeySelection.credential.key;
		}

		const oauthKey = await this.resolveOAuthApiKey(provider, sessionId, options);
		if (oauthKey) {
			return oauthKey;
		}

		// Fall back to environment variable
		const envKey = getEnvApiKey(provider);
		if (envKey) return envKey;

		// Fall back to custom resolver (e.g., models.json custom providers)
		return this.fallbackResolver?.(provider) ?? undefined;
	}
}
