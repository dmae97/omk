import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import {
	createExtensionRuntime,
	loadExtensionFromFactory,
	loadExtensionModuleWithVirtualModulesForTests,
	loadExtensions,
} from "../src/core/extensions/loader.ts";
import type { ExtensionCommandContext } from "../src/core/extensions/types.ts";

describe("native ordinary dependency identities, not an import firewall", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "omk-native-routes-"));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));
	function write(relativePath: string, text: string): string {
		const path = join(root, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
		return path;
	}
	function dependency(name: string, cjs: boolean): void {
		write(
			`node_modules/${name}/package.json`,
			JSON.stringify({
				name,
				version: "1.0.0",
				type: cjs ? "commonjs" : "module",
				exports: { ".": "./index.js", "./deep": "./deep.js" },
			}),
		);
		for (const part of ["index", "deep"]) {
			write(
				`node_modules/${name}/${part}.js`,
				`${cjs ? "exports.identity =" : "export const identity ="} ${JSON.stringify(`${name}/${part}`)};`,
			);
		}
	}

	for (const binary of [false, true]) {
		it.each([false, true])(
			`retains installed ESM/CJS identities through helpers and subpaths (virtual=${binary}, cjs=%s)`,
			async (cjs) => {
				dependency("@earendil-works/pi-ai", cjs);
				dependency("@mariozechner/pi-tui", cjs);
				// Declaration omission deliberately does not prohibit resolvable user code under Boundary A.
				write("package.json", JSON.stringify({ name: "user-extension", type: "module" }));
				write(
					"node_modules/ordinary-helper/package.json",
					JSON.stringify({ name: "ordinary-helper", type: "module", exports: "./index.js" }),
				);
				write("node_modules/ordinary-helper/index.js", 'export {identity} from "@earendil-works/pi-ai/deep";');
				write("relative-helper.ts", 'export {identity} from "@mariozechner/pi-tui";');
				const receipt = join(root, "late.json");
				const entry = write(
					"entry.ts",
					`
				import {createRequire} from "node:module";
				import {writeFileSync} from "node:fs";
				import {identity as relative} from "./relative-helper.ts";
				import {identity as ordinary} from "ordinary-helper";
				const localRequire = createRequire(${JSON.stringify(join(root, "entry.ts"))});
				export default function(api) {
					api.registerCommand(relative + ":" + ordinary, {handler: async () => {}});
					api.registerCommand("late", {handler: async () => {
						const specifier = "@earendil-works/" + "pi-ai/deep";
						const delayed = await import(specifier);
						const required = localRequire("@mariozechner/pi-tui/deep");
						writeFileSync(${JSON.stringify(receipt)}, JSON.stringify([delayed.identity, required.identity]));
					}});
				}
			`,
				);
				const extension = binary
					? await loadExtensionFromFactory(
							(await loadExtensionModuleWithVirtualModulesForTests(entry, { packageManifestDialect: "omk" }))!,
							root,
							createEventBus(),
							createExtensionRuntime(),
							entry,
						)
					: (await loadExtensions([entry], root, undefined, { packageManifestDialect: "omk" })).extensions[0];
				expect(extension).toBeDefined();
				expect([...extension!.commands.keys()]).toEqual([
					"@mariozechner/pi-tui/index:@earendil-works/pi-ai/deep",
					"late",
				]);
				await extension!.commands.get("late")!.handler("", {} as ExtensionCommandContext);
				expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual([
					"@earendil-works/pi-ai/deep",
					"@mariozechner/pi-tui/deep",
				]);
			},
		);
	}

	it("supports a same-publisher non-Pi package without namespace blacklisting", async () => {
		dependency("@earendil-works/ordinary-fixture", false);
		const entry = write(
			"entry.ts",
			`import {identity} from "@earendil-works/ordinary-fixture";
			export default function(api) {api.registerCommand(identity, {handler: async () => {}});}`,
		);
		const result = await loadExtensions([entry], root, undefined, { packageManifestDialect: "omk" });
		expect(result.errors).toEqual([]);
		expect([...result.extensions[0]!.commands.keys()]).toEqual(["@earendil-works/ordinary-fixture/index"]);
	});

	it.each(["omk", "omk+pi"] as const)("isolates interleaved maps when %s loads first", async (first) => {
		dependency("@earendil-works/pi-ai", true);
		const entry = write(
			"entry.ts",
			`import * as dependency from "@earendil-works/pi-ai";
			export default function(api) {api.registerCommand(dependency.identity ?? "omk-alias", {handler: async () => {}});}`,
		);
		for (const dialect of [first, first === "omk" ? "omk+pi" : "omk", first] as const) {
			const result = await loadExtensions([entry], root, undefined, { packageManifestDialect: dialect });
			expect(result.errors).toEqual([]);
			expect([...result.extensions[0]!.commands.keys()]).toEqual([
				dialect === "omk" ? "@earendil-works/pi-ai/index" : "omk-alias",
			]);
		}
	});
});
