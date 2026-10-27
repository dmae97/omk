import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Spec 061 end-to-end through the real `omk -p` CLI (built dist/cli.js): a mock openai-completions
// provider reports realistic usage (prompt_tokens = size of the request it received), the model has a
// 64k window, and an extension tool returns ~400KB. Gated (SPEC061_E2E=1) because it needs a build.
// Run: npm run build && SPEC061_E2E=1 npx vitest run test/oversized-output-hang.e2e.test.ts
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const WALL_CLOCK_MS = 60_000;

interface CliResult {
	code: number | null;
	timedOut: boolean;
	elapsedMs: number;
	requests: number;
	stdout: string;
	stderr: string;
}

async function runCli(varyArgs: boolean): Promise<CliResult> {
	let requests = 0;
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			const body = JSON.parse(raw) as { messages: Array<{ role: string }> };
			requests++;
			const promptTokens = Math.ceil(raw.length / 4);
			const chunk = (delta: object, finish: string | null = null, extra: object = {}) =>
				`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
			const usage = (input: number) => ({
				usage: { prompt_tokens: input, completion_tokens: 5, total_tokens: input + 5 },
			});
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.write(chunk({ role: "assistant", content: "" }));
			const system = JSON.stringify(body.messages.filter((m) => m.role === "system" || m.role === "developer"));
			if (/summar/i.test(system)) {
				res.write(chunk({ content: "## Goal\nbench\n## Progress\nran tool" }));
				res.write(chunk({}, "stop", usage(100)));
			} else if (body.messages.at(-1)?.role === "tool") {
				res.write(chunk({ content: "ok" }));
				res.write(chunk({}, "stop", usage(promptTokens)));
			} else {
				const args = varyArgs ? JSON.stringify({ n: requests }) : "{}";
				res.write(
					chunk({
						tool_calls: [
							{ index: 0, id: `call_${requests}`, type: "function", function: { name: "big", arguments: args } },
						],
					}),
				);
				res.write(chunk({}, "tool_calls", usage(promptTokens)));
			}
			res.end("data: [DONE]\n\n");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	const dir = mkdtempSync(join(tmpdir(), "omk-061-e2e-"));
	const agentDir = join(dir, "agent");
	const project = join(dir, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(project, { recursive: true });
	writeFileSync(join(agentDir, "auth.json"), "{}");
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				mock: {
					baseUrl: `http://127.0.0.1:${port}/v1`,
					api: "openai-completions",
					apiKey: "x",
					models: [{ id: "mock-64k", contextWindow: 64_000, maxTokens: 4096 }],
				},
			},
		}),
	);
	const extension = join(dir, "big-tool.ts");
	writeFileSync(
		extension,
		`export default function (omk) {
  omk.registerTool({
    name: "big", label: "big", description: "returns ~400KB",
    parameters: { type: "object", properties: { n: { type: "number" } } },
    execute: async () => ({ content: [{ type: "text", text: "y".repeat(400000) }], details: {} }),
  });
}`,
	);
	const started = performance.now();
	try {
		return await new Promise<CliResult>((resolve) => {
			const child = spawn(
				process.execPath,
				[CLI, "-p", "--no-session", "-e", extension, "--model", "mock/mock-64k", "go"],
				{
					cwd: project,
					env: {
						...process.env,
						OMK_CODING_AGENT_DIR: agentDir,
						OMK_TRUST_PROJECT: "0",
						OMK_OFFLINE: "1",
						OMK_FINISH_CHECK: "0",
					},
					detached: true,
				},
			);
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (c) => {
				stdout += c;
			});
			child.stderr.on("data", (c) => {
				stderr += c;
			});
			let timedOut = false;
			const guard = setTimeout(() => {
				timedOut = true;
				if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
			}, WALL_CLOCK_MS);
			child.on("close", (code) => {
				clearTimeout(guard);
				resolve({ code, timedOut, elapsedMs: performance.now() - started, requests, stdout, stderr });
			});
		});
	} finally {
		server.close();
		rmSync(dir, { recursive: true, force: true });
	}
}

const TOO_LARGE = /The output of tool "big" \(~[\d,]+ tokens\) is larger than the 64,000-token context window/;

describe.runIf(process.env.SPEC061_E2E === "1" && existsSync(CLI))("spec 061 end-to-end: omk -p", () => {
	// Varying args evades the identical-loop guard; on main this run never ends (345 requests in 60s).
	it.each([false, true])(
		"reports the oversized tool output on stderr and exits 1 (vary args: %s)",
		async (vary) => {
			const result = await runCli(vary);
			expect({ timedOut: result.timedOut, code: result.code }, result.stderr).toEqual({ timedOut: false, code: 1 });
			expect(result.stderr).toMatch(TOO_LARGE);
			expect(result.stdout).not.toContain("ok\n");
		},
		WALL_CLOCK_MS + 15_000,
	);
});
