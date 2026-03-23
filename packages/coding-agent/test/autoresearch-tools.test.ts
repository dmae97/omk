import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import {
	buildAutoresearchSegmentFingerprint,
	loadAutoresearchScriptSnapshot,
	readAutoresearchContract,
} from "../src/autoresearch/contract";
import { readPendingRunSummary } from "../src/autoresearch/helpers";
import { createSessionRuntime } from "../src/autoresearch/state";
import { createInitExperimentTool } from "../src/autoresearch/tools/init-experiment";
import { createLogExperimentTool } from "../src/autoresearch/tools/log-experiment";
import { createRunExperimentTool } from "../src/autoresearch/tools/run-experiment";
import type { RunDetails } from "../src/autoresearch/types";
import type { ExtensionAPI, ExtensionContext } from "../src/extensibility/extensions";

function makeTempDir(): string {
	const dir = path.join(os.tmpdir(), `pi-autoresearch-tools-${Snowflake.next()}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function writeAutoresearchWorkspace(
	dir: string,
	options?: {
		checksScript?: string;
		contract?: string;
		benchmarkScript?: string;
	},
): void {
	fs.writeFileSync(
		path.join(dir, "autoresearch.md"),
		options?.contract ??
			[
				"# Autoresearch",
				"",
				"## Benchmark",
				"- command: bash autoresearch.sh",
				"- primary metric: runtime_ms",
				"- metric unit: ms",
				"- direction: lower",
				"",
				"## Files in Scope",
				"- src",
				"",
				"## Off Limits",
				"",
				"## Constraints",
				"- keep behavior stable",
				"",
			].join("\n"),
	);
	fs.writeFileSync(
		path.join(dir, "autoresearch.sh"),
		options?.benchmarkScript ??
			[
				"#!/usr/bin/env bash",
				"set -euo pipefail",
				"echo METRIC runtime_ms=10",
				"echo METRIC memory_mb=32",
				'echo ASI hypothesis="baseline"',
			].join("\n"),
	);
	fs.chmodSync(path.join(dir, "autoresearch.sh"), 0o755);
	if (options?.checksScript) {
		fs.writeFileSync(path.join(dir, "autoresearch.checks.sh"), options.checksScript);
		fs.chmodSync(path.join(dir, "autoresearch.checks.sh"), 0o755);
	}
}

function createFingerprint(workDir: string): string {
	const contractResult = readAutoresearchContract(workDir);
	const scriptSnapshot = loadAutoresearchScriptSnapshot(workDir);
	if (contractResult.errors.length > 0 || scriptSnapshot.errors.length > 0) {
		throw new Error(`Workspace setup invalid: ${[...contractResult.errors, ...scriptSnapshot.errors].join(" ")}`);
	}
	return buildAutoresearchSegmentFingerprint(contractResult.contract, {
		benchmarkScript: scriptSnapshot.benchmarkScript,
		checksScript: scriptSnapshot.checksScript,
	});
}

function createDashboardStub() {
	return {
		clear(): void {},
		requestRender(): void {},
		showOverlay: async (): Promise<void> => {},
		updateWidget(): void {},
	};
}

function createContext(cwd: string): ExtensionContext {
	return { cwd, hasUI: false } as ExtensionContext;
}

function createGitApi(): ExtensionAPI {
	return {
		exec: async (command: string, args: string[], options?: { cwd?: string }) => {
			const result = Bun.spawnSync([command, ...args], {
				cwd: options?.cwd ?? process.cwd(),
				stdout: "pipe",
				stderr: "pipe",
			});
			return {
				code: result.exitCode,
				stdout: Buffer.from(result.stdout).toString("utf8"),
				stderr: Buffer.from(result.stderr).toString("utf8"),
			};
		},
	} as unknown as ExtensionAPI;
}

function createManagedGitApi(options?: { activeTools?: string[] }) {
	const activeTools = [...(options?.activeTools ?? ["init_experiment", "run_experiment", "log_experiment"])];
	const appendEntries: Array<{ customType: string; data: unknown }> = [];
	const setActiveToolsCalls: string[][] = [];
	const api = {
		appendEntry: (customType: string, data?: unknown) => {
			appendEntries.push({ customType, data });
		},
		exec: async (command: string, args: string[], execOptions?: { cwd?: string }) => {
			const result = Bun.spawnSync([command, ...args], {
				cwd: execOptions?.cwd ?? process.cwd(),
				stdout: "pipe",
				stderr: "pipe",
			});
			return {
				code: result.exitCode,
				stdout: Buffer.from(result.stdout).toString("utf8"),
				stderr: Buffer.from(result.stderr).toString("utf8"),
			};
		},
		getActiveTools: () => [...activeTools],
		setActiveTools: async (toolNames: string[]) => {
			setActiveToolsCalls.push([...toolNames]);
			activeTools.splice(0, activeTools.length, ...toolNames);
		},
	} as unknown as ExtensionAPI;
	return { activeTools, api, appendEntries, setActiveToolsCalls };
}

function expectRunDetails(details: unknown): RunDetails {
	if (!details || typeof details !== "object" || !("benchmarkLogPath" in details)) {
		throw new Error("Expected run details");
	}
	return details as RunDetails;
}

describe("autoresearch tools", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes durable benchmark/check artifacts and run metadata", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir, {
			checksScript: ["#!/usr/bin/env bash", "set -euo pipefail", "echo checks ok"].join("\n"),
		});

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.segmentFingerprint = createFingerprint(dir);

		const tool = createRunExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});

		const result = await tool.execute(
			"call-1",
			{ command: "bash autoresearch.sh", timeout_seconds: 5, checks_timeout_seconds: 5 },
			undefined,
			undefined,
			createContext(dir),
		);
		const details = expectRunDetails(result.details);

		expect(details.runNumber).toBe(1);
		expect(details.parsedPrimary).toBe(10);
		expect(details.parsedMetrics).toEqual({ memory_mb: 32, runtime_ms: 10 });
		expect(details.benchmarkLogPath).toBe(path.join(details.runDirectory, "benchmark.log"));
		expect(fs.existsSync(details.benchmarkLogPath)).toBe(true);
		expect(fs.existsSync(details.checksLogPath ?? "")).toBe(true);

		const runJson = JSON.parse(fs.readFileSync(path.join(details.runDirectory, "run.json"), "utf8")) as {
			completedAt?: string;
			parsedPrimary?: number;
			checks?: { passed?: boolean };
		};
		expect(runJson.completedAt).toEqual(expect.any(String));
		expect(runJson.parsedPrimary).toBe(10);
		expect(runJson.checks?.passed).toBe(true);
	});

	it("ignores incomplete run artifacts until the benchmark has actually finished", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				runNumber: 1,
				startedAt: new Date().toISOString(),
			}),
		);

		const pendingRun = await readPendingRunSummary(dir);
		expect(pendingRun).toBeNull();
	});

	it("persists init_experiment config metadata from autoresearch.md", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir, {
			contract: [
				"# Autoresearch",
				"",
				"## Benchmark",
				"- command: bash autoresearch.sh",
				"- primary metric: runtime_ms",
				"- metric unit: ms",
				"- direction: lower",
				"- secondary metrics: memory_mb, tokens",
				"",
				"## Files in Scope",
				"- src",
				"",
				"## Off Limits",
				"- src/generated",
				"",
				"## Constraints",
				"- keep behavior stable",
				"",
			].join("\n"),
		});

		const runtime = createSessionRuntime();
		runtime.lastRunChecks = { pass: true, output: "stale", duration: 1 };
		runtime.lastRunDuration = 1;
		runtime.lastRunAsi = { hypothesis: "stale" };
		runtime.lastRunArtifactDir = path.join(dir, ".autoresearch", "runs", "9999");
		runtime.lastRunNumber = 99;
		runtime.lastRunSummary = {
			checksDurationSeconds: 1,
			checksPass: true,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: 1,
			parsedAsi: { hypothesis: "stale" },
			parsedMetrics: { runtime_ms: 10 },
			parsedPrimary: 10,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "9999"),
			runNumber: 99,
		};
		const tool = createInitExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});

		const result = await tool.execute(
			"init-1",
			{
				name: "Reduce runtime variance",
				metric_name: "runtime_ms",
				metric_unit: "ms",
				direction: "lower",
				benchmark_command: "bash autoresearch.sh",
				scope_paths: ["src"],
				off_limits: ["src/generated"],
				constraints: ["keep behavior stable"],
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Experiment initialized: Reduce runtime variance"),
		});
		expect(runtime.state.secondaryMetrics).toEqual([
			{ name: "memory_mb", unit: "mb" },
			{ name: "tokens", unit: "" },
		]);

		const configEntry = JSON.parse(fs.readFileSync(path.join(dir, "autoresearch.jsonl"), "utf8").trim()) as {
			benchmarkCommand?: string;
			constraints?: string[];
			offLimits?: string[];
			scopePaths?: string[];
			secondaryMetrics?: string[];
			segmentFingerprint?: string;
		};
		expect(configEntry.benchmarkCommand).toBe("bash autoresearch.sh");
		expect(configEntry.secondaryMetrics).toEqual(["memory_mb", "tokens"]);
		expect(configEntry.scopePaths).toEqual(["src"]);
		expect(configEntry.offLimits).toEqual(["src/generated"]);
		expect(configEntry.constraints).toEqual(["keep behavior stable"]);
		expect(configEntry.segmentFingerprint).toBe(createFingerprint(dir));
		expect(runtime.lastRunChecks).toBeNull();
		expect(runtime.lastRunDuration).toBeNull();
		expect(runtime.lastRunAsi).toBeNull();
		expect(runtime.lastRunArtifactDir).toBeNull();
		expect(runtime.lastRunNumber).toBeNull();
		expect(runtime.lastRunSummary).toBeNull();
	});

	it("rejects init_experiment when the passed contract no longer matches autoresearch.md", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir, {
			contract: [
				"# Autoresearch",
				"",
				"## Benchmark",
				"- command: bash autoresearch.sh",
				"- primary metric: runtime_ms",
				"- metric unit: ms",
				"- direction: lower",
				"",
				"## Files in Scope",
				"- src",
				"",
				"## Off Limits",
				"- src/generated",
				"",
				"## Constraints",
				"- keep behavior stable",
				"",
			].join("\n"),
		});

		const runtime = createSessionRuntime();
		const tool = createInitExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});

		const result = await tool.execute(
			"init-2",
			{
				name: "Mismatch",
				metric_name: "runtime_ms",
				metric_unit: "ms",
				direction: "lower",
				benchmark_command: "bash autoresearch.sh",
				scope_paths: ["src"],
				off_limits: ["src/other-generated"],
				constraints: ["keep behavior stable"],
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("off_limits do not match autoresearch.md"),
		});
		expect(fs.existsSync(path.join(dir, "autoresearch.jsonl"))).toBe(false);
	});

	it("rejects init_experiment while a previous run is still pending", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				completedAt: new Date().toISOString(),
				durationSeconds: 1,
				exitCode: 0,
				parsedPrimary: 10,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		const tool = createInitExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});

		const result = await tool.execute(
			"init-pending",
			{
				name: "Blocked",
				metric_name: "runtime_ms",
				metric_unit: "ms",
				direction: "lower",
				benchmark_command: "bash autoresearch.sh",
				scope_paths: ["src"],
				off_limits: [],
				constraints: [],
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("has not been logged yet"),
		});
		expect(fs.existsSync(path.join(dir, "autoresearch.jsonl"))).toBe(false);
	});

	it("refuses to start a new benchmark while a previous run artifact is still unlogged", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({ command: "bash autoresearch.sh", exitCode: 0, parsedPrimary: 10, runNumber: 1 }),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.segmentFingerprint = createFingerprint(dir);

		const tool = createRunExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});
		const result = await tool.execute(
			"call-1b",
			{ command: "bash autoresearch.sh", timeout_seconds: 5 },
			undefined,
			undefined,
			createContext(dir),
		);
		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("has not been logged yet"),
		});
	});

	it("refuses to run when the current segment fingerprint is stale", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.segmentFingerprint = createFingerprint(dir);

		fs.writeFileSync(
			path.join(dir, "autoresearch.sh"),
			["#!/usr/bin/env bash", "set -euo pipefail", "echo METRIC runtime_ms=9"].join("\n"),
		);

		const tool = createRunExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});
		const result = await tool.execute(
			"call-2",
			{ command: "bash autoresearch.sh", timeout_seconds: 5 },
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Re-run init_experiment"),
		});
	});

	it("times out checks asynchronously and preserves the checks log", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir, {
			checksScript: ["#!/usr/bin/env bash", "set -euo pipefail", "sleep 2", "echo done"].join("\n"),
		});

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.segmentFingerprint = createFingerprint(dir);

		const tool = createRunExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});
		const result = await tool.execute(
			"call-3",
			{ command: "bash autoresearch.sh", timeout_seconds: 5, checks_timeout_seconds: 0.1 },
			undefined,
			undefined,
			createContext(dir),
		);
		const details = expectRunDetails(result.details);

		expect(details.checksTimedOut).toBe(true);
		expect(fs.existsSync(details.checksLogPath ?? "")).toBe(true);
	});

	it("honors user aborts while the experiment is running", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir, {
			benchmarkScript: ["#!/usr/bin/env bash", "set -euo pipefail", "sleep 5", "echo METRIC runtime_ms=10"].join(
				"\n",
			),
		});

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.segmentFingerprint = createFingerprint(dir);

		const tool = createRunExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 100);

		await expect(
			tool.execute(
				"call-4",
				{ command: "bash autoresearch.sh", timeout_seconds: 10 },
				controller.signal,
				undefined,
				createContext(dir),
			),
		).rejects.toThrow("aborted");
		expect(fs.existsSync(path.join(dir, ".autoresearch", "runs", "0001", "run.json"))).toBe(true);
	});

	it("commits only in-scope changes and excludes autoresearch local state", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir, {
			contract: [
				"# Autoresearch",
				"",
				"## Benchmark",
				"- command: bash autoresearch.sh",
				"- primary metric: runtime_ms",
				"- metric unit: ms",
				"- direction: lower",
				"",
				"## Files in Scope",
				"- src/in-scope.ts",
				"",
				"## Off Limits",
				"- src/generated",
				"",
				"## Constraints",
				"- keep behavior stable",
				"",
			].join("\n"),
		});
		fs.mkdirSync(path.join(dir, "src"), { recursive: true });
		fs.writeFileSync(path.join(dir, "src", "in-scope.ts"), "export const value = 1;\n");
		fs.writeFileSync(path.join(dir, "src", "out-of-scope.ts"), "export const value = 2;\n");

		await $`git init`.cwd(dir).quiet();
		await $`git config user.email test@example.com`.cwd(dir).quiet();
		await $`git config user.name Test User`.cwd(dir).quiet();
		await $`git add .`.cwd(dir).quiet();
		await $`git commit -m initial`.cwd(dir).quiet();
		await $`git checkout -b autoresearch/test-force-secondary-accept`.cwd(dir).quiet();
		await $`git checkout -b autoresearch/test-keep`.cwd(dir).quiet();

		fs.writeFileSync(path.join(dir, "src", "in-scope.ts"), "export const value = 3;\n");
		fs.writeFileSync(path.join(dir, "autoresearch.program.md"), "# Strategy\n\n- focus on in-scope edits\n");
		fs.writeFileSync(path.join(dir, "autoresearch.jsonl"), '{"type":"run"}\n');
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				exitCode: 0,
				parsedMetrics: { runtime_ms: 9 },
				parsedPrimary: 9,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.scopePaths = ["src/in-scope.ts"];
		runtime.state.offLimits = ["src/generated"];
		runtime.state.constraints = ["keep behavior stable"];
		runtime.state.segmentFingerprint = createFingerprint(dir);
		const runDirectory = path.join(dir, ".autoresearch", "runs", "0001");
		runtime.lastRunArtifactDir = runDirectory;
		runtime.lastRunNumber = 1;
		runtime.lastRunDuration = 1.2;
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: 1.2,
			parsedAsi: null,
			parsedMetrics: { runtime_ms: 9 },
			parsedPrimary: 9,
			passed: true,
			runDirectory,
			runNumber: 1,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: createGitApi(),
		});
		const result = await tool.execute(
			"call-5",
			{
				commit: "initial",
				metric: 9,
				status: "keep",
				description: "Improve in scope",
				asi: { hypothesis: "inline the hot path" },
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Logged run #1: keep"),
		});
		const committedPaths = await $`git show --name-only --pretty=format: HEAD`.cwd(dir).text();
		expect(committedPaths).toContain("src/in-scope.ts");
		expect(committedPaths).toContain("autoresearch.program.md");
		expect(committedPaths).not.toContain("autoresearch.jsonl");
		expect(committedPaths).not.toContain(".autoresearch");

		const runJson = JSON.parse(fs.readFileSync(path.join(runDirectory, "run.json"), "utf8")) as {
			status?: string;
		};
		expect(runJson.status).toBe("keep");
	});

	it("rejects keep when an out-of-scope file is dirty", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir, {
			contract: [
				"# Autoresearch",
				"",
				"## Benchmark",
				"- command: bash autoresearch.sh",
				"- primary metric: runtime_ms",
				"- metric unit: ms",
				"- direction: lower",
				"",
				"## Files in Scope",
				"- src/in-scope.ts",
				"",
				"## Off Limits",
				"",
				"## Constraints",
				"",
			].join("\n"),
		});
		fs.mkdirSync(path.join(dir, "src"), { recursive: true });
		fs.writeFileSync(path.join(dir, "src", "in-scope.ts"), "export const value = 1;\n");
		fs.writeFileSync(path.join(dir, "src", "out-of-scope.ts"), "export const value = 2;\n");

		await $`git init`.cwd(dir).quiet();
		await $`git config user.email test@example.com`.cwd(dir).quiet();
		await $`git config user.name Test User`.cwd(dir).quiet();
		await $`git add .`.cwd(dir).quiet();
		await $`git commit -m initial`.cwd(dir).quiet();
		await $`git checkout -b autoresearch/test-max-iterations-accept`.cwd(dir).quiet();
		await $`git checkout -b autoresearch/test-force-secondary`.cwd(dir).quiet();

		fs.writeFileSync(path.join(dir, "src", "out-of-scope.ts"), "export const value = 99;\n");
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				exitCode: 0,
				parsedMetrics: { runtime_ms: 9 },
				parsedPrimary: 9,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.scopePaths = ["src/in-scope.ts"];
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: null,
			parsedAsi: null,
			parsedMetrics: { runtime_ms: 9 },
			parsedPrimary: 9,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: createGitApi(),
		});
		const result = await tool.execute(
			"call-6",
			{
				commit: "initial",
				metric: 9,
				status: "keep",
				description: "Should fail",
				asi: { hypothesis: "touch wrong file" },
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("outside Files in Scope"),
		});
		expect(runtime.state.results).toHaveLength(0);
	});

	it("rejects keep when a dirty path is listed under Off Limits", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir, {
			contract: [
				"# Autoresearch",
				"",
				"## Benchmark",
				"- command: bash autoresearch.sh",
				"- primary metric: runtime_ms",
				"- metric unit: ms",
				"- direction: lower",
				"",
				"## Files in Scope",
				"- src",
				"",
				"## Off Limits",
				"- src/generated",
				"",
				"## Constraints",
				"",
			].join("\n"),
		});
		fs.mkdirSync(path.join(dir, "src", "generated"), { recursive: true });
		fs.writeFileSync(path.join(dir, "src", "generated", "index.ts"), "export const value = 1;\n");

		await $`git init`.cwd(dir).quiet();
		await $`git config user.email test@example.com`.cwd(dir).quiet();
		await $`git config user.name Test User`.cwd(dir).quiet();
		await $`git add .`.cwd(dir).quiet();
		await $`git commit -m initial`.cwd(dir).quiet();
		await $`git checkout -b autoresearch/test-discard-cleanup`.cwd(dir).quiet();
		await $`git checkout -b autoresearch/test-max-iterations`.cwd(dir).quiet();

		fs.writeFileSync(path.join(dir, "src", "generated", "index.ts"), "export const value = 2;\n");
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				exitCode: 0,
				parsedMetrics: { runtime_ms: 9 },
				parsedPrimary: 9,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.scopePaths = ["src"];
		runtime.state.offLimits = ["src/generated"];
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: null,
			parsedAsi: null,
			parsedMetrics: { runtime_ms: 9 },
			parsedPrimary: 9,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: createGitApi(),
		});
		const result = await tool.execute(
			"call-7",
			{
				commit: "initial",
				metric: 9,
				status: "keep",
				description: "Should fail",
				asi: { hypothesis: "touch forbidden path" },
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Off Limits"),
		});
		expect(runtime.state.results).toHaveLength(0);
	});

	it("rejects keep when the metric is worse than the current best kept run", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);

		await $`git init`.cwd(dir).quiet();
		await $`git config user.email test@example.com`.cwd(dir).quiet();
		await $`git config user.name Test User`.cwd(dir).quiet();
		await $`git add .`.cwd(dir).quiet();
		await $`git commit -m initial`.cwd(dir).quiet();
		await $`git checkout -b autoresearch/test-discard`.cwd(dir).quiet();

		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0003", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				completedAt: new Date().toISOString(),
				durationSeconds: 1,
				exitCode: 0,
				parsedMetrics: { runtime_ms: 9 },
				parsedPrimary: 9,
				runNumber: 3,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.scopePaths = ["autoresearch.md"];
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.state.results = [
			{
				runNumber: 1,
				commit: "aaaaaaa",
				metric: 10,
				metrics: {},
				status: "keep",
				description: "baseline",
				timestamp: 1,
				segment: 0,
				confidence: null,
			},
			{
				runNumber: 2,
				commit: "bbbbbbb",
				metric: 8,
				metrics: {},
				status: "keep",
				description: "winner",
				timestamp: 2,
				segment: 0,
				confidence: null,
			},
		];
		runtime.lastRunArtifactDir = path.join(dir, ".autoresearch", "runs", "0003");
		runtime.lastRunNumber = 3;
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: 1,
			parsedAsi: null,
			parsedMetrics: { runtime_ms: 9 },
			parsedPrimary: 9,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0003"),
			runNumber: 3,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: createGitApi(),
		});
		const result = await tool.execute(
			"call-best",
			{
				commit: "initial",
				metric: 9,
				status: "keep",
				description: "regression from best",
				asi: { hypothesis: "try a weaker variant" },
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Current best: 8"),
		});
		expect(runtime.state.results).toHaveLength(2);
	});

	it("rejects log_experiment when configured secondary metrics are missing", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				completedAt: new Date().toISOString(),
				durationSeconds: 1,
				exitCode: 0,
				parsedMetrics: { memory_mb: 32, runtime_ms: 9 },
				parsedPrimary: 9,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.secondaryMetrics = [
			{ name: "memory_mb", unit: "mb" },
			{ name: "tokens", unit: "" },
		];
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: 1,
			parsedAsi: null,
			parsedMetrics: { memory_mb: 32, runtime_ms: 9 },
			parsedPrimary: 9,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});
		const result = await tool.execute(
			"call-missing-secondary",
			{
				commit: "initial",
				metric: 9,
				status: "discard",
				description: "missing tokens metric",
				metrics: { memory_mb: 32 },
				asi: {
					hypothesis: "watch memory only",
					rollback_reason: "missing required metrics",
					next_action_hint: "include all configured tradeoff metrics",
				},
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("missing secondary metrics: tokens"),
		});
		expect(runtime.state.results).toHaveLength(0);
	});

	it("rejects new secondary metrics unless force is enabled", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				completedAt: new Date().toISOString(),
				durationSeconds: 1,
				exitCode: 0,
				parsedMetrics: { runtime_ms: 9 },
				parsedPrimary: 9,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.secondaryMetrics = [{ name: "memory_mb", unit: "mb" }];
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: 1,
			parsedAsi: null,
			parsedMetrics: { runtime_ms: 9 },
			parsedPrimary: 9,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});
		const result = await tool.execute(
			"call-new-secondary",
			{
				commit: "initial",
				metric: 9,
				status: "discard",
				description: "introduce tokens metric",
				metrics: { memory_mb: 32, tokens: 100 },
				asi: {
					hypothesis: "watch an extra tradeoff",
					rollback_reason: "needs explicit opt-in",
					next_action_hint: "retry with force if the metric matters",
				},
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("new secondary metrics require force=true: tokens"),
		});
		expect(runtime.state.results).toHaveLength(0);
	});

	it("accepts a new secondary metric when force is enabled", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);

		await $`git init`.cwd(dir).quiet();
		await $`git config user.email test@example.com`.cwd(dir).quiet();
		await $`git config user.name Test User`.cwd(dir).quiet();
		await $`git add .`.cwd(dir).quiet();
		await $`git commit -m initial`.cwd(dir).quiet();
		await $`git checkout -b autoresearch/test-force-secondary-accept`.cwd(dir).quiet();

		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				completedAt: new Date().toISOString(),
				durationSeconds: 1,
				exitCode: 0,
				parsedMetrics: { runtime_ms: 9 },
				parsedPrimary: 9,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.secondaryMetrics = [{ name: "memory_mb", unit: "mb" }];
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: 1,
			parsedAsi: null,
			parsedMetrics: { runtime_ms: 9 },
			parsedPrimary: 9,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: createGitApi(),
		});
		const result = await tool.execute(
			"call-force-secondary",
			{
				commit: "initial",
				metric: 9,
				status: "discard",
				description: "force extra metric",
				force: true,
				metrics: { memory_mb: 32, tokens: 100 },
				asi: {
					hypothesis: "capture an extra tradeoff",
					rollback_reason: "benchmark was flat",
					next_action_hint: "keep collecting tokens when useful",
				},
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Logged run #1: discard"),
		});
		expect(runtime.state.secondaryMetrics).toContainEqual({ name: "tokens", unit: "" });
	});

	it("rejects log_experiment at the tool boundary when asi is missing", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				completedAt: new Date().toISOString(),
				durationSeconds: 1,
				exitCode: 0,
				parsedMetrics: { runtime_ms: 9 },
				parsedPrimary: 9,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: 1,
			parsedAsi: null,
			parsedMetrics: { runtime_ms: 9 },
			parsedPrimary: 9,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {} as ExtensionAPI,
		});
		const result = await tool.execute(
			"call-missing-asi",
			{
				commit: "initial",
				metric: 9,
				status: "keep",
				description: "missing asi",
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("asi is required"),
		});
		expect(runtime.state.results).toHaveLength(0);
		expect(fs.existsSync(path.join(dir, "autoresearch.jsonl"))).toBe(false);
	});

	it("requires failed benchmarks to be logged as crash", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				completedAt: new Date().toISOString(),
				durationSeconds: 1,
				exitCode: 1,
				runNumber: 1,
				timedOut: false,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: 1,
			parsedAsi: null,
			parsedMetrics: null,
			parsedPrimary: null,
			passed: false,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {
				exec: async () => ({ code: 0, stderr: "", stdout: "autoresearch/test-20260323\n" }),
			} as unknown as ExtensionAPI,
		});
		const result = await tool.execute(
			"call-status-crash",
			{
				commit: "initial",
				metric: 0,
				status: "discard",
				description: "wrong status",
				asi: {
					hypothesis: "broken attempt",
					rollback_reason: "benchmark failed",
					next_action_hint: "fix the crash first",
				},
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Log it as crash"),
		});
	});

	it("requires failed checks to be logged as checks_failed", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				checks: { durationSeconds: 1, passed: false, timedOut: false },
				command: "bash autoresearch.sh",
				completedAt: new Date().toISOString(),
				durationSeconds: 1,
				exitCode: 0,
				parsedPrimary: 10,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunSummary = {
			checksDurationSeconds: 1,
			checksPass: false,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: 1,
			parsedAsi: null,
			parsedMetrics: null,
			parsedPrimary: 10,
			passed: false,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: {
				exec: async () => ({ code: 0, stderr: "", stdout: "autoresearch/test-20260323\n" }),
			} as unknown as ExtensionAPI,
		});
		const result = await tool.execute(
			"call-status-checks",
			{
				commit: "initial",
				metric: 10,
				status: "crash",
				description: "wrong checks status",
				asi: {
					hypothesis: "checks regressed",
					rollback_reason: "test suite failed",
					next_action_hint: "inspect failing checks",
				},
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Log it as checks_failed"),
		});
	});

	it("persists autoresearch shutdown when the max iteration cap is reached", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);

		await $`git init`.cwd(dir).quiet();
		await $`git config user.email test@example.com`.cwd(dir).quiet();
		await $`git config user.name Test User`.cwd(dir).quiet();
		await $`git add .`.cwd(dir).quiet();
		await $`git commit -m initial`.cwd(dir).quiet();
		await $`git checkout -b autoresearch/test-max-iterations-accept`.cwd(dir).quiet();

		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				exitCode: 0,
				parsedMetrics: { runtime_ms: 9 },
				parsedPrimary: 9,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.autoresearchMode = true;
		runtime.goal = "reduce runtime";
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.scopePaths = ["autoresearch.md"];
		runtime.state.maxExperiments = 1;
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunArtifactDir = path.join(dir, ".autoresearch", "runs", "0001");
		runtime.lastRunNumber = 1;
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: null,
			parsedAsi: null,
			parsedMetrics: { runtime_ms: 9 },
			parsedPrimary: 9,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const managedApi = createManagedGitApi({
			activeTools: ["read", "init_experiment", "run_experiment", "log_experiment"],
		});
		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: managedApi.api,
		});
		const result = await tool.execute(
			"call-max",
			{
				commit: "initial",
				metric: 9,
				status: "keep",
				description: "Baseline",
				asi: { hypothesis: "record baseline" },
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Autoresearch mode is now off"),
		});
		expect(runtime.autoresearchMode).toBe(false);
		expect(managedApi.appendEntries).toContainEqual({
			customType: "autoresearch-control",
			data: { mode: "off", goal: "reduce runtime" },
		});
		expect(managedApi.setActiveToolsCalls).toEqual([["read"]]);
	});

	it("rejects keep when a rename touches an off-limits source path", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir, {
			contract: [
				"# Autoresearch",
				"",
				"## Benchmark",
				"- command: bash autoresearch.sh",
				"- primary metric: runtime_ms",
				"- metric unit: ms",
				"- direction: lower",
				"",
				"## Files in Scope",
				"- src",
				"",
				"## Off Limits",
				"- src/generated",
				"",
				"## Constraints",
				"",
			].join("\n"),
		});

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.scopePaths = ["src"];
		runtime.state.offLimits = ["src/generated"];
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: null,
			parsedAsi: null,
			parsedMetrics: { runtime_ms: 9 },
			parsedPrimary: 9,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const api = {
			exec: async (command: string, args: string[]) => {
				if (command !== "git") return { code: 1, stderr: "unexpected", stdout: "" };
				if (args[0] === "status") {
					return { code: 0, stderr: "", stdout: "R  src/generated/index.ts\0src/index.ts\0" };
				}
				return { code: 1, stderr: `unexpected git args: ${args.join(" ")}`, stdout: "" };
			},
		} as unknown as ExtensionAPI;

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: api,
		});
		const result = await tool.execute(
			"call-8",
			{
				commit: "initial",
				metric: 9,
				status: "keep",
				description: "Should fail on rename",
				asi: { hypothesis: "rename generated file" },
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Off Limits"),
		});
		expect(runtime.state.results).toHaveLength(0);
	});

	it("removes ignored experiment artifacts on discard while preserving autoresearch control files", async () => {
		const dir = makeTempDir();
		tempDirs.push(dir);
		writeAutoresearchWorkspace(dir);
		fs.writeFileSync(path.join(dir, ".gitignore"), "tmp-artifact/\n");
		fs.writeFileSync(path.join(dir, "autoresearch.program.md"), "# Strategy\n");

		await $`git init`.cwd(dir).quiet();
		await $`git config user.email test@example.com`.cwd(dir).quiet();
		await $`git config user.name Test User`.cwd(dir).quiet();
		await $`git add .`.cwd(dir).quiet();
		await $`git commit -m initial`.cwd(dir).quiet();
		await $`git checkout -b autoresearch/test-discard-cleanup`.cwd(dir).quiet();

		fs.mkdirSync(path.join(dir, "tmp-artifact"), { recursive: true });
		fs.writeFileSync(path.join(dir, "tmp-artifact", "result.txt"), "temporary benchmark output\n");
		await Bun.write(
			path.join(dir, ".autoresearch", "runs", "0001", "run.json"),
			JSON.stringify({
				command: "bash autoresearch.sh",
				exitCode: 0,
				parsedMetrics: { runtime_ms: 10 },
				parsedPrimary: 10,
				runNumber: 1,
			}),
		);

		const runtime = createSessionRuntime();
		runtime.state.metricName = "runtime_ms";
		runtime.state.metricUnit = "ms";
		runtime.state.scopePaths = ["src"];
		runtime.state.segmentFingerprint = createFingerprint(dir);
		runtime.lastRunSummary = {
			checksDurationSeconds: 0,
			checksPass: null,
			checksTimedOut: false,
			command: "bash autoresearch.sh",
			durationSeconds: null,
			parsedAsi: null,
			parsedMetrics: { runtime_ms: 10 },
			parsedPrimary: 10,
			passed: true,
			runDirectory: path.join(dir, ".autoresearch", "runs", "0001"),
			runNumber: 1,
		};

		const tool = createLogExperimentTool({
			dashboard: createDashboardStub(),
			getRuntime: () => runtime,
			pi: createGitApi(),
		});
		const result = await tool.execute(
			"call-discard",
			{
				commit: "initial",
				metric: 10,
				status: "discard",
				description: "Discard noisy run",
				asi: {
					hypothesis: "investigate cache behavior",
					rollback_reason: "ignored artifact should be cleaned",
					next_action_hint: "try a cleaner setup",
				},
			},
			undefined,
			undefined,
			createContext(dir),
		);

		expect(result.content[0]).toEqual({
			type: "text",
			text: expect.stringContaining("Logged run #1: discard"),
		});
		expect(fs.existsSync(path.join(dir, "tmp-artifact"))).toBe(false);
		expect(fs.existsSync(path.join(dir, "autoresearch.md"))).toBe(true);
		expect(fs.existsSync(path.join(dir, "autoresearch.program.md"))).toBe(true);
	});
});
