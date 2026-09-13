/**
 * Devin harness auto-dispatch: when provider is devin and OMK_DEVIN_HARNESS is not off,
 * tryDevinHarnessDispatch applies the devin-harness domain loadout without OMK_DOMAIN_ROUTING=1.
 */
import { describe, expect, it, vi } from "vitest";
import { DEVIN_PROVIDER } from "../src/core/devin-harness.ts";
import { tryDevinHarnessDispatch } from "../src/core/devin-harness-dispatch.ts";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import type { LoadoutRuntimeSession } from "../src/core/loadout-runtime.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import type { SourceInfo } from "../src/core/source-info.ts";

vi.mock("../src/core/mcp-inventory.ts", () => ({
	loadMcpInventory: () => ({
		entries: [
			{ name: "fetch", source: "/project/.omk/mcp.json", commandSummary: "fetch", envKeys: [] },
			{ name: "context7", source: "/project/.omk/mcp.json", commandSummary: "context7", envKeys: [] },
			{ name: "understand-anything", source: "/project/.omk/mcp.json", commandSummary: "ua", envKeys: [] },
			{ name: "playwright", source: "/project/.omk/mcp.json", commandSummary: "playwright", envKeys: [] },
			{ name: "filesystem", source: "/project/.omk/mcp.json", commandSummary: "fs", envKeys: [] },
		],
		presets: [],
		sources: [],
		errors: [],
	}),
}));

const sourceInfo = (name: string): SourceInfo => ({
	source: "test",
	scope: "project",
	origin: "top-level",
	path: `/skills/${name}`,
});

const makeSession = (
	baseTools: readonly string[] = ["read", "grep", "find", "ls", "edit", "write", "bash"],
): LoadoutRuntimeSession => {
	const base = new Map<string, ToolDefinition>();
	for (const name of baseTools) base.set(name, { name } as unknown as ToolDefinition);
	return {
		_baseToolDefinitions: base,
		_extensionRunner: { getAllRegisteredTools: () => [] },
		_customTools: [],
	};
};

const skillDescriptions: Readonly<Record<string, string>> = {
	packages: "Multi-package repository context",
	programming: "TypeScript Python Rust Go implementation",
	debugging: "Runtime failures, hanging, crash, empty response",
	"tdd-workflow": "Test-driven development red green refactor coverage",
	"understand-anything": "Repository graph architecture comprehension",
	headroom: "Compress oversized context window",
};

const makeResourceLoader = (): ResourceLoader => ({
	getSkills: () => ({
		skills: Object.keys(skillDescriptions).map((name) => ({
			name,
			description: skillDescriptions[name] ?? name,
			filePath: `/skills/${name}/SKILL.md`,
			baseDir: "/skills",
			disableModelInvocation: false,
			sourceInfo: sourceInfo(name),
		})),
		diagnostics: [],
	}),
	getExtensions: () => ({ extensions: [], diagnostics: [], errors: [], runtime: {} as never }),
	getPrompts: () => ({ prompts: [], diagnostics: [] }),
	getThemes: () => ({ themes: [], diagnostics: [] }),
	getAgentsFiles: () => ({ agentsFiles: [] }),
	getSystemPrompt: () => undefined,
	getAppendSystemPrompt: () => [],
	extendResources: () => {},
	reload: async () => {},
});

const dispatch = (overrides: Partial<Parameters<typeof tryDevinHarnessDispatch>[0]> = {}) =>
	tryDevinHarnessDispatch({
		provider: DEVIN_PROVIDER,
		session: makeSession(),
		resourceLoader: makeResourceLoader(),
		cwd: "/project",
		agentDir: "/agent",
		env: {},
		...overrides,
	});

describe("tryDevinHarnessDispatch", () => {
	it("is a no-op for other providers, including native xai", () => {
		for (const provider of ["anthropic", "xai", undefined]) {
			const result = dispatch({ provider });
			expect(result.loadoutAccessPolicy).toBeUndefined();
			expect(result.warnings).toEqual([]);
			expect(result.runtimeState).toBeUndefined();
		}
	});

	it("is a no-op when OMK_DEVIN_HARNESS is disabled, regardless of the Grok flag", () => {
		expect(dispatch({ env: { OMK_DEVIN_HARNESS: "0" } }).loadoutAccessPolicy).toBeUndefined();
		expect(
			dispatch({ env: { OMK_DEVIN_HARNESS: "off", OMK_GROK_HARNESS: "1" } }).loadoutAccessPolicy,
		).toBeUndefined();
	});

	it("applies the devin-harness loadout for the devin provider without domain routing opt-in", () => {
		const result = dispatch();
		expect(result.loadoutAccessPolicy).toBeDefined();
		expect(result.loadoutAccessPolicy?.activeTools).toEqual(
			expect.arrayContaining(["read", "bash", "edit", "write"]),
		);
		expect(result.runtimeState?.profileName).toMatch(/devin|coder/i);
		expect(result.runtimeState?.activeSkills).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it("narrows the skill grant to the documented 2-3 subset when a task is given", () => {
		const result = dispatch({ task: "the agent is hanging and the response is empty" });
		expect(result.runtimeState?.activeSkills).toContain("debugging");
		expect(result.runtimeState?.activeSkills.length).toBeGreaterThan(0);
		expect(result.runtimeState?.activeSkills.length).toBeLessThanOrEqual(3);
		expect(result.runtimeState?.activeSkills).not.toContain("headroom");
	});

	it("reports missing skill signals instead of granting the full allowlist", () => {
		const result = dispatch({ task: "hello there" });
		expect(result.runtimeState?.activeSkills ?? []).toEqual([]);
		expect(result.warnings).toContain("no devin-harness skill signals");
	});

	it("uses path hints to grant a skill the task text would miss", () => {
		const result = dispatch({ task: "deploy the app", paths: ["packages/foo/bar.ts"] });
		expect(result.runtimeState?.activeSkills).toContain("packages");
		expect(result.runtimeState?.activeSkills.length).toBeLessThanOrEqual(3);
	});

	it("fails closed with warnings when an extension shadows a builtin tool", () => {
		const session: LoadoutRuntimeSession = {
			...makeSession(),
			_extensionRunner: {
				getAllRegisteredTools: () => [
					{
						definition: { name: "bash" } as unknown as ToolDefinition,
						sourceInfo: sourceInfo("ext"),
					},
				],
			},
		};
		const result = dispatch({ session });
		expect(result.loadoutAccessPolicy).toBeUndefined();
		expect(result.warnings.length).toBeGreaterThan(0);
	});
});
