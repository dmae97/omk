import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spec 037 R2.2, modeled on skill-search-flag-off-cold-path.test.ts: with OMK_ADAPTIVE_EFFORT off, a headless
// `-p` run against a local mock never loads `adaptive-effort.ts` or `phase-classifier.ts`.
const MODULES = ["../src/core/adaptive-effort.ts", "../src/core/phase-classifier.ts"] as const;
const ENV_KEYS = [
	"OMK_ADAPTIVE_EFFORT",
	"OMK_CODING_AGENT_DIR",
	"OMK_FINISH_CHECK",
	"OMK_OFFLINE",
	"OMK_PRINT_EXIT_GRACE_MS",
	"OMK_SKIP_VERSION_CHECK",
	"OMK_RUN_LOG_DIR",
	"OMK_TRUST_PROJECT",
] as const;
const loads = new Map<string, number>();

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

const CASES = [
	{ label: "flag 0", env: { OMK_ADAPTIVE_EFFORT: "0" }, loaded: false },
	{ label: "flag false", env: { OMK_ADAPTIVE_EFFORT: "false" }, loaded: false },
	{ label: "flag off", env: { OMK_ADAPTIVE_EFFORT: "off" }, loaded: false },
	// Default on: the counters see the modules when unset or 1.
	{ label: "flag unset (default on)", env: {}, loaded: true },
	{ label: "flag 1", env: { OMK_ADAPTIVE_EFFORT: "1" }, loaded: true },
];

describe("adaptive effort cold path (spec 037 R2.2)", () => {
	let tempDir: string;
	let server: Server;
	let bodies: string[];
	let originalCwd: string;
	let savedEnv: Record<string, string | undefined>;
	let originalExitCode: typeof process.exitCode;
	let stdinTtyDescriptor: PropertyDescriptor | undefined;

	beforeEach(async () => {
		vi.resetModules();
		loads.clear();
		for (const module of MODULES) {
			vi.doMock(module, async (importOriginal) => {
				loads.set(module, (loads.get(module) ?? 0) + 1);
				return await importOriginal();
			});
		}
		tempDir = join(tmpdir(), `omk-adaptive-cold-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const agentDir = join(tempDir, "agent");
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
		process.env.OMK_FINISH_CHECK = "0";
		process.env.OMK_OFFLINE = "1";
		process.env.OMK_PRINT_EXIT_GRACE_MS = "0";
		process.env.OMK_TRUST_PROJECT = "0";
		process.chdir(projectDir);
		stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
	});

	afterEach(async () => {
		for (const module of MODULES) vi.doUnmock(module);
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

	it.each(CASES)("$label", async ({ env, loaded }) => {
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
		await main(["--mode", "json", "-p", "--no-session", "--model", "mock/mock-1", "List the files and reply hi"]);

		expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain('"hi"');
		expect(process.exitCode ?? 0).toBe(0);
		expect(bodies.length).toBeGreaterThan(0);
		for (const module of MODULES) expect((loads.get(module) ?? 0) > 0, module).toBe(loaded);
	});
});
