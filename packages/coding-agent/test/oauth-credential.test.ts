import type { OAuthCredentials } from "omk-ai";
import { describe, expect, it } from "vitest";
import {
	createOAuthCredential,
	getOAuthAccounts,
	getSelectedOAuthAccountIndex,
	normalizeOAuthAccountIndex,
	type OAuthCredential,
	stripOAuthStorageMetadata,
} from "../src/core/oauth-credential.ts";

describe("oauth-credential", () => {
	const makeCred = (id: string): OAuthCredentials => ({
		access: `access-${id}`,
		refresh: `refresh-${id}`,
		expires: 1000,
	});

	describe("normalizeOAuthAccountIndex", () => {
		it("normalizes negative and wrap-around indices", () => {
			expect(normalizeOAuthAccountIndex(-1, 3)).toBe(2);
			expect(normalizeOAuthAccountIndex(5, 3)).toBe(2);
			expect(normalizeOAuthAccountIndex(0, 3)).toBe(0);
			expect(normalizeOAuthAccountIndex(1, 3)).toBe(1);
			expect(normalizeOAuthAccountIndex(2, 3)).toBe(2);
			expect(normalizeOAuthAccountIndex(3, 3)).toBe(0);
		});

		it("returns 0 for non-integer, non-number, or empty account counts", () => {
			expect(normalizeOAuthAccountIndex(1.5, 3)).toBe(0);
			expect(normalizeOAuthAccountIndex("1", 3)).toBe(0);
			expect(normalizeOAuthAccountIndex(null, 3)).toBe(0);
			expect(normalizeOAuthAccountIndex(undefined, 3)).toBe(0);
			expect(normalizeOAuthAccountIndex(2, 0)).toBe(0);
			expect(normalizeOAuthAccountIndex(2, -1)).toBe(0);
		});
	});

	describe("getSelectedOAuthAccountIndex", () => {
		it("prefers activeAccount and falls back to legacy nextAccount", () => {
			const credWithBoth: OAuthCredential = {
				...makeCred("1"),
				type: "oauth",
				activeAccount: 2,
				nextAccount: 1,
			};
			expect(getSelectedOAuthAccountIndex(credWithBoth, 3)).toBe(2);

			const credWithLegacy: OAuthCredential = {
				...makeCred("1"),
				type: "oauth",
				nextAccount: 1,
			};
			expect(getSelectedOAuthAccountIndex(credWithLegacy, 3)).toBe(1);

			const credWithNeither: OAuthCredential = {
				...makeCred("1"),
				type: "oauth",
			};
			expect(getSelectedOAuthAccountIndex(credWithNeither, 3)).toBe(0);
		});
	});

	describe("stripOAuthStorageMetadata and getOAuthAccounts", () => {
		it("strips storage metadata fields", () => {
			const credential: OAuthCredential = {
				...makeCred("1"),
				type: "oauth",
				accounts: [makeCred("1"), makeCred("2")],
				activeAccount: 1,
				nextAccount: 0,
			};
			const stripped = stripOAuthStorageMetadata(credential);
			expect(stripped).toEqual(makeCred("1"));
			expect("type" in stripped).toBe(false);
			expect("accounts" in stripped).toBe(false);
			expect("activeAccount" in stripped).toBe(false);
			expect("nextAccount" in stripped).toBe(false);
		});

		it("returns accounts array when non-empty", () => {
			const accounts = [makeCred("1"), makeCred("2")];
			const credential: OAuthCredential = {
				...makeCred("1"),
				type: "oauth",
				accounts,
			};
			expect(getOAuthAccounts(credential)).toBe(accounts);
		});

		it("returns single-item list with stripped metadata when accounts is absent or empty", () => {
			const credential: OAuthCredential = {
				...makeCred("single"),
				type: "oauth",
				activeAccount: 0,
			};
			expect(getOAuthAccounts(credential)).toEqual([makeCred("single")]);

			const emptyAccountsCred: OAuthCredential = {
				...makeCred("single"),
				type: "oauth",
				accounts: [],
			};
			expect(getOAuthAccounts(emptyAccountsCred)).toEqual([makeCred("single")]);
		});
	});

	describe("createOAuthCredential", () => {
		it("throws when accounts list is empty", () => {
			expect(() => createOAuthCredential([])).toThrow("OAuth credential must contain at least one account");
		});

		it("creates single-account credential without accounts or activeAccount fields", () => {
			const cred = createOAuthCredential([makeCred("only")]);
			expect(cred).toEqual({
				...makeCred("only"),
				type: "oauth",
			});
			expect(cred.accounts).toBeUndefined();
			expect(cred.activeAccount).toBeUndefined();
		});

		it("creates multi-account credential and normalizes activeAccount", () => {
			const a1 = makeCred("1");
			const a2 = makeCred("2");
			const cred = createOAuthCredential([a1, a2], 3); // 3 % 2 = 1 -> a2
			expect(cred).toEqual({
				...a2,
				type: "oauth",
				accounts: [a1, a2],
				activeAccount: 1,
			});
		});

		it("handles negative activeAccount in multi-account credential", () => {
			const a1 = makeCred("1");
			const a2 = makeCred("2");
			const cred = createOAuthCredential([a1, a2], -1); // -1 -> 1 -> a2
			expect(cred).toEqual({
				...a2,
				type: "oauth",
				accounts: [a1, a2],
				activeAccount: 1,
			});
		});
	});
});
