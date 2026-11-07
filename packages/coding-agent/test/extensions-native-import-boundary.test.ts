import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	discoverAndLoadExtensions,
	loadExtensionModuleWithVirtualModulesForTests,
	loadExtensions,
} from "../src/core/extensions/loader.ts";
import { LEGACY_PI_RUNTIME_ALIASES } from "../src/core/pi-compat.ts";

describe("native vs compatibility extension import boundary (Boundary A)", () => {
	let tempDir: string;
	let extensionsDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "omk-ext-native-boundary-"));
		extensionsDir = join(tempDir, ".omk", "extensions");
		mkdirSync(extensionsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function write(relativePath: string, content: string): string {
		const target = join(tempDir, relativePath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
		return target;
	}

	it("loads native OMK imports in explicit omk mode across Node and Bun virtual modules", async () => {
		const extPath = write(
			".omk/extensions/native-ok.ts",
			`
				import { Type } from "omk-ai";
				import { Key } from "omk-tui";
				import { createNodeResourceKeyResolver } from "omk-agent-core/node";
				import type { ExtensionAPI } from "open-multi-agent-kit";

				const resolver = createNodeResourceKeyResolver();
				if (typeof Type.Object !== "function" || typeof Key.escape !== "string" || typeof resolver.resolvePath !== "function") {
					throw new Error("missing native OMK exports");
				}

				export default function(omk: ExtensionAPI) {
					omk.registerCommand("native-ok", { handler: async () => {} });
				}
			`,
		);

		const loaded = await loadExtensions([extPath], tempDir, undefined, { packageManifestDialect: "omk" });
		const binaryFactory = await loadExtensionModuleWithVirtualModulesForTests(extPath, {
			packageManifestDialect: "omk",
		});

		expect(loaded.errors).toEqual([]);
		expect(loaded.extensions[0]?.commands.has("native-ok")).toBe(true);
		expect(binaryFactory).toBeTypeOf("function");
	});

	it("does not provide implicit legacy Pi aliases in native omk mode (Node and Bun virtual modules)", async () => {
		for (const specifier of Object.keys(LEGACY_PI_RUNTIME_ALIASES)) {
			const extPath = write(
				`.omk/extensions/unmapped-${specifier.replace(/[/@]/g, "-")}.ts`,
				`
					import * as legacyMod from "${specifier}";
					void legacyMod;
					export default function(api) {
						api.registerCommand("should-not-load", { handler: async () => {} });
					}
				`,
			);

			const nativeLoaded = await loadExtensions([extPath], tempDir, undefined, {
				packageManifestDialect: "omk",
			});
			expect(nativeLoaded.extensions).toEqual([]);
			expect(nativeLoaded.errors).toHaveLength(1);
			expect(nativeLoaded.errors[0]?.error).toContain(specifier);

			await expect(
				loadExtensionModuleWithVirtualModulesForTests(extPath, { packageManifestDialect: "omk" }),
			).rejects.toThrow();

			const compatLoaded = await loadExtensions([extPath], tempDir, undefined, {
				packageManifestDialect: "omk+pi",
			});
			expect(compatLoaded.errors).toEqual([]);
			expect(compatLoaded.extensions[0]?.commands.has("should-not-load")).toBe(true);
		}
	});

	it("resolves explicitly installed local Pi dependencies to their own package identity in omk mode (Boundary A)", async () => {
		const sentinelFile = join(tempDir, "explicit-pi-sentinel.txt");
		write(
			"ext-pkg/package.json",
			JSON.stringify({
				name: "user-ext-with-explicit-pi",
				type: "module",
				omk: { extensions: ["./index.ts"] },
				dependencies: { "@earendil-works/pi-ai": "1.0.0" },
			}),
		);
		write(
			"ext-pkg/node_modules/@earendil-works/pi-ai/package.json",
			JSON.stringify({
				name: "@earendil-works/pi-ai",
				version: "1.0.0",
				type: "module",
				exports: { ".": "./index.js" },
			}),
		);
		write(
			"ext-pkg/node_modules/@earendil-works/pi-ai/index.js",
			`
				import { writeFileSync } from "node:fs";
				writeFileSync(${JSON.stringify(sentinelFile)}, "explicit-pi-loaded");
				export const EXPLICIT_PI_IDENTITY = "real-user-installed-pi-ai";
			`,
		);
		write(
			"ext-pkg/helper.ts",
			`
				import * as dependency from "@earendil-works/pi-ai";
				export const EXPLICIT_PI_IDENTITY = dependency.EXPLICIT_PI_IDENTITY ?? "remapped-to-omk";
			`,
		);
		const entryPath = write(
			"ext-pkg/index.ts",
			`
				import { EXPLICIT_PI_IDENTITY } from "./helper.ts";
				export default function(api) {
					api.registerCommand(EXPLICIT_PI_IDENTITY ?? "remapped-to-omk", { handler: async () => {} });
				}
			`,
		);

		const compatLoaded = await loadExtensions([entryPath], tempDir, undefined, {
			packageManifestDialect: "omk+pi",
		});
		expect(compatLoaded.errors).toEqual([]);
		expect(compatLoaded.extensions[0]?.commands.has("remapped-to-omk")).toBe(true);
		expect(existsSync(sentinelFile)).toBe(false);

		const nativeLoaded = await loadExtensions([entryPath], tempDir, undefined, {
			packageManifestDialect: "omk",
		});
		expect(nativeLoaded.errors).toEqual([]);
		expect(nativeLoaded.extensions[0]?.commands.has("real-user-installed-pi-ai")).toBe(true);
		expect(existsSync(sentinelFile)).toBe(true);
	});

	it("enforces manifest dialect in discoverAndLoadExtensions without index.ts fallback for Pi-only dirs", async () => {
		const piSentinel = join(tempDir, "pi-subdir-executed");
		write(
			".omk/extensions/pi-only-sub/package.json",
			JSON.stringify({ name: "pi-only-sub", pi: { extensions: ["./index.ts"] } }),
		);
		write(
			".omk/extensions/pi-only-sub/index.ts",
			`
				import { writeFileSync } from "node:fs";
				writeFileSync(${JSON.stringify(piSentinel)}, "ran");
				export default function(api) {
					api.registerCommand("pi-sub", { handler: async () => {} });
				}
			`,
		);
		write(
			".omk/extensions/native-sub/package.json",
			JSON.stringify({ name: "native-sub", omk: { extensions: ["./index.ts"] } }),
		);
		write(
			".omk/extensions/native-sub/index.ts",
			`
				export default function(api) {
					api.registerCommand("native-sub", { handler: async () => {} });
				}
			`,
		);

		const nativeResult = await discoverAndLoadExtensions([], tempDir, join(tempDir, "agent"), undefined, {
			packageManifestDialect: "omk",
		});
		expect(nativeResult.errors).toEqual([]);
		expect(nativeResult.extensions.map((ext) => [...ext.commands.keys()][0])).toEqual(["native-sub"]);
		expect(existsSync(piSentinel)).toBe(false);

		const compatResult = await discoverAndLoadExtensions([], tempDir, join(tempDir, "agent"), undefined, {
			packageManifestDialect: "omk+pi",
		});
		expect(compatResult.errors).toEqual([]);
		expect(compatResult.extensions.map((ext) => [...ext.commands.keys()][0]).sort()).toEqual([
			"native-sub",
			"pi-sub",
		]);
		expect(existsSync(piSentinel)).toBe(true);
	});

	it("rejects invalid untyped packageManifestDialect values in loader entry points", async () => {
		for (const invalid of [null, "", "pi", 123] as unknown as Array<"omk" | "omk+pi">) {
			await expect(loadExtensions([], tempDir, undefined, { packageManifestDialect: invalid })).rejects.toThrow(
				TypeError,
			);
			await expect(
				discoverAndLoadExtensions([], tempDir, tempDir, undefined, { packageManifestDialect: invalid }),
			).rejects.toThrow(TypeError);
			await expect(
				loadExtensionModuleWithVirtualModulesForTests(join(tempDir, "missing.ts"), {
					packageManifestDialect: invalid,
				}),
			).rejects.toThrow(TypeError);
		}
	});
});
