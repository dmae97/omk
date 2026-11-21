import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { runMigrations } from "../src/migrations.ts";

describe("config value env var syntax migration", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		vi.restoreAllMocks();
	});

	function createAgentDir(): string {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-config-value-migration-test-"));
		tempDirs.push(agentDir);
		return agentDir;
	}

	function withAgentDir(agentDir: string, fn: () => void): void {
		const previousAgentDir = process.env[ENV_AGENT_DIR];
		process.env[ENV_AGENT_DIR] = agentDir;
		try {
			fn();
		} finally {
			if (previousAgentDir === undefined) {
				delete process.env[ENV_AGENT_DIR];
			} else {
				process.env[ENV_AGENT_DIR] = previousAgentDir;
			}
		}
	}

	it("rewrites legacy uppercase auth.json API key values to explicit env references", () => {
		const agentDir = createAgentDir();
		fs.writeFileSync(
			path.join(agentDir, "auth.json"),
			`${JSON.stringify(
				{
					anthropic: { type: "api_key", key: "ANTHROPIC_API_KEY" },
					openai: { type: "api_key", key: "$OPENAI_API_KEY" },
					opencode: { type: "api_key", key: "public" },
					github: { type: "oauth", access: "ACCESS_TOKEN", refresh: "REFRESH_TOKEN", expires: 1 },
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		withAgentDir(agentDir, () => runMigrations(agentDir));

		const migrated = JSON.parse(fs.readFileSync(path.join(agentDir, "auth.json"), "utf-8")) as Record<
			string,
			Record<string, unknown>
		>;
		expect(migrated.anthropic.key).toBe("$ANTHROPIC_API_KEY");
		expect(migrated.openai.key).toBe("$OPENAI_API_KEY");
		expect(migrated.opencode.key).toBe("public");
		expect(migrated.github.access).toBe("ACCESS_TOKEN");
		const logMessage = String(logSpy.mock.calls[0]?.[0] ?? "");
		expect(logMessage).toContain("explicit $ENV_VAR syntax");
		expect(logMessage).toContain('auth.json["anthropic"].key: ANTHROPIC_API_KEY -> $ANTHROPIC_API_KEY');
	});

	it("rewrites legacy uppercase models.json API key and header values", () => {
		const agentDir = createAgentDir();
		fs.writeFileSync(
			path.join(agentDir, "models.json"),
			`${JSON.stringify(
				{
					providers: {
						"custom-provider": {
							baseUrl: "https://example.com/v1",
							apiKey: "CUSTOM_API_KEY",
							api: "openai-completions",
							headers: {
								"x-api-key": "HEADER_API_KEY",
								"x-literal": "literal",
							},
							models: [
								{
									id: "model-a",
									headers: { "x-model-key": "MODEL_API_KEY" },
								},
							],
							modelOverrides: {
								"model-b": { headers: { "x-override-key": "OVERRIDE_API_KEY" } },
							},
						},
					},
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		withAgentDir(agentDir, () => runMigrations(agentDir));

		const migrated = JSON.parse(fs.readFileSync(path.join(agentDir, "models.json"), "utf-8")) as {
			providers: Record<
				string,
				{
					apiKey?: string;
					headers?: Record<string, string>;
					models?: Array<{ headers?: Record<string, string> }>;
					modelOverrides?: Record<string, { headers?: Record<string, string> }>;
				}
			>;
		};
		const provider = migrated.providers["custom-provider"]!;
		expect(provider.apiKey).toBe("$CUSTOM_API_KEY");
		expect(provider.headers?.["x-api-key"]).toBe("$HEADER_API_KEY");
		expect(provider.headers?.["x-literal"]).toBe("literal");
		expect(provider.models?.[0]?.headers?.["x-model-key"]).toBe("$MODEL_API_KEY");
		expect(provider.modelOverrides?.["model-b"]?.headers?.["x-override-key"]).toBe("$OVERRIDE_API_KEY");
		const logMessage = String(logSpy.mock.calls[0]?.[0] ?? "");
		expect(logMessage).toContain(
			'models.json.providers["custom-provider"].apiKey: CUSTOM_API_KEY -> $CUSTOM_API_KEY',
		);
		expect(logMessage).toContain(
			'models.json.providers["custom-provider"].headers["x-api-key"]: HEADER_API_KEY -> $HEADER_API_KEY',
		);
		expect(logMessage).toContain(
			'models.json.providers["custom-provider"].models["model-a"].headers["x-model-key"]: MODEL_API_KEY -> $MODEL_API_KEY',
		);
		expect(logMessage).toContain(
			'models.json.providers["custom-provider"].modelOverrides["model-b"].headers["x-override-key"]: OVERRIDE_API_KEY -> $OVERRIDE_API_KEY',
		);
	});
});

describe("legacy config compatibility migrations", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		vi.restoreAllMocks();
	});

	function createTempDir(prefix: string): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		tempDirs.push(dir);
		return dir;
	}

	function withAgentDir(agentDir: string, fn: () => void): void {
		const previousAgentDir = process.env[ENV_AGENT_DIR];
		process.env[ENV_AGENT_DIR] = agentDir;
		try {
			fn();
		} finally {
			if (previousAgentDir === undefined) {
				delete process.env[ENV_AGENT_DIR];
			} else {
				process.env[ENV_AGENT_DIR] = previousAgentDir;
			}
		}
	}

	it("migrates legacy oauth.json and settings.json apiKeys into canonical auth.json", () => {
		const agentDir = createTempDir("omk-auth-compat-migration-test-");
		fs.writeFileSync(
			path.join(agentDir, "oauth.json"),
			`${JSON.stringify({ github: { access: "legacy-access", refresh: "legacy-refresh" } }, null, 2)}\n`,
			"utf-8",
		);
		fs.writeFileSync(
			path.join(agentDir, "settings.json"),
			`${JSON.stringify(
				{
					apiKeys: {
						openai: "OPENAI_API_KEY",
						github: "GITHUB_API_KEY",
					},
					theme: "dark",
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);

		let migratedAuthProviders: string[] = [];
		withAgentDir(agentDir, () => {
			migratedAuthProviders = runMigrations(agentDir).migratedAuthProviders;
		});

		const auth = JSON.parse(fs.readFileSync(path.join(agentDir, "auth.json"), "utf-8")) as Record<
			string,
			{ type: string; key?: string; access?: string; refresh?: string }
		>;
		const settings = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8")) as {
			apiKeys?: unknown;
			theme?: string;
		};
		expect(auth.github).toEqual({ type: "oauth", access: "legacy-access", refresh: "legacy-refresh" });
		expect(auth.openai).toEqual({ type: "api_key", key: "$OPENAI_API_KEY" });
		expect(settings).toEqual({ theme: "dark" });
		expect(fs.existsSync(path.join(agentDir, "oauth.json"))).toBe(false);
		expect(fs.existsSync(path.join(agentDir, "oauth.json.migrated"))).toBe(true);
		expect(migratedAuthProviders).toEqual(["github", "openai"]);
	});

	it("keeps canonical auth.json authoritative when legacy files also exist", () => {
		const agentDir = createTempDir("omk-auth-canonical-migration-test-");
		fs.writeFileSync(
			path.join(agentDir, "auth.json"),
			`${JSON.stringify({ openai: { type: "api_key", key: "$OMK_OPENAI_KEY" } }, null, 2)}\n`,
			"utf-8",
		);
		fs.writeFileSync(
			path.join(agentDir, "oauth.json"),
			`${JSON.stringify({ github: { access: "legacy-access" } }, null, 2)}\n`,
			"utf-8",
		);
		fs.writeFileSync(
			path.join(agentDir, "settings.json"),
			`${JSON.stringify({ apiKeys: { anthropic: "ANTHROPIC_API_KEY" }, model: "current" }, null, 2)}\n`,
			"utf-8",
		);

		let migratedAuthProviders: string[] = [];
		withAgentDir(agentDir, () => {
			migratedAuthProviders = runMigrations(agentDir).migratedAuthProviders;
		});

		const auth = JSON.parse(fs.readFileSync(path.join(agentDir, "auth.json"), "utf-8")) as Record<
			string,
			{ type: string; key?: string }
		>;
		const settings = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8")) as {
			apiKeys?: Record<string, string>;
			model?: string;
		};
		expect(auth).toEqual({ openai: { type: "api_key", key: "$OMK_OPENAI_KEY" } });
		expect(settings.apiKeys).toEqual({ anthropic: "ANTHROPIC_API_KEY" });
		expect(fs.existsSync(path.join(agentDir, "oauth.json"))).toBe(true);
		expect(fs.existsSync(path.join(agentDir, "oauth.json.migrated"))).toBe(false);
		expect(migratedAuthProviders).toEqual([]);
	});

	it("does not create auth.json for malformed oauth.json or empty apiKeys", () => {
		const agentDir = createTempDir("omk-auth-boundary-migration-test-");
		fs.writeFileSync(path.join(agentDir, "oauth.json"), "{not-json", "utf-8");
		fs.writeFileSync(path.join(agentDir, "settings.json"), `${JSON.stringify({ apiKeys: {} }, null, 2)}\n`, "utf-8");

		let migratedAuthProviders: string[] = [];
		withAgentDir(agentDir, () => {
			migratedAuthProviders = runMigrations(agentDir).migratedAuthProviders;
		});

		expect(fs.existsSync(path.join(agentDir, "auth.json"))).toBe(false);
		expect(fs.existsSync(path.join(agentDir, "oauth.json"))).toBe(true);
		expect(fs.existsSync(path.join(agentDir, "oauth.json.migrated"))).toBe(false);
		expect(migratedAuthProviders).toEqual([]);
	});

	it("renames legacy commands directories to canonical prompts directories", () => {
		const agentDir = createTempDir("omk-prompts-global-migration-test-");
		const cwd = createTempDir("omk-prompts-project-migration-test-");
		const globalCommandsDir = path.join(agentDir, "commands");
		const projectCommandsDir = path.join(cwd, ".omk", "commands");
		fs.mkdirSync(globalCommandsDir, { recursive: true });
		fs.mkdirSync(projectCommandsDir, { recursive: true });
		fs.writeFileSync(path.join(globalCommandsDir, "global.md"), "global prompt", "utf-8");
		fs.writeFileSync(path.join(projectCommandsDir, "project.md"), "project prompt", "utf-8");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		withAgentDir(agentDir, () => runMigrations(cwd));

		expect(fs.existsSync(path.join(agentDir, "commands"))).toBe(false);
		expect(fs.readFileSync(path.join(agentDir, "prompts", "global.md"), "utf-8")).toBe("global prompt");
		expect(fs.existsSync(path.join(cwd, ".omk", "commands"))).toBe(false);
		expect(fs.readFileSync(path.join(cwd, ".omk", "prompts", "project.md"), "utf-8")).toBe("project prompt");
		const logOutput = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(logOutput).toContain("Migrated Global commands/");
		expect(logOutput).toContain("Migrated Project commands/");
	});

	it("moves managed legacy tools binaries to canonical bin while warning about custom tools", () => {
		const agentDir = createTempDir("omk-tools-bin-migration-test-");
		const toolsDir = path.join(agentDir, "tools");
		fs.mkdirSync(toolsDir, { recursive: true });
		fs.writeFileSync(path.join(toolsDir, "rg"), "managed rg", "utf-8");
		fs.writeFileSync(path.join(toolsDir, "custom-tool.ts"), "custom", "utf-8");
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		let deprecationWarnings: string[] = [];
		withAgentDir(agentDir, () => {
			deprecationWarnings = runMigrations(agentDir).deprecationWarnings;
		});

		expect(fs.existsSync(path.join(agentDir, "tools", "rg"))).toBe(false);
		expect(fs.readFileSync(path.join(agentDir, "bin", "rg"), "utf-8")).toBe("managed rg");
		expect(fs.readFileSync(path.join(agentDir, "tools", "custom-tool.ts"), "utf-8")).toBe("custom");
		expect(deprecationWarnings).toEqual([
			"Global tools/ directory contains custom tools. Custom tools have been merged into extensions.",
		]);
		const logOutput = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(logOutput).toContain("Migrated managed binaries tools/");
	});

	it("does not warn about vendored checkouts or release binaries stored in tools/", () => {
		const agentDir = createTempDir("omk-tools-vendored-test-");
		const toolsDir = path.join(agentDir, "tools");
		// Vendored git checkout with a package.json but no index module.
		fs.mkdirSync(path.join(toolsDir, "vendored-src"), { recursive: true });
		fs.writeFileSync(path.join(toolsDir, "vendored-src", "package.json"), "{}", "utf-8");
		fs.writeFileSync(path.join(toolsDir, "vendored-src", "README.md"), "docs", "utf-8");
		// Release tree holding only a versioned binary.
		fs.mkdirSync(path.join(toolsDir, "release", "v1.0.0"), { recursive: true });
		fs.writeFileSync(path.join(toolsDir, "release", "v1.0.0", "tool-linux-amd64"), "", "utf-8");

		let deprecationWarnings: string[] = [];
		withAgentDir(agentDir, () => {
			deprecationWarnings = runMigrations(agentDir).deprecationWarnings;
		});

		expect(deprecationWarnings).toEqual([]);
	});

	it("warns when a tools/ subdirectory has a loadable index module", () => {
		const agentDir = createTempDir("omk-tools-index-entry-test-");
		const toolsDir = path.join(agentDir, "tools");
		fs.mkdirSync(path.join(toolsDir, "legacy-tool"), { recursive: true });
		fs.writeFileSync(path.join(toolsDir, "legacy-tool", "index.ts"), "", "utf-8");

		let deprecationWarnings: string[] = [];
		withAgentDir(agentDir, () => {
			deprecationWarnings = runMigrations(agentDir).deprecationWarnings;
		});

		expect(deprecationWarnings).toEqual([
			"Global tools/ directory contains custom tools. Custom tools have been merged into extensions.",
		]);
	});
});
