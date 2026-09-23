/**
 * Pure helpers for the stored `oauth` credential shape: account lists, the
 * selected-account index, and building a credential back from an account list.
 * Extracted from auth-storage.ts so the store keeps its size budget; nothing here
 * touches the storage lock or disk.
 */
import type { OAuthCredentials } from "omk-ai";

export type OAuthCredential = {
	type: "oauth";
	/** Complete account list when more than one subscription account is configured. */
	accounts?: OAuthCredentials[];
	/** Index of the account explicitly selected for this provider. */
	activeAccount?: number;
	/** Legacy cursor accepted when migrating older auth.json files. */
	nextAccount?: number;
} & OAuthCredentials;

export function stripOAuthStorageMetadata(credential: OAuthCredential): OAuthCredentials {
	const {
		type: _type,
		accounts: _accounts,
		activeAccount: _activeAccount,
		nextAccount: _nextAccount,
		...credentials
	} = credential;
	return credentials;
}

export function getOAuthAccounts(credential: OAuthCredential): OAuthCredentials[] {
	if (Array.isArray(credential.accounts) && credential.accounts.length > 0) {
		return credential.accounts;
	}
	return [stripOAuthStorageMetadata(credential)];
}

export function normalizeOAuthAccountIndex(index: unknown, accountCount: number): number {
	if (accountCount <= 0 || typeof index !== "number" || !Number.isInteger(index)) {
		return 0;
	}
	return ((index % accountCount) + accountCount) % accountCount;
}

export function getSelectedOAuthAccountIndex(credential: OAuthCredential, accountCount: number): number {
	return normalizeOAuthAccountIndex(credential.activeAccount ?? credential.nextAccount, accountCount);
}

export function createOAuthCredential(accounts: OAuthCredentials[], activeAccount = 0): OAuthCredential {
	const selectedIndex = normalizeOAuthAccountIndex(activeAccount, accounts.length);
	const selected = accounts[selectedIndex];
	if (!selected) {
		throw new Error("OAuth credential must contain at least one account");
	}
	if (accounts.length === 1) {
		return { ...selected, type: "oauth" };
	}
	return {
		...selected,
		type: "oauth",
		accounts,
		activeAccount: selectedIndex,
	};
}
