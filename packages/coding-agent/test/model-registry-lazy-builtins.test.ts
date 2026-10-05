import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { resolveCliModel } from "../src/core/model-resolver.ts";

describe("ModelRegistry defers built-in catalog", () => {
	const dirs: string[] = [];

	afterEach(() => {
		vi.resetModules();
	});

	function registryWithMockModel(): ModelRegistry {
		const dir = join(tmpdir(), `omk-lazy-models-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		dirs.push(dir);
		writeFileSync(
			join(dir, "models.json"),
			JSON.stringify({
				providers: {
					mock: {
						baseUrl: "http://127.0.0.1:9/v1",
						api: "openai-completions",
						apiKey: "x",
						models: [{ id: "mock-1", contextWindow: 128000, maxTokens: 4096 }],
					},
				},
			}),
		);
		writeFileSync(join(dir, "auth.json"), "{}");
		return ModelRegistry.create(AuthStorage.create(join(dir, "auth.json")), join(dir, "models.json"));
	}

	it("does not load built-ins when custom model resolves via CLI", () => {
		const registry = registryWithMockModel();
		expect(registry.areBuiltInsLoaded()).toBe(false);
		const resolved = resolveCliModel({
			cliProvider: "mock",
			cliModel: "mock-1",
			modelRegistry: registry,
		});
		expect(resolved.model?.id).toBe("mock-1");
		expect(resolved.error).toBeUndefined();
		expect(registry.areBuiltInsLoaded()).toBe(false);
	});

	it("loads built-ins when getAll is required", () => {
		const registry = registryWithMockModel();
		expect(registry.areBuiltInsLoaded()).toBe(false);
		const all = registry.getAll();
		expect(all.length).toBeGreaterThan(1);
		expect(registry.areBuiltInsLoaded()).toBe(true);
	});
});
