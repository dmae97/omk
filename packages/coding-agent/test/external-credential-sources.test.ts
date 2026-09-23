import { describe, expect, it } from "vitest";
import {
	credentialSourcePath,
	decodeJwtPayload,
	readExternalCredential,
} from "../src/core/external-credential-sources.ts";

// The library compares against the wall clock, so the fixtures must sit relative to it: a fake
// "now" in the past would make a "valid" account look expired and flip the expected action.
const NOW = Date.now();
const HOUR = 3_600_000;

function jwt(payload: Record<string, unknown>): string {
	const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

function codexDocument(access: string, refresh: string, accountId = "acct-1"): string {
	return JSON.stringify({ tokens: { access_token: access, refresh_token: refresh, account_id: accountId } });
}

function claudeDocument(access: string, refresh: string, expiresAt: number): string {
	return JSON.stringify({
		claudeAiOauth: { accessToken: access, refreshToken: refresh, expiresAt, subscriptionType: "max" },
	});
}

function enoent(): Error {
	return Object.assign(new Error("no such file or directory"), { code: "ENOENT" });
}

describe("external credential sources", () => {
	describe("codex-cli", () => {
		it("reads a valid access token, its expiry and the account identity", () => {
			const access = jwt({ exp: (NOW + HOUR) / 1000, "https://api.openai.com/profile": { email: "a@example.com" } });
			const result = readExternalCredential("codex-cli", {
				readFile: () => codexDocument(access, "refresh-1"),
				now: () => NOW,
				env: { CODEX_HOME: "/codex-home" },
			});
			expect(result.status).toBe("found");
			if (result.status !== "found") return;
			expect(result.candidate.path).toBe("/codex-home/auth.json");
			expect(result.candidate.credentials.access).toBe(access);
			expect(result.candidate.credentials.refresh).toBe("refresh-1");
			expect(result.candidate.credentials.expires).toBe(NOW + HOUR);
			expect(result.candidate.credentials.accountId).toBe("acct-1");
			expect(result.candidate.credentials.email).toBe("a@example.com");
			expect(result.candidate.detail).toContain("a@example.com");
		});

		it("refuses an expired token that has no refresh token", () => {
			const access = jwt({ exp: (NOW - HOUR) / 1000 });
			const result = readExternalCredential("codex-cli", {
				readFile: () => codexDocument(access, ""),
				now: () => NOW,
			});
			expect(result.status).toBe("unusable");
			if (result.status !== "unusable") return;
			expect(result.reason).toMatch(/expired/);
			expect(result.reason).toMatch(/no refresh token/);
		});

		it("still adopts an expired token when the store can refresh it", () => {
			const access = jwt({ exp: (NOW - HOUR) / 1000 });
			const result = readExternalCredential("codex-cli", {
				readFile: () => codexDocument(access, "refresh-1"),
				now: () => NOW,
			});
			expect(result.status).toBe("found");
		});

		it("reports a missing store with the sign-in hint", () => {
			const result = readExternalCredential("codex-cli", {
				readFile: () => {
					throw enoent();
				},
				now: () => NOW,
				home: "/home/u",
				// An explicit empty env keeps the home fallback deterministic: the machine running the
				// suite may export CODEX_HOME (the Codex CLI's own resolution) and change the path.
				env: {},
			});
			expect(result.status).toBe("missing");
			if (result.status !== "missing") return;
			expect(result.path).toBe("/home/u/.codex/auth.json");
			expect(result.reason).toContain("sign in with the CLI first");
		});

		it("reports malformed input instead of importing nothing", () => {
			const result = readExternalCredential("codex-cli", { readFile: () => "not json" });
			expect(result.status).toBe("unusable");
		});

		it("refuses an access token without an exp claim", () => {
			const access = jwt({ sub: "no-exp" });
			const result = readExternalCredential("codex-cli", {
				readFile: () => codexDocument(access, "r"),
				now: () => NOW,
			});
			expect(result.status).toBe("unusable");
			if (result.status === "unusable") expect(result.reason).toContain("exp claim");
		});
	});

	describe("claude-code", () => {
		it("reads a valid token and honors CLAUDE_CONFIG_DIR", () => {
			const result = readExternalCredential("claude-code", {
				readFile: () => claudeDocument("sk-ant-oat01-valid", "sk-ant-ort01-valid", NOW + HOUR),
				now: () => NOW,
				env: { CLAUDE_CONFIG_DIR: "/claude-dir" },
			});
			expect(result.status).toBe("found");
			if (result.status !== "found") return;
			expect(result.candidate.path).toBe("/claude-dir/.credentials.json");
			expect(result.candidate.credentials.expires).toBe(NOW + HOUR);
			expect(result.candidate.detail).toContain("max");
		});

		it("refuses an expired token whose refresh token is empty", () => {
			const result = readExternalCredential("claude-code", {
				readFile: () => claudeDocument("sk-ant-oat01-stale", "", NOW - HOUR),
				now: () => NOW,
				home: "/home/u",
			});
			expect(result.status).toBe("unusable");
			if (result.status !== "unusable") return;
			expect(result.path).toBe("/home/u/.claude/.credentials.json");
			expect(result.reason).toContain("sign in with the Claude Code CLI again");
		});

		it("defaults the path to the home directory", () => {
			expect(credentialSourcePath("claude-code", { home: "/home/u", env: {} })).toBe(
				"/home/u/.claude/.credentials.json",
			);
			expect(credentialSourcePath("codex-cli", { home: "/home/u", env: {} })).toBe("/home/u/.codex/auth.json");
		});
	});

	describe("decodeJwtPayload", () => {
		it("returns undefined for input that is not a JWT", () => {
			expect(decodeJwtPayload("not-a-token")).toBeUndefined();
			expect(decodeJwtPayload("header.not-base64-json.sig")).toBeUndefined();
		});
	});
});
