import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionServices } from "../src/core/agent-session-services.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { loadExtensionModuleWithVirtualModulesForTests } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { DefaultResourceLoader, type DefaultResourceLoaderOptions } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("native extension services propagation", () => {
	let tempDir: string;
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "omk-native-services-"));
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(join(cwd, ".git"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		vi.stubEnv("HOME", tempDir);
		vi.stubEnv("OMK_CODING_AGENT_DIR", agentDir);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(tempDir, { recursive: true, force: true });
	});

	function write(relativePath: string, content: string): string {
		const target = join(tempDir, relativePath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
		return target;
	}

	it("propagates packageManifestDialect through createAgentSessionServices and DefaultResourceLoader", async () => {
		const nativePkg = join(tempDir, "pkg-native");
		const piPkg = join(tempDir, "pkg-pi");
		write(
			"project/.omk/extensions/legacy-import.ts",
			`
				import { Key } from "@earendil-works/pi-tui";
				void Key;
				export default function(api) {
					api.registerCommand("legacy-import-cmd", { handler: async () => {} });
				}
			`,
		);
		write("pkg-native/package.json", JSON.stringify({ name: "pkg-native", omk: { extensions: ["./index.ts"] } }));
		write(
			"pkg-native/index.ts",
			`
				import { Type } from "typebox";
				import type { ExtensionAPI } from "open-multi-agent-kit";
				export default function(omk: ExtensionAPI) {
					omk.registerCommand("from-native-pkg", { handler: async () => {} });
					omk.registerTool({name: "native_increment", label: "Increment", description: "Increment a number",
						parameters: Type.Object({value: Type.Number()}),
						execute: async (_id, args) => ({content: [{type: "text", text: String(args.value + 1)}]})});
					omk.registerProvider("native-owned-provider", {baseUrl: "https://example.invalid/v1", apiKey: "fixture-only",
						api: "openai-completions", models: []});
				}
			`,
		);
		write("pkg-pi/package.json", JSON.stringify({ name: "pkg-pi", pi: { extensions: ["./index.ts"] } }));
		write(
			"pkg-pi/index.ts",
			`
				export default function(api) {
					api.registerCommand("from-pi-pkg", { handler: async () => {} });
				}
			`,
		);

		const settingsManager = SettingsManager.inMemory({ packages: [nativePkg, piPkg] });

		const authStorage = AuthStorage.inMemory();
		const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));

		const nativeServices = await createAgentSessionServices({
			cwd,
			agentDir,
			authStorage,
			settingsManager,
			modelRegistry,
			resourceLoaderOptions: {
				packageManifestDialect: "omk",
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
			},
		});

		const nativeCommands = nativeServices.resourceLoader
			.getExtensions()
			.extensions.flatMap((ext) => [...ext.commands.keys()]);
		expect(nativeCommands).toContain("from-native-pkg");
		const nativeResult = nativeServices.resourceLoader.getExtensions();
		const nativeExtension = nativeResult.extensions.find((ext) => ext.commands.has("from-native-pkg"));
		const tool = nativeExtension?.tools.get("native_increment")?.definition;
		expect(tool).toBeDefined();
		const runner = new ExtensionRunner(
			nativeResult.extensions,
			nativeResult.runtime,
			cwd,
			SessionManager.inMemory(cwd),
			modelRegistry,
		);
		expect(
			await tool?.execute("tracer", { value: 41 }, new AbortController().signal, undefined, runner.createContext()),
		).toEqual({
			content: [{ type: "text", text: "42" }],
		});
		expect(nativeResult.runtime.providerOwners.get("native-owned-provider")).toBe(join(nativePkg, "index.ts"));
		expect(nativeResult.runtime.pendingProviderRegistrations).toEqual([]);
		expect(nativeCommands).not.toContain("from-pi-pkg");
		expect(nativeCommands).not.toContain("legacy-import-cmd");
		expect(
			nativeServices.resourceLoader.getExtensions().errors.some((err) => err.path.endsWith("legacy-import.ts")),
		).toBe(true);

		const compatLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			packageManifestDialect: "omk+pi",
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await compatLoader.reload();
		const compatCommands = compatLoader.getExtensions().extensions.flatMap((ext) => [...ext.commands.keys()]);
		expect(compatCommands).toContain("from-native-pkg");
		expect(compatCommands).toContain("from-pi-pkg");
		expect(compatCommands).toContain("legacy-import-cmd");
	});

	it("captures constructor policy independently of caller mutation and subsequent reloads", async () => {
		const extension = write(
			"legacy.ts",
			`import {Key} from "@earendil-works/pi-tui";
			export default function(api) { api.registerCommand(Key.escape, {handler: async () => {}}); }`,
		);
		const options: DefaultResourceLoaderOptions = {
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			packageManifestDialect: "omk",
			additionalExtensionPaths: [extension],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		};
		const native = new DefaultResourceLoader(options);
		options.packageManifestDialect = "omk+pi";
		const compatible = new DefaultResourceLoader(options);
		for (const loader of [native, compatible, native]) {
			await loader.reload();
			const result = loader.getExtensions();
			expect(result.errors.some((error) => error.path === extension)).toBe(loader === native);
			expect(result.extensions.some((entry) => entry.path === extension)).toBe(loader === compatible);
		}
		expect(() => new DefaultResourceLoader({ ...options, packageManifestDialect: null as never })).toThrow(TypeError);
	});

	it("executes a source virtual-module factory through actual native services", async () => {
		const entry = write(
			"virtual.ts",
			`import {Type} from "omk-ai";
			import {systemHash} from "omk-ai/prompt-hash";
			export default function(api) {
				if (systemHash({systemPrompt: ""}) !== "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
					throw new Error("wrong native prompt hash subpath");
				api.registerTool({name: "virtual_echo", label: "Echo", description: "Echo", parameters: Type.Object({}),
					execute: async () => ({content: [{type: "text", text: "virtual-result"}]})});
			}`,
		);
		const factory = await loadExtensionModuleWithVirtualModulesForTests(entry, { packageManifestDialect: "omk" });
		expect(factory).toBeDefined();
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			authStorage: AuthStorage.inMemory(),
			settingsManager: SettingsManager.inMemory(),
			resourceLoaderOptions: {
				packageManifestDialect: "omk",
				extensionFactories: [factory!],
				noExtensions: true,
				noSkills: true,
				noContextFiles: true,
				noThemes: true,
				noPromptTemplates: true,
			},
		});
		const loaded = services.resourceLoader.getExtensions();
		expect(loaded.errors).toEqual([]);
		const tool = loaded.extensions
			.find((ext) => ext.tools.has("virtual_echo"))
			?.tools.get("virtual_echo")?.definition;
		expect(tool).toBeDefined();
		const runner = new ExtensionRunner(
			loaded.extensions,
			loaded.runtime,
			cwd,
			SessionManager.inMemory(cwd),
			services.modelRegistry,
		);
		expect(await tool?.execute("virtual", {}, undefined, undefined, runner.createContext())).toEqual({
			content: [{ type: "text", text: "virtual-result" }],
		});
	});
});
