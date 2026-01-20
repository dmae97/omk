/**
 * Credential storage for API keys and OAuth tokens.
 * Handles loading, saving, and refreshing credentials from agent.db.
 */

import { dirname, join } from "node:path";
import {
	getEnvApiKey,
	getOAuthApiKey,
	loginAnthropic,
	loginAntigravity,
	loginCursor,
	loginGeminiCli,
	loginGitHubCopilot,
	loginOpenAICodex,
	type OAuthController,
	type OAuthCredentials,
	type OAuthProvider,
} from "@oh-my-pi/pi-ai";
import { logger } from "@oh-my-pi/pi-utils";
import { getAgentDbPath, getAuthPath } from "../config";
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

/** Rate limit window from Codex usage API (primary or secondary quota). */
type CodexUsageWindow = {
	usedPercent?: number;
	limitWindowSeconds?: number;
	resetAt?: number; // Unix timestamp (seconds)
};

/** Parsed usage data from Codex /wham/usage endpoint. */
type CodexUsage = {
	allowed?: boolean;
	limitReached?: boolean;
	primary?: CodexUsageWindow;
	secondary?: CodexUsageWindow;
};

/** Cached usage entry with TTL for avoiding redundant API calls. */
type CodexUsageCacheEntry = {
	fetchedAt: number;
	expiresAt: number;
	usage?: CodexUsage;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

/**
 * Credential storage backed by agent.db.
 * Reads from SQLite and migrates legacy auth.json paths.
 */
export class AuthStorage {
	private static readonly codexUsageCacheTtlMs = 60_000; // Cache usage data for 1 minute
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
	/** Cached usage info for providers that expose usage endpoints. */
	private codexUsageCache: Map<string, CodexUsageCacheEntry> = new Map();
	private fallbackResolver?: (provider: string) => string | undefined;

	/**
	 * @param authPath - Legacy auth.json path used for migration and locating agent.db
	 * @param fallbackPaths - Additional auth.json paths to migrate (legacy support)
	 */
	constructor(
		private authPath: string,
		private fallbackPaths: string[] = [],
	) {
		this.dbPath = AuthStorage.resolveDbPath(authPath);
		this.storage = AgentStorage.open(this.dbPath);
	}

	/**
	 * Create an in-memory AuthStorage instance from serialized data.
	 * Used by subagent workers to bypass discovery and use parent's credentials.
	 */
	static fromSerialized(data: SerializedAuthStorage): AuthStorage {
		const instance = Object.create(AuthStorage.prototype) as AuthStorage;
		const authPath = data.authPath ?? data.dbPath ?? getAuthPath();
		instance.authPath = authPath;
		instance.fallbackPaths = [];
		instance.dbPath = data.dbPath ?? AuthStorage.resolveDbPath(authPath);
		instance.storage = AgentStorage.open(instance.dbPath);
		instance.data = new Map();
		instance.runtimeOverrides = new Map();
		instance.providerRoundRobinIndex = new Map();
		instance.sessionLastCredential = new Map();
		instance.credentialBackoff = new Map();
		instance.codexUsageCache = new Map();

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
		this.data = grouped;
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
		const stored = this.storage.replaceAuthCredentialsForProvider(provider, normalized);
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
				credentials = await loginAnthropic(ctrl);
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
	// Codex Usage API Integration
	// Queries ChatGPT/Codex usage endpoints to detect rate limits before they occur.
	// ─────────────────────────────────────────────────────────────────────────────

	/** Normalizes Codex base URL to include /backend-api path. */
	private normalizeCodexBaseUrl(baseUrl?: string): string {
		const fallback = "https://chatgpt.com/backend-api";
		const trimmed = baseUrl?.trim() ? baseUrl.trim() : fallback;
		const base = trimmed.replace(/\/+$/, "");
		const lower = base.toLowerCase();
		if (
			(lower.startsWith("https://chatgpt.com") || lower.startsWith("https://chat.openai.com")) &&
			!lower.includes("/backend-api")
		) {
			return `${base}/backend-api`;
		}
		return base;
	}

	private getCodexUsagePath(baseUrl: string): string {
		return baseUrl.includes("/backend-api") ? "wham/usage" : "api/codex/usage";
	}

	private buildCodexUsageUrl(baseUrl: string, path: string): string {
		const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
		return `${normalized}${path.replace(/^\/+/, "")}`;
	}

	private getCodexUsageCacheKey(accountId: string, baseUrl: string): string {
		return `${baseUrl}|${accountId}`;
	}

	private extractCodexUsageWindow(window: unknown): CodexUsageWindow | undefined {
		if (!isRecord(window)) return undefined;
		const usedPercent = toNumber(window.used_percent);
		const limitWindowSeconds = toNumber(window.limit_window_seconds);
		const resetAt = toNumber(window.reset_at);
		if (usedPercent === undefined && limitWindowSeconds === undefined && resetAt === undefined) return undefined;
		return { usedPercent, limitWindowSeconds, resetAt };
	}

	private extractCodexUsage(payload: unknown): CodexUsage | undefined {
		if (!isRecord(payload)) return undefined;
		const rateLimit = isRecord(payload.rate_limit) ? payload.rate_limit : undefined;
		if (!rateLimit) return undefined;
		const primary = this.extractCodexUsageWindow(rateLimit.primary_window);
		const secondary = this.extractCodexUsageWindow(rateLimit.secondary_window);
		const usage: CodexUsage = {
			allowed: toBoolean(rateLimit.allowed),
			limitReached: toBoolean(rateLimit.limit_reached),
			primary,
			secondary,
		};
		if (!primary && !secondary && usage.allowed === undefined && usage.limitReached === undefined) return undefined;
		return usage;
	}

	/** Returns true if usage indicates rate limit has been reached. */
	private isCodexUsageLimitReached(usage: CodexUsage): boolean {
		if (usage.allowed === false || usage.limitReached === true) return true;
		if (usage.primary?.usedPercent !== undefined && usage.primary.usedPercent >= 100) return true;
		if (usage.secondary?.usedPercent !== undefined && usage.secondary.usedPercent >= 100) return true;
		return false;
	}

	/** Extracts the earliest reset timestamp from usage windows (in ms). */
	private getCodexResetAtMs(usage: CodexUsage): number | undefined {
		const now = Date.now();
		const candidates: number[] = [];
		const addCandidate = (value: number | undefined) => {
			if (!value) return;
			const ms = value > 1_000_000_000_000 ? value : value * 1000;
			if (Number.isFinite(ms) && ms > now) {
				candidates.push(ms);
			}
		};
		const useAll = usage.limitReached === true || usage.allowed === false;
		if (useAll) {
			addCandidate(usage.primary?.resetAt);
			addCandidate(usage.secondary?.resetAt);
		} else {
			if (usage.primary?.usedPercent !== undefined && usage.primary.usedPercent >= 100) {
				addCandidate(usage.primary.resetAt);
			}
			if (usage.secondary?.usedPercent !== undefined && usage.secondary.usedPercent >= 100) {
				addCandidate(usage.secondary.resetAt);
			}
		}
		if (candidates.length === 0) return undefined;
		return Math.min(...candidates);
	}

	private getCodexUsageExpiryMs(usage: CodexUsage, nowMs: number): number {
		const resetAtMs = this.getCodexResetAtMs(usage);
		if (this.isCodexUsageLimitReached(usage)) {
			if (resetAtMs) return resetAtMs;
			return nowMs + AuthStorage.defaultBackoffMs;
		}
		const defaultExpiry = nowMs + AuthStorage.codexUsageCacheTtlMs;
		if (!resetAtMs) return defaultExpiry;
		return Math.min(defaultExpiry, resetAtMs);
	}

	/** Fetches usage data from Codex API. */
	private async fetchCodexUsage(credential: OAuthCredential, baseUrl?: string): Promise<CodexUsage | undefined> {
		const accountId = credential.accountId;
		if (!accountId) return undefined;

		const normalizedBase = this.normalizeCodexBaseUrl(baseUrl);
		const url = this.buildCodexUsageUrl(normalizedBase, this.getCodexUsagePath(normalizedBase));
		const headers = {
			authorization: `Bearer ${credential.access}`,
			"chatgpt-account-id": accountId,
			"openai-beta": "responses=experimental",
			originator: "codex_cli_rs",
		};

		try {
			const response = await fetch(url, { headers });
			if (!response.ok) {
				logger.debug("AuthStorage codex usage fetch failed", {
					status: response.status,
					statusText: response.statusText,
				});
				return undefined;
			}

			const payload = (await response.json()) as unknown;
			return this.extractCodexUsage(payload);
		} catch (error) {
			logger.debug("AuthStorage codex usage fetch error", { error: String(error) });
			return undefined;
		}
	}

	/** Gets usage data with caching to avoid redundant API calls. */
	private async getCodexUsage(credential: OAuthCredential, baseUrl?: string): Promise<CodexUsage | undefined> {
		const accountId = credential.accountId;
		if (!accountId) return undefined;

		const normalizedBase = this.normalizeCodexBaseUrl(baseUrl);
		const cacheKey = this.getCodexUsageCacheKey(accountId, normalizedBase);
		const now = Date.now();

		// Check in-memory cache first (fastest)
		const memCached = this.codexUsageCache.get(cacheKey);
		if (memCached && memCached.expiresAt > now) {
			return memCached.usage;
		}

		// Check DB cache (survives restarts)
		const dbCached = this.storage.getCache(`codex_usage:${cacheKey}`);
		if (dbCached) {
			try {
				const parsed = JSON.parse(dbCached) as CodexUsage;
				// Store in memory for faster subsequent access
				this.codexUsageCache.set(cacheKey, {
					fetchedAt: now,
					expiresAt: now + AuthStorage.codexUsageCacheTtlMs,
					usage: parsed,
				});
				return parsed;
			} catch {
				// Invalid cache, continue to fetch
			}
		}

		// Fetch from API
		const usage = await this.fetchCodexUsage(credential, normalizedBase);
		if (usage) {
			const expiresAt = this.getCodexUsageExpiryMs(usage, now);
			this.codexUsageCache.set(cacheKey, { fetchedAt: now, expiresAt, usage });
			// Store in DB with 60s TTL
			this.storage.setCache(
				`codex_usage:${cacheKey}`,
				JSON.stringify(usage),
				Math.floor((now + AuthStorage.codexUsageCacheTtlMs) / 1000),
			);
			return usage;
		}

		this.codexUsageCache.set(cacheKey, {
			fetchedAt: now,
			expiresAt: now + AuthStorage.defaultBackoffMs,
		});
		return undefined;
	}

	/**
	 * Marks the current session's credential as temporarily blocked due to usage limits.
	 * Queries the Codex usage API to determine accurate reset time.
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
		const now = Date.now();
		let blockedUntil = now + (options?.retryAfterMs ?? AuthStorage.defaultBackoffMs);

		if (provider === "openai-codex" && sessionCredential.type === "oauth") {
			const credential = this.getCredentialsForProvider(provider)[sessionCredential.index];
			if (credential?.type === "oauth") {
				const usage = await this.getCodexUsage(credential, options?.baseUrl);
				if (usage) {
					const resetAtMs = this.getCodexResetAtMs(usage);
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
	 * Skips blocked credentials and checks usage limits for Codex accounts.
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

		if (checkUsage) {
			const usage = await this.getCodexUsage(selection.credential, options?.baseUrl);
			if (usage && this.isCodexUsageLimitReached(usage)) {
				const resetAtMs = this.getCodexResetAtMs(usage);
				this.markCredentialBlocked(
					providerKey,
					selection.index,
					resetAtMs ?? Date.now() + AuthStorage.defaultBackoffMs,
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

			const updated: OAuthCredential = { type: "oauth", ...result.newCredentials };
			this.replaceCredentialAt(provider, selection.index, updated);

			if (checkUsage) {
				const usage = await this.getCodexUsage(updated, options?.baseUrl);
				if (usage && this.isCodexUsageLimitReached(usage)) {
					const resetAtMs = this.getCodexResetAtMs(usage);
					this.markCredentialBlocked(
						providerKey,
						selection.index,
						resetAtMs ?? Date.now() + AuthStorage.defaultBackoffMs,
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
