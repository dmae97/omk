import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectPackageCompatibility, type PackageDoctorInput } from "../src/core/package-doctor.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-doctor-native-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fixture(manifest: Record<string, unknown>, source: string): PackageDoctorInput {
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "native-diagnostic", ...manifest }));
	const entry = join(root, "entry.ts");
	writeFileSync(entry, source);
	return { source: root, packageRoot: root, resources: { extensions: [entry], skills: [], prompts: [], themes: [] } };
}

describe("static native package diagnosis", () => {
	it("reports Pi-only policy as a diagnostic without convention fallback or execution", () => {
		const marker = join(root, "executed");
		const input = fixture(
			{ pi: { extensions: ["./entry.ts"] } },
			`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "bad");`,
		);
		const original = readFileSync(join(root, "package.json"));
		const result = inspectPackageCompatibility({ ...input, packageManifestDialect: "omk" } as PackageDoctorInput);
		expect(result.compatible).toBe(false);
		expect(result.manifest.selected).not.toBe("convention");
		expect(result.manifest.diagnostics).toContainEqual({ path: "pi", message: expect.stringContaining("Pi-only") });
		expect(result.checks.find(({ id }) => id === "manifest")).toMatchObject({
			status: "error",
			message: expect.stringContaining("Pi-only"),
		});
		expect(result.inspectedFiles).toEqual(["entry.ts"]);
		expect(readFileSync(join(root, "package.json"))).toEqual(original);
		expect(existsSync(marker)).toBe(false);
	});

	it.each(["dependencies", "peerDependencies", "optionalDependencies"])(
		"warns about declared but absent subpath imports in %s",
		(declaration) => {
			const input = fixture(
				{ omk: { extensions: ["./entry.ts"] }, [declaration]: { "@earendil-works/pi-ai": "1.0.0" } },
				'import "@earendil-works/pi-ai/oauth";',
			);
			const result = inspectPackageCompatibility({ ...input, packageManifestDialect: "omk" } as PackageDoctorInput);
			const check = result.checks.find(({ id }) => id === "runtime-imports");
			expect(check).toMatchObject({ status: "warning", files: ["entry.ts"] });
			expect(check?.message).toMatch(/no implicit.*alias/i);
			expect(check?.message).toMatch(/unverified/i);
			expect(check?.message).not.toContain("will use OMK compatibility aliases");
			expect(result.compatible).toBe(true);
			expect(existsSync(join(root, "node_modules"))).toBe(false);
		},
	);

	it.each([
		{},
		{ dependencies: { "@earendil-works/pi-ai-extra": "*" } },
		{ devDependencies: { "@earendil-works/pi-ai": "*" } },
		{ dependencies: { "@earendil-works/pi-ai": null } },
	])("errors on an undeclared exact legacy package root with declarations %j", (declarations) => {
		const input = fixture(
			{ omk: { extensions: ["./entry.ts"] }, ...declarations },
			'import "@earendil-works/pi-ai/oauth";',
		);
		const result = inspectPackageCompatibility({ ...input, packageManifestDialect: "omk" } as PackageDoctorInput);
		expect(result.checks.find(({ id }) => id === "runtime-imports")).toMatchObject({
			status: "error",
			files: ["entry.ts"],
		});
		expect(result.compatible).toBe(false);
	});

	it("does not blacklist an unrelated package from the same publisher", () => {
		const input = fixture(
			{ omk: { extensions: ["./entry.ts"] } },
			'import "@mariozechner/some-library"; import "@earendil-works/pi-ai-extra";',
		);
		const result = inspectPackageCompatibility({ ...input, packageManifestDialect: "omk" } as PackageDoctorInput);
		expect(result.checks.find(({ id }) => id === "runtime-imports")?.status).toBe("pass");
	});

	it("uses byte-equivalent native JSON on omission and undefined (OMK 2.0 default)", () => {
		const input = fixture({ pi: { extensions: ["./entry.ts"] } }, 'import "@earendil-works/pi-ai";');
		const native = JSON.stringify(inspectPackageCompatibility({ ...input, packageManifestDialect: "omk" }));
		for (const dialect of [undefined]) {
			expect(
				JSON.stringify(
					inspectPackageCompatibility({ ...input, packageManifestDialect: dialect } as PackageDoctorInput),
				),
			).toBe(native);
		}
		expect(JSON.stringify(inspectPackageCompatibility(input))).toBe(native);
		expect(JSON.stringify(inspectPackageCompatibility({ ...input, packageManifestDialect: "omk+pi" }))).not.toBe(
			native,
		);
	});

	it("validates untyped construction before filesystem access", () => {
		const input = fixture({}, "export default () => {};");
		for (const dialect of [null, "native", {}, 1, false]) {
			expect(() =>
				inspectPackageCompatibility({
					...input,
					packageRoot: join(root, "missing"),
					packageManifestDialect: dialect,
				} as PackageDoctorInput),
			).toThrow('packageManifestDialect must be "omk" or "omk+pi"');
		}
	});

	it("keeps bounded relative scanning, no node_modules reads, symlink containment and source redaction", () => {
		const input = fixture(
			{ omk: { extensions: ["./entry.ts"] } },
			'import "./nested.ts"; import "./escape.ts"; import "fixture-dependency";',
		);
		writeFileSync(join(root, "nested.ts"), 'import "@oh-my-pi/pi-utils/subpath";');
		const outside = join(root, "..", `${root.split("/").at(-1)}-outside.ts`);
		writeFileSync(outside, "DO_NOT_DISCLOSE_EXTERNAL_CONTENT");
		symlinkSync(outside, join(root, "escape.ts"));
		mkdirSync(join(root, "node_modules", "fixture-dependency"), { recursive: true });
		writeFileSync(join(root, "node_modules", "fixture-dependency", "index.js"), "DO_NOT_DISCLOSE_DEPENDENCY_CONTENT");
		const original = ["package.json", "entry.ts", "nested.ts"].map((file) => readFileSync(join(root, file)));
		try {
			const result = inspectPackageCompatibility({
				...input,
				source: "git:https://user:secret@example.invalid/repo?token=secret#secret",
				packageManifestDialect: "omk",
			} as PackageDoctorInput);
			expect(result.inspectedFiles).toEqual(["entry.ts", "nested.ts"]);
			expect(result.checks.find(({ id }) => id === "runtime-imports")?.status).toBe("error");
			expect(result.checks.find(({ id }) => id === "scan-coverage")?.status).toBe("warning");
			expect(JSON.stringify(result)).not.toMatch(/secret|DO_NOT_DISCLOSE/);
			expect(["package.json", "entry.ts", "nested.ts"].map((file) => readFileSync(join(root, file)))).toEqual(
				original,
			);
		} finally {
			rmSync(outside, { force: true });
		}
	});
});
