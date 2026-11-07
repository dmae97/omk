import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";

describe("direct discovery preserves its compatibility contract", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-direct-dialect-"));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));
	function write(path: string, text: string): string {
		const file = join(root, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
		return file;
	}
	function code(name: string, cjs = false): string {
		return `${cjs ? "module.exports =" : "export default"} function(api) {
			api.registerCommand(${JSON.stringify(name)}, {handler: async () => {}});
		}`;
	}

	it.each([undefined, "omk+pi"] as const)("retains directory indexes and order for %s", async (dialect) => {
		write("project/.omk/extensions/a.ts", code("local"));
		write("agent/extensions/b.js", code("global"));
		const configured = join(root, "configured");
		const extensions = ["ts", "js", "mjs", "cjs"];
		write("configured/package.json", JSON.stringify({ pi: { extensions: extensions.map((ext) => `./${ext}`) } }));
		for (const ext of extensions) write(`configured/${ext}/index.${ext}`, code(ext, ext === "cjs"));
		write("configured/ts/index.js", code("lower-priority-index"));
		const result = await discoverAndLoadExtensions(
			[configured, configured, join(root, "project/.omk/extensions/a.ts")],
			join(root, "project"),
			join(root, "agent"),
			undefined,
			{ packageManifestDialect: dialect },
		);
		expect(result.errors).toEqual([]);
		expect(result.extensions.flatMap((ext) => [...ext.commands.keys()])).toEqual(["local", "global", ...extensions]);
	});

	it.each([undefined, "omk+pi", "omk"] as const)(
		"retains authoritative empty/malformed manifests for %s",
		async (dialect) => {
			const packages = [
				{ omk: {}, pi: { extensions: ["./index.ts"] } },
				{ omk: { extensions: [] } },
				{ omk: { extensions: "./index.ts" } },
				{ omk: { extensions: ["./missing.ts"] } },
			];
			for (const [index, pkg] of packages.entries()) {
				write(`project/.omk/extensions/pkg-${index}/package.json`, JSON.stringify(pkg));
				write(`project/.omk/extensions/pkg-${index}/index.ts`, code("must-not-fallback"));
			}
			write("project/.omk/extensions/good.ts", code("good"));
			const result = await discoverAndLoadExtensions([], join(root, "project"), join(root, "agent"), undefined, {
				packageManifestDialect: dialect,
			});
			expect(result.errors).toEqual([]);
			expect(result.extensions.flatMap((ext) => [...ext.commands.keys()])).toEqual(["good"]);
		},
	);

	it("rejects a nested Pi-only manifest in native declared directories, retaining native siblings", async () => {
		write(
			"project/.omk/extensions/wrapper/package.json",
			JSON.stringify({ omk: { extensions: ["./nested", "./ok.ts"] } }),
		);
		write(
			"project/.omk/extensions/wrapper/nested/package.json",
			JSON.stringify({ pi: { extensions: ["./index.ts"] } }),
		);
		write("project/.omk/extensions/wrapper/nested/index.ts", code("pi-nested"));
		write("project/.omk/extensions/wrapper/ok.ts", code("native-sibling"));
		const result = await discoverAndLoadExtensions([], join(root, "project"), join(root, "agent"), undefined, {
			packageManifestDialect: "omk",
		});
		expect(result.errors).toEqual([]);
		expect(result.extensions.flatMap((ext) => [...ext.commands.keys()])).toEqual(["native-sibling"]);
	});

	it("retains native self-directory index declarations and terminates nested cycles", async () => {
		write("self/package.json", JSON.stringify({ omk: { extensions: ["./"] } }));
		write("self/index.mjs", code("self-index"));
		write("cycle/package.json", JSON.stringify({ omk: { extensions: ["./nested", "./good.ts"] } }));
		write("cycle/nested/package.json", JSON.stringify({ omk: { extensions: ["./"] } }));
		write("cycle/good.ts", code("cycle-sibling"));
		const result = await discoverAndLoadExtensions([join(root, "self"), join(root, "cycle")], root, root, undefined, {
			packageManifestDialect: "omk",
		});
		expect(result.errors).toEqual([]);
		expect(result.extensions.flatMap((ext) => [...ext.commands.keys()])).toEqual(["self-index", "cycle-sibling"]);
	});

	it.each([undefined, "omk+pi", "omk"] as const)(
		"retains valid siblings around a dangling symlink for %s",
		async (dialect) => {
			write("project/.omk/extensions/a-before.ts", code("before"));
			write("project/.omk/extensions/z-after.ts", code("after"));
			symlinkSync(join(root, "missing"), join(root, "project/.omk/extensions/m-broken"), "dir");
			const result = await discoverAndLoadExtensions([], join(root, "project"), join(root, "agent"), undefined, {
				packageManifestDialect: dialect,
			});
			expect(result.errors).toEqual([]);
			expect(result.extensions.flatMap((ext) => [...ext.commands.keys()])).toEqual(["before", "after"]);
		},
	);
});
