import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadExtensions } from "../src/core/extensions/loader.ts";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const nativeExtension = `
	export default function(api) {
		api.registerCommand("auto-native-boundary", { handler: async () => {} });
	}
`;

describe("automatic package manifest dialect boundary", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "omk-manifest-auto-"));
		vi.stubEnv("HOME", tempDir);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		rmSync(tempDir, { recursive: true, force: true });
	});

	function write(relativePath: string, contents: string): string {
		const path = join(tempDir, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, contents);
		return path;
	}

	function resolve(packageManifestDialect?: "omk" | "omk+pi", packageRoot?: string) {
		const base = packageRoot ? join(tempDir, "managed") : tempDir;
		const cwd = join(base, "project");
		const agentDir = join(base, "agent");
		mkdirSync(join(cwd, ".git"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		return new DefaultPackageManager({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(packageRoot ? { packages: [packageRoot] } : {}),
			...(packageManifestDialect === undefined ? {} : { packageManifestDialect }),
		}).resolve();
	}

	it.each(["agent/extensions", "project/.omk/extensions"])(
		"rejects a Pi-only directory declared by a native wrapper in %s",
		async (discoveryRoot) => {
			const wrapper = `${discoveryRoot}/wrapper`;
			const root = join(tempDir, wrapper);
			write(`${wrapper}/package.json`, JSON.stringify({ omk: { extensions: ["./native.ts", "./legacy"] } }));
			const nativePath = write(`${wrapper}/native.ts`, nativeExtension);
			const sentinel = join(root, "executed");
			write(`${wrapper}/legacy/package.json`, JSON.stringify({ pi: { extensions: ["./index.ts"] } }));
			write(
				`${wrapper}/legacy/index.ts`,
				`import { writeFileSync } from "node:fs";
				writeFileSync(${JSON.stringify(sentinel)}, "executed");
				export default function() {}`,
			);
			const compatible = await resolve();
			expect(compatible.extensions.map((r) => r.path).sort()).toEqual([nativePath, join(root, "legacy")].sort());
			const explicitCompatible = await resolve("omk+pi");
			expect(explicitCompatible).toEqual(compatible);
			expect(existsSync(sentinel)).toBe(false);
			const managed = await resolve("omk", root);
			expect(managed.extensions.map((r) => r.path)).toEqual([nativePath]);
			const native = await resolve("omk");
			expect(native.extensions.map((r) => r.path)).toEqual([nativePath]);
			const loaded = await loadExtensions(
				native.extensions.filter((r) => r.enabled).map((r) => r.path),
				join(tempDir, "project"),
			);
			expect(loaded.errors).toEqual([]);
			expect(loaded.extensions).toHaveLength(1);
			expect(loaded.extensions[0]?.commands.has("auto-native-boundary")).toBe(true);
			expect(existsSync(sentinel)).toBe(false);
		},
	);

	it.each(["agent/extensions", "project/.omk/extensions"])(
		"expands native automatic manifest wildcards in %s",
		async (discoveryRoot) => {
			const wrapper = `${discoveryRoot}/wrapper`;
			const root = join(tempDir, wrapper);
			write(`${wrapper}/package.json`, JSON.stringify({ omk: { extensions: ["./*.ts"] } }));
			const indexPath = write(`${wrapper}/index.ts`, nativeExtension);
			const extraPath = write(`${wrapper}/extra.ts`, "export default function() {}");
			const managed = await resolve("omk", root);
			expect(managed.extensions.map((r) => r.path).sort()).toEqual([indexPath, extraPath].sort());
			const compatible = await resolve();
			expect(compatible.extensions.map((r) => r.path)).toEqual([indexPath]);
			expect(await resolve("omk+pi")).toEqual(compatible);
			const native = await resolve("omk");
			expect(native.extensions.map((r) => r.path).sort()).toEqual([indexPath, extraPath].sort());
			expect(native.extensions.every((r) => r.enabled)).toBe(true);
		},
	);

	it.each(["self", "symlink"])("terminates a native manifest %s cycle without losing a sibling", async (cycle) => {
		const wrapper = "agent/extensions/wrapper";
		const root = join(tempDir, wrapper);
		write(
			`${wrapper}/package.json`,
			JSON.stringify({ omk: { extensions: [cycle === "self" ? "." : "./loop", "./native.ts"] } }),
		);
		const nativePath = write(`${wrapper}/native.ts`, nativeExtension);
		if (cycle === "symlink") symlinkSync(root, join(root, "loop"), "junction");
		const paths = await resolve("omk");
		expect(paths.extensions.map((r) => r.path)).toEqual([nativePath]);
	});

	it.each([16, 80])("bounds native manifest traversal at depth %s", async (depth) => {
		let wrapper = "agent/extensions/wrapper";
		for (let level = 0; level < depth; level++) {
			write(`${wrapper}/package.json`, JSON.stringify({ omk: { extensions: ["./next"] } }));
			wrapper += "/next";
		}
		const nativePath = write(`${wrapper}/index.ts`, nativeExtension);
		const paths = await resolve("omk");
		expect(paths.extensions.map((r) => r.path)).toEqual(depth === 16 ? [nativePath] : []);
	});

	it("selects and loads a canonical native extension only once across directory aliases", async () => {
		const wrapper = "agent/extensions/wrapper";
		const root = join(tempDir, wrapper);
		write(`${wrapper}/package.json`, JSON.stringify({ omk: { extensions: ["./relay", "./alias"] } }));
		write(`${wrapper}/relay/package.json`, JSON.stringify({ omk: { extensions: ["./native.ts"] } }));
		const nativePath = write(`${wrapper}/relay/native.ts`, nativeExtension);
		symlinkSync(join(root, "relay"), join(root, "alias"), "junction");
		const paths = await resolve("omk");
		expect(paths.extensions.map((r) => r.path)).toEqual([nativePath]);
		const loaded = await loadExtensions(
			paths.extensions.filter((r) => r.enabled).map((r) => r.path),
			join(tempDir, "project"),
		);
		expect(loaded.errors).toEqual([]);
		expect(loaded.extensions).toHaveLength(1);
		expect(loaded.extensions[0]?.commands.has("auto-native-boundary")).toBe(true);
	});

	it.each([
		["agent/extensions", "./groups/*"],
		["project/.omk/extensions", "./groups/*"],
		["agent/extensions", "./groups/one"],
		["project/.omk/extensions", "./groups/one"],
	])(
		"collects native conventional directories in %s from %s like managed resolution",
		async (discoveryRoot, entry) => {
			const wrapper = `${discoveryRoot}/wrapper`;
			const root = join(tempDir, wrapper);
			write(`${wrapper}/package.json`, JSON.stringify({ omk: { extensions: [entry, "./sibling"] } }));
			const nativePath = write(`${wrapper}/groups/one/native.ts`, nativeExtension);
			write(`${wrapper}/sibling/package.json`, JSON.stringify({ omk: { extensions: ["./native.ts"] } }));
			const siblingPath = write(`${wrapper}/sibling/native.ts`, "export default function() {}");
			const sentinel = join(root, "executed");
			write(`${wrapper}/groups/one/legacy/package.json`, JSON.stringify({ pi: { extensions: ["./index.ts"] } }));
			write(
				`${wrapper}/groups/one/legacy/index.ts`,
				`import { writeFileSync } from "node:fs";
			writeFileSync(${JSON.stringify(sentinel)}, "executed");
			export default function() {}`,
			);
			const managed = await resolve("omk", root);
			expect(managed.extensions.map((r) => r.path).sort()).toEqual([nativePath, siblingPath].sort());
			const compatible = await resolve();
			expect(compatible.extensions.map((r) => r.path)).toEqual(
				entry.includes("*") ? [join(root, "sibling")] : [join(root, "groups/one"), join(root, "sibling")],
			);
			expect(await resolve("omk+pi")).toEqual(compatible);
			const native = await resolve("omk");
			expect(native.extensions.map((r) => r.path).sort()).toEqual([nativePath, siblingPath].sort());
			const loaded = await loadExtensions(
				native.extensions.filter((r) => r.enabled).map((r) => r.path),
				join(tempDir, "project"),
			);
			expect(loaded.errors).toEqual([]);
			expect(loaded.extensions).toHaveLength(2);
			expect(existsSync(sentinel)).toBe(false);
		},
	);

	it.each([{}, { extensions: [] }, null, { extensions: "./index.ts" }, { extensions: ["../escape.ts"] }])(
		"keeps nested authoritative omk %j terminal without changing compatibility directory entries",
		async (omk) => {
			const wrapper = "agent/extensions/wrapper";
			write(`${wrapper}/package.json`, JSON.stringify({ omk: { extensions: ["./nested", "./native.ts"] } }));
			const nativePath = write(`${wrapper}/native.ts`, nativeExtension);
			write(`${wrapper}/nested/package.json`, JSON.stringify({ omk, pi: { extensions: ["./index.ts"] } }));
			write(`${wrapper}/nested/index.ts`, "export default function() {}");
			const native = await resolve("omk");
			expect(native.extensions.map((r) => r.path)).toEqual([nativePath]);
			const compatible = await resolve();
			expect(compatible.extensions.map((r) => r.path)).toEqual([join(tempDir, wrapper, "nested"), nativePath]);
		},
	);

	it("applies wildcard exclusions without reviving index fallback", async () => {
		const wrapper = "agent/extensions/wrapper";
		write(`${wrapper}/package.json`, JSON.stringify({ omk: { extensions: ["./*.ts", "!index.ts"] } }));
		const indexPath = write(`${wrapper}/index.ts`, nativeExtension);
		const extraPath = write(`${wrapper}/extra.ts`, "export default function() {}");
		expect((await resolve("omk", join(tempDir, wrapper))).extensions.map((r) => r.path)).toEqual([extraPath]);
		expect((await resolve("omk")).extensions.map((r) => r.path)).toEqual([extraPath]);
		expect((await resolve()).extensions.map((r) => r.path)).toEqual([indexPath]);
	});

	it.each([{}, { extensions: [] }, { extensions: ["./missing.ts"] }, { extensions: "./index.ts" }])(
		"preserves default automatic index fallback for authoritative omk %j",
		async (omk) => {
			const wrapper = "agent/extensions/wrapper";
			write(`${wrapper}/package.json`, JSON.stringify({ omk }));
			const indexPath = write(`${wrapper}/index.ts`, nativeExtension);
			expect((await resolve()).extensions.map((r) => r.path)).toEqual([indexPath]);
			expect((await resolve("omk+pi")).extensions.map((r) => r.path)).toEqual([indexPath]);
			expect((await resolve("omk")).extensions).toEqual([]);
		},
	);
});
