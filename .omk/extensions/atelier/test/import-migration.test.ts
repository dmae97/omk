import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CustomEditor } from "open-multi-agent-kit";
import ts from "typescript";
import { expect, it } from "vitest";
import { DefaultResourceLoader } from "../../../../packages/coding-agent/src/core/resource-loader.ts";
import { SettingsManager } from "../../../../packages/coding-agent/src/core/settings-manager.ts";
import { AtelierEditor, frameEditorLines } from "../vendor/src/editor.ts";
import { findOwnMethod } from "../vendor/src/image-compositor.ts";
import { renderMenuFrame } from "../vendor/src/menu.ts";
import { getDisplaySettingsViewportHeight } from "../vendor/src/settings-workspace.ts";
import { fitToWidth, sanitizeInline } from "../vendor/src/text.ts";

const importCases = [
	["batch A text", "src/text.ts", [["omk-tui", false, ["truncateToWidth"]]]],
	["batch A text", "src/footer.ts", [["omk-tui", false, ["type Component", "truncateToWidth", "visibleWidth"]]]],
	[
		"batch A text",
		"src/run-activity.ts",
		[
			["open-multi-agent-kit", true, ["ExtensionEvent"]],
			["omk-tui", false, ["truncateToWidth", "visibleWidth"]],
		],
	],
	["batch A text", "src/subagent-cost-chart.ts", [["omk-tui", false, ["truncateToWidth", "visibleWidth"]]]],
	[
		"batch A editor",
		"src/editor.ts",
		[
			["open-multi-agent-kit", false, ["CustomEditor"]],
			["omk-tui", false, ["truncateToWidth", "visibleWidth"]],
		],
	],
	[
		"batch A editor",
		"src/menu.ts",
		[
			["open-multi-agent-kit", false, ["getSettingsListTheme", "type ExtensionAPI", "type ExtensionContext"]],
			[
				"omk-tui",
				false,
				["Container", "type SelectItem", "SelectList", "type SettingItem", "SettingsList", "Text", "truncateToWidth"],
			],
		],
	],
	[
		"batch A editor",
		"src/image-compositor.ts",
		[["omk-tui", false, ["type OverlayOptions", "type TUI", "visibleWidth"]]],
	],
	[
		"batch A editor",
		"src/settings-workspace.ts",
		[["omk-tui", false, ["matchesKey", "truncateToWidth", "visibleWidth"]]],
	],
	[
		"batch B runtime",
		"extensions/index.ts",
		[
			[
				"open-multi-agent-kit",
				false,
				["type ExtensionAPI", "type ExtensionContext", "estimateTokens", "getAgentDir", "SettingsManager"],
			],
			["omk-tui", true, ["KeyId"]],
		],
	],
	[
		"batch B runtime",
		"src/sidebar.ts",
		[
			["open-multi-agent-kit", true, ["ExtensionContext"]],
			["omk-tui", false, ["type Component", "type OverlayHandle", "truncateToWidth", "visibleWidth"]],
		],
	],
	[
		"batch B runtime",
		"src/subagent-cost-image.ts",
		[["omk-tui", false, ["allocateImageId", "getCapabilities", "getCellDimensions", "Image"]]],
	],
	[
		"batch B runtime",
		"src/subagent-usage-view.ts",
		[
			["open-multi-agent-kit", true, ["ExtensionContext"]],
			["omk-tui", false, ["matchesKey", "truncateToWidth", "visibleWidth"]],
		],
	],
	["batch B runtime", "src/workspace-pulse.ts", [["open-multi-agent-kit", true, ["ExecOptions", "ExecResult"]]]],
	[
		"batch B state",
		"src/overlay-lifecycle.ts",
		[
			["open-multi-agent-kit", true, ["ExtensionContext"]],
			["omk-tui", true, ["Component", "OverlayOptions", "TUI"]],
		],
	],
	["batch B state", "src/state.ts", [["open-multi-agent-kit", true, ["ExtensionAPI", "ExtensionContext"]]]],
	["batch B state", "src/todos.ts", [["open-multi-agent-kit", true, ["ExtensionContext"]]]],
	["batch B state", "src/sidebar-panels.ts", [["open-multi-agent-kit", true, ["ExtensionAPI"]]]],
] as const;

function parseSource(path: string): ts.SourceFile {
	return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function apiImports(path: string) {
	const source = parseSource(path);
	return source.statements.flatMap((node) => {
		if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return [];
		const specifier = node.moduleSpecifier.text;
		if (
			!["open-multi-agent-kit", "omk-tui", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"].includes(
				specifier,
			)
		)
			return [];
		const clause = node.importClause;
		const named = clause?.namedBindings;
		const bindings =
			named && ts.isNamedImports(named)
				? named.elements.map((binding) => binding.getText(source).replace(/\s+/g, " "))
				: [named?.getText(source) ?? ""];
		if (clause?.name) bindings.unshift(`default ${clause.name.text}`);
		return [[specifier, clause?.isTypeOnly ?? false, bindings]];
	});
}

for (const [batch, path, imports] of importCases) {
	it(`${batch} preserves native import bindings and type markers in ${path}`, () => {
		expect(apiImports(resolve("vendor", path))).toEqual(imports);
	});
}

it("batch A text pads, truncates and sanitizes terminal sequences through the native TUI", () => {
	expect(fitToWidth("hi", 4)).toBe("hi  ");
	expect(sanitizeInline(fitToWidth("abcdef", 4))).toBe("abcd");
	expect(fitToWidth("hello", 0)).toBe("");
	expect(
		sanitizeInline("\u001b]8;;https://example.invalid\u0007safe\u001b]8;;\u0007\n\u001b[31mred\u001b[0m\twords"),
	).toBe("safe red words");
});

it("batch A editor retains native inheritance, framing, image method lookup and settings viewport", () => {
	expect(AtelierEditor.prototype).toBeInstanceOf(CustomEditor);
	expect(frameEditorLines(["────", "body", "────"], 8, (text) => text)).toEqual(["╭──────╮", "│ body │", "╰──────╯"]);
	expect(renderMenuFrame({ fg: (_role, text) => text, bold: (text) => text }, ["abc"], 8)).toEqual([
		"┏━━━━━━┓",
		"┃abc   ┃",
		"┗━━━━━━┛",
	]);
	const render = () => ["image"];
	expect(findOwnMethod(Object.create({ render }), "render")).toBe(render);
	expect(getDisplaySettingsViewportHeight(24)).toBe(22);
});

it("final aliases removes both legacy type and test aliases while retaining native targets", () => {
	const config = JSON.parse(readFileSync(resolve("tsconfig.json"), "utf8"));
	expect(config.compilerOptions.paths).not.toHaveProperty("@earendil-works/pi-coding-agent");
	expect(config.compilerOptions.paths).not.toHaveProperty("@earendil-works/pi-tui");
	expect(config.compilerOptions.paths["open-multi-agent-kit"]).toEqual(["packages/coding-agent/src/index.ts"]);
	expect(config.compilerOptions.paths["omk-tui"]).toEqual(["packages/tui/src/index.ts"]);
	const aliases: string[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isPropertyAssignment(node) &&
			node.name.getText() === "alias" &&
			ts.isObjectLiteralExpression(node.initializer)
		) {
			for (const property of node.initializer.properties) {
				if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) aliases.push(property.name.text);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(parseSource(resolve("vitest.config.ts")));
	expect(aliases).not.toContain("@earendil-works/pi-coding-agent");
	expect(aliases).not.toContain("@earendil-works/pi-tui");
	expect(aliases).toEqual(expect.arrayContaining(["open-multi-agent-kit", "omk-tui"]));
});

it("native package retains the exact registrations and both themes through DefaultResourceLoader", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "atelier-native-package-"));
	try {
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: join(cwd, "agent"),
			packageManifestDialect: "omk",
			settingsManager: SettingsManager.inMemory({ packages: [resolve(".")] }),
			noSkills: true,
			noContextFiles: true,
			noPromptTemplates: true,
		});
		await loader.reload();
		const loaded = loader.getExtensions();
		expect(loaded.errors).toEqual([]);
		const packageExtensions = loaded.extensions.filter((entry) => entry.path.startsWith(resolve(".")));
		expect(packageExtensions.map((entry) => entry.path)).toEqual([resolve("index.ts")]);
		const entry = packageExtensions[0];
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
});
