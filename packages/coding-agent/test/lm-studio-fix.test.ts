import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { Snowflake } from "@oh-my-pi/pi-utils";

describe("ModelRegistry LM Studio Fixes", () => {
	let tempDir: string;
	let modelsJsonPath: string;
	let authStorage: AuthStorage;

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `pi-test-lm-studio-fixes-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		modelsJsonPath = path.join(tempDir, "models.json");
		authStorage = await AuthStorage.create(path.join(tempDir, "testauth.db"));
	});

	afterEach(() => {
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	test("auto-discovers both ollama and lm-studio models independently", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes(":11434/api/tags")) {
				return new Response(JSON.stringify({ models: [{ name: "ollama-model" }] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url.includes(":1234/v1/models")) {
				return new Response(JSON.stringify({ data: [{ id: "lm-studio-model" }] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response(null, { status: 404 });
		}) as unknown as typeof fetch;

		try {
			// Mock environment variables
			const registry = new ModelRegistry(authStorage, modelsJsonPath);
			await registry.refresh();

			const allModels = registry.getAll();
			expect(allModels.some((m: any) => m.provider === "ollama" && m.id === "ollama-model")).toBe(true);
			expect(allModels.some((m: any) => m.provider === "lm-studio" && m.id === "lm-studio-model")).toBe(true);

			const available = registry.getAvailable();
			expect(available.some((m: any) => m.provider === "ollama")).toBe(true);
			expect(available.some((m: any) => m.provider === "lm-studio")).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("lm-studio discovery handles trailing slashes in baseUrl correctly", async () => {
		const originalFetch = globalThis.fetch;
		let requestedUrl = "";
		globalThis.fetch = (async (input: string | URL | Request) => {
			requestedUrl = String(input);
			return new Response(JSON.stringify({ data: [{ id: "model-1" }] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		try {
			// Scenario 1: No trailing slash
			fs.writeFileSync(
				modelsJsonPath,
				JSON.stringify({
					providers: {
						"lm-studio": {
							baseUrl: "http://127.0.0.1:1234/v1",
							api: "openai-completions",
							discovery: { type: "lm-studio" },
						},
					},
				}),
			);
			let registry = new ModelRegistry(authStorage, modelsJsonPath);
			await registry.refresh();
			expect(requestedUrl).toBe("http://127.0.0.1:1234/v1/models");

			// Scenario 2: With trailing slash
			fs.writeFileSync(
				modelsJsonPath,
				JSON.stringify({
					providers: {
						"lm-studio": {
							baseUrl: "http://127.0.0.1:1234/v1/",
							api: "openai-completions",
							discovery: { type: "lm-studio" },
						},
					},
				}),
			);
			registry = new ModelRegistry(authStorage, modelsJsonPath);
			await registry.refresh();
			expect(requestedUrl).toBe("http://127.0.0.1:1234/v1/models");

			// Scenario 3: Custom port without /v1
			fs.writeFileSync(
				modelsJsonPath,
				JSON.stringify({
					providers: {
						"lm-studio": {
							baseUrl: "http://127.0.0.1:9999",
							api: "openai-completions",
							discovery: { type: "lm-studio" },
						},
					},
				}),
			);
			registry = new ModelRegistry(authStorage, modelsJsonPath);
			await registry.refresh();
			expect(requestedUrl).toBe("http://127.0.0.1:9999/v1/models");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
