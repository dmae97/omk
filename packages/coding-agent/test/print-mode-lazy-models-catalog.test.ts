import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBuiltInModelsCatalogLoaded, resetBuiltInModelsCatalogForTest } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { main } from "../src/main.ts";

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

describe("omk -p with a fully specified custom provider", () => {
	let tempDir: string;
	let server: Server;
	let originalCwd: string;
	let originalAgentDir: string | undefined;
	let originalExitCode: typeof process.exitCode;
	let stdinTtyDescriptor: PropertyDescriptor | undefined;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `omk-print-lazy-models-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

		originalCwd = process.cwd();
		originalAgentDir = process.env[ENV_AGENT_DIR];
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
		process.env[ENV_AGENT_DIR] = agentDir;
		process.chdir(projectDir);
		// vitest's stdin is a never-ending pipe; mark it as a TTY so main() skips the stdin read.
		stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		resetBuiltInModelsCatalogForTest();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (stdinTtyDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
		else delete (process.stdin as { isTTY?: boolean }).isTTY;
		process.chdir(originalCwd);
		process.exitCode = originalExitCode;
		if (originalAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = originalAgentDir;
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("finishes without evaluating the built-in models catalog", async () => {
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

		await main(["--provider", "mock", "--model", "mock-1", "--no-session", "--offline", "-p", "say hi"]);

		expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("hi");
		expect(process.exitCode ?? 0).toBe(0);
		expect(isBuiltInModelsCatalogLoaded()).toBe(false);
	});
});
