/**
 * Credential storage for API keys and OAuth tokens.
 * Handles loading, saving, refreshing credentials, and usage tracking.
 *
 * This module defines:
 * - `AuthCredentialStore` interface: abstracting persistence (SQLite, memory, etc.)
 * - `AuthStorage` class: credential management with round-robin, usage limits, OAuth refresh
 * - `AuthCredentialStore`: concrete SQLite-backed implementation
 */
import { Database, type Statement } from "bun:sqlite";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, logger } from "@oh-my-pi/pi-utils";
import { googleGeminiCliUsageProvider } from "./providers/google-gemini-cli-usage";
import { getEnvApiKey } from "./stream";
import type { Provider } from "./types";
import type {
	CredentialRankingStrategy,
	UsageCache,
	UsageCacheEntry,
	UsageCredential,
	UsageLimit,
	UsageLogger,
	UsageProvider,
	UsageReport,
} from "./usage";
import { claudeRankingStrategy, claudeUsageProvider } from "./usage/claude";
import { githubCopilotUsageProvider } from "./usage/github-copilot";
import { antigravityUsageProvider } from "./usage/google-antigravity";
import { kimiUsageProvider } from "./usage/kimi";
import { codexRankingStrategy, openaiCodexUsageProvider } from "./usage/openai-codex";
import { zaiUsageProvider } from "./usage/zai";
import { getOAuthApiKey, getOAuthProvider } from "./utils/oauth";
// Re-export login functions so consumers of AuthStorage.login() have access
// (these are used inside the login() switch-case)
import { loginAnthropic } from "./utils/oauth/anthropic";
import { loginCerebras } from "./utils/oauth/cerebras";
import { loginCloudflareAiGateway } from "./utils/oauth/cloudflare-ai-gateway";
import { loginCursor } from "./utils/oauth/cursor";
import { loginGitHubCopilot } from "./utils/oauth/github-copilot";
import { loginGitLabDuo } from "./utils/oauth/gitlab-duo";
import { loginAntigravity } from "./utils/oauth/google-antigravity";
import { loginGeminiCli } from "./utils/oauth/google-gemini-cli";
import { loginHuggingface } from "./utils/oauth/huggingface";
import { loginKilo } from "./utils/oauth/kilo";
import { loginKimi } from "./utils/oauth/kimi";
import { loginLiteLLM } from "./utils/oauth/litellm";
import { loginMiniMaxCode, loginMiniMaxCodeCn } from "./utils/oauth/minimax-code";
import { loginMoonshot } from "./utils/oauth/moonshot";
import { loginNanoGPT } from "./utils/oauth/nanogpt";
import { loginNvidia } from "./utils/oauth/nvidia";
import { loginOllama } from "./utils/oauth/ollama";
import { loginOpenAICodex } from "./utils/oauth/openai-codex";
import { loginOpenCode } from "./utils/oauth/opencode";
import { loginPerplexity } from "./utils/oauth/perplexity";
import { loginQianfan } from "./utils/oauth/qianfan";
import { loginQwenPortal } from "./utils/oauth/qwen-portal";
import { loginSynthetic } from "./utils/oauth/synthetic";
import { loginTogether } from "./utils/oauth/together";
import type { OAuthController, OAuthCredentials, OAuthProvider, OAuthProviderId } from "./utils/oauth/types";
import { loginVenice } from "./utils/oauth/venice";
import { loginVllm } from "./utils/oauth/vllm";
import { loginXiaomi } from "./utils/oauth/xiaomi";
import { loginZai } from "./utils/oauth/zai";

// ─────────────────────────────────────────────────────────────────────────────
// Credential Types
// ─────────────────────────────────────────────────────────────────────────────

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
	dbPath?: string;
}

/**
 * Auth credential with database row ID for updates/deletes.
 * Wraps AuthCredential with storage metadata.
 */
export interface StoredAuthCredential {
	id: number;
	provider: string;
	credential: AuthCredential;
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthStorage Options
// ─────────────────────────────────────────────────────────────────────────────

export type AuthStorageOptions = {
	usageProviderResolver?: (provider: Provider) => UsageProvider | undefined;
	rankingStrategyResolver?: (provider: Provider) => CredentialRankingStrategy | undefined;
	usageCache?: UsageCache;
	usageFetch?: typeof fetch;
	usageNow?: () => number;
	usageLogger?: UsageLogger;
	/**
	 * Resolve a config value (API key, header value, etc.) to an actual value.
	 * - coding-agent injects its resolveConfigValue (supports "!command" syntax via pi-natives)
	 * - Default: checks environment variable first, then treats as literal
	 */
	configValueResolver?: (config: string) => Promise<string | undefined>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Default Config Value Resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default config value resolver that checks env vars and treats as literal.
 * Does NOT support "!command" syntax (that requires pi-natives).
 */
async function defaultConfigValueResolver(config: string): Promise<string | undefined> {
	const envValue = process.env[config];
	return envValue || config;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage Providers (defaults)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_USAGE_PROVIDERS: UsageProvider[] = [
	openaiCodexUsageProvider,
	kimiUsageProvider,
	antigravityUsageProvider,
	googleGeminiCliUsageProvider,
	claudeUsageProvider,
	zaiUsageProvider,
	githubCopilotUsageProvider,
];

const DEFAULT_USAGE_PROVIDER_MAP = new Map<Provider, UsageProvider>(
	DEFAULT_USAGE_PROVIDERS.map(provider => [provider.id, provider]),
);

const USAGE_CACHE_PREFIX = "usage_cache:";

function resolveDefaultUsageProvider(provider: Provider): UsageProvider | undefined {
	return DEFAULT_USAGE_PROVIDER_MAP.get(provider);
}

const DEFAULT_RANKING_STRATEGIES = new Map<Provider, CredentialRankingStrategy>([
	["openai-codex", codexRankingStrategy],
	["anthropic", claudeRankingStrategy],
]);

function resolveDefaultRankingStrategy(provider: Provider): CredentialRankingStrategy | undefined {
	return DEFAULT_RANKING_STRATEGIES.get(provider);
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

// ─────────────────────────────────────────────────────────────────────────────
// Usage Cache (backed by AuthCredentialStore)
// ─────────────────────────────────────────────────────────────────────────────

class AuthStorageUsageCache implements UsageCache {
	constructor(private store: AuthCredentialStore) {}

	get(key: string): UsageCacheEntry | undefined {
		const raw = this.store.getCache(`${USAGE_CACHE_PREFIX}${key}`);
		if (!raw) return undefined;
		const entry = parseUsageCacheEntry(raw);
		if (!entry) return undefined;
		if (entry.expiresAt <= Date.now()) return undefined;
		return entry;
	}

	set(key: string, entry: UsageCacheEntry): void {
		const payload = JSON.stringify({ value: entry.value ?? null, expiresAt: entry.expiresAt });
		this.store.setCache(`${USAGE_CACHE_PREFIX}${key}`, payload, Math.floor(entry.expiresAt / 1000));
	}

	cleanup(): void {
		this.store.cleanExpiredCache();
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory representation
// ─────────────────────────────────────────────────────────────────────────────

type StoredCredential = { id: number; credential: AuthCredential };

// ─────────────────────────────────────────────────────────────────────────────
// AuthStorage Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Credential storage backed by an AuthCredentialStore.
 * Reads from storage on reload(), manages round-robin credential selection,
 * usage limit tracking, and OAuth token refresh.
 */
export class AuthStorage {
	static readonly #defaultBackoffMs = 60_000; // Default backoff when no reset time available

	/** Provider -> credentials cache, populated from store on reload(). */
	#data: Map<string, StoredCredential[]> = new Map();
	#runtimeOverrides: Map<string, string> = new Map();
	/** Tracks next credential index per provider:type key for round-robin distribution (non-session use). */
	#providerRoundRobinIndex: Map<string, number> = new Map();
	/** Tracks the last used credential per provider for a session (used for rate-limit switching). */
	#sessionLastCredential: Map<string, Map<string, { type: AuthCredential["type"]; index: number }>> = new Map();
	/** Maps provider:type -> credentialIndex -> blockedUntilMs for temporary backoff. */
	#credentialBackoff: Map<string, Map<number, number>> = new Map();
	#usageProviderResolver?: (provider: Provider) => UsageProvider | undefined;
	#rankingStrategyResolver?: (provider: Provider) => CredentialRankingStrategy | undefined;
	#usageCache?: UsageCache;
	#usageFetch: typeof fetch;
	#usageNow: () => number;
	#usageLogger?: UsageLogger;
	#fallbackResolver?: (provider: string) => string | undefined;
	#store: AuthCredentialStore;
	#configValueResolver: (config: string) => Promise<string | undefined>;

	constructor(store: AuthCredentialStore, options: AuthStorageOptions = {}) {
		this.#store = store;
		this.#configValueResolver = options.configValueResolver ?? defaultConfigValueResolver;
		this.#usageProviderResolver = options.usageProviderResolver ?? resolveDefaultUsageProvider;
		this.#rankingStrategyResolver = options.rankingStrategyResolver ?? resolveDefaultRankingStrategy;
		this.#usageCache = options.usageCache ?? new AuthStorageUsageCache(this.#store);
		this.#usageFetch = options.usageFetch ?? fetch;
		this.#usageNow = options.usageNow ?? Date.now;
		this.#usageLogger =
			options.usageLogger ??
			({
				debug: (message, meta) => logger.debug(message, meta),
				warn: (message, meta) => logger.warn(message, meta),
			} satisfies UsageLogger);
	}

	/**
	 * Create an AuthStorage instance backed by a AuthCredentialStore.
	 * Convenience factory for standalone use (e.g., pi-ai CLI).
	 * @param dbPath - Path to SQLite database
	 */
	static async create(dbPath: string, options: AuthStorageOptions = {}): Promise<AuthStorage> {
		const store = await AuthCredentialStore.open(dbPath);
		return new AuthStorage(store, options);
	}

	/**
	 * Set a runtime API key override (not persisted to disk).
	 * Used for CLI --api-key flag.
	 */
	setRuntimeApiKey(provider: string, apiKey: string): void {
		this.#runtimeOverrides.set(provider, apiKey);
	}

	/**
	 * Remove a runtime API key override.
	 */
	removeRuntimeApiKey(provider: string): void {
		this.#runtimeOverrides.delete(provider);
	}

	/**
	 * Set a fallback resolver for API keys not found in storage or env vars.
	 * Used for custom provider keys from models.json.
	 */
	setFallbackResolver(resolver: (provider: string) => string | undefined): void {
		this.#fallbackResolver = resolver;
	}

	/**
	 * Reload credentials from storage.
	 */
	async reload(): Promise<void> {
		const records = this.#store.listAuthCredentials();
		const grouped = new Map<string, StoredCredential[]>();
		for (const record of records) {
			const list = grouped.get(record.provider) ?? [];
			list.push({ id: record.id, credential: record.credential });
			grouped.set(record.provider, list);
		}

		const dedupedGrouped = new Map<string, StoredCredential[]>();
		for (const [provider, entries] of grouped.entries()) {
			const deduped = this.#pruneDuplicateStoredCredentials(provider, entries);
			if (deduped.length > 0) {
				dedupedGrouped.set(provider, deduped);
			}
		}
		this.#data = dedupedGrouped;
	}

	/**
	 * Gets cached credentials for a provider.
	 * @param provider - Provider name (e.g., "anthropic", "openai")
	 * @returns Array of stored credentials, empty if none exist
	 */
	#getStoredCredentials(provider: string): StoredCredential[] {
		return this.#data.get(provider) ?? [];
	}

	/**
	 * Updates in-memory credential cache for a provider.
	 * Removes the provider entry entirely if credentials array is empty.
	 * @param provider - Provider name (e.g., "anthropic", "openai")
	 * @param credentials - Array of stored credentials to cache
	 */
	#setStoredCredentials(provider: string, credentials: StoredCredential[]): void {
		if (credentials.length === 0) {
			this.#data.delete(provider);
		} else {
			this.#data.set(provider, credentials);
		}
	}

	#getOAuthIdentifiers(credential: OAuthCredential): string[] {
		const identifiers: string[] = [];
		const accountId = credential.accountId?.trim();
		if (accountId) identifiers.push(`account:${accountId}`);
		const email = credential.email?.trim().toLowerCase();
		if (email) identifiers.push(`email:${email}`);
		if (identifiers.length > 0) return identifiers;
		const tokenIdentifiers = this.#getOAuthIdentifiersFromToken(credential.access) ?? [];
		for (const identifier of tokenIdentifiers) {
			identifiers.push(identifier);
		}
		if (identifiers.length > 0) return identifiers;
		const refreshIdentifiers = this.#getOAuthIdentifiersFromToken(credential.refresh) ?? [];
		for (const identifier of refreshIdentifiers) {
			identifiers.push(identifier);
		}
		return identifiers;
	}

	#getOAuthIdentifiersFromToken(token: string | undefined): string[] | undefined {
		if (!token) return undefined;
		const parts = token.split(".");
		if (parts.length !== 3) return undefined;
		const payloadRaw = parts[1];
		const decoder = new TextDecoder("utf-8");
		try {
			const payload = JSON.parse(
				decoder.decode(Uint8Array.fromBase64(payloadRaw, { alphabet: "base64url" })),
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

	#resolveOAuthDedupeIdentifiers(provider: string, credential: OAuthCredential): string[] {
		const identifiers = this.#getOAuthIdentifiers(credential);
		if (provider !== "openai-codex") return identifiers;
		return identifiers.filter(identifier => identifier.startsWith("email:"));
	}

	#dedupeOAuthCredentials(provider: string, credentials: AuthCredential[]): AuthCredential[] {
		const seen = new Set<string>();
		const deduped: AuthCredential[] = [];
		for (let index = credentials.length - 1; index >= 0; index -= 1) {
			const credential = credentials[index];
			if (credential.type !== "oauth") {
				deduped.push(credential);
				continue;
			}
			const identifiers = this.#resolveOAuthDedupeIdentifiers(provider, credential);
			if (identifiers.length === 0) {
				deduped.push(credential);
				continue;
			}
			if (identifiers.some(identifier => seen.has(identifier))) {
				continue;
			}
			for (const identifier of identifiers) {
				seen.add(identifier);
			}
			deduped.push(credential);
		}
		return deduped.reverse();
	}

	#pruneDuplicateStoredCredentials(provider: string, entries: StoredCredential[]): StoredCredential[] {
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
			const identifiers = this.#resolveOAuthDedupeIdentifiers(provider, credential);
			if (identifiers.length === 0) {
				kept.push(entry);
				continue;
			}
			if (identifiers.some(identifier => seen.has(identifier))) {
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
				this.#store.deleteAuthCredential(entry.id);
			}
			this.#resetProviderAssignments(provider);
		}
		return kept.reverse();
	}

	/** Returns all credentials for a provider as an array */
	#getCredentialsForProvider(provider: string): AuthCredential[] {
		return this.#getStoredCredentials(provider).map(entry => entry.credential);
	}

	/** Composite key for round-robin tracking: "anthropic:oauth" or "openai:api_key" */
	#getProviderTypeKey(provider: string, type: AuthCredential["type"]): string {
		return `${provider}:${type}`;
	}

	/**
	 * Returns next index in round-robin sequence for load distribution.
	 * Increments stored counter and wraps at total.
	 */
	#getNextRoundRobinIndex(providerKey: string, total: number): number {
		if (total <= 1) return 0;
		const current = this.#providerRoundRobinIndex.get(providerKey) ?? -1;
		const next = (current + 1) % total;
		this.#providerRoundRobinIndex.set(providerKey, next);
		return next;
	}

	/**
	 * FNV-1a hash for deterministic session-to-credential mapping.
	 * Ensures the same session always starts with the same credential.
	 */
	#getHashedIndex(sessionId: string, total: number): number {
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
	#getCredentialOrder(providerKey: string, sessionId: string | undefined, total: number): number[] {
		if (total <= 1) return [0];
		const start = sessionId
			? this.#getHashedIndex(sessionId, total)
			: this.#getNextRoundRobinIndex(providerKey, total);
		const order: number[] = [];
		for (let i = 0; i < total; i++) {
			order.push((start + i) % total);
		}
		return order;
	}

	/** Returns block expiry timestamp for a credential, cleaning up expired entries. */
	#getCredentialBlockedUntil(providerKey: string, credentialIndex: number): number | undefined {
		const backoffMap = this.#credentialBackoff.get(providerKey);
		if (!backoffMap) return undefined;
		const blockedUntil = backoffMap.get(credentialIndex);
		if (!blockedUntil) return undefined;
		if (blockedUntil <= Date.now()) {
			backoffMap.delete(credentialIndex);
			if (backoffMap.size === 0) {
				this.#credentialBackoff.delete(providerKey);
			}
			return undefined;
		}
		return blockedUntil;
	}

	/** Checks if a credential is temporarily blocked due to usage limits. */
	#isCredentialBlocked(providerKey: string, credentialIndex: number): boolean {
		return this.#getCredentialBlockedUntil(providerKey, credentialIndex) !== undefined;
	}

	/** Marks a credential as blocked until the specified time. */
	#markCredentialBlocked(providerKey: string, credentialIndex: number, blockedUntilMs: number): void {
		const backoffMap = this.#credentialBackoff.get(providerKey) ?? new Map<number, number>();
		const existing = backoffMap.get(credentialIndex) ?? 0;
		backoffMap.set(credentialIndex, Math.max(existing, blockedUntilMs));
		this.#credentialBackoff.set(providerKey, backoffMap);
	}

	/** Records which credential was used for a session (for rate-limit switching). */
	#recordSessionCredential(
		provider: string,
		sessionId: string | undefined,
		type: AuthCredential["type"],
		index: number,
	): void {
		if (!sessionId) return;
		const sessionMap = this.#sessionLastCredential.get(provider) ?? new Map();
		sessionMap.set(sessionId, { type, index });
		this.#sessionLastCredential.set(provider, sessionMap);
	}

	/** Retrieves the last credential used by a session. */
	#getSessionCredential(
		provider: string,
		sessionId: string | undefined,
	): { type: AuthCredential["type"]; index: number } | undefined {
		if (!sessionId) return undefined;
		return this.#sessionLastCredential.get(provider)?.get(sessionId);
	}

	/**
	 * Selects a credential of the specified type for a provider.
	 * Returns both the credential and its index in the original array (for updates/removal).
	 * Uses deterministic hashing for session stickiness and skips blocked credentials when possible.
	 */
	#selectCredentialByType<T extends AuthCredential["type"]>(
		provider: string,
		type: T,
		sessionId?: string,
	): { credential: Extract<AuthCredential, { type: T }>; index: number } | undefined {
		const credentials = this.#getCredentialsForProvider(provider)
			.map((credential, index) => ({ credential, index }))
			.filter(
				(entry): entry is { credential: Extract<AuthCredential, { type: T }>; index: number } =>
					entry.credential.type === type,
			);

		if (credentials.length === 0) return undefined;
		if (credentials.length === 1) return credentials[0];

		const providerKey = this.#getProviderTypeKey(provider, type);
		const order = this.#getCredentialOrder(providerKey, sessionId, credentials.length);
		const fallback = credentials[order[0]];

		for (const idx of order) {
			const candidate = credentials[idx];
			if (!this.#isCredentialBlocked(providerKey, candidate.index)) {
				return candidate;
			}
		}

		return fallback;
	}

	/**
	 * Clears round-robin and session assignment state for a provider.
	 * Called when credentials are added/removed to prevent stale index references.
	 */
	#resetProviderAssignments(provider: string): void {
		for (const key of this.#providerRoundRobinIndex.keys()) {
			if (key.startsWith(`${provider}:`)) {
				this.#providerRoundRobinIndex.delete(key);
			}
		}
		this.#sessionLastCredential.delete(provider);
		for (const key of this.#credentialBackoff.keys()) {
			if (key.startsWith(`${provider}:`)) {
				this.#credentialBackoff.delete(key);
			}
		}
	}

	/** Updates credential at index in-place (used for OAuth token refresh) */
	#replaceCredentialAt(provider: string, index: number, credential: AuthCredential): void {
		const entries = this.#getStoredCredentials(provider);
		if (index < 0 || index >= entries.length) return;
		const target = entries[index];
		this.#store.updateAuthCredential(target.id, credential);
		const updated = [...entries];
		updated[index] = { id: target.id, credential };
		this.#setStoredCredentials(provider, updated);
	}

	/**
	 * Disables credential at index (used when OAuth refresh fails).
	 * The credential remains in the database but is excluded from active queries.
	 * Cleans up provider entry if last credential disabled.
	 */
	#removeCredentialAt(provider: string, index: number): void {
		const entries = this.#getStoredCredentials(provider);
		if (index < 0 || index >= entries.length) return;
		this.#store.deleteAuthCredential(entries[index].id);
		const updated = entries.filter((_value, idx) => idx !== index);
		this.#setStoredCredentials(provider, updated);
		this.#resetProviderAssignments(provider);
	}

	/**
	 * Get credential for a provider (first entry if multiple).
	 */
	get(provider: string): AuthCredential | undefined {
		return this.#getCredentialsForProvider(provider)[0];
	}

	/**
	 * Set credential for a provider.
	 */
	async set(provider: string, credential: AuthCredentialEntry): Promise<void> {
		const normalized = Array.isArray(credential) ? credential : [credential];
		const deduped = this.#dedupeOAuthCredentials(provider, normalized);
		const stored = this.#store.replaceAuthCredentialsForProvider(provider, deduped);
		this.#setStoredCredentials(
			provider,
			stored.map(record => ({ id: record.id, credential: record.credential })),
		);
		this.#resetProviderAssignments(provider);
	}

	/**
	 * Remove credential for a provider.
	 */
	async remove(provider: string): Promise<void> {
		this.#store.deleteAuthCredentialsForProvider(provider);
		this.#data.delete(provider);
		this.#resetProviderAssignments(provider);
	}

	/**
	 * List all providers with credentials.
	 */
	list(): string[] {
		return [...this.#data.keys()];
	}

	/**
	 * Check if credentials exist for a provider in storage.
	 */
	has(provider: string): boolean {
		return this.#getCredentialsForProvider(provider).length > 0;
	}

	/**
	 * Check if any form of auth is configured for a provider.
	 * Unlike getApiKey(), this doesn't refresh OAuth tokens.
	 */
	hasAuth(provider: string): boolean {
		if (this.#runtimeOverrides.has(provider)) return true;
		if (this.#getCredentialsForProvider(provider).length > 0) return true;
		if (getEnvApiKey(provider)) return true;
		if (this.#fallbackResolver?.(provider)) return true;
		return false;
	}

	/**
	 * Check if OAuth credentials are configured for a provider.
	 */
	hasOAuth(provider: string): boolean {
		return this.#getCredentialsForProvider(provider).some(credential => credential.type === "oauth");
	}

	/**
	 * Get OAuth credentials for a provider.
	 */
	getOAuthCredential(provider: string): OAuthCredential | undefined {
		return this.#getCredentialsForProvider(provider).find(
			(credential): credential is OAuthCredential => credential.type === "oauth",
		);
	}

	/**
	 * Get all credentials.
	 */
	getAll(): AuthStorageData {
		const result: AuthStorageData = {};
		for (const [provider, entries] of this.#data.entries()) {
			const credentials = entries.map(entry => entry.credential);
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
		provider: OAuthProviderId,
		ctrl: OAuthController & {
			/** onAuth is required by auth-storage but optional in OAuthController */
			onAuth: (info: { url: string; instructions?: string }) => void;
			/** onPrompt is required for some providers (github-copilot, openai-codex) */
			onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
		},
	): Promise<void> {
		let credentials: OAuthCredentials;
		const saveApiKeyCredential = async (apiKey: string): Promise<void> => {
			const newCredential: ApiKeyCredential = { type: "api_key", key: apiKey };
			const shouldReplaceExisting = provider === "minimax-code" || provider === "minimax-code-cn";
			if (shouldReplaceExisting) {
				await this.set(provider, newCredential);
				return;
			}
			const existing = this.#getCredentialsForProvider(provider);
			if (existing.length === 0) {
				await this.set(provider, newCredential);
				return;
			}
			await this.set(provider, [...existing, newCredential]);
		};
		const manualCodeInput = () => ctrl.onPrompt({ message: "Paste the authorization code (or full redirect URL):" });
		switch (provider) {
			case "anthropic":
				credentials = await loginAnthropic({
					...ctrl,
					onManualCodeInput: ctrl.onManualCodeInput ?? manualCodeInput,
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
				credentials = await loginGeminiCli({
					...ctrl,
					onManualCodeInput: ctrl.onManualCodeInput ?? manualCodeInput,
				});
				break;
			case "google-antigravity":
				credentials = await loginAntigravity({
					...ctrl,
					onManualCodeInput: ctrl.onManualCodeInput ?? manualCodeInput,
				});
				break;
			case "openai-codex":
				credentials = await loginOpenAICodex({
					...ctrl,
					onManualCodeInput: ctrl.onManualCodeInput ?? manualCodeInput,
				});
				break;
			case "gitlab-duo":
				credentials = await loginGitLabDuo({
					...ctrl,
					onManualCodeInput: ctrl.onManualCodeInput ?? manualCodeInput,
				});
				break;
			case "kimi-code":
				credentials = await loginKimi(ctrl);
				break;
			case "kilo":
				credentials = await loginKilo(ctrl);
				break;
			case "cursor":
				credentials = await loginCursor(
					url => ctrl.onAuth({ url }),
					ctrl.onProgress ? () => ctrl.onProgress?.("Waiting for browser authentication...") : undefined,
				);
				break;
			case "perplexity":
				credentials = await loginPerplexity(ctrl);
				break;
			case "huggingface": {
				const apiKey = await loginHuggingface(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "opencode": {
				const apiKey = await loginOpenCode(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "ollama": {
				const apiKey = await loginOllama(ctrl);
				if (!apiKey) {
					return;
				}
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "cerebras": {
				const apiKey = await loginCerebras(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "zai": {
				const apiKey = await loginZai(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "qianfan": {
				const apiKey = await loginQianfan(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "minimax-code": {
				const apiKey = await loginMiniMaxCode(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "minimax-code-cn": {
				const apiKey = await loginMiniMaxCodeCn(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "synthetic": {
				const apiKey = await loginSynthetic(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "venice": {
				const apiKey = await loginVenice(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "litellm": {
				const apiKey = await loginLiteLLM(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "moonshot": {
				const apiKey = await loginMoonshot(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "nanogpt": {
				const apiKey = await loginNanoGPT(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "together": {
				const apiKey = await loginTogether(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "cloudflare-ai-gateway": {
				const apiKey = await loginCloudflareAiGateway(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "vllm": {
				const apiKey = await loginVllm(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "qwen-portal": {
				const apiKey = await loginQwenPortal(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "nvidia": {
				const apiKey = await loginNvidia(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			case "xiaomi": {
				const apiKey = await loginXiaomi(ctrl);
				await saveApiKeyCredential(apiKey);
				return;
			}
			default: {
				const customProvider = getOAuthProvider(provider);
				if (!customProvider) {
					throw new Error(`Unknown OAuth provider: ${provider}`);
				}
				const customLoginResult = await customProvider.login({
					onAuth: info => ctrl.onAuth(info),
					onProgress: ctrl.onProgress,
					onPrompt: ctrl.onPrompt,
					onManualCodeInput: ctrl.onManualCodeInput ?? manualCodeInput,
					signal: ctrl.signal,
				});
				if (typeof customLoginResult === "string") {
					await saveApiKeyCredential(customLoginResult);
					return;
				}
				credentials = customLoginResult;
				break;
			}
		}
		const newCredential: OAuthCredential = { type: "oauth", ...credentials };
		const existing = this.#getCredentialsForProvider(provider);
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

	#buildUsageCredential(credential: OAuthCredential): UsageCredential {
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

	#getUsageReportMetadataValue(report: UsageReport, key: string): string | undefined {
		const metadata = report.metadata;
		if (!metadata || typeof metadata !== "object") return undefined;
		const value = metadata[key];
		return typeof value === "string" ? value.trim() : undefined;
	}

	#getUsageReportScopeAccountId(report: UsageReport): string | undefined {
		const ids = new Set<string>();
		for (const limit of report.limits) {
			const accountId = limit.scope.accountId?.trim();
			if (accountId) ids.add(accountId);
		}
		if (ids.size === 1) return [...ids][0];
		return undefined;
	}

	#getUsageReportIdentifiers(report: UsageReport): string[] {
		const identifiers: string[] = [];
		const email = this.#getUsageReportMetadataValue(report, "email");
		if (email) identifiers.push(`email:${email.toLowerCase()}`);
		if (report.provider === "openai-codex" || report.provider === "anthropic") {
			return identifiers.map(identifier => `${report.provider}:${identifier.toLowerCase()}`);
		}
		const accountId = this.#getUsageReportMetadataValue(report, "accountId");
		if (accountId) identifiers.push(`account:${accountId}`);
		const account = this.#getUsageReportMetadataValue(report, "account");
		if (account) identifiers.push(`account:${account}`);
		const user = this.#getUsageReportMetadataValue(report, "user");
		if (user) identifiers.push(`account:${user}`);
		const username = this.#getUsageReportMetadataValue(report, "username");
		if (username) identifiers.push(`account:${username}`);
		const scopeAccountId = this.#getUsageReportScopeAccountId(report);
		if (scopeAccountId) identifiers.push(`account:${scopeAccountId}`);
		return identifiers.map(identifier => `${report.provider}:${identifier.toLowerCase()}`);
	}

	#mergeUsageReportGroup(reports: UsageReport[]): UsageReport {
		if (reports.length === 1) return reports[0];
		const sorted = [...reports].sort((a, b) => {
			const limitDiff = b.limits.length - a.limits.length;
			if (limitDiff !== 0) return limitDiff;
			return (b.fetchedAt ?? 0) - (a.fetchedAt ?? 0);
		});
		const base = sorted[0];
		const mergedLimits = [...base.limits];
		const limitIds = new Set(mergedLimits.map(limit => limit.id));
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

	#dedupeUsageReports(reports: UsageReport[]): UsageReport[] {
		const groups: UsageReport[][] = [];
		const idToGroup = new Map<string, number>();

		for (const report of reports) {
			const identifiers = this.#getUsageReportIdentifiers(report);
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

		const deduped = groups.map(group => this.#mergeUsageReportGroup(group));
		if (deduped.length !== reports.length) {
			this.#usageLogger?.debug("Usage reports deduped", {
				before: reports.length,
				after: deduped.length,
			});
		}
		return deduped;
	}

	#isUsageLimitExhausted(limit: UsageLimit): boolean {
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
	#isUsageLimitReached(report: UsageReport): boolean {
		return report.limits.some(limit => this.#isUsageLimitExhausted(limit));
	}

	/** Extracts the earliest reset timestamp from exhausted windows (in ms). */
	#getUsageResetAtMs(report: UsageReport, nowMs: number): number | undefined {
		const candidates: number[] = [];
		for (const limit of report.limits) {
			if (!this.#isUsageLimitExhausted(limit)) continue;
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

	async #getUsageReport(
		provider: Provider,
		credential: OAuthCredential,
		options?: { baseUrl?: string },
	): Promise<UsageReport | null> {
		const resolver = this.#usageProviderResolver;
		const cache = this.#usageCache;
		if (!resolver || !cache) return null;

		const providerImpl = resolver(provider);
		if (!providerImpl) return null;

		const params = {
			provider,
			credential: this.#buildUsageCredential(credential),
			baseUrl: options?.baseUrl,
		};

		if (providerImpl.supports && !providerImpl.supports(params)) return null;

		try {
			return await providerImpl.fetchUsage(params, {
				cache,
				fetch: this.#usageFetch,
				now: this.#usageNow,
				logger: this.#usageLogger,
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
		const resolver = this.#usageProviderResolver;
		const cache = this.#usageCache;
		if (!resolver || !cache) return null;

		const tasks: Array<Promise<UsageReport | null>> = [];
		const providers = new Set<string>([
			...this.#data.keys(),
			...DEFAULT_USAGE_PROVIDERS.map(provider => provider.id),
		]);
		this.#usageLogger?.debug("Usage fetch requested", {
			providers: Array.from(providers).sort(),
		});
		for (const provider of providers) {
			const providerImpl = resolver(provider as Provider);
			if (!providerImpl) continue;
			const baseUrl = options?.baseUrlResolver?.(provider as Provider);
			let entries = this.#getStoredCredentials(provider);
			if (entries.length > 0) {
				const dedupedEntries = this.#pruneDuplicateStoredCredentials(provider, entries);
				if (dedupedEntries.length !== entries.length) {
					this.#setStoredCredentials(provider, dedupedEntries);
				}
				entries = dedupedEntries;
			}

			if (entries.length === 0) {
				const runtimeKey = this.#runtimeOverrides.get(provider);
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
				this.#usageLogger?.debug("Usage fetch queued", {
					provider,
					credentialType: "api_key",
					baseUrl,
				});
				tasks.push(
					providerImpl
						.fetchUsage(params, {
							cache,
							fetch: this.#usageFetch,
							now: this.#usageNow,
							logger: this.#usageLogger,
						})
						.catch(error => {
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
						: this.#buildUsageCredential(credential);
				const params = {
					provider: provider as Provider,
					credential: usageCredential,
					baseUrl,
				};

				if (providerImpl.supports && !providerImpl.supports(params)) {
					continue;
				}

				this.#usageLogger?.debug("Usage fetch queued", {
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
							fetch: this.#usageFetch,
							now: this.#usageNow,
							logger: this.#usageLogger,
						})
						.catch(error => {
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
		const deduped = this.#dedupeUsageReports(reports);
		this.#usageLogger?.debug("Usage fetch resolved", {
			reports: deduped.map(report => {
				const accountLabel =
					this.#getUsageReportMetadataValue(report, "email") ??
					this.#getUsageReportMetadataValue(report, "accountId") ??
					this.#getUsageReportMetadataValue(report, "account") ??
					this.#getUsageReportMetadataValue(report, "user") ??
					this.#getUsageReportMetadataValue(report, "username") ??
					this.#getUsageReportScopeAccountId(report);
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
		const sessionCredential = this.#getSessionCredential(provider, sessionId);
		if (!sessionCredential) return false;

		const providerKey = this.#getProviderTypeKey(provider, sessionCredential.type);
		const now = this.#usageNow();
		let blockedUntil = now + (options?.retryAfterMs ?? AuthStorage.#defaultBackoffMs);

		if (sessionCredential.type === "oauth" && this.#rankingStrategyResolver?.(provider)) {
			const credential = this.#getCredentialsForProvider(provider)[sessionCredential.index];
			if (credential?.type === "oauth") {
				const report = await this.#getUsageReport(provider, credential, options);
				if (report && this.#isUsageLimitReached(report)) {
					const resetAtMs = this.#getUsageResetAtMs(report, this.#usageNow());
					if (resetAtMs && resetAtMs > blockedUntil) {
						blockedUntil = resetAtMs;
					}
				}
			}
		}

		this.#markCredentialBlocked(providerKey, sessionCredential.index, blockedUntil);

		const remainingCredentials = this.#getCredentialsForProvider(provider)
			.map((credential, index) => ({ credential, index }))
			.filter(
				(entry): entry is { credential: AuthCredential; index: number } =>
					entry.credential.type === sessionCredential.type && entry.index !== sessionCredential.index,
			);

		return remainingCredentials.some(candidate => !this.#isCredentialBlocked(providerKey, candidate.index));
	}

	#resolveWindowResetInMs(window: UsageLimit["window"], nowMs: number): number | undefined {
		if (!window) return undefined;
		if (typeof window.resetInMs === "number" && Number.isFinite(window.resetInMs)) {
			return window.resetInMs;
		}
		if (typeof window.resetsAt === "number" && Number.isFinite(window.resetsAt)) {
			return window.resetsAt - nowMs;
		}
		return undefined;
	}

	#normalizeUsageFraction(limit: UsageLimit | undefined): number {
		const usedFraction = limit?.amount.usedFraction;
		if (typeof usedFraction !== "number" || !Number.isFinite(usedFraction)) {
			return 0.5;
		}
		return Math.min(Math.max(usedFraction, 0), 1);
	}

	/** Computes `usedFraction / elapsedHours` — consumption rate per hour within the current window. Lower drain rate = less pressure = preferred. */
	#computeWindowDrainRate(limit: UsageLimit | undefined, nowMs: number, fallbackDurationMs: number): number {
		const usedFraction = this.#normalizeUsageFraction(limit);
		const durationMs = limit?.window?.durationMs ?? fallbackDurationMs;
		if (!Number.isFinite(durationMs) || durationMs <= 0) {
			return usedFraction;
		}
		const resetInMs = this.#resolveWindowResetInMs(limit?.window, nowMs);
		if (!Number.isFinite(resetInMs)) {
			return usedFraction;
		}
		const clampedResetInMs = Math.min(Math.max(resetInMs as number, 0), durationMs);
		const elapsedMs = durationMs - clampedResetInMs;
		if (elapsedMs <= 0) {
			return usedFraction;
		}
		const elapsedHours = elapsedMs / (60 * 60 * 1000);
		if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) {
			return usedFraction;
		}
		return usedFraction / elapsedHours;
	}

	async #rankOAuthSelections(args: {
		providerKey: string;
		provider: string;
		order: number[];
		credentials: Array<{ credential: OAuthCredential; index: number }>;
		options?: { baseUrl?: string };
		strategy: CredentialRankingStrategy;
	}): Promise<
		Array<{
			selection: { credential: OAuthCredential; index: number };
			usage: UsageReport | null;
			usageChecked: boolean;
		}>
	> {
		const nowMs = this.#usageNow();
		const { strategy } = args;
		const ranked: Array<{
			selection: { credential: OAuthCredential; index: number };
			usage: UsageReport | null;
			usageChecked: boolean;
			blocked: boolean;
			blockedUntil?: number;
			hasPriorityBoost: boolean;
			secondaryUsed: number;
			secondaryDrainRate: number;
			primaryUsed: number;
			primaryDrainRate: number;
			orderPos: number;
		}> = [];
		// Pre-fetch usage reports in parallel for non-blocked credentials
		const usageResults = await Promise.all(
			args.order.map(async idx => {
				const selection = args.credentials[idx];
				if (!selection) return null;
				const blockedUntil = this.#getCredentialBlockedUntil(args.providerKey, selection.index);
				if (blockedUntil !== undefined) return { selection, usage: null, usageChecked: false, blockedUntil };
				const usage = await this.#getUsageReport(args.provider, selection.credential, args.options);
				return { selection, usage, usageChecked: true, blockedUntil: undefined as number | undefined };
			}),
		);

		for (let orderPos = 0; orderPos < usageResults.length; orderPos += 1) {
			const result = usageResults[orderPos];
			if (!result) continue;
			const { selection, usage, usageChecked } = result;
			let { blockedUntil } = result;
			let blocked = blockedUntil !== undefined;
			if (!blocked && usage && this.#isUsageLimitReached(usage)) {
				const resetAtMs = this.#getUsageResetAtMs(usage, nowMs);
				blockedUntil = resetAtMs ?? nowMs + AuthStorage.#defaultBackoffMs;
				this.#markCredentialBlocked(args.providerKey, selection.index, blockedUntil);
				blocked = true;
			}
			const windows = usage ? strategy.findWindowLimits(usage) : undefined;
			const primary = windows?.primary;
			const secondary = windows?.secondary;
			const secondaryTarget = secondary ?? primary;
			ranked.push({
				selection,
				usage,
				usageChecked,
				blocked,
				blockedUntil,
				hasPriorityBoost: strategy.hasPriorityBoost?.(primary) ?? false,
				secondaryUsed: this.#normalizeUsageFraction(secondaryTarget),
				secondaryDrainRate: this.#computeWindowDrainRate(
					secondaryTarget,
					nowMs,
					strategy.windowDefaults.secondaryMs,
				),
				primaryUsed: this.#normalizeUsageFraction(primary),
				primaryDrainRate: this.#computeWindowDrainRate(primary, nowMs, strategy.windowDefaults.primaryMs),
				orderPos,
			});
		}
		ranked.sort((left, right) => {
			if (left.blocked !== right.blocked) return left.blocked ? 1 : -1;
			if (left.blocked && right.blocked) {
				const leftBlockedUntil = left.blockedUntil ?? Number.POSITIVE_INFINITY;
				const rightBlockedUntil = right.blockedUntil ?? Number.POSITIVE_INFINITY;
				if (leftBlockedUntil !== rightBlockedUntil) return leftBlockedUntil - rightBlockedUntil;
				return left.orderPos - right.orderPos;
			}
			if (left.hasPriorityBoost !== right.hasPriorityBoost) {
				return left.hasPriorityBoost ? -1 : 1;
			}
			if (left.secondaryDrainRate !== right.secondaryDrainRate)
				return left.secondaryDrainRate - right.secondaryDrainRate;
			if (left.secondaryUsed !== right.secondaryUsed) return left.secondaryUsed - right.secondaryUsed;
			if (left.primaryDrainRate !== right.primaryDrainRate) return left.primaryDrainRate - right.primaryDrainRate;
			if (left.primaryUsed !== right.primaryUsed) return left.primaryUsed - right.primaryUsed;
			return left.orderPos - right.orderPos;
		});
		return ranked.map(candidate => ({
			selection: candidate.selection,
			usage: candidate.usage,
			usageChecked: candidate.usageChecked,
		}));
	}

	/**
	 * Resolves an OAuth API key, trying credentials in priority order.
	 * Skips blocked credentials and checks usage limits for providers with usage data.
	 * Falls back to earliest-unblocking credential if all are blocked.
	 */
	async #resolveOAuthApiKey(
		provider: string,
		sessionId?: string,
		options?: { baseUrl?: string },
	): Promise<string | undefined> {
		const credentials = this.#getCredentialsForProvider(provider)
			.map((credential, index) => ({ credential, index }))
			.filter((entry): entry is { credential: OAuthCredential; index: number } => entry.credential.type === "oauth");

		if (credentials.length === 0) return undefined;

		const providerKey = this.#getProviderTypeKey(provider, "oauth");
		const order = this.#getCredentialOrder(providerKey, sessionId, credentials.length);
		const strategy = this.#rankingStrategyResolver?.(provider);
		const checkUsage = strategy !== undefined && credentials.length > 1;
		const candidates = checkUsage
			? await this.#rankOAuthSelections({ providerKey, provider, order, credentials, options, strategy })
			: order
					.map(idx => credentials[idx])
					.filter((selection): selection is { credential: OAuthCredential; index: number } => Boolean(selection))
					.map(selection => ({ selection, usage: null, usageChecked: false }));
		const fallback = candidates[0];

		for (const candidate of candidates) {
			const apiKey = await this.#tryOAuthCredential(provider, candidate.selection, providerKey, sessionId, options, {
				checkUsage,
				allowBlocked: false,
				prefetchedUsage: candidate.usage,
				usagePrechecked: candidate.usageChecked,
			});
			if (apiKey) return apiKey;
		}

		if (fallback && this.#isCredentialBlocked(providerKey, fallback.selection.index)) {
			return this.#tryOAuthCredential(provider, fallback.selection, providerKey, sessionId, options, {
				checkUsage,
				allowBlocked: true,
				prefetchedUsage: fallback.usage,
				usagePrechecked: fallback.usageChecked,
			});
		}

		return undefined;
	}

	/** Attempts to use a single OAuth credential, checking usage and refreshing token. */
	async #tryOAuthCredential(
		provider: Provider,
		selection: { credential: OAuthCredential; index: number },
		providerKey: string,
		sessionId: string | undefined,
		options: { baseUrl?: string } | undefined,
		usageOptions: {
			checkUsage: boolean;
			allowBlocked: boolean;
			prefetchedUsage?: UsageReport | null;
			usagePrechecked?: boolean;
		},
	): Promise<string | undefined> {
		const { checkUsage, allowBlocked, prefetchedUsage = null, usagePrechecked = false } = usageOptions;
		if (!allowBlocked && this.#isCredentialBlocked(providerKey, selection.index)) {
			return undefined;
		}

		let usage: UsageReport | null = null;
		let usageChecked = false;

		if (checkUsage && !allowBlocked) {
			if (usagePrechecked) {
				usage = prefetchedUsage;
				usageChecked = true;
			} else {
				usage = await this.#getUsageReport(provider, selection.credential, options);
				usageChecked = true;
			}
			if (usage && this.#isUsageLimitReached(usage)) {
				const resetAtMs = this.#getUsageResetAtMs(usage, this.#usageNow());
				this.#markCredentialBlocked(
					providerKey,
					selection.index,
					resetAtMs ?? this.#usageNow() + AuthStorage.#defaultBackoffMs,
				);
				return undefined;
			}
		}

		try {
			let result: { newCredentials: OAuthCredentials; apiKey: string } | null;
			const customProvider = getOAuthProvider(provider);
			if (customProvider) {
				let refreshedCredentials: OAuthCredentials = selection.credential;
				if (Date.now() >= refreshedCredentials.expires) {
					if (!customProvider.refreshToken) {
						throw new Error(`OAuth provider "${provider}" does not support token refresh`);
					}
					refreshedCredentials = await customProvider.refreshToken(refreshedCredentials);
				}
				const apiKey = customProvider.getApiKey
					? customProvider.getApiKey(refreshedCredentials)
					: refreshedCredentials.access;
				result = { newCredentials: refreshedCredentials, apiKey };
			} else {
				const oauthCreds: Record<string, OAuthCredentials> = {
					[provider]: selection.credential,
				};
				result = await getOAuthApiKey(provider as OAuthProvider, oauthCreds);
			}
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
			this.#replaceCredentialAt(provider, selection.index, updated);
			if (checkUsage && !allowBlocked) {
				const sameAccount = selection.credential.accountId === updated.accountId;
				if (!usageChecked || !sameAccount) {
					usage = await this.#getUsageReport(provider, updated, options);
				}
				if (usage && this.#isUsageLimitReached(usage)) {
					const resetAtMs = this.#getUsageResetAtMs(usage, this.#usageNow());
					this.#markCredentialBlocked(
						providerKey,
						selection.index,
						resetAtMs ?? this.#usageNow() + AuthStorage.#defaultBackoffMs,
					);
					return undefined;
				}
			}
			this.#recordSessionCredential(provider, sessionId, "oauth", selection.index);
			return result.apiKey;
		} catch (error) {
			const errorMsg = String(error);
			// Only remove credentials for definitive auth failures
			// Keep credentials for transient errors (network, 5xx) and block temporarily
			const isDefinitiveFailure =
				/invalid_grant|invalid_token|revoked|unauthorized|expired.*refresh|refresh.*expired/i.test(errorMsg) ||
				(/\b(401|403)\b/.test(errorMsg) && !/timeout|network|fetch failed|ECONNREFUSED/i.test(errorMsg));

			logger.warn("OAuth token refresh failed", {
				provider,
				index: selection.index,
				error: errorMsg,
				isDefinitiveFailure,
			});

			if (isDefinitiveFailure) {
				// Permanently remove invalid credentials
				this.#removeCredentialAt(provider, selection.index);
				if (this.#getCredentialsForProvider(provider).some(credential => credential.type === "oauth")) {
					return this.getApiKey(provider, sessionId, options);
				}
			} else {
				// Block temporarily for transient failures (5 minutes)
				this.#markCredentialBlocked(providerKey, selection.index, this.#usageNow() + 5 * 60 * 1000);
			}
		}

		return undefined;
	}

	/**
	 * Peek at API key for a provider without refreshing OAuth tokens.
	 * Used for model discovery where we only need to know if credentials exist
	 * and get a best-effort token. The actual refresh happens lazily when the
	 * provider is used for an API call.
	 */
	async peekApiKey(provider: string): Promise<string | undefined> {
		const runtimeKey = this.#runtimeOverrides.get(provider);
		if (runtimeKey) {
			return runtimeKey;
		}

		const apiKeySelection = this.#selectCredentialByType(provider, "api_key");
		if (apiKeySelection) {
			return this.#configValueResolver(apiKeySelection.credential.key);
		}

		// Return current OAuth access token only if it is not already expired.
		const oauthSelection = this.#selectCredentialByType(provider, "oauth");
		if (oauthSelection) {
			const expiresAt = oauthSelection.credential.expires;
			if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
				return oauthSelection.credential.access;
			}
		}

		const envKey = getEnvApiKey(provider);
		if (envKey) return envKey;

		return this.#fallbackResolver?.(provider) ?? undefined;
	}

	/**
	 * Get API key for a provider.
	 * Priority:
	 * 1. Runtime override (CLI --api-key)
	 * 2. API key from storage
	 * 3. OAuth token from storage (auto-refreshed)
	 * 4. Environment variable
	 * 5. Fallback resolver (models.json custom providers)
	 */
	async getApiKey(provider: string, sessionId?: string, options?: { baseUrl?: string }): Promise<string | undefined> {
		// Runtime override takes highest priority
		const runtimeKey = this.#runtimeOverrides.get(provider);
		if (runtimeKey) {
			return runtimeKey;
		}

		const apiKeySelection = this.#selectCredentialByType(provider, "api_key", sessionId);
		if (apiKeySelection) {
			this.#recordSessionCredential(provider, sessionId, "api_key", apiKeySelection.index);
			return this.#configValueResolver(apiKeySelection.credential.key);
		}

		const oauthKey = await this.#resolveOAuthApiKey(provider, sessionId, options);
		if (oauthKey) {
			return oauthKey;
		}

		// Fall back to environment variable
		const envKey = getEnvApiKey(provider);
		if (envKey) return envKey;

		// Fall back to custom resolver (e.g., models.json custom providers)
		return this.#fallbackResolver?.(provider) ?? undefined;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthCredentialStore
// ─────────────────────────────────────────────────────────────────────────────

/** Row shape for auth_credentials table queries */
type AuthRow = {
	id: number;
	provider: string;
	credential_type: string;
	data: string;
};

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

function deserializeCredential(row: AuthRow): AuthCredential | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.data);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
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
 * Get default path to agent.db
 */
function getAgentDbPath(): string {
	return path.join(getAgentDir(), "agent.db");
}

/**
 * Standalone SQLite-backed implementation of AuthCredentialStore interface.
 * Used by the pi-ai CLI and as the default store for AuthStorage.create().
 * Also has convenience methods for simple CRUD (saveOAuth, getOAuth, etc.).
 */
export class AuthCredentialStore {
	#db: Database;
	#listActiveStmt: Statement;
	#listActiveByProviderStmt: Statement;
	#insertStmt: Statement;
	#updateStmt: Statement;
	#deleteStmt: Statement;
	#deleteByProviderStmt: Statement;
	#getCacheStmt: Statement;
	#upsertCacheStmt: Statement;
	#deleteExpiredCacheStmt: Statement;
	#listAllStmt: Statement;
	#listByProviderStmt: Statement;

	constructor(db: Database) {
		this.#db = db;
		this.#initializeSchema();

		this.#listActiveStmt = this.#db.prepare(
			"SELECT id, provider, credential_type, data FROM auth_credentials WHERE disabled = 0 ORDER BY id ASC",
		);
		this.#listActiveByProviderStmt = this.#db.prepare(
			"SELECT id, provider, credential_type, data FROM auth_credentials WHERE provider = ? AND disabled = 0 ORDER BY id ASC",
		);
		this.#listAllStmt = this.#db.prepare(
			"SELECT id, provider, credential_type, data FROM auth_credentials WHERE disabled = 0 ORDER BY id ASC",
		);
		this.#listByProviderStmt = this.#db.prepare(
			"SELECT id, provider, credential_type, data FROM auth_credentials WHERE provider = ? AND disabled = 0 ORDER BY id ASC",
		);
		this.#insertStmt = this.#db.prepare(
			"INSERT INTO auth_credentials (provider, credential_type, data) VALUES (?, ?, ?) RETURNING id",
		);
		this.#updateStmt = this.#db.prepare(
			"UPDATE auth_credentials SET credential_type = ?, data = ?, updated_at = unixepoch() WHERE id = ?",
		);
		this.#deleteStmt = this.#db.prepare(
			"UPDATE auth_credentials SET disabled = 1, updated_at = unixepoch() WHERE id = ?",
		);
		this.#deleteByProviderStmt = this.#db.prepare(
			"UPDATE auth_credentials SET disabled = 1, updated_at = unixepoch() WHERE provider = ?",
		);
		this.#getCacheStmt = this.#db.prepare("SELECT value FROM cache WHERE key = ? AND expires_at > unixepoch()");
		this.#upsertCacheStmt = this.#db.prepare(
			"INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
		);
		this.#deleteExpiredCacheStmt = this.#db.prepare("DELETE FROM cache WHERE expires_at <= unixepoch()");
	}

	static async open(dbPath: string = getAgentDbPath()): Promise<AuthCredentialStore> {
		const dir = path.dirname(dbPath);
		const dirExists = await fs
			.stat(dir)
			.then(s => s.isDirectory())
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

		return new AuthCredentialStore(db);
	}

	#initializeSchema(): void {
		this.#db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS auth_credentials (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	provider TEXT NOT NULL,
	credential_type TEXT NOT NULL,
	data TEXT NOT NULL,
	disabled INTEGER NOT NULL DEFAULT 0,
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
		`);

		// Migration: add disabled column if missing (for databases created by old CliAuthStorage)
		const cols = this.#db.prepare("PRAGMA table_info(auth_credentials)").all() as Array<{ name?: string }>;
		if (!cols.some(c => c.name === "disabled")) {
			this.#db.exec("ALTER TABLE auth_credentials ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
		}
	}

	// ─── AuthCredentialStore interface ──────────────────────────────────────

	listAuthCredentials(provider?: string): StoredAuthCredential[] {
		const rows =
			(provider
				? (this.#listActiveByProviderStmt.all(provider) as AuthRow[])
				: (this.#listActiveStmt.all() as AuthRow[])) ?? [];

		const results: StoredAuthCredential[] = [];
		for (const row of rows) {
			const credential = deserializeCredential(row);
			if (!credential) continue;
			results.push({ id: row.id, provider: row.provider, credential });
		}
		return results;
	}

	replaceAuthCredentialsForProvider(provider: string, credentials: AuthCredential[]): StoredAuthCredential[] {
		const replace = this.#db.transaction((providerName: string, items: AuthCredential[]) => {
			this.#deleteByProviderStmt.run(providerName);
			const inserted: StoredAuthCredential[] = [];
			for (const credential of items) {
				const serialized = serializeCredential(credential);
				if (!serialized) continue;
				const row = this.#insertStmt.get(providerName, serialized.credentialType, serialized.data) as
					| { id?: number }
					| undefined;
				if (row?.id) {
					inserted.push({ id: row.id, provider: providerName, credential });
				}
			}
			return inserted;
		});

		return replace(provider, credentials);
	}

	updateAuthCredential(id: number, credential: AuthCredential): void {
		const serialized = serializeCredential(credential);
		if (!serialized) return;
		try {
			this.#updateStmt.run(serialized.credentialType, serialized.data, id);
		} catch {
			// Ignore update failures
		}
	}

	deleteAuthCredential(id: number): void {
		try {
			this.#deleteStmt.run(id);
		} catch {
			// Ignore delete failures
		}
	}

	deleteAuthCredentialsForProvider(provider: string): void {
		try {
			this.#deleteByProviderStmt.run(provider);
		} catch {
			// Ignore delete failures
		}
	}

	getCache(key: string): string | null {
		try {
			const row = this.#getCacheStmt.get(key) as { value?: string } | undefined;
			return row?.value ?? null;
		} catch {
			return null;
		}
	}

	setCache(key: string, value: string, expiresAtSec: number): void {
		try {
			this.#upsertCacheStmt.run(key, value, expiresAtSec);
		} catch {
			// Ignore cache set failures
		}
	}

	cleanExpiredCache(): void {
		try {
			this.#deleteExpiredCacheStmt.run();
		} catch {
			// Ignore cleanup errors
		}
	}

	// ─── Convenience methods for CLI ────────────────────────────────────────

	/**
	 * Save OAuth credentials for a provider (replaces existing).
	 */
	saveOAuth(provider: string, credentials: OAuthCredentials): void {
		const credential: AuthCredential = { type: "oauth", ...credentials };
		this.replaceAuthCredentialsForProvider(provider, [credential]);
	}

	/**
	 * Get OAuth credentials for a provider.
	 */
	getOAuth(provider: string): OAuthCredentials | null {
		const rows = this.#listByProviderStmt.all(provider) as AuthRow[];
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
	 * Save API key for a provider (replaces existing).
	 */
	saveApiKey(provider: string, apiKey: string): void {
		const credential: AuthCredential = { type: "api_key", key: apiKey };
		this.replaceAuthCredentialsForProvider(provider, [credential]);
	}

	/**
	 * Get API key for a provider.
	 */
	getApiKey(provider: string): string | null {
		const rows = this.#listByProviderStmt.all(provider) as AuthRow[];
		for (const row of rows) {
			const credential = deserializeCredential(row);
			if (credential && credential.type === "api_key") {
				return credential.key;
			}
		}
		return null;
	}

	/**
	 * List all providers with credentials.
	 */
	listProviders(): string[] {
		const rows = this.#listAllStmt.all() as AuthRow[];
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
		this.deleteAuthCredentialsForProvider(provider);
	}

	close(): void {
		this.#db.close();
	}
}
