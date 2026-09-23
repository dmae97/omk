import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runProviderAdoptCli } from "../src/commands/provider-adopt-cli.ts";

// Anchored to the wall clock: `AuthStorage.addOAuthAccount` compares `expires` against `Date.now()`,
// so a fixture clock in the past would turn "still valid" into "expired" and change the action.
const NOW = Date.now();
const HOUR = 3_600_000;
const CODEX_PROFILE_CLAIM = "https://api.openai.com/profile";

type StoredAccount = { access?: string; refresh?: string; expires?: number; accountId?: string };
type StoredCredential = StoredAccount & {
	type?: string;
	key?: string;
	accounts?: StoredAccount[];
	activeAccount?: number;
};
type StoredAuth = Record<string, StoredCredential>;

function jwt(payload: Record<string, unknown>): string {
	const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

function codexAccess(expiresAt: number, email = "classicmate@classicmate.app"): string {
	return jwt({ exp: expiresAt / 1000, [CODEX_PROFILE_CLAIM]: { email } });
}

describe("provider adopt CLI", () => {
	let root: string;
	let agentDir: string;
	let codexHome: string;
	let lines: string[];

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-provider-adopt-"));
		agentDir = join(root, "agent");
		codexHome = join(root, "codex");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(codexHome, { recursive: true });
		lines = [];
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const authPath = () => join(agentDir, "auth.json");
	const writeAuth = (data: StoredAuth) => writeFileSync(authPath(), JSON.stringify(data, null, 1));
	const readAuth = () => JSON.parse(readFileSync(authPath(), "utf-8")) as StoredAuth;
	const writeCodexStore = (access: string, refresh: string, accountId = "acct-1") =>
		writeFileSync(
			join(codexHome, "auth.json"),
			JSON.stringify({ tokens: { access_token: access, refresh_token: refresh, account_id: accountId } }),
		);
	const run = (args: readonly string[]) =>
		runProviderAdoptCli(args, {
			agentDir,
			env: { CODEX_HOME: codexHome },
			now: () => NOW,
			writeLine: (line: string) => {
				lines.push(line);
			},
		});

	it("ignores argv that belongs to another provider command", async () => {
		await expect(run(["provider", "sync", "openai-codex"])).resolves.toEqual({ handled: false, exitCode: 0 });
		await expect(run(["--list-models"])).resolves.toEqual({ handled: false, exitCode: 0 });
	});

	it("imports a Codex CLI account into an empty store", async () => {
		writeAuth({});
		writeCodexStore(codexAccess(NOW + HOUR), "refresh-1");
		const outcome = await run(["provider", "adopt", "openai-codex"]);
		expect(outcome).toEqual({ handled: true, exitCode: 0 });
		const stored = readAuth()["openai-codex"];
		expect(stored?.type).toBe("oauth");
		expect(stored?.access).toBe(codexAccess(NOW + HOUR));
		expect(stored?.accountId).toBe("acct-1");
		expect(lines.join("\n")).toContain("imported");
	});

	it("is idempotent: a second run leaves a valid stored account alone", async () => {
		writeAuth({});
		writeCodexStore(codexAccess(NOW + HOUR), "refresh-1");
		await run(["provider", "adopt", "openai-codex"]);
		lines = [];
		const second = await run(["provider", "adopt", "openai-codex"]);
		expect(second.exitCode).toBe(0);
		expect(lines.join("\n")).toContain("unchanged");
		const stored = readAuth()["openai-codex"];
		expect(stored?.accounts).toBeUndefined();
	});

	it("updates an expired matching account in place and keeps the active selection", async () => {
		writeAuth({
			"openai-codex": {
				type: "oauth",
				accounts: [
					{ access: codexAccess(NOW - HOUR), refresh: "old-refresh", expires: NOW - HOUR, accountId: "acct-1" },
					{ access: "other-access", refresh: "other-refresh", expires: NOW + HOUR, accountId: "acct-2" },
				],
				activeAccount: 1,
			},
		});
		writeCodexStore(codexAccess(NOW + HOUR), "refresh-1");
		const outcome = await run(["provider", "adopt", "openai-codex"]);
		expect(outcome.exitCode).toBe(0);
		const stored = readAuth()["openai-codex"];
		expect(stored?.activeAccount).toBe(1);
		expect(stored?.accounts).toHaveLength(2);
		expect(stored?.accounts?.[0]?.access).toBe(codexAccess(NOW + HOUR));
		expect(stored?.accounts?.[1]?.access).toBe("other-access");
		expect(lines.join("\n")).toContain("updated account[0]");
	});

	it("--dry-run reports the change without writing", async () => {
		writeAuth({});
		writeCodexStore(codexAccess(NOW + HOUR), "refresh-1");
		const before = readFileSync(authPath(), "utf-8");
		const outcome = await run(["provider", "adopt", "openai-codex", "--dry-run"]);
		expect(outcome.exitCode).toBe(0);
		expect(readFileSync(authPath(), "utf-8")).toBe(before);
		expect(lines.join("\n")).toContain("would be: imported");
		expect(lines.join("\n")).toContain("not written");
	});

	it("--status reports account health and writes nothing", async () => {
		writeAuth({
			"openai-codex": {
				type: "oauth",
				accounts: [
					{ access: "expired", refresh: "r", expires: NOW - HOUR, accountId: "acct-1" },
					{ access: "valid", refresh: "r", expires: NOW + HOUR, accountId: "acct-2" },
				],
				activeAccount: 1,
			},
			deepseek: { type: "api_key", key: "k" },
		});
		const before = readFileSync(authPath(), "utf-8");
		const outcome = await run(["provider", "adopt", "--status", "--json"]);
		expect(outcome).toEqual({ handled: true, exitCode: 0 });
		expect(readFileSync(authPath(), "utf-8")).toBe(before);
		const report = JSON.parse(lines.join("\n")) as {
			providers: { provider: string; kind: string; accounts: { state: string; selected: boolean }[] }[];
		};
		const codex = report.providers.find((entry) => entry.provider === "openai-codex");
		expect(codex?.accounts.map((account) => account.state)).toEqual(["refreshable", "valid"]);
		expect(codex?.accounts[1]?.selected).toBe(true);
		expect(report.providers.find((entry) => entry.provider === "deepseek")?.kind).toBe("api_key");
	});

	it("exits 1 with the reason when the source is missing", async () => {
		writeAuth({});
		const outcome = await run(["provider", "adopt", "openai-codex"]);
		expect(outcome.exitCode).toBe(1);
		const text = lines.join("\n");
		expect(text).toContain("no usable credential to adopt");
		expect(text).toContain("sign in with the CLI first");
	});

	it("exits 1 when the Claude Code store is expired and has no refresh token", async () => {
		writeAuth({});
		const claudeDir = join(root, "claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(
			join(claudeDir, ".credentials.json"),
			JSON.stringify({
				claudeAiOauth: { accessToken: "sk-ant-oat01-stale", refreshToken: "", expiresAt: NOW - HOUR },
			}),
		);
		const outcome = await runProviderAdoptCli(["provider", "adopt", "anthropic"], {
			agentDir,
			env: { CLAUDE_CONFIG_DIR: claudeDir },
			now: () => NOW,
			writeLine: (line: string) => {
				lines.push(line);
			},
		});
		expect(outcome.exitCode).toBe(1);
		expect(lines.join("\n")).toContain("no refresh token");
	});

	it("rejects an unknown --from value as a usage error", async () => {
		const outcome = await run(["provider", "adopt", "openai-codex", "--from", "windsurf"]);
		expect(outcome).toEqual({ handled: true, exitCode: 2 });
		expect(lines.join("\n")).toContain("Use one of: codex-cli, claude-code.");
	});

	it("requires a provider id unless --status is given", async () => {
		const outcome = await run(["provider", "adopt"]);
		expect(outcome).toEqual({ handled: true, exitCode: 2 });
		expect(lines.join("\n")).toContain("Missing provider id.");
	});

	it("--from narrows to the provider's own mapping instead of replacing it", async () => {
		writeAuth({});
		writeCodexStore(codexAccess(NOW + HOUR), "refresh-1");
		// anthropic is mapped to claude-code only: a codex-cli grant must never be stored under it.
		const outcome = await run(["provider", "adopt", "anthropic", "--from", "codex-cli"]);
		expect(outcome.exitCode).toBe(2);
		expect(readAuth()["anthropic"]).toBeUndefined();
		expect(lines.join("\n")).toContain("No external credential source");
	});

	it("--status reports an unreadable store instead of claiming no credential", async () => {
		writeFileSync(authPath(), "not json{");
		const outcome = await run(["provider", "adopt", "--status"]);
		expect(outcome.exitCode).toBe(1);
		expect(lines.join("\n")).toContain("could not be read");
	});

	it("keeps the stored refresh token when the source carries none", async () => {
		writeAuth({
			"openai-codex": {
				type: "oauth",
				access: codexAccess(NOW - HOUR),
				refresh: "keep-me",
				expires: NOW - HOUR,
				accountId: "acct-1",
			},
		});
		writeCodexStore(codexAccess(NOW + HOUR), "");
		const outcome = await run(["provider", "adopt", "openai-codex"]);
		expect(outcome.exitCode).toBe(0);
		const stored = readAuth()["openai-codex"];
		expect(stored?.access).toBe(codexAccess(NOW + HOUR));
		expect(stored?.refresh).toBe("keep-me");
	});

	it("prints JSON without token material", async () => {
		writeAuth({});
		const access = codexAccess(NOW + HOUR);
		writeCodexStore(access, "refresh-1");
		await run(["provider", "adopt", "openai-codex", "--json"]);
		const document = JSON.parse(lines.join("\n")) as { action: string; source: string; path: string };
		expect(document.action).toBe("imported");
		expect(document.source).toBe("codex-cli");
		expect(lines.join("\n")).not.toContain(access);
		expect(lines.join("\n")).not.toContain("refresh-1");
	});
});
