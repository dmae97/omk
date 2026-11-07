import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadExtensions } from "../src/core/extensions/loader.ts";
import { DefaultPackageManager, type ResolvedPaths } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const resourceTypes = ["extensions", "skills", "prompts", "themes"] as const;
const declaredFiles = {
	extensions: "declared/extensions/entry.ts",
	skills: "declared/skills/SKILL.md",
	prompts: "declared/prompts/prompt.md",
	themes: "declared/themes/theme.json",
};
const declaredManifest = Object.fromEntries(resourceTypes.map((type) => [type, [`./${declaredFiles[type]}`]]));
const nativeExtension = `
	import type { ExtensionAPI } from "open-multi-agent-kit";
	export default function(api: ExtensionAPI) {
		api.registerCommand("native-boundary", { handler: async () => {} });
	}
`;

describe("managed package manifest dialect boundary", () => {
	let tempDir: string;
	let cwd: string;
	let agentDir: string;
	let settingsManager: SettingsManager;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "omk-manifest-boundary-"));
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(join(cwd, ".git"), { recursive: true });
		mkdirSync(agentDir);
		vi.stubEnv("HOME", tempDir);
		settingsManager = SettingsManager.inMemory();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(tempDir, { recursive: true, force: true });
	});

	function manager(packageManifestDialect?: "omk" | "omk+pi"): DefaultPackageManager {
		const options = { cwd, agentDir, settingsManager, packageManifestDialect };
		return new DefaultPackageManager(options);
	}

	function write(relativePath: string, contents: string): string {
		const path = join(tempDir, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, contents);
		return path;
	}

	function fixture(relativeRoot: string, manifest: unknown): string {
		const sentinel = join(tempDir, relativeRoot, "executed");
		const rejectedExtension = `
			import { writeFileSync } from "node:fs";
			writeFileSync(${JSON.stringify(sentinel)}, "executed");
			export default function() {}
		`;
		write(`${relativeRoot}/package.json`, JSON.stringify(manifest));
		for (const type of resourceTypes) {
			write(`${relativeRoot}/${declaredFiles[type]}`, type === "extensions" ? rejectedExtension : "{}");
		}
		write(`${relativeRoot}/index.ts`, rejectedExtension);
		write(`${relativeRoot}/extensions/fallback.ts`, rejectedExtension);
		write(`${relativeRoot}/skills/fallback/SKILL.md`, "---\nname: fallback\ndescription: Fallback\n---\n");
		write(`${relativeRoot}/prompts/fallback.md`, "Fallback prompt");
		write(`${relativeRoot}/themes/fallback.json`, "{}");
		return join(tempDir, relativeRoot);
	}

	function expectNoResources(paths: ResolvedPaths): void {
		for (const type of resourceTypes) expect(paths[type]).toEqual([]);
	}

	it("registers a native command through manager-selected paths and the real loader", async () => {
		const root = fixture("native", { omk: declaredManifest, pi: { extensions: ["./index.ts"] } });
		write("native/declared/extensions/entry.ts", nativeExtension);
		const paths = await manager("omk").resolveExtensionSources([root]);
		for (const type of resourceTypes) {
			expect(paths[type].map((resource) => resource.path)).toEqual([join(root, declaredFiles[type])]);
		}
		const loaded = await loadExtensions(
			paths.extensions.filter((resource) => resource.enabled).map((r) => r.path),
			cwd,
		);
		expect(loaded.errors).toEqual([]);
		expect(loaded.extensions).toHaveLength(1);
		expect(loaded.extensions[0]?.commands.has("native-boundary")).toBe(true);
		expect(existsSync(join(root, "executed"))).toBe(false);
	});

	it("rejects a Pi-only package without declared or conventional resource contribution", async () => {
		const root = fixture("pi-only", { pi: declaredManifest });
		const paths = await manager("omk").resolveExtensionSources([root]);
		expect(existsSync(join(root, "executed"))).toBe(false);
		expectNoResources(paths);
		const loaded = await loadExtensions(
			paths.extensions.map((resource) => resource.path),
			cwd,
		);
		expect(loaded.errors).toEqual([]);
		expect(loaded.extensions).toEqual([]);
		expect(existsSync(join(root, "executed"))).toBe(false);
	});

	it.each(["all", "partial", "disabled"])("rejects filtered Pi-only packages (%s)", async (filter) => {
		const root = fixture("filtered-pi", { pi: declaredManifest });
		const patterns = filter === "disabled" ? [] : ["**/*"];
		settingsManager.setPackages([
			filter === "partial"
				? { source: root, extensions: patterns }
				: { source: root, extensions: patterns, skills: patterns, prompts: patterns, themes: patterns },
		]);
		const paths = await manager("omk").resolve();
		expectNoResources(paths);
		expect(existsSync(join(root, "executed"))).toBe(false);
	});

	it.each([undefined, "omk+pi"] as const)(
		"preserves filtered and unfiltered Pi compatibility for %s",
		async (dialect) => {
			const root = fixture("legacy", { pi: declaredManifest });
			const paths = await manager(dialect).resolveExtensionSources([root]);
			settingsManager.setPackages([
				{ source: root, extensions: ["**/*"], skills: ["**/*"], prompts: ["**/*"], themes: ["**/*"] },
			]);
			const filtered = await manager(dialect).resolve();
			for (const type of resourceTypes) {
				expect(paths[type].map((resource) => resource.path)).toEqual([join(root, declaredFiles[type])]);
				expect(filtered[type].map((resource) => resource.path)).toEqual([join(root, declaredFiles[type])]);
			}
			expect(existsSync(join(root, "executed"))).toBe(false);
		},
	);

	it("preserves compatibility when the constructor option is omitted entirely", async () => {
		const root = fixture("omitted", { pi: declaredManifest });
		const compatible = new DefaultPackageManager({ cwd, agentDir, settingsManager });
		const paths = await compatible.resolveExtensionSources([root]);
		for (const type of resourceTypes) expect(paths[type]).toHaveLength(1);
	});

	it.each([{}, { extensions: [] }, { extensions: ["./missing.ts"] }, { extensions: "./invalid.ts" }])(
		"preserves 1.x nested extension fallback in compatibility mode for Pi %j",
		async (pi) => {
			const root = fixture("agent/extensions/legacy-fallback", { pi });
			const paths = await manager().resolve();
			expect(paths.extensions.map((resource) => resource.path)).toEqual([join(root, "index.ts")]);
			expectNoResources(await manager("omk").resolve());
			expect(existsSync(join(root, "executed"))).toBe(false);
		},
	);

	it.each([null, "pi", "", false, 0, {}])("rejects an untyped constructor dialect %j", (value) => {
		const options = { cwd, agentDir, settingsManager, packageManifestDialect: value };
		expect(() => Reflect.construct(DefaultPackageManager, [options])).toThrow(
			'packageManifestDialect must be "omk" or "omk+pi"',
		);
	});

	it("copies the dialect primitive instead of retaining the caller's options object", async () => {
		const root = fixture("immutable", { pi: declaredManifest });
		const options: ConstructorParameters<typeof DefaultPackageManager>[0] = {
			cwd,
			agentDir,
			settingsManager,
			packageManifestDialect: "omk",
		};
		const native = new DefaultPackageManager(options);
		options.packageManifestDialect = "omk+pi";
		expectNoResources(await native.resolveExtensionSources([root]));
		const compatible = new DefaultPackageManager(options);
		options.packageManifestDialect = "omk";
		const paths = await compatible.resolveExtensionSources([root]);
		for (const type of resourceTypes) expect(paths[type]).toHaveLength(1);
	});

	it.each(["none", "all", "partial"])("uses native authoritative manifests with filters=%s", async (filter) => {
		const root = fixture("authoritative", { omk: declaredManifest, pi: { extensions: ["./index.ts"] } });
		settingsManager.setPackages([
			filter === "all"
				? { source: root, extensions: ["**/*"], skills: ["**/*"], prompts: ["**/*"], themes: ["**/*"] }
				: filter === "partial"
					? { source: root, extensions: ["**/*"] }
					: root,
		]);
		const paths = await manager("omk").resolve();
		for (const type of resourceTypes) {
			expect(paths[type].map((resource) => resource.path)).toEqual([join(root, declaredFiles[type])]);
		}
	});

	it.each([{}, { extensions: [] }, null, { extensions: "./extensions" }, { extensions: ["../escape.ts"] }])(
		"never falls back from authoritative omk %j, even with filters",
		async (omk) => {
			const root = fixture("empty-or-invalid", { omk, pi: declaredManifest });
			expectNoResources(await manager("omk").resolveExtensionSources([root]));
			settingsManager.setPackages([
				{ source: root, extensions: ["**/*"], skills: ["**/*"], prompts: ["**/*"], themes: ["**/*"] },
			]);
			expectNoResources(await manager("omk").resolve());
			expect(existsSync(join(root, "executed"))).toBe(false);
		},
	);

	it("never falls back from malformed package JSON", async () => {
		const root = fixture("malformed-json", {});
		write("malformed-json/package.json", "{malformed");
		expectNoResources(await manager("omk").resolveExtensionSources([root]));
	});

	it.each([false, true])("preserves convention-only packages with filters=%s", async (filtered) => {
		const root = fixture("conventional", { name: "conventional" });
		settingsManager.setPackages([
			filtered
				? { source: root, extensions: ["**/*"], skills: ["**/*"], prompts: ["**/*"], themes: ["**/*"] }
				: root,
		]);
		const paths = await manager("omk").resolve();
		for (const type of resourceTypes) {
			expect(paths[type]).toHaveLength(1);
			expect(paths[type][0]?.path.startsWith(join(root, type))).toBe(true);
			expect(paths[type][0]?.enabled).toBe(true);
		}
	});

	it.each([
		"manifest",
		"manifest-filtered",
		"convention",
		"convention-filtered",
		"settings",
		"user-auto",
		"project-auto",
		"user-root",
		"project-root",
	])("keeps nested and automatic Pi discovery inside the policy (%s)", async (discovery) => {
		const relativeRoot = discovery.startsWith("user")
			? `agent/extensions${discovery.endsWith("root") ? "" : "/nested"}`
			: discovery.startsWith("project")
				? `project/.omk/extensions${discovery.endsWith("root") ? "" : "/nested"}`
				: "outer/extensions/nested";
		const root = fixture(relativeRoot, { pi: declaredManifest });
		const native = manager("omk");
		let paths: ResolvedPaths;
		const managedPackage = discovery.startsWith("manifest") || discovery.startsWith("convention");
		if (managedPackage) {
			write(
				"outer/package.json",
				JSON.stringify(discovery.startsWith("manifest") ? { omk: { extensions: ["./extensions/nested"] } } : {}),
			);
			settingsManager.setPackages([
				discovery.endsWith("filtered")
					? { source: join(tempDir, "outer"), extensions: ["**/*"] }
					: join(tempDir, "outer"),
			]);
			paths = await native.resolve();
		} else {
			if (discovery === "settings") settingsManager.setExtensionPaths([root]);
			paths = await native.resolve();
		}
		expectNoResources(paths);
		expect(existsSync(join(root, "executed"))).toBe(false);
		const legacy = await manager().resolve();
		expect(legacy.extensions.map((resource) => resource.path)).toEqual([join(root, declaredFiles.extensions)]);
	});

	it("does not fall back from malformed nested package JSON during automatic discovery", async () => {
		const root = fixture("agent/extensions/malformed", {});
		write("agent/extensions/malformed/package.json", "{malformed");
		expectNoResources(await manager("omk").resolve());
		expect(existsSync(join(root, "executed"))).toBe(false);
	});

	it.each([{}, { extensions: [] }, null, { extensions: "./index.ts" }, { extensions: ["../escape.ts"] }])(
		"does not rediscover nested authoritative omk %j through index or directory fallbacks",
		async (omk) => {
			const root = fixture("agent/extensions/nested-native", { omk, pi: declaredManifest });
			expectNoResources(await manager("omk").resolve());
			expect(existsSync(join(root, "executed"))).toBe(false);
		},
	);

	it("keeps native siblings when automatic discovery rejects a Pi package", async () => {
		const rejected = fixture("agent/extensions/pi", { pi: declaredManifest });
		const nativePath = write("agent/extensions/native/index.ts", nativeExtension);
		const paths = await manager("omk").resolve();
		expect(paths.extensions.map((resource) => resource.path)).toEqual([nativePath]);
		const loaded = await loadExtensions(
			paths.extensions.map((resource) => resource.path),
			cwd,
		);
		expect(loaded.errors).toEqual([]);
		expect(loaded.extensions[0]?.commands.has("native-boundary")).toBe(true);
		expect(existsSync(join(rejected, "executed"))).toBe(false);
	});
});
