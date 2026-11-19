import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadExtensions } from "../src/core/extensions/loader.ts";
import { inspectPackageCompatibility } from "../src/core/package-doctor.ts";
import type { PackageManifestDialect } from "../src/core/package-manifest.ts";
import { preservationHarness } from "./fixtures/native-extension-harness.ts";

describe("synthetic user originals (never actual private extensions)", () => {
	const harness = preservationHarness();
	function write(path: string, content: string) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
		return path;
	}
	function fixture(installed = false) {
		const root = join(harness.agentDir, "extensions", "synthetic-user");
		const entry = write(
			join(root, "index.ts"),
			`import { Key } from "@earendil-works/pi-tui";
export default function(api) { if (!Key.escape) throw new Error("missing key contract"); api.registerCommand("synthetic-user", { handler: async () => {} }); }`,
		);
		const manifest = write(
			join(root, "package.json"),
			JSON.stringify({
				name: "synthetic-user",
				omk: { extensions: ["./index.ts"] },
				...(installed ? { dependencies: { "@earendil-works/pi-tui": "0.0.0-fixture" } } : {}),
			}),
		);
		const session = write(
			join(harness.agentDir, "sessions", "sentinel.jsonl"),
			'{"synthetic":"unchanged-session"}\n',
		);
		const auth = write(join(harness.agentDir, "auth.json"), '{"synthetic":"not-a-credential"}\n');
		const metadata = write(join(root, "metadata.json"), '{"synthetic":"unchanged-metadata"}\n');
		const paths = [entry, manifest, session, auth, metadata];
		return { root, entry, paths, before: paths.map((path) => readFileSync(path)) };
	}
	async function load(entry: string, dialect?: PackageManifestDialect) {
		return loadExtensions([entry], harness.cwd, undefined, { packageManifestDialect: dialect });
	}
	it("native missing legacy dependency fails resolution and preserves every original byte", async () => {
		const input = fixture();
		const result = await load(input.entry, "omk");
		expect(result.extensions).toHaveLength(0);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].error).toContain("@earendil-works/pi-tui");
		expect(input.paths.map((path) => readFileSync(path))).toEqual(input.before);
	});
	it.each(["omk+pi"] as const)(
		"compatibility %s retains synthetic legacy registration without rewriting",
		async (dialect) => {
			const input = fixture();
			const result = await load(input.entry, dialect);
			expect(result.errors).toEqual([]);
			expect([...result.extensions[0].commands.keys()]).toEqual(["synthetic-user"]);
			expect(input.paths.map((path) => readFileSync(path))).toEqual(input.before);
		},
	);
	it("native local installed Pi dependency and transitive subpath keep their actual fixture identity", async () => {
		const input = fixture(true);
		const dependency = join(input.root, "node_modules", "@earendil-works", "pi-tui");
		write(
			join(dependency, "package.json"),
			JSON.stringify({
				name: "@earendil-works/pi-tui",
				version: "0.0.0-fixture",
				type: "module",
				exports: { ".": "./index.js", "./identity": "./identity.js" },
			}),
		);
		write(
			join(dependency, "index.js"),
			'export { identity } from "./identity.js"; export const Key = {escape: "fixture-escape"};',
		);
		write(join(dependency, "identity.js"), 'export const identity = "synthetic-installed-pi-identity";');
		write(join(input.root, "bridge.ts"), 'export { identity } from "@earendil-works/pi-tui/identity";');
		write(
			input.entry,
			'import { identity as direct } from "@earendil-works/pi-tui"; import { identity as transitive } from "./bridge.ts"; export default function(api) { if (direct !== transitive) throw new Error("identity mismatch"); api.registerCommand(direct, {handler: async () => {}}); }',
		);
		const paths = [
			...input.paths,
			join(dependency, "package.json"),
			join(dependency, "index.js"),
			join(dependency, "identity.js"),
			join(input.root, "bridge.ts"),
		];
		const before = paths.map((path) => readFileSync(path));
		const result = await load(input.entry, "omk");
		expect(result.errors).toEqual([]);
		expect([...result.extensions[0].commands.keys()]).toEqual(["synthetic-installed-pi-identity"]);
		const report = inspectPackageCompatibility({
			source: input.root,
			packageRoot: input.root,
			resources: { extensions: [input.entry], skills: [], prompts: [], themes: [] },
			packageManifestDialect: "omk",
		});
		expect(report.checks.find((check) => check.id === "runtime-imports")?.status).toBe("warning");
		expect(paths.map((path) => readFileSync(path))).toEqual(before);
	});
	it("declared but absent Pi dependency is not fabricated by native loading", async () => {
		const input = fixture(true);
		const result = await load(input.entry, "omk");
		expect(result.extensions).toEqual([]);
		expect(result.errors).toHaveLength(1);
		expect(existsSync(join(input.root, "node_modules"))).toBe(false);
		expect(input.paths.map((path) => readFileSync(path))).toEqual(input.before);
	});
	it("doctor diagnoses but never imports synthetic code or rewrites adjacent user state", () => {
		const input = fixture();
		const marker = join(input.root, "must-not-execute");
		write(
			input.entry,
			`import { writeFileSync } from "node:fs"; import "@earendil-works/pi-tui"; writeFileSync(${JSON.stringify(marker)}, "executed"); export default () => {};`,
		);
		const before = input.paths.map((path) => readFileSync(path));
		const common = {
			source: input.root,
			packageRoot: input.root,
			resources: { extensions: [input.entry], skills: [], prompts: [], themes: [] },
		};
		const implicit = inspectPackageCompatibility(common);
		const compatible = inspectPackageCompatibility({ ...common, packageManifestDialect: "omk+pi" });
		expect(compatible.checks.find((check) => check.id === "runtime-imports")?.status).toBe("warning");
		const native = inspectPackageCompatibility({ ...common, packageManifestDialect: "omk" });
		// OMK 2.0: the omitted target is native.
		expect(JSON.stringify(implicit)).toBe(JSON.stringify(native));
		expect(native.checks.find((check) => check.id === "runtime-imports")?.status).toBe("error");
		expect(existsSync(marker)).toBe(false);
		expect(input.paths.map((path) => readFileSync(path))).toEqual(before);
	});
});
