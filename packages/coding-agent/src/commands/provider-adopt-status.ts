/**
 * `--status` reporting helpers for `omk provider adopt`.
 *
 * Extracted from provider-adopt-cli.ts so the command stays under the module-size
 * ceiling: account health rendering and store enumeration are independent of the
 * adoption write path.
 */
import { readFileSync } from "node:fs";
import type { OAuthCredentials } from "omk-ai";
import type { AuthStorage } from "../core/auth-storage.ts";

export type AccountHealth = {
	readonly index: number;
	readonly label: string;
	readonly selected: boolean;
	readonly state: "valid" | "refreshable" | "expired";
	readonly expiresAt?: number;
	readonly hasRefresh: boolean;
};

export function describeAccounts(storage: AuthStorage, providerId: string, now: number): AccountHealth[] {
	const credential = storage.get(providerId);
	if (credential?.type !== "oauth") return [];
	const labels = storage.listOAuthAccounts(providerId);
	const accounts: OAuthCredentials[] =
		Array.isArray(credential.accounts) && credential.accounts.length > 0 ? credential.accounts : [credential];
	const selectedIndex = typeof credential.activeAccount === "number" ? credential.activeAccount : 0;
	return accounts.map((account, index) => {
		const expires = typeof account.expires === "number" ? account.expires : undefined;
		const hasRefresh = Boolean(account.refresh);
		const state: AccountHealth["state"] =
			expires !== undefined && expires > now ? "valid" : hasRefresh ? "refreshable" : "expired";
		return {
			index,
			label: labels.find((entry) => entry.index === index)?.label ?? `Account ${index + 1}`,
			selected: index === selectedIndex,
			state,
			expiresAt: expires,
			hasRefresh,
		};
	});
}

function formatInstant(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms)) return "an unknown time";
	return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function accountLine(account: AccountHealth): string {
	const selected = account.selected ? "selected" : "not selected";
	if (account.state === "valid")
		return `valid until ${formatInstant(account.expiresAt)}, refresh ${account.hasRefresh ? "yes" : "no"} (${selected})`;
	if (account.state === "refreshable")
		return `expired ${formatInstant(account.expiresAt)}, refreshes on use (${selected})`;
	return `expired ${formatInstant(account.expiresAt)}, no refresh token: sign in again (${selected})`;
}

export function storedProviderIds(authPath: string, readFile: (path: string) => string): readonly string[] {
	try {
		const parsed: unknown = JSON.parse(readFile(authPath));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
		return Object.keys(parsed as Record<string, unknown>).sort();
	} catch {
		return [];
	}
}

export function writeStatusReport(input: {
	readonly storage: AuthStorage;
	readonly providerIds: readonly string[];
	readonly json: boolean;
	readonly authPath: string;
	readonly writeLine: (line: string) => void;
	readonly now: number;
}): void {
	const providers = input.providerIds.map((providerId) => {
		const credential = input.storage.get(providerId);
		const kind = credential?.type === "oauth" ? "oauth" : credential?.type === "api_key" ? "api_key" : "none";
		const accounts = kind === "oauth" ? describeAccounts(input.storage, providerId, input.now) : [];
		return { provider: providerId, kind, accounts };
	});
	if (input.json) {
		input.writeLine(JSON.stringify({ status: "reported", authPath: input.authPath, providers }, null, 2));
		return;
	}
	input.writeLine(`${input.authPath}`);
	for (const entry of providers) {
		if (entry.kind === "none") {
			input.writeLine(`  ${entry.provider}: no stored credential`);
			continue;
		}
		if (entry.kind === "api_key") {
			input.writeLine(`  ${entry.provider}: API key stored`);
			continue;
		}
		input.writeLine(`  ${entry.provider}: ${entry.accounts.length} OAuth account(s)`);
		for (const account of entry.accounts) {
			input.writeLine(`    [${account.index}] ${account.label} ${accountLine(account)}`);
		}
	}
}

export function readAuthStoreFile(authPath: string): string {
	return readFileSync(authPath, "utf-8");
}
