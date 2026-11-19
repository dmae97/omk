import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	PackageManifestPolicyError,
	readPackageManifest,
	resolvePackageManifest,
	resolvePackageManifestDialect,
} from "../src/core/package-manifest.ts";

describe("package manifest compatibility", () => {
	it("uses package.json pi when omk is absent", () => {
		const resolved = resolvePackageManifest(
			{
				pi: { extensions: ["./index.ts"], skills: ["./skills"] },
			},
			"omk+pi",
		);

		expect(resolved).toEqual({
			key: "pi",
			manifest: { extensions: ["./index.ts"], skills: ["./skills"] },
			diagnostics: [],
			present: { omk: false, pi: true },
		});
	});

	it("keeps omk authoritative over pi, including an empty omk manifest", () => {
		const resolved = resolvePackageManifest({
			omk: {},
			pi: { extensions: ["./legacy.ts"] },
		});

		expect(resolved).toMatchObject({
			key: "omk",
			manifest: {},
			present: { omk: true, pi: true },
		});
	});

	it("fails closed on malformed authoritative fields instead of falling through", () => {
		const resolved = resolvePackageManifest({
			omk: { extensions: ["./safe.ts", 42], skills: "./skills" },
			pi: { extensions: ["./legacy.ts"] },
		});

		expect(resolved.key).toBe("omk");
		expect(resolved.manifest).toEqual({ extensions: ["./safe.ts"] });
		expect(resolved.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(["omk.extensions[1]", "omk.skills"]);
	});

	it("rejects manifest paths that escape the package", () => {
		const resolved = resolvePackageManifest(
			{
				pi: { extensions: ["./safe.ts", "../outside.ts", "/absolute.ts", "!../excluded.ts", "C:\\escape.ts"] },
			},
			"omk+pi",
		);

		expect(resolved.manifest).toEqual({ extensions: ["./safe.ts"] });
		expect(resolved.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
			"pi.extensions[1]",
			"pi.extensions[2]",
			"pi.extensions[3]",
			"pi.extensions[4]",
		]);
	});

	it("returns convention mode when neither manifest key is present", () => {
		expect(resolvePackageManifest({ name: "conventional" })).toEqual({
			key: null,
			manifest: null,
			diagnostics: [],
			present: { omk: false, pi: false },
		});
	});
});

describe("native package manifest policy", () => {
	it.each([{}, null, { extensions: "./legacy.ts" }])("rejects Pi-only manifests before parsing %j", (pi) => {
		expect(() => resolvePackageManifest({ pi }, "omk")).toThrow(PackageManifestPolicyError);
		expect(() => resolvePackageManifest({ pi }, undefined)).toThrow(PackageManifestPolicyError);
	});

	it.each(["omk+pi"] as const)("preserves compatibility for %s", (dialect) => {
		expect(resolvePackageManifest({ pi: { extensions: ["./legacy.ts"] } }, dialect)).toMatchObject({
			key: "pi",
			manifest: { extensions: ["./legacy.ts"] },
		});
	});

	it.each([{}, { extensions: [] }, null])("keeps authoritative omk %j instead of rejecting the Pi field", (omk) => {
		const result = resolvePackageManifest({ omk, pi: { extensions: ["./legacy.ts"] } }, "omk");
		expect(result.key).toBe("omk");
		expect(result.manifest?.extensions ?? []).toEqual([]);
		expect(result.diagnostics).toEqual(omk === null ? [{ path: "omk", message: "omk must be an object" }] : []);
	});

	it("preserves native invalid-field and path diagnostics", () => {
		const result = resolvePackageManifest(
			{ omk: { extensions: ["./safe.ts", "../escape.ts", 42], skills: "./skills" }, pi: {} },
			"omk",
		);
		expect(result.manifest).toEqual({ extensions: ["./safe.ts"] });
		expect(result.diagnostics).toEqual([
			{ path: "omk.extensions[1]", message: "omk.extensions[1] must be a package-relative path or glob" },
			{ path: "omk.extensions[2]", message: "omk.extensions[2] must be a string" },
			{ path: "omk.skills", message: "omk.skills must be an array" },
		]);
	});

	it("keeps manifest absence distinct from native policy rejection", () => {
		expect(resolvePackageManifest({ name: "conventional" }, "omk")).toEqual({
			key: null,
			manifest: null,
			diagnostics: [],
			present: { omk: false, pi: false },
		});
	});

	it("does not turn a policy error into a JSON diagnostic", () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-manifest-policy-"));
		const path = join(dir, "package.json");
		try {
			writeFileSync(path, JSON.stringify({ pi: {} }));
			expect(() => readPackageManifest(path, "omk")).toThrow(PackageManifestPolicyError);
			writeFileSync(path, "{malformed");
			expect(readPackageManifest(path, "omk")).toEqual({
				key: null,
				manifest: null,
				diagnostics: [{ path: "package.json", message: "package.json must contain valid JSON" }],
				present: { omk: false, pi: false },
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.each([null, "pi", "", false, 0, {}])("rejects invalid untyped dialect %j", (value) => {
		expect(() => resolvePackageManifestDialect(value)).toThrow(TypeError);
	});
});
