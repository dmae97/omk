import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findEnvKeys, getProviders } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runOnboardDoctorCli } from "../src/commands/onboard-doctor-cli.ts";

describe("omk doctor", () => {
	let root: string;
	let agentDir: string;

	beforeEach(() => {
		for (const provider of getProviders()) {
			for (const key of findEnvKeys(provider) ?? []) vi.stubEnv(key, "");
		}
		root = mkdtempSync(join(tmpdir(), "omk-doctor-"));
		agentDir = join(root, "agent");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
	});

	const run = async (args: string[], env: Record<string, string | undefined> = { HOME: root }, cwd: string = root) => {
		const lines: string[] = [];
		const outcome = await runOnboardDoctorCli(args, { writeLine: (line) => lines.push(line), agentDir, env, cwd });
		return { ...outcome, output: lines.join("\n") };
	};

	it("leaves the narrower doctors and prompts alone", async () => {
		expect((await run(["doctor", "resources"])).handled).toBe(false);
		expect((await run(["doctor", "adaptorch", "--json"])).handled).toBe(false);
		expect((await run(["fix", "the", "doctor"])).handled).toBe(false);
	});

	it("rejects unknown flags with exit code 2", async () => {
		const outcome = await run(["doctor", "--frobnicate"]);
		expect(outcome).toMatchObject({ handled: true, exitCode: 2 });
	});

	it("emits one JSON document with every check in declaration order", async () => {
		const outcome = await run(["doctor", "--json"]);
		const report = JSON.parse(outcome.output) as { checks: Array<{ id: string; status: string }> };
		expect(report.checks.map((check) => check.id)).toEqual([
			"runtime",
			"agent-dir",
			"credentials",
			"default-model",
			"sandbox",
			"tools",
			"network",
		]);
		expect(report.checks.find((check) => check.id === "network")?.status).toBe("skip");
	});

	it("reads an existing auth.json without modifying the agent directory", async () => {
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "sk-test" } }));
		const before = readdirSync(agentDir).sort();
		const outcome = await run(["doctor", "--json"]);
		const report = JSON.parse(outcome.output) as {
			checks: Array<{ id: string; status: string; summary: string; data?: { stored?: string[] } }>;
		};
		const credentials = report.checks.find((check) => check.id === "credentials");
		expect(credentials?.status).toBe("pass");
		expect(credentials?.data?.stored).toEqual(["anthropic"]);
		expect(outcome.output).not.toContain("sk-test");
		expect(readdirSync(agentDir).sort()).toEqual(before);
	});

	it("does not create the agent directory on a fresh machine and still passes the writability check", async () => {
		agentDir = join(root, ".omk", "agent");
		const outcome = await run(["doctor", "--json"]);
		const report = JSON.parse(outcome.output) as { checks: Array<{ id: string; status: string; summary: string }> };
		expect(report.checks.find((check) => check.id === "agent-dir")).toMatchObject({
			status: "pass",
			summary: expect.stringContaining("created on first run"),
		});
		expect(readdirSync(root)).toEqual([]);
	});

	it("resolves the default model through models.json without writing a snapshot", async () => {
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "sk-test" } }));
		const provider = {
			name: "Doctor Test",
			baseUrl: "https://example.invalid/v1",
			api: "openai-completions",
			apiKey: "test-key",
		};
		const models = [{ id: "doctor-model", name: "doctor-model" }];
		writeFileSync(
			join(agentDir, "models.json"),
			JSON.stringify({ providers: { "doctor-test": { ...provider, models } } }),
		);
		const before = readdirSync(agentDir).sort();
		const report = JSON.parse((await run(["doctor", "--json"])).output) as {
			checks: Array<{ id: string; status: string }>;
		};
		expect(report.checks.find((check) => check.id === "default-model")?.status).toBe("pass");
		expect(readdirSync(agentDir).sort()).toEqual(before);
	});

	it("reports a malformed auth.json without quoting any of it", async () => {
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "auth.json"), '{"anthropic":{"type":"api_key","key": sk-ant-leaked-fragment}}');
		const outcome = await run(["doctor", "--json"]);
		const report = JSON.parse(outcome.output) as { checks: Array<{ id: string; status: string; summary: string }> };
		expect(report.checks.find((check) => check.id === "credentials")).toMatchObject({
			status: "fail",
			summary: expect.stringContaining("auth.json is not valid JSON"),
		});
		expect(outcome.output).not.toContain("sk-ant");
	});

	it("issue #9: passes credentials and default-model when custom provider configured in models.json", async () => {
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					ollama: {
						baseUrl: "http://localhost:11434/v1",
						apiKey: "ollama",
						api: "openai-completions",
						models: [{ id: "llama3" }],
					},
				},
			}),
		);
		const outcome = await run(["doctor", "--json"]);
		const report = JSON.parse(outcome.output) as {
			checks: Array<{ id: string; status: string; summary: string }>;
		};
		const creds = report.checks.find((check) => check.id === "credentials");
		expect(creds?.status).toBe("pass");
		expect(creds?.summary).toContain("custom: ollama (models.json)");
		const model = report.checks.find((check) => check.id === "default-model");
		expect(model?.status).toBe("pass");
		expect(model?.summary).toContain("ollama/llama3");
	});

	it("issue #9: passes credentials and default-model when custom provider configured via ~/.kimi/config.toml", async () => {
		const kimiDir = join(root, ".kimi");
		mkdirSync(kimiDir, { recursive: true });
		writeFileSync(
			join(kimiDir, "config.toml"),
			[
				"[providers.ollama]",
				'type = "openai_legacy"',
				'base_url = "http://localhost:11434/v1"',
				'model_name = "llama3"',
			].join("\n"),
		);
		const outcome = await run(["doctor", "--json"], { HOME: root, KIMI_CONFIG_PATH: join(kimiDir, "config.toml") });
		const report = JSON.parse(outcome.output) as {
			checks: Array<{ id: string; status: string; summary: string }>;
		};
		const creds = report.checks.find((check) => check.id === "credentials");
		expect(creds?.status).toBe("pass");
		expect(creds?.summary).toContain("custom: kimi:ollama (~/.kimi/config.toml)");
		const model = report.checks.find((check) => check.id === "default-model");
		expect(model?.status).toBe("pass");
		expect(model?.summary).toContain("kimi-coding (custom:ollama)/llama3");
	});

	it("P1-01: reflects project .omk/settings.json defaultProvider/defaultModel over global settings", async () => {
		mkdirSync(agentDir, { recursive: true });
		const projectDir = join(root, "proj");
		mkdirSync(join(projectDir, ".omk"), { recursive: true });
		writeFileSync(
			join(agentDir, "auth.json"),
			JSON.stringify({
				anthropic: { type: "api_key", key: "sk-ant-test" },
				openai: { type: "api_key", key: "sk-openai-test" },
			}),
		);
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-6" }),
		);
		writeFileSync(
			join(projectDir, ".omk", "settings.json"),
			JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-5.4" }),
		);

		const outcome = await run(["doctor", "--json"], { HOME: root }, projectDir);
		const report = JSON.parse(outcome.output) as {
			checks: Array<{ id: string; status: string; summary: string; data?: Record<string, unknown> }>;
		};
		const model = report.checks.find((check) => check.id === "default-model");
		expect(model?.status).toBe("pass");
		expect(model?.summary).toContain("openai/gpt-5.4");
		expect(model?.summary).toContain("project settings");
		expect(model?.data).toMatchObject({
			settingsSource: "project",
			configuredModel: "openai/gpt-5.4",
			resolvedModel: "openai/gpt-5.4",
			matchesConfigured: true,
		});
	});

	it("P1-01: aligns with enabledModels runtime scope and explains difference from defaultModel", async () => {
		mkdirSync(agentDir, { recursive: true });
		const projectDir = join(root, "proj-scoped");
		mkdirSync(join(projectDir, ".omk"), { recursive: true });
		writeFileSync(
			join(agentDir, "auth.json"),
			JSON.stringify({
				anthropic: { type: "api_key", key: "sk-ant-test" },
				openai: { type: "api_key", key: "sk-openai-test" },
			}),
		);
		writeFileSync(
			join(projectDir, ".omk", "settings.json"),
			JSON.stringify({
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				enabledModels: ["openai/gpt-5.4"],
			}),
		);

		const outcome = await run(["doctor", "--json"], { HOME: root }, projectDir);
		const report = JSON.parse(outcome.output) as {
			checks: Array<{ id: string; status: string; summary: string; data?: Record<string, unknown> }>;
		};
		const model = report.checks.find((check) => check.id === "default-model");
		expect(model?.status).toBe("warn");
		expect(model?.summary).toContain("openai/gpt-5.4");
		expect(model?.summary).toContain("enabledModels");
		expect(model?.data).toMatchObject({
			configuredModel: "anthropic/claude-sonnet-4-6",
			resolvedModel: "openai/gpt-5.4",
			matchesConfigured: false,
		});
	});

	it("P1-01: explains divergence when configured default model is missing from static catalog", async () => {
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(
			join(agentDir, "auth.json"),
			JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-test" } }),
		);
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ defaultProvider: "google-proxy", defaultModel: "gemini-4-neon" }),
		);

		const outcome = await run(["doctor", "--json"], { HOME: root }, root);
		const report = JSON.parse(outcome.output) as {
			checks: Array<{ id: string; status: string; summary: string; data?: Record<string, unknown> }>;
		};
		const model = report.checks.find((check) => check.id === "default-model");
		expect(model?.status).toBe("warn");
		expect(model?.summary).toContain("google-proxy/gemini-4-neon");
		expect(model?.data).toMatchObject({
			configuredModel: "google-proxy/gemini-4-neon",
			matchesConfigured: false,
		});
		expect(typeof model?.data?.divergenceReason).toBe("string");
	});
});
