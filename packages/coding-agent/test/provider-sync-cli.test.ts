import { describe, expect, it } from "vitest";
import { type ProviderSyncCliDependencies, runProviderSyncCli } from "../src/commands/provider-sync-cli.ts";

/**
 * `omk provider sync codex-chatgpt-web` reads the launcher's account-aware catalog and rewrites the
 * provider's models.json rows. The bridge forwards /v1/models to the Codex backend, so the command
 * needs OMK's own Codex OAuth; the placeholder bearer in models.json cannot authenticate there.
 */

const MODELS_JSON = `{
  "providers": {
    "codex-chatgpt-web": {
      "baseUrl": "http://127.0.0.1:17841/v1",
      "api": "openai-responses",
      "apiKey": "codex-chatgpt-web",
      "compat": { "sendCodexTurnMetadata": true },
      "models": [
        { "id": "chatgpt-web/high", "name": "ChatGPT Web — High", "reasoning": true, "input": ["text", "image"], "contextWindow": 90000, "maxTokens": 32768 }
      ]
    },
    "plain": { "baseUrl": "https://example.test/v1", "api": "openai-responses", "apiKey": "k", "models": [] }
  }
}
`;

const HEALTH = { status: "ok", service: "codex-chatgpt-web", version: "5.0.4", mode: "full", accepting_turns: true };
const CATALOG = {
	models: [
		{ slug: "gpt-5.6-sol", display_name: "GPT-5.6 Sol", context_window: 258_000 },
		{
			slug: "chatgpt-web/high",
			display_name: "ChatGPT Web — High",
			context_window: 333_579,
			auto_compact_token_limit: 285_000,
			default_reasoning_level: "high",
			input_modalities: ["text", "image"],
		},
		{
			slug: "chatgpt-web/pro",
			display_name: "ChatGPT Web — Pro",
			context_window: 336_579,
			auto_compact_token_limit: 285_000,
			default_reasoning_level: "ultra",
			input_modalities: ["text", "image"],
		},
	],
};

type FetchCall = { readonly url: string; readonly authorization: string | undefined };

function harness(overrides: Partial<ProviderSyncCliDependencies> & { modelsJson?: string } = {}) {
	const lines: string[] = [];
	const writes: Array<{ path: string; text: string }> = [];
	const calls: FetchCall[] = [];
	const files = new Map<string, string>([["/agent/models.json", overrides.modelsJson ?? MODELS_JSON]]);
	const deps: ProviderSyncCliDependencies = {
		agentDir: "/agent",
		env: {},
		readFile: (path) => {
			const text = files.get(path);
			if (text === undefined) throw new Error(`ENOENT: ${path}`);
			return text;
		},
		writeFile: (path, text) => {
			writes.push({ path, text });
		},
		fetch: async (url, init) => {
			calls.push({ url, authorization: init.headers?.authorization });
			if (url.endsWith("/healthz")) return { status: 200, json: async () => HEALTH, text: async () => "" };
			return { status: 200, json: async () => CATALOG, text: async () => "" };
		},
		getCodexAccessToken: async () => "oauth-token-value",
		detectCodexVersion: () => "0.150.0",
		now: () => "2026-09-07T12:00:00.000Z",
		writeLine: (line) => lines.push(line),
		...overrides,
	};
	return { deps, lines, writes, calls, output: () => lines.join("\n") };
}

describe("omk provider sync: routing and usage", () => {
	it("ignores every other command", async () => {
		for (const args of [[], ["provider"], ["provider", "doctor", "x"], ["sync", "codex-chatgpt-web"]]) {
			const result = await runProviderSyncCli(args, harness().deps);
			expect(result.handled, JSON.stringify(args)).toBe(false);
		}
	});

	it("prints usage for --help without touching the network or disk", async () => {
		const h = harness();
		const result = await runProviderSyncCli(["provider", "sync", "--help"], h.deps);

		expect(result).toEqual({ handled: true, exitCode: 0 });
		expect(h.output()).toContain("Usage:");
		expect(h.calls).toEqual([]);
		expect(h.writes).toEqual([]);
	});

	it("reports usage errors with exit 2 and never echoes the argument", async () => {
		for (const args of [
			["provider", "sync"],
			["provider", "sync", "codex-chatgpt-web", "--bogus-flag-value"],
			["provider", "sync", "codex-chatgpt-web", "--timeout", "soon"],
			["provider", "sync", "codex-chatgpt-web", "extra"],
		]) {
			const h = harness();
			const result = await runProviderSyncCli(args, h.deps);
			expect(result.exitCode, JSON.stringify(args)).toBe(2);
			expect(h.output()).not.toContain("bogus-flag-value");
		}
	});
});

describe("omk provider sync: preconditions", () => {
	it("fails when the provider is not a codex-chatgpt-web bridge", async () => {
		const h = harness();
		const result = await runProviderSyncCli(["provider", "sync", "plain"], h.deps);

		expect(result.exitCode).toBe(1);
		expect(h.output()).toContain("sendCodexTurnMetadata");
		expect(h.calls).toEqual([]);
	});

	it("fails when the provider is absent from models.json", async () => {
		const h = harness();
		const result = await runProviderSyncCli(["provider", "sync", "nope"], h.deps);

		expect(result.exitCode).toBe(1);
		expect(h.output()).toContain("models.json");
	});

	it("names the launcher when the bridge refuses the connection", async () => {
		const h = harness({
			fetch: async () => {
				throw new TypeError("fetch failed");
			},
		});
		const result = await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], h.deps);

		expect(result.exitCode).toBe(1);
		expect(h.output()).toContain("Codex Web GPT launcher");
		expect(h.writes).toEqual([]);
	});

	it("explains that the catalog needs OMK's Codex OAuth when it is missing", async () => {
		const h = harness({ getCodexAccessToken: async () => undefined });
		const result = await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], h.deps);

		expect(result.exitCode).toBe(1);
		expect(h.output()).toContain("/login openai-codex");
		expect(h.calls.map((call) => call.url)).toEqual(["http://127.0.0.1:17841/healthz"]);
	});

	it("treats a rejected token as an auth failure without printing it", async () => {
		const h = harness({
			fetch: async (url) =>
				url.endsWith("/healthz")
					? { status: 200, json: async () => HEALTH, text: async () => "" }
					: { status: 401, json: async () => ({}), text: async () => "Could not parse your authentication token" },
		});
		const result = await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], h.deps);

		expect(result.exitCode).toBe(1);
		expect(h.output()).toContain("rejected");
		expect(h.output()).not.toContain("oauth-token-value");
	});
});

describe("omk provider sync: catalog sync", () => {
	it("sends the Codex OAuth bearer and client_version to the bridge", async () => {
		const h = harness();
		await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], h.deps);

		const models = h.calls.find((call) => call.url.includes("/models"));
		expect(models?.url).toBe("http://127.0.0.1:17841/v1/models?client_version=0.150.0");
		expect(models?.authorization).toBe("Bearer oauth-token-value");
	});

	it("prefers --client-version, then the environment, then the detected Codex CLI", async () => {
		const flagged = harness();
		await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web", "--client-version", "1.2.3"], flagged.deps);
		expect(flagged.calls[1]?.url).toContain("client_version=1.2.3");

		const fromEnv = harness({ env: { OMK_CODEX_CLIENT_VERSION: "2.0.0" } });
		await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], fromEnv.deps);
		expect(fromEnv.calls[1]?.url).toContain("client_version=2.0.0");

		const fallback = harness({ detectCodexVersion: () => undefined });
		await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], fallback.deps);
		expect(fallback.calls[1]?.url).toMatch(/client_version=\d+\.\d+\.\d+$/);
	});

	it("rewrites the provider rows from the catalog and reports each change", async () => {
		// Given: models.json still carries the Plus window while the account is Pro with Bigger Context.
		const h = harness();

		// When: the sync runs for real.
		const result = await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], h.deps);

		// Then: the file is rewritten from the catalog and the report names the drift.
		expect(result.exitCode).toBe(0);
		expect(h.writes).toHaveLength(1);
		expect(h.writes[0]?.path).toBe("/agent/models.json");
		const written = JSON.parse(h.writes[0]?.text ?? "") as {
			providers: Record<
				string,
				{ models: Array<{ id: string; contextWindow: number }>; compat?: unknown; bridgeCatalog?: unknown }
			>;
		};
		expect(written.providers["codex-chatgpt-web"]?.models.map((m) => [m.id, m.contextWindow])).toEqual([
			["chatgpt-web/high", 285_000],
			["chatgpt-web/pro", 285_000],
		]);
		expect(written.providers["codex-chatgpt-web"]?.compat).toEqual({ sendCodexTurnMetadata: true });
		expect(written.providers["codex-chatgpt-web"]?.bridgeCatalog).toEqual({
			bridgeVersion: "5.0.4",
			clientVersion: "0.150.0",
			syncedAt: "2026-09-07T12:00:00.000Z",
			contextCeilings: { "chatgpt-web/high": 333_579, "chatgpt-web/pro": 336_579 },
		});
		expect(written.providers.plain).toBeDefined();
		expect(h.output()).toContain("5.0.4");
		expect(h.output()).toContain("chatgpt-web/high");
		expect(h.output()).toContain("285000");
		expect(h.output()).toContain("333579");
		expect(h.output()).toContain("chatgpt-web/pro");
	});

	it("rewrites when only the provenance moved, so a launcher upgrade is recorded", async () => {
		const h = harness();
		await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], h.deps);
		const upgraded = harness({
			modelsJson: h.writes[0]?.text,
			fetch: async (url) => ({
				status: 200,
				json: async () => (url.endsWith("/healthz") ? { ...HEALTH, version: "5.0.5" } : CATALOG),
				text: async () => "",
			}),
		});

		const result = await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], upgraded.deps);

		expect(result.exitCode).toBe(0);
		expect(upgraded.writes).toHaveLength(1);
		expect(upgraded.output()).toContain("5.0.5");
	});

	it("writes nothing on --dry-run and says so", async () => {
		const h = harness();
		const result = await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web", "--dry-run"], h.deps);

		expect(result.exitCode).toBe(0);
		expect(h.writes).toEqual([]);
		expect(h.output()).toContain("dry run");
		expect(h.output()).toContain("285000");
	});

	it("writes nothing when models.json already matches the bridge", async () => {
		const h = harness();
		await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], h.deps);
		const synced = harness({ modelsJson: h.writes[0]?.text });

		const result = await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], synced.deps);

		expect(result.exitCode).toBe(0);
		expect(synced.writes).toEqual([]);
		expect(synced.output()).toContain("already matches");
	});

	it("fails when the bridge advertises no chatgpt-web models", async () => {
		const h = harness({
			fetch: async (url) => ({
				status: 200,
				json: async () => (url.endsWith("/healthz") ? HEALTH : { models: CATALOG.models.slice(0, 1) }),
				text: async () => "",
			}),
		});
		const result = await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web"], h.deps);

		expect(result.exitCode).toBe(1);
		expect(h.writes).toEqual([]);
		expect(h.output()).toContain("no chatgpt-web");
	});

	it("emits one JSON document with --json", async () => {
		const h = harness();
		const result = await runProviderSyncCli(["provider", "sync", "codex-chatgpt-web", "--json", "--dry-run"], h.deps);

		expect(result.exitCode).toBe(0);
		const document = JSON.parse(h.output()) as {
			provider: string;
			bridge: { version: string; mode: string };
			bridgeCatalog: { contextCeilings: Record<string, number> };
			clientVersion: string;
			changes: unknown[];
			added: string[];
			written: boolean;
		};
		expect(document.provider).toBe("codex-chatgpt-web");
		expect(document.bridge).toMatchObject({ version: "5.0.4", mode: "full" });
		expect(document.bridgeCatalog.contextCeilings).toEqual({
			"chatgpt-web/high": 333_579,
			"chatgpt-web/pro": 336_579,
		});
		expect(document.clientVersion).toBe("0.150.0");
		expect(document.added).toEqual(["chatgpt-web/pro"]);
		expect(document.changes).toHaveLength(1);
		expect(document.written).toBe(false);
	});
});
