/**
 * Credential adoption from another CLI's own store.
 *
 * OMK never reads a foreign token store while serving a request: a request only ever uses
 * `agentDir/auth.json`. This module is the explicit bridge behind `omk provider adopt`, which copies
 * credentials this machine already holds (an OpenAI Codex CLI login, a Claude Code CLI login) into
 * OMK's store so the same subscription does not have to be signed in twice.
 *
 * Every source is read-only here. A source that cannot authenticate right now is reported as
 * `unusable` with the reason, never silently imported as a token that would fail at request time.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials, OAuthProviderId } from "omk-ai";

export type ExternalCredentialSourceId = "codex-cli" | "claude-code";

export type ExternalCredentialCandidate = {
	readonly source: ExternalCredentialSourceId;
	readonly path: string;
	readonly credentials: OAuthCredentials;
	/** One short line for the CLI report: which account was found and how long it lasts. */
	readonly detail: string;
};

export type ExternalCredentialLookup =
	| { readonly status: "found"; readonly candidate: ExternalCredentialCandidate }
	| {
			readonly status: "missing" | "unusable";
			readonly source: ExternalCredentialSourceId;
			readonly path: string;
			readonly reason: string;
	  };

export type ExternalCredentialIo = {
	readonly readFile?: (path: string) => string;
	readonly now?: () => number;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly home?: string;
};

/**
 * Providers that can adopt credentials, with the source tried first. The mapping stays explicit:
 * a source is only offered for the provider whose OAuth client minted it. The Codex CLI and OMK
 * share `app_EMoamEEZ73f0CkXaXp7hrann`, and a Claude Code CLI store holds an Anthropic OAuth grant.
 */
export const PROVIDER_CREDENTIAL_SOURCES: Readonly<Record<string, readonly ExternalCredentialSourceId[]>> = {
	"openai-codex": ["codex-cli"],
	anthropic: ["claude-code"],
};

export const EXTERNAL_CREDENTIAL_SOURCE_LABELS: Readonly<Record<ExternalCredentialSourceId, string>> = {
	"codex-cli": "OpenAI Codex CLI (~/.codex/auth.json)",
	"claude-code": "Claude Code CLI (~/.claude/.credentials.json)",
};

const CODEX_PROFILE_CLAIM = "https://api.openai.com/profile";

export function credentialSourcesFor(providerId: OAuthProviderId): readonly ExternalCredentialSourceId[] {
	return PROVIDER_CREDENTIAL_SOURCES[providerId] ?? [];
}

export function credentialSourcePath(source: ExternalCredentialSourceId, io: ExternalCredentialIo = {}): string {
	const env = io.env ?? process.env;
	const home = io.home ?? homedir();
	if (source === "codex-cli") {
		const codexHome = env.CODEX_HOME;
		return codexHome ? join(codexHome, "auth.json") : join(home, ".codex", "auth.json");
	}
	const claudeDir = env.CLAUDE_CONFIG_DIR;
	return claudeDir ? join(claudeDir, ".credentials.json") : join(home, ".claude", ".credentials.json");
}

export function readExternalCredential(
	source: ExternalCredentialSourceId,
	io: ExternalCredentialIo = {},
): ExternalCredentialLookup {
	const path = credentialSourcePath(source, io);
	const readFile = io.readFile ?? ((target: string) => readFileSync(target, "utf-8"));
	let text: string;
	try {
		text = readFile(path);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? String((error as { code?: unknown }).code)
				: "";
		if (code === "ENOENT") {
			return {
				status: "missing",
				source,
				path,
				reason: `no credential file at ${path}; sign in with the CLI first`,
			};
		}
		const message = error instanceof Error ? error.message : String(error);
		return { status: "unusable", source, path, reason: `could not read ${path}: ${message}` };
	}

	const document = parseJsonObject(text);
	if (!document) return { status: "unusable", source, path, reason: `${path} is not a JSON object` };

	const found = source === "codex-cli" ? readCodexCli(document, path, io) : readClaudeCode(document, path, io);
	return found;
}

function readCodexCli(
	document: Record<string, unknown>,
	path: string,
	io: ExternalCredentialIo,
): ExternalCredentialLookup {
	const source: ExternalCredentialSourceId = "codex-cli";
	const tokens = asRecord(document.tokens);
	if (!tokens) return { status: "unusable", source, path, reason: "the file has no tokens object" };

	const access = asString(tokens.access_token);
	const refresh = asString(tokens.refresh_token) ?? "";
	if (!access) return { status: "unusable", source, path, reason: "the store has no access token" };

	const claims = decodeJwtPayload(access);
	const expSeconds = typeof claims?.exp === "number" ? claims.exp : undefined;
	if (expSeconds === undefined) {
		return { status: "unusable", source, path, reason: "the access token carries no exp claim" };
	}
	const expires = expSeconds * 1000;
	const now = (io.now ?? Date.now)();
	if (expires <= now && !refresh) {
		return {
			status: "unusable",
			source,
			path,
			reason: `the access token expired ${formatInstant(expires)} and the store has no refresh token`,
		};
	}

	const credentials: OAuthCredentials = { access, refresh, expires };
	const accountId = asString(tokens.account_id);
	if (accountId) credentials.accountId = accountId;
	const profile = asRecord(claims?.[CODEX_PROFILE_CLAIM]);
	const email = asString(profile?.email);
	if (email) credentials.email = email;

	const who = email ?? accountId ?? "an unnamed account";
	return {
		status: "found",
		candidate: {
			source,
			path,
			credentials,
			detail: `Codex CLI token for ${who}, access valid until ${formatInstant(expires)}`,
		},
	};
}

function readClaudeCode(
	document: Record<string, unknown>,
	path: string,
	io: ExternalCredentialIo,
): ExternalCredentialLookup {
	const source: ExternalCredentialSourceId = "claude-code";
	const oauth = asRecord(document.claudeAiOauth);
	if (!oauth) return { status: "unusable", source, path, reason: "the file has no claudeAiOauth object" };

	const access = asString(oauth.accessToken);
	if (!access) return { status: "unusable", source, path, reason: "the store has no access token" };
	const refresh = asString(oauth.refreshToken) ?? "";
	const expires = typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined;
	if (expires === undefined) return { status: "unusable", source, path, reason: "the store has no expiresAt" };

	const now = (io.now ?? Date.now)();
	if (expires <= now && !refresh) {
		return {
			status: "unusable",
			source,
			path,
			reason:
				`the access token expired ${formatInstant(expires)} and the store has no refresh token; ` +
				`sign in with the Claude Code CLI again`,
		};
	}

	const credentials: OAuthCredentials = { access, refresh, expires };
	const subscription = asString(oauth.subscriptionType);
	const detail = `Claude Code CLI token (${subscription ?? "unknown plan"}), access valid until ${formatInstant(expires)}`;
	return { status: "found", candidate: { source, path, credentials, detail } };
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
	try {
		return asRecord(JSON.parse(text) as unknown);
	} catch {
		return undefined;
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Decode a JWT payload without verifying it: this only reads exp/email for a stored token. */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	const payload = parts[1];
	if (!payload) return undefined;
	try {
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
		return asRecord(JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as unknown);
	} catch {
		return undefined;
	}
}

function formatInstant(ms: number): string {
	if (!Number.isFinite(ms)) return "an unknown time";
	return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
