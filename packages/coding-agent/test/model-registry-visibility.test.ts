import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { validateModelsConfig } from "../src/core/model-registry-schema.ts";

let dir: string;
let path: string;
const provider = {
	baseUrl: "https://example.invalid/v1",
	api: "openai-completions",
	apiKey: "fixture-only",
	models: [{ id: "same-id" }, { id: "other-id" }],
};
function save(visibility?: unknown) {
	writeFileSync(
		path,
		JSON.stringify({
			providers: { visible: provider, hidden: provider },
			...(visibility === undefined ? {} : { visibility }),
		}),
	);
}
function load() {
	return ModelRegistry.createReadOnly(AuthStorage.inMemory(), path);
}
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "omk-model-visibility-"));
	path = join(dir, "models.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("model list visibility", () => {
	it("preserves legacy availability when no visibility filter is configured", () => {
		save();
		expect(
			load()
				.getAvailable()
				.filter((model) => ["visible", "hidden"].includes(model.provider)),
		).toHaveLength(4);
	});
	it("hides providers without deleting model definitions or credentials", () => {
		save({ providers: ["visible"] });
		const registry = load();
		expect(registry.getAvailable().map((model) => model.provider)).toEqual(["visible", "visible"]);
		expect(registry.find("hidden", "same-id")).toBeDefined();
		expect(registry.hasConfiguredAuth(registry.find("hidden", "same-id")!)).toBe(true);
	});
	it("treats an empty provider allowlist as show none", () => {
		save({ providers: [] });
		expect(load().getAvailable()).toEqual([]);
	});
	it("matches exact model IDs within their provider only", () => {
		save({ providers: ["visible", "hidden"], models: { visible: ["same-id"], hidden: [] } });
		expect(
			load()
				.getAvailable()
				.map((model) => `${model.provider}/${model.id}`),
		).toEqual(["visible/same-id"]);
	});
	it.each(["constructor", "toString", "__proto__"])("ignores inherited model-map keys for %s", (name) => {
		writeFileSync(path, JSON.stringify({ providers: { [name]: provider }, visibility: { models: {} } }));
		expect(
			load()
				.getAvailable()
				.filter((model) => model.provider === name),
		).toHaveLength(2);
	});
	it("never grants authentication merely because a provider is visible", () => {
		writeFileSync(path, JSON.stringify({ providers: {}, visibility: { providers: ["openai"] } }));
		expect(load().getAvailable()).toEqual([]);
	});
	it("refreshes when only visibility changes and can restore the old catalog", () => {
		save({ providers: ["visible"] });
		const registry = load();
		registry.refreshIfChanged();
		save({ providers: ["hidden"] });
		expect(registry.refreshIfChanged()).toBe(true);
		expect(registry.getAvailable().map((model) => model.provider)).toEqual(["hidden", "hidden"]);
		save();
		registry.refresh();
		expect(registry.getAvailable().filter((model) => ["visible", "hidden"].includes(model.provider))).toHaveLength(4);
	});
	it("applies the filter to dynamically registered providers too", () => {
		save({ providers: ["visible"] });
		const registry = load();
		registry.registerProvider("late", {
			...provider,
			api: "openai-completions",
			models: registry.getAll().filter((model) => model.provider === "visible"),
		});
		expect(registry.find("late", "same-id")).toBeDefined();
		expect(registry.getAvailable().some((model) => model.provider === "late")).toBe(false);
	});
	it.each([{ providers: "visible" }, { providers: [""] }, { models: { visible: "same-id" } }])(
		"rejects invalid visibility and fails closed: %j",
		(visibility) => {
			save(visibility);
			const registry = load();
			expect(registry.getError()).toContain("schema");
			expect(registry.getAvailable()).toEqual([]);
			expect(validateModelsConfig.Check({ providers: {}, visibility })).toBe(false);
		},
	);
});
