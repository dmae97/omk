/**
 * Pure matching/preview logic for `omk provider adopt` account imports.
 *
 * Extracted from auth-storage.ts so the credential store keeps its size budget:
 * these functions depend only on the stored account list and the incoming
 * credentials, never on the storage lock or persistence.
 */
import type { OAuthCredentials } from "omk-ai";
import { getOAuthProvider } from "omk-ai/oauth";
import { stripAnsi } from "../utils/ansi.ts";

export interface OAuthAccountSummary {
	index: number;
	label: string;
	selected: boolean;
}

const OAUTH_ACCOUNT_ID_FIELDS = ["accountId", "email", "userId", "username"] as const;
const OAUTH_ACCOUNT_LABEL_FIELDS = ["email", "username"] as const;
const OAUTH_ACCOUNT_LABEL_MAX_LENGTH = 96;
const UNSAFE_ACCOUNT_LABEL_PATTERN =
	/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

function sanitizeOAuthAccountLabel(value: string): string | undefined {
	const sanitized = stripAnsi(value)
		.replace(/[\t\r\n]+/g, " ")
		.replace(UNSAFE_ACCOUNT_LABEL_PATTERN, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, OAUTH_ACCOUNT_LABEL_MAX_LENGTH);
	return sanitized || undefined;
}

/** Canonical identity of an OAuth account, used to match an import against stored accounts. */
function getOAuthAccountIdentity(credentials: OAuthCredentials): string | undefined {
	const accountId = credentials.accountId;
	const orgId = credentials.orgId;
	if (typeof accountId === "string" && accountId.trim() && typeof orgId === "string" && orgId.trim()) {
		return `accountId:${accountId.trim().toLowerCase()}:orgId:${orgId.trim().toLowerCase()}`;
	}
	for (const field of OAUTH_ACCOUNT_ID_FIELDS) {
		const value = credentials[field];
		if (typeof value === "string" && value.trim()) {
			return `${field}:${value.trim().toLowerCase()}`;
		}
	}
	return undefined;
}

/** Human-facing label for one stored account: a sanitized identity field or the provider's own label. */
export function getOAuthAccountDisplayLabel(providerId: string, credentials: OAuthCredentials): string | undefined {
	for (const field of OAUTH_ACCOUNT_LABEL_FIELDS) {
		const value = credentials[field];
		if (typeof value === "string" && value.trim()) {
			const label = sanitizeOAuthAccountLabel(value);
			if (!label) continue;
			const orgName =
				typeof credentials.orgName === "string" ? sanitizeOAuthAccountLabel(credentials.orgName) : undefined;
			return sanitizeOAuthAccountLabel(orgName ? `${label} (${orgName})` : label);
		}
	}
	try {
		const label = getOAuthProvider(providerId)?.getAccountLabel?.(credentials);
		return typeof label === "string" ? sanitizeOAuthAccountLabel(label) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Match stored accounts to fresh credentials at login: exact identity first, then a compatible
 * field match so enriched credentials update entries that predate email/org metadata, then the
 * refresh token.
 */
export function findMatchingOAuthAccount(accounts: OAuthCredentials[], credentials: OAuthCredentials): number {
	const identity = getOAuthAccountIdentity(credentials);
	if (identity) {
		const exactMatch = accounts.findIndex((account) => getOAuthAccountIdentity(account) === identity);
		if (exactMatch >= 0) return exactMatch;
	}

	for (const field of OAUTH_ACCOUNT_ID_FIELDS) {
		const value = credentials[field];
		if (typeof value !== "string" || !value.trim()) continue;
		const normalizedValue = value.trim().toLowerCase();
		const orgId = typeof credentials.orgId === "string" ? credentials.orgId.trim().toLowerCase() : "";
		const compatibleMatch = accounts.findIndex((account) => {
			const existingValue = account[field];
			if (typeof existingValue !== "string" || existingValue.trim().toLowerCase() !== normalizedValue) return false;
			const existingOrgId = typeof account.orgId === "string" ? account.orgId.trim().toLowerCase() : "";
			return !orgId || !existingOrgId || orgId === existingOrgId;
		});
		if (compatibleMatch >= 0) return compatibleMatch;
	}

	return accounts.findIndex((account) => account.refresh === credentials.refresh);
}

/** Outcome of importing an account from an external credential store. */
export type OAuthAccountImport = {
	readonly action: "imported" | "updated" | "unchanged" | "blocked";
	readonly accountIndex?: number;
	readonly reason?: string;
};

/**
 * Merge an incoming credential over the stored one. A credential that carries no
 * refresh token must not erase a still-usable stored refresh token: a source that
 * keeps only the access token would otherwise strand the account at expiry.
 */
export function mergeImportedCredential(
	current: OAuthCredentials | undefined,
	incoming: OAuthCredentials,
): OAuthCredentials {
	return {
		...current,
		...incoming,
		refresh: incoming.refresh || current?.refresh || incoming.refresh,
	};
}

/**
 * Match an incoming account to a stored one: by account identity when both sides expose one, or by
 * the refresh token for stores that keep only tokens (the Claude Code CLI writes no account id).
 */
export function findOAuthAccountMatch(accounts: OAuthCredentials[], credentials: OAuthCredentials): number {
	const identity = getOAuthAccountIdentity(credentials);
	return accounts.findIndex((account) => {
		const storedIdentity = getOAuthAccountIdentity(account);
		if (identity && storedIdentity) return storedIdentity === identity;
		return Boolean(credentials.refresh) && account.refresh === credentials.refresh;
	});
}

/**
 * Predict what an import would do, without writing. Keeps `--dry-run` honest: the preview
 * and the write share one matching rule.
 */
export function previewOAuthAccountImport(input: {
	readonly loadError: boolean;
	readonly existing: { readonly type: string } | undefined;
	readonly accounts: OAuthCredentials[];
	readonly credentials: OAuthCredentials;
	readonly now?: number;
}): OAuthAccountImport {
	if (input.loadError) {
		return { action: "blocked", reason: "the credential store could not be read" };
	}
	const accounts = input.existing?.type === "oauth" ? input.accounts : [];
	const matchIndex = findOAuthAccountMatch([...accounts], input.credentials);
	if (matchIndex < 0) return { action: "imported", accountIndex: accounts.length };
	const current = accounts[matchIndex];
	const now = input.now ?? Date.now();
	if (current && typeof current.expires === "number" && current.expires > now) {
		return { action: "unchanged", accountIndex: matchIndex, reason: "the stored account is still valid" };
	}
	return { action: "updated", accountIndex: matchIndex };
}
