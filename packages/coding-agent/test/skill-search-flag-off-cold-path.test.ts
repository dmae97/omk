import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spec 050 AC 3 (CI part), modeled on print-mode-worker-cold-path.test.ts: with OMK_SKILL_SEARCH off, or on
// but inactive (24 skills or fewer), or on in a worker (OMK_SKILL_SEARCH_SUGGEST=0) that never searches, a
// `-p` run must not load the index module, and no index file may exist before the first search.
const SKILL_SEARCH_MODULE = "../src/core/skill-search.ts";
const INDEX_FILE = join("cache", "skill-index-v1.json");
const ENV_KEYS = [
	"OMK_CODING_AGENT_DIR",
	"OMK_FINISH_CHECK",
	"OMK_OFFLINE",
	"OMK_SKIP_VERSION_CHECK",
	"OMK_SKILL_SEARCH",
	"OMK_SKILL_SEARCH_SUGGEST",
	"OMK_SKILL_SELECT",
	"OMK_RUN_LOG_DIR",
	"OMK_TRUST_PROJECT",
	"OMK_PRINT_EXIT_GRACE_MS",
	"HOME",
] as const;
let loads = 0;

/** Minimal OpenAI-compatible streaming endpoint: answers every chat request with "hi". */
function startMockServer(bodies: string[]): Promise<Server> {
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			bodies.push(body);
			if (!req.url?.includes("/chat/completions")) {
				res.writeHead(404).end();
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			const chunk = (delta: object, finish: string | null = null, extra: object = {}) =>
				`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
			res.write(chunk({ role: "assistant", content: "" }));
			res.write(chunk({ content: "hi" }));
			res.write(chunk({}, "stop", { usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }));
			res.end("data: [DONE]\n\n");
		});
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

interface Case {
	readonly label: string;
	readonly env: Record<string, string>;
	/** Synthetic skills written to the agent dir (the 6 bundled ones are always loaded too). */
	readonly skills: number;
	readonly loaded: boolean;
	readonly tool: boolean;
}

const CASES: Case[] = [
	{ label: "flag off", env: {}, skills: 30, loaded: false, tool: false },
	{ label: "flag on, 24 skills or fewer", env: { OMK_SKILL_SEARCH: "1" }, skills: 0, loaded: false, tool: false },
	{
		label: "flag on, worker without a search",
		env: { OMK_SKILL_SEARCH: "1", OMK_SKILL_SEARCH_SUGGEST: "0" },
		skills: 30,
		loaded: false,
		tool: true,
	},
	// Spec 058 AC 1/3: an unknown OMK_SKILL_SELECT value (wpl included) is off even with the alias set.
	{
		label: "OMK_SKILL_SELECT=wpl (unknown, off)",
		env: { OMK_SKILL_SELECT: "wpl", OMK_SKILL_SEARCH: "1" },
		skills: 30,
		loaded: false,
		tool: false,
	},
	{
		label: "OMK_SKILL_SELECT=metacon, worker without a search",
		env: { OMK_SKILL_SELECT: "metacon", OMK_SKILL_SEARCH_SUGGEST: "0" },
		skills: 30,
		loaded: false,
		tool: true,
	},
	{
		label: "OMK_SKILL_SELECT=metacon, lead task start (control)",
		env: { OMK_SKILL_SELECT: "metacon" },
		skills: 30,
		loaded: true,
		tool: true,
	},
	// Control: the counter does see the module when a task start computes candidates.
	{
		label: "flag on, lead task start (control)",
		env: { OMK_SKILL_SEARCH: "1" },
		skills: 30,
		loaded: true,
		tool: true,
	},
];

describe("skill search cold path (spec 050 AC 3)", () => {
	let tempDir: string;
	let agentDir: string;
	let server: Server;
	let bodies: string[];
	let originalCwd: string;
	let savedEnv: Record<string, string | undefined>;
	let originalExitCode: typeof process.exitCode;
	let stdinTtyDescriptor: PropertyDescriptor | undefined;

	beforeEach(async () => {
		vi.resetModules();
		loads = 0;
		vi.doMock(SKILL_SEARCH_MODULE, async (importOriginal) => {
			loads++;
			return await importOriginal();
		});
		tempDir = join(tmpdir(), `omk-skill-search-cold-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		const projectDir = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		bodies = [];
		server = await startMockServer(bodies);
		const { port } = server.address() as AddressInfo;
		writeFileSync(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					mock: {
						baseUrl: `http://127.0.0.1:${port}/v1`,
						api: "openai-completions",
						apiKey: "x",
						models: [{ id: "mock-1", contextWindow: 128000, maxTokens: 4096 }],
					},
				},
			}),
		);
		writeFileSync(join(agentDir, "auth.json"), "{}");
		originalCwd = process.cwd();
		savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
		for (const key of ENV_KEYS) delete process.env[key];
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
		process.env.OMK_CODING_AGENT_DIR = agentDir;
		// The loader also reads $HOME/.agents/skills, which OMK_CODING_AGENT_DIR does not cover.
		// Isolate HOME or a large user skill set makes skill search active here.
		process.env.HOME = tempDir;
		process.env.OMK_FINISH_CHECK = "0";
		process.env.OMK_OFFLINE = "1";
		process.env.OMK_TRUST_PROJECT = "0";
		// The print-mode exit guard (2 s timer after main) would fire inside a later case and hit the exit spy.
		process.env.OMK_PRINT_EXIT_GRACE_MS = "0";
		process.chdir(projectDir);
		stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
	});

	afterEach(async () => {
		vi.doUnmock(SKILL_SEARCH_MODULE);
		vi.restoreAllMocks();
		if (stdinTtyDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
		else delete (process.stdin as { isTTY?: boolean }).isTTY;
		process.chdir(originalCwd);
		process.exitCode = originalExitCode;
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(tempDir, { recursive: true, force: true });
	});

	it.each(CASES)("$label", async ({ env, skills, loaded, tool }) => {
		for (let i = 0; i < skills; i++) {
			const dir = join(agentDir, "skills", `pdf-helper-${i}`);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "SKILL.md"),
				`---\nname: pdf-helper-${i}\ndescription: Fill PDF forms, variant ${i}.\n---\nbody\n`,
			);
		}
		Object.assign(process.env, env);
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((
			_chunk: unknown,
			encodingOrCallback?: unknown,
			callback?: unknown,
		) => {
			const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
			if (typeof done === "function") queueMicrotask(() => done());
			return true;
		}) as typeof process.stdout.write);
		vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`process.exit(${code})`);
		}) as typeof process.exit);

		const { main } = await import("../src/main.ts");
		await main(["--mode", "json", "-p", "--no-session", "--model", "mock/mock-1", "Fill the PDF forms and reply hi"]);

		expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain('"hi"');
		expect(process.exitCode ?? 0).toBe(0);
		expect(bodies.length).toBeGreaterThan(0);
		expect(bodies[0].includes('"skill_search"')).toBe(tool);
		expect(loads > 0).toBe(loaded);
		expect(existsSync(join(agentDir, INDEX_FILE))).toBe(loaded);
	});
});
