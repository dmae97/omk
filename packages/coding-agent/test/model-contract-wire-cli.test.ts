import { execFile } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const execute = promisify(execFile);
const modelId = "deepseek-v4-flash-0731";
const provider = "modelstudio-local-fixture";
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(allowedId = modelId, mode: "text" | "json" = "text", readImage = false) {
	const directory = mkdtempSync(join(tmpdir(), "omk-wire-cli-"));
	cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
	const agentDir = join(directory, "agent");
	mkdirSync(agentDir);
	if (readImage) copyFileSync(join(root, "packages/ai/test/data/red-circle.png"), join(directory, "plot.png"));
	const requests: unknown[] = [];
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk.toString();
		try {
			requests.push(JSON.parse(body));
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			response.writeHead(400).end();
			return;
		}
		response.writeHead(200, { "content-type": "text/event-stream" });
		const callRead = readImage && requests.length === 1;
		const delta = callRead
			? {
					tool_calls: [
						{
							index: 0,
							id: "read-image-1",
							type: "function",
							function: { name: "read", arguments: JSON.stringify({ path: join(directory, "plot.png") }) },
						},
					],
				}
			: { content: "fixture ok" };
		const chunk = {
			id: "chatcmpl-cli-fixture",
			model: modelId,
			choices: [{ index: 0, delta, finish_reason: callRead ? "tool_calls" : "stop" }],
			usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
		};
		response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	cleanups.push(async () => {
		server.close();
		await once(server, "close");
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Fixture server has no TCP address");
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				[provider]: {
					api: "openai-completions",
					baseUrl: `http://127.0.0.1:${address.port}/v1`,
					apiKey: "fixture-key",
					compat: {
						thinkingFormat: "qwen",
						maxTokensField: "max_tokens",
						supportsDeveloperRole: false,
						supportsStore: false,
					},
					models: [{ id: modelId, reasoning: true, contextWindow: 128000, maxTokens: 32768 }],
				},
			},
		}),
	);
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }),
	);
	const policyPath = join(directory, "contract.json");
	writeFileSync(
		policyPath,
		JSON.stringify({
			allowedModels: [{ provider, id: allowedId }],
			allowedProviders: [provider],
			allowedAuthOrigins: [provider],
			thinking: false,
			thinkingLevel: "off",
			maxOutputTokens: 512,
		}),
	);
	const invoke = () => {
		const execution = execute(
			process.execPath,
			[
				join(root, "node_modules/tsx/dist/cli.mjs"),
				"--tsconfig",
				join(root, "tsconfig.json"),
				join(root, "packages/coding-agent/src/cli.ts"),
				"--offline",
				"--mode",
				mode,
				"--no-session",
				...(readImage ? ["--tools", "read"] : ["--no-tools"]),
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-context-files",
				"--provider",
				provider,
				"--model",
				modelId,
				"--thinking",
				"off",
				"--model-contract",
				policyPath,
				"--print",
				"Return the fixture result.",
			],
			{
				cwd: directory,
				timeout: 20000,
				encoding: "utf8",
				env: {
					PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
					HOME: directory,
					OMK_CODING_AGENT_DIR: agentDir,
					OMK_OFFLINE: "1",
					OMK_TELEMETRY: "0",
					CI: "true",
					NO_COLOR: "1",
				},
			},
		);
		// Print mode reads piped stdin to EOF before starting the prompt.
		execution.child.stdin?.end();
		return execution;
	};
	return { invoke, requests };
}

describe("source CLI single-model wire contract", () => {
	it("completes an actual image read without leaving the pinned text-only model", async () => {
		const { invoke, requests } = await fixture(modelId, "json", true);
		const result = await invoke();
		expect(result.stdout).toContain("fixture ok");
		expect(result.stdout).toContain('"omittedToolImages":1');
		expect(result.stdout).toContain('"type":"image"');
		expect(requests).toHaveLength(2);
		expect(JSON.stringify(requests[1])).not.toContain("image_url");
		expect(JSON.stringify(requests[1])).toContain("not inspected");
		expect(requests[1]).toHaveProperty("model", modelId);
	});

	it.each(["text", "json"] as const)("carries the contract through the real HTTP request in %s mode", async (mode) => {
		const { invoke, requests } = await fixture(modelId, mode);
		const result = await invoke();
		expect(result.stdout).toContain("fixture ok");
		expect(requests).toHaveLength(1);
		expect(requests[0]).toEqual(expect.objectContaining({ model: modelId, max_tokens: 512, enable_thinking: false }));
		expect(requests[0]).not.toHaveProperty("max_completion_tokens");
	});

	it.each(["text", "json"] as const)(
		"exits nonzero without HTTP dispatch for a forbidden model in %s mode",
		async (mode) => {
			const { invoke, requests } = await fixture("other-model", mode);
			await expect(invoke()).rejects.toMatchObject({ code: 1 });
			expect(requests).toEqual([]);
		},
	);
});
