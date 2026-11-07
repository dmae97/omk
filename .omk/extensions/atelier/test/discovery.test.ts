import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { DefaultResourceLoader } from "../../../../packages/coding-agent/src/core/resource-loader.ts";
import { SettingsManager } from "../../../../packages/coding-agent/src/core/settings-manager.ts";

it.each([undefined, "omk+pi", "omk"] as const)(
	"discovers exact Atelier registrations and both themes with dialect %s",
	async (packageManifestDialect) => {
		const cwd = mkdtempSync(join(tmpdir(), "atelier-package-"));
		try {
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir: join(cwd, "agent"),
				...(packageManifestDialect === undefined ? {} : { packageManifestDialect }),
				settingsManager: SettingsManager.inMemory({ packages: [resolve(".")] }),
				noSkills: true,
				noContextFiles: true,
				noPromptTemplates: true,
			});
			await loader.reload();
			expect(loader.getExtensions().errors).toEqual([]);
			const extensions = loader.getExtensions().extensions.filter((entry) => entry.path.startsWith(resolve(".")));
			expect(extensions.map((entry) => entry.path)).toEqual([resolve("index.ts")]);
			const entry = extensions[0];
			if (!entry) throw new Error("Atelier package extension was not loaded");
			expect([...entry.commands.keys()].sort()).toEqual(["atelier", "atelier-theme"]);
			expect([...entry.shortcuts.keys()].sort()).toEqual(["ctrl+q", "ctrl+shift+r", "f6"]);
			expect([...entry.tools.keys()]).toEqual([]);
			expect([...entry.flags.keys()]).toEqual([]);
			expect([...entry.messageRenderers.keys()]).toEqual([]);
			expect(Object.fromEntries([...entry.handlers].map(([event, handlers]) => [event, handlers.length]))).toEqual({
				session_start: 1,
				session_tree: 1,
				agent_start: 1,
				turn_start: 1,
				before_provider_request: 1,
				message_update: 1,
				message_end: 1,
				tool_execution_start: 1,
				tool_execution_end: 1,
				tool_result: 1,
				agent_settled: 1,
				turn_end: 1,
				model_select: 1,
				thinking_level_select: 1,
				session_compact: 1,
				session_info_changed: 1,
				session_shutdown: 1,
				resources_discover: 1,
			});
			expect(loader.getThemes().diagnostics).toEqual([]);
			expect(
				loader
					.getThemes()
					.themes.map((theme) => theme.name)
					.sort(),
			).toEqual(["omk-atelier-dark", "omk-atelier-light"]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

for (const [file, expected] of [
	[
		"overlay-lifecycle.ts",
		[
			["open-multi-agent-kit", "type { ExtensionContext }"],
			["omk-tui", "type { Component, OverlayOptions, TUI }"],
		],
	],
	["state.ts", [["open-multi-agent-kit", "type { ExtensionAPI, ExtensionContext }"]]],
	["todos.ts", [["open-multi-agent-kit", "type { ExtensionContext }"]]],
	["sidebar-panels.ts", [["open-multi-agent-kit", "type { ExtensionAPI }"]]],
] as const) {
	it(`batch B state preserves native type-only declarations in ${file}`, () => {
		const path = resolve("vendor/src", file);
		const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
		const imports = source.statements.flatMap((node) => {
			if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return [];
			const specifier = node.moduleSpecifier.text;
			if (
				!["open-multi-agent-kit", "omk-tui"].includes(specifier) &&
				!specifier.endsWith("/pi-coding-agent") &&
				!specifier.endsWith("/pi-tui")
			)
				return [];
			return [[node.moduleSpecifier.text, node.importClause?.getText(source).replace(/\s+/g, " ")]];
		});
		expect(imports).toEqual(expected);
	});
}
