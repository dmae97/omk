import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExtensionModuleWithVirtualModulesForTests, loadExtensions } from "../src/core/extensions/loader.ts";
import {
	PackageManifestPolicyError,
	resolvePackageManifest,
	resolvePackageManifestDialect,
} from "../src/core/package-manifest.ts";
import { LEGACY_PI_RUNTIME_ALIASES } from "../src/core/pi-compat.ts";

// OMK 2.0 default: an omitted dialect is native "omk". Legacy Pi compatibility is explicit opt-in.
describe("native default package manifest dialect", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "omk-native-default-"));
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

	it("resolves an omitted or undefined dialect to omk", () => {
		expect(resolvePackageManifestDialect()).toBe("omk");
		expect(resolvePackageManifestDialect(undefined)).toBe("omk");
		expect(resolvePackageManifestDialect("omk+pi")).toBe("omk+pi");
	});

	it("rejects a Pi-only package manifest when the dialect is omitted", () => {
		expect(() => resolvePackageManifest({ pi: { extensions: ["index.ts"] } })).toThrow(PackageManifestPolicyError);
		expect(resolvePackageManifest({ pi: { extensions: ["index.ts"] } }, "omk+pi").key).toBe("pi");
	});

	it("fails a legacy Pi import by default with a migration hint, and loads it under explicit omk+pi", async () => {
		const specifier = Object.keys(LEGACY_PI_RUNTIME_ALIASES)[0];
		const extPath = write(
			"legacy.ts",
			`import * as legacy from "${specifier}"; void legacy; export default function (api) { api.registerCommand("legacy-loaded", { handler: async () => {} }); }`,
		);

		const native = await loadExtensions([extPath], tempDir);
		expect(native.extensions).toEqual([]);
		expect(native.errors).toHaveLength(1);
		expect(native.errors[0]?.error).toContain(specifier);
		expect(native.errors[0]?.error).toContain("--package-manifest-dialect omk+pi");
		await expect(loadExtensionModuleWithVirtualModulesForTests(extPath)).rejects.toThrow();

		const compat = await loadExtensions([extPath], tempDir, undefined, { packageManifestDialect: "omk+pi" });
		expect(compat.errors).toEqual([]);
		expect(compat.extensions[0]?.commands.has("legacy-loaded")).toBe(true);
	});

	it("adds no hint to ordinary load failures", async () => {
		const extPath = write("missing-dep.ts", 'import "not-a-real-package-xyz"; export default function () {}');
		const result = await loadExtensions([extPath], tempDir);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.error).not.toContain("--package-manifest-dialect");
	});
});
