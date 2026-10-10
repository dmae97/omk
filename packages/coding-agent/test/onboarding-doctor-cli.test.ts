import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOnboardDoctorCli } from "../src/commands/onboard-doctor-cli.ts";

describe("omk doctor", () => {
	let root: string;
	let agentDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-doctor-"));
		agentDir = join(root, "agent");
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	const run = async (args: string[], env: Record<string, string | undefined> = { HOME: root }) => {
		const lines: string[] = [];
		const outcome = await runOnboardDoctorCli(args, { writeLine: (line) => lines.push(line), agentDir, env });
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
});
