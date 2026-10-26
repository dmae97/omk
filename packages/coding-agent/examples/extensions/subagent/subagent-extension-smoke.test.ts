import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "open-multi-agent-kit";
import { afterEach, describe, expect, it } from "vitest";
import { installProjectPstack } from "../../../src/commands/pstack-install.ts";
import { getPackageDir } from "../../../src/config.ts";

interface SmokeToolResult {
	readonly content: readonly { readonly type: string; readonly text?: string }[];
	readonly details?: unknown;
	readonly isError?: boolean;
}

interface SmokeTool {
	resolveTimeoutMs?(context: { thinkingLevel?: string }): number | undefined;
	execute(
		toolCallId: string,
		params: unknown,
		signal: AbortSignal,
		onUpdate: undefined,
		context: unknown,
	): Promise<SmokeToolResult>;
}

interface SmokeDetails {
	readonly mode: string;
	readonly results: readonly {
		readonly output?: string;
		readonly exitCode: number;
		readonly deadline?: { readonly outcome: string; readonly attempts: readonly unknown[] };
	}[];
	readonly executionBudget: {
		readonly unbounded?: boolean;
		readonly hardDeadlineMs: number;
		readonly plannedShards: number;
		readonly completedShards: number;
		readonly resumeCount: number;
	};
	readonly graph?: { readonly waves: readonly (readonly string[])[]; readonly completedNodeIds: readonly string[] };
}

const cleanupPaths: string[] = [];
const originalArgvEntry = process.argv[1];
const originalAgentDir = process.env.OMK_CODING_AGENT_DIR;
const originalExpectedModel = process.env.OMK_EXPECTED_MODEL;
const originalArgvFile = process.env.OMK_FAKE_ARGV_FILE;
const originalWorkerExtensions = process.env.OMK_WORKER_EXTENSIONS;

afterEach(async () => {
	process.argv[1] = originalArgvEntry;
	if (originalAgentDir === undefined) delete process.env.OMK_CODING_AGENT_DIR;
	else process.env.OMK_CODING_AGENT_DIR = originalAgentDir;
	if (originalExpectedModel === undefined) delete process.env.OMK_EXPECTED_MODEL;
	else process.env.OMK_EXPECTED_MODEL = originalExpectedModel;
	if (originalArgvFile === undefined) delete process.env.OMK_FAKE_ARGV_FILE;
	else process.env.OMK_FAKE_ARGV_FILE = originalArgvFile;
	if (originalWorkerExtensions === undefined) delete process.env.OMK_WORKER_EXTENSIONS;
	else process.env.OMK_WORKER_EXTENSIONS = originalWorkerExtensions;
	await Promise.all(cleanupPaths.splice(0).map((entry) => fs.promises.rm(entry, { recursive: true, force: true })));
});

describe("subagent extension registration and spawn smoke", () => {
	it("inherits the selected session model across the managed process boundary", async () => {
		const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omk-subagent-extension-smoke-"));
		cleanupPaths.push(cwd);
		const projectAgentsDir = path.join(cwd, ".omk", "agents");
		const agentHome = path.join(cwd, "agent-home");
		await fs.promises.mkdir(projectAgentsDir, { recursive: true });
		await fs.promises.mkdir(agentHome, { recursive: true });
		await fs.promises.writeFile(
			path.join(projectAgentsDir, "fixture-agent.md"),
			"---\nname: fixture-agent\ndescription: Offline extension smoke fixture\n---\nReturn the fixture result.\n",
			"utf8",
		);
		process.argv[1] = path.join(import.meta.dirname, "fixtures", "fake-omk-json.mjs");
		process.env.OMK_CODING_AGENT_DIR = agentHome;
		process.env.OMK_EXPECTED_MODEL = "openai-codex/session-selected-model";

		let registered: unknown;
		const api = {
			registerTool(tool: unknown) {
				registered = tool;
			},
		} as unknown as ExtensionAPI;
		const { default: registerSubagent } = await import("./index.ts");
		registerSubagent(api);
		if (!isSmokeTool(registered)) throw new Error("subagent tool was not registered");

		const result = await registered.execute(
			"fixture-call",
			{
				agent: "fixture-agent",
				task: "Run the offline fixture.",
				agentScope: "project",
				confirmProjectAgents: false,
				executionBudgetMs: 120_000,
				maxResumeAttempts: 1,
			},
			new AbortController().signal,
			undefined,
			{ cwd, hasUI: false, model: { provider: "openai-codex", id: "session-selected-model" } },
		);
		const details = result.details as SmokeDetails;

		expect(result.isError).not.toBe(true);
		expect(result.content[0]?.text).toContain("fixture subagent completed");
		expect(details.mode).toBe("single");
		expect(details.results[0]).toMatchObject({
			exitCode: 0,
			output: "fixture subagent completed",
			deadline: { outcome: "completed" },
		});
		expect(details.results[0]?.deadline?.attempts).toHaveLength(1);
		expect(details.executionBudget).toMatchObject({
			hardDeadlineMs: 120_000,
			plannedShards: 1,
			completedShards: 1,
			resumeCount: 0,
		});
		expect(await fs.promises.stat(path.join(agentHome, "state", "subagent-deadline-profiles.json"))).toBeDefined();
	}, 120_000);

	it("starts the worker with --no-extensions and forwards only the model provider's extension (spec 057)", async () => {
		const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omk-subagent-no-extensions-smoke-"));
		cleanupPaths.push(cwd);
		const projectAgentsDir = path.join(cwd, ".omk", "agents");
		const agentHome = path.join(cwd, "agent-home");
		await fs.promises.mkdir(projectAgentsDir, { recursive: true });
		await fs.promises.mkdir(agentHome, { recursive: true });
		await fs.promises.writeFile(
			path.join(projectAgentsDir, "fixture-agent.md"),
			"---\nname: fixture-agent\ndescription: Offline extension smoke fixture\n---\nReturn the fixture result.\n",
			"utf8",
		);
		const argvFile = path.join(cwd, "worker-argv.jsonl");
		process.argv[1] = path.join(import.meta.dirname, "fixtures", "fake-omk-json.mjs");
		process.env.OMK_CODING_AGENT_DIR = agentHome;
		process.env.OMK_FAKE_ARGV_FILE = argvFile;
		delete process.env.OMK_WORKER_EXTENSIONS;

		const loaded = [
			{
				name: "codex-auth",
				path: "/ext/codex-auth.ts",
				resolvedPath: "/ext/codex-auth.ts",
				source: "local",
				scope: "user",
				origin: "top-level",
				providers: ["openai-codex"],
				hooks: [],
			},
			{
				name: "memory",
				path: "/ext/memory.ts",
				resolvedPath: "/ext/memory.ts",
				source: "local",
				scope: "user",
				origin: "top-level",
				providers: [],
				hooks: ["turn_end"],
			},
		];
		let registered: unknown;
		const api = {
			registerTool(tool: unknown) {
				registered = tool;
			},
			[Symbol.for("omk.internal.loadedExtensions")]: () => loaded,
		} as unknown as ExtensionAPI;
		const { default: registerSubagent } = await import("./index.ts");
		registerSubagent(api);
		if (!isSmokeTool(registered)) throw new Error("subagent tool was not registered");

		const result = await registered.execute(
			"fixture-no-extensions-call",
			{
				agent: "fixture-agent",
				task: "Run the offline fixture.",
				agentScope: "project",
				confirmProjectAgents: false,
				executionBudgetMs: 120_000,
				maxResumeAttempts: 0,
			},
			new AbortController().signal,
			undefined,
			{ cwd, hasUI: false, model: { provider: "openai-codex", id: "session-selected-model" } },
		);

		expect(result.isError).not.toBe(true);
		const argv = JSON.parse((await fs.promises.readFile(argvFile, "utf8")).trim().split("\n")[0]!) as string[];
		const afterSession = argv.indexOf("--no-session") + 1;
		expect(argv.slice(afterSession, afterSession + 3)).toEqual(["--no-extensions", "-e", "/ext/codex-auth.ts"]);
		expect(argv).not.toContain("/ext/memory.ts");
		expect(argv.filter((arg) => arg === "-e")).toHaveLength(1);
	}, 120_000);

	it("prefers an explicit agent model over the inherited session model", async () => {
		const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omk-subagent-model-smoke-"));
		cleanupPaths.push(cwd);
		const projectAgentsDir = path.join(cwd, ".omk", "agents");
		const agentHome = path.join(cwd, "agent-home");
		await fs.promises.mkdir(projectAgentsDir, { recursive: true });
		await fs.promises.mkdir(agentHome, { recursive: true });
		await fs.promises.writeFile(
			path.join(projectAgentsDir, "fixture-agent.md"),
			"---\nname: fixture-agent\ndescription: Offline extension smoke fixture\nmodel: agent-pinned-model\n---\nReturn the fixture result.\n",
			"utf8",
		);
		process.argv[1] = path.join(import.meta.dirname, "fixtures", "fake-omk-json.mjs");
		process.env.OMK_CODING_AGENT_DIR = agentHome;
		process.env.OMK_EXPECTED_MODEL = "agent-pinned-model";

		let registered: unknown;
		const api = {
			registerTool(tool: unknown) {
				registered = tool;
			},
		} as unknown as ExtensionAPI;
		const { default: registerSubagent } = await import("./index.ts");
		registerSubagent(api);
		if (!isSmokeTool(registered)) throw new Error("subagent tool was not registered");

		const result = await registered.execute(
			"fixture-model-call",
			{
				agent: "fixture-agent",
				task: "Run the pinned-model fixture.",
				agentScope: "project",
				confirmProjectAgents: false,
			},
			new AbortController().signal,
			undefined,
			{ cwd, hasUI: false, model: { id: "session-selected-model" } },
		);

		expect(result.isError).not.toBe(true);
		expect(result.content[0]?.text).toContain("fixture subagent completed");
	}, 120_000);

	it("runs validated graph waves and records the graph plan", async () => {
		const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omk-subagent-graph-smoke-"));
		cleanupPaths.push(cwd);
		const projectAgentsDir = path.join(cwd, ".omk", "agents");
		const agentHome = path.join(cwd, "agent-home");
		await fs.promises.mkdir(projectAgentsDir, { recursive: true });
		await fs.promises.mkdir(agentHome, { recursive: true });
		await fs.promises.writeFile(
			path.join(projectAgentsDir, "fixture-agent.md"),
			"---\nname: fixture-agent\ndescription: Offline extension smoke fixture\n---\nReturn the fixture result.\n",
			"utf8",
		);
		process.argv[1] = path.join(import.meta.dirname, "fixtures", "fake-omk-json.mjs");
		process.env.OMK_CODING_AGENT_DIR = agentHome;

		let registered: unknown;
		const api = {
			registerTool(tool: unknown) {
				registered = tool;
			},
		} as unknown as ExtensionAPI;
		const { default: registerSubagent } = await import("./index.ts");
		registerSubagent(api);
		if (!isSmokeTool(registered)) throw new Error("subagent tool was not registered");

		const result = await registered.execute(
			"fixture-graph-call",
			{
				graph: [
					{ id: "research-a", agent: "fixture-agent", task: "Research A." },
					{ id: "research-b", agent: "fixture-agent", task: "Research B." },
					{
						id: "synthesize",
						agent: "fixture-agent",
						task: "Synthesize:\n{dependencies}",
						dependsOn: ["research-a", "research-b"],
					},
				],
				agentScope: "project",
				confirmProjectAgents: false,
				executionBudgetMs: 120_000,
			},
			new AbortController().signal,
			undefined,
			{ cwd, hasUI: false },
		);
		const details = result.details as SmokeDetails;

		expect(result.isError).not.toBe(true);
		expect(details.mode).toBe("graph");
		expect(details.results).toHaveLength(3);
		expect(details.graph).toEqual({
			waves: [["research-a", "research-b"], ["synthesize"]],
			completedNodeIds: ["research-a", "research-b", "synthesize"],
		});
	}, 120_000);

	it("honors an explicit internal execution budget in Ultra while removing parallel limits", async () => {
		const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omk-subagent-ultra-smoke-"));
		cleanupPaths.push(cwd);
		const projectAgentsDir = path.join(cwd, ".omk", "agents");
		const agentHome = path.join(cwd, "agent-home");
		await fs.promises.mkdir(projectAgentsDir, { recursive: true });
		await fs.promises.mkdir(agentHome, { recursive: true });
		await fs.promises.writeFile(
			path.join(projectAgentsDir, "fixture-agent.md"),
			"---\nname: fixture-agent\ndescription: Offline extension smoke fixture\n---\nReturn the fixture result.\n",
			"utf8",
		);
		process.argv[1] = path.join(import.meta.dirname, "fixtures", "fake-omk-json.mjs");
		process.env.OMK_CODING_AGENT_DIR = agentHome;

		let registered: unknown;
		const api = {
			registerTool(tool: unknown) {
				registered = tool;
			},
		} as unknown as ExtensionAPI;
		const { default: registerSubagent } = await import("./index.ts");
		registerSubagent(api);
		if (!isSmokeTool(registered)) throw new Error("subagent tool was not registered");

		expect(registered.resolveTimeoutMs?.({ thinkingLevel: "ultra" })).toBe(0);
		const result = await registered.execute(
			"fixture-ultra-call",
			{
				tasks: Array.from({ length: 9 }, (_, index) => ({
					agent: "fixture-agent",
					task: `Run bounded offline fixture ${index + 1}.`,
				})),
				agentScope: "project",
				confirmProjectAgents: false,
				executionBudgetMs: 120_000,
				maxResumeAttempts: 1,
			},
			new AbortController().signal,
			undefined,
			{ cwd, hasUI: false, thinkingLevel: "ultra" },
		);
		const details = result.details as SmokeDetails;

		expect(result.isError).not.toBe(true);
		expect(details.mode).toBe("parallel");
		expect(details.results).toHaveLength(9);
		expect(details.results.map((entry) => ({ exitCode: entry.exitCode, outcome: entry.deadline?.outcome }))).toEqual(
			Array.from({ length: 9 }, () => ({ exitCode: 0, outcome: "completed" })),
		);
		expect(details.executionBudget).toMatchObject({
			unbounded: false,
			hardDeadlineMs: 120_000,
			plannedShards: 9,
			completedShards: 9,
		});
	}, 120_000);

	it("concurrent calls from different sessions give each worker its own OMK_RUN_LOG_PARENT_SESSION", async () => {
		const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omk-subagent-parent-session-smoke-"));
		cleanupPaths.push(cwd);
		const projectAgentsDir = path.join(cwd, ".omk", "agents");
		const agentHome = path.join(cwd, "agent-home");
		await fs.promises.mkdir(projectAgentsDir, { recursive: true });
		await fs.promises.mkdir(agentHome, { recursive: true });
		await fs.promises.writeFile(
			path.join(projectAgentsDir, "fixture-agent.md"),
			"---\nname: fixture-agent\ndescription: Offline extension smoke fixture\n---\nReturn the fixture result.\n",
			"utf8",
		);
		const envFile = path.join(cwd, "worker-env.jsonl");
		const savedLogDir = process.env.OMK_RUN_LOG_DIR;
		process.argv[1] = path.join(import.meta.dirname, "fixtures", "fake-omk-json.mjs");
		process.env.OMK_CODING_AGENT_DIR = agentHome;
		process.env.OMK_FAKE_ENV_FILE = envFile;
		process.env.OMK_RUN_LOG_DIR = path.join(cwd, "run-log");
		try {
			let registered: unknown;
			const api = {
				registerTool(tool: unknown) {
					registered = tool;
				},
			} as unknown as ExtensionAPI;
			const { default: registerSubagent } = await import("./index.ts");
			registerSubagent(api);
			if (!isSmokeTool(registered)) throw new Error("subagent tool was not registered");
			const tool = registered;
			const call = (sessionId: string) =>
				tool.execute(
					`call-${sessionId}`,
					{
						agent: "fixture-agent",
						task: `task-for-${sessionId}`,
						agentScope: "project",
						confirmProjectAgents: false,
						executionBudgetMs: 120_000,
						maxResumeAttempts: 0,
					},
					new AbortController().signal,
					undefined,
					{
						cwd,
						hasUI: false,
						sessionManager: { getSessionId: () => sessionId, getEntries: () => [] },
					},
				);
			const results = await Promise.all([call("sess-one"), call("sess-two")]);
			for (const r of results) expect(r.isError).not.toBe(true);
			const rows = (await fs.promises.readFile(envFile, "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { task: string; parent: string | null });
			expect(rows).toHaveLength(2);
			for (const row of rows) {
				const owner = row.task.includes("sess-one") ? "sess-one" : "sess-two";
				expect(row.parent).toBe(owner);
			}
		} finally {
			delete process.env.OMK_FAKE_ENV_FILE;
			if (savedLogDir === undefined) delete process.env.OMK_RUN_LOG_DIR;
			else process.env.OMK_RUN_LOG_DIR = savedLogDir;
		}
	}, 120_000);
	it("dispatches an installed pstack agent only after interactive project trust confirmation", async () => {
		const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omk-pstack-dispatch-"));
		cleanupPaths.push(cwd);
		const agentHome = path.join(cwd, "agent-home");
		await fs.promises.mkdir(agentHome);
		installProjectPstack(cwd, path.join(getPackageDir(), "resources", "pstack"), false, () => {});
		process.argv[1] = path.join(import.meta.dirname, "fixtures", "fake-omk-json.mjs");
		process.env.OMK_CODING_AGENT_DIR = agentHome;
		const argvFile = path.join(cwd, "worker-argv.jsonl");
		process.env.OMK_FAKE_ARGV_FILE = argvFile;
		let registered: unknown;
		const { default: registerSubagent } = await import("./index.ts");
		registerSubagent({
			registerTool(tool: unknown) {
				registered = tool;
			},
		} as unknown as ExtensionAPI);
		if (!isSmokeTool(registered)) throw new Error("subagent tool was not registered");
		let confirmed = 0;
		const result = await registered.execute(
			"pstack-fixture",
			{
				agent: "pstack-poteto-agent",
				task: "Read the installed poteto-mode skill, then return the fixture result.",
				agentScope: "project",
				executionBudgetMs: 120_000,
				maxResumeAttempts: 0,
			},
			new AbortController().signal,
			undefined,
			{
				cwd,
				hasUI: true,
				ui: {
					confirm: async () => {
						confirmed++;
						return true;
					},
				},
			},
		);
		expect(confirmed).toBe(1);
		expect(result.isError).not.toBe(true);
		expect(result.content[0]?.text).toContain("fixture subagent completed");
		const argv = JSON.parse((await fs.promises.readFile(argvFile, "utf8")).trim()) as string[];
		expect(argv).toContain("--append-system-prompt");
	}, 120_000);
});

function isSmokeTool(value: unknown): value is SmokeTool {
	return typeof value === "object" && value !== null && "execute" in value && typeof value.execute === "function";
}
