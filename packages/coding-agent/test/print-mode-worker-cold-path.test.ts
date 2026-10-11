import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spec 043: a headless `-p --mode json` worker must finish without loading modules
// that only other paths need (subcommands, ACP, quota, resume picker, HTML export).
// Each module below is wrapped with a load counter (vi.doMock + importOriginal) and
// main() runs the real worker argv against a local OpenAI-compatible mock, so a
// static import anywhere on the path fails here.
const COLD_PATH_MODULES = {
	runCommand: "../src/commands/run-command.ts",
	verifiedRunCoordinator: "../src/core/verified-run/coordinator.ts",
	codexBarCli: "../src/codexbar-cli.ts",
} as const;
type ColdPathModule = keyof typeof COLD_PATH_MODULES;
const loads = new Map<ColdPathModule, number>();

/** Minimal OpenAI-compatible streaming endpoint: answers every chat request with "hi". */
function startMockServer(): Promise<Server> {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
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

describe("omk --mode json -p worker cold path (spec 043)", () => {
	let tempDir: string;
	let server: Server;
	let originalCwd: string;
	let savedEnv: Record<string, string | undefined>;
	let originalExitCode: typeof process.exitCode;
	let stdinTtyDescriptor: PropertyDescriptor | undefined;

	beforeEach(async () => {
		vi.resetModules();
		loads.clear();
		for (const [name, path] of Object.entries(COLD_PATH_MODULES) as [ColdPathModule, string][]) {
			vi.doMock(path, async (importOriginal) => {
				loads.set(name, (loads.get(name) ?? 0) + 1);
				return await importOriginal();
			});
		}
		tempDir = join(tmpdir(), `omk-worker-cold-path-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const agentDir = join(tempDir, "agent");
		const projectDir = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		server = await startMockServer();
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
		const promptFile = join(tempDir, "prompt-worker.md");
		writeFileSync(promptFile, "You are a helper subagent. Answer briefly.\n");

		originalCwd = process.cwd();
		savedEnv = {
			OMK_CODING_AGENT_DIR: process.env.OMK_CODING_AGENT_DIR,
			OMK_FINISH_CHECK: process.env.OMK_FINISH_CHECK,
			OMK_OFFLINE: process.env.OMK_OFFLINE,
			OMK_SKIP_VERSION_CHECK: process.env.OMK_SKIP_VERSION_CHECK,
		};
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
		process.env.OMK_CODING_AGENT_DIR = agentDir;
		process.env.OMK_FINISH_CHECK = "0";
		process.env.OMK_OFFLINE = "1";
		process.chdir(projectDir);
		// vitest's stdin is a never-ending pipe; mark it as a TTY so main() skips the stdin read.
		stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
	});

	afterEach(async () => {
		for (const path of Object.values(COLD_PATH_MODULES)) vi.doUnmock(path);
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

	it("answers the worker prompt without loading cold-path modules", async () => {
		// Invoke write callbacks: print mode awaits stdout drain before returning.
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
		await main([
			"--mode",
			"json",
			"-p",
			"--no-session",
			"--model",
			"mock/mock-1",
			"--append-system-prompt",
			join(tempDir, "prompt-worker.md"),
			"Task: run the checks and reply with hi",
		]);

		expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain('"hi"');
		expect(process.exitCode ?? 0).toBe(0);
		expect(Object.fromEntries(loads)).toEqual({});
	});
});
