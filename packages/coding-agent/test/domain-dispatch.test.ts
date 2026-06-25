import { describe, expect, it, vi } from "vitest";
import { isDomainRoutingEnabled, tryDomainDispatch } from "../src/core/domain-dispatch.ts";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import type { LoadoutRuntimeSession } from "../src/core/loadout-runtime.ts";
import { BUILTIN_LOADOUTS, type LoadoutProfile } from "../src/core/loadouts.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import type { SourceInfo } from "../src/core/source-info.ts";

vi.mock("../src/core/mcp-inventory.ts", () => ({
	loadMcpInventory: () => ({
		entries: [
			{ name: "filesystem", source: "/project/.omk/mcp.json", commandSummary: "filesystem", envKeys: [] },
			{
				name: "filesystem-readonly",
				source: "/project/.omk/mcp.json",
				commandSummary: "filesystem-ro",
				envKeys: [],
			},
			{ name: "context7", source: "/project/.omk/mcp.json", commandSummary: "context7", envKeys: [] },
			{ name: "chrome-devtools", source: "/project/.omk/mcp.json", commandSummary: "chrome", envKeys: [] },
			{ name: "playwright", source: "/project/.omk/mcp.json", commandSummary: "playwright", envKeys: [] },
			{ name: "memory", source: "/project/.omk/mcp.json", commandSummary: "memory", envKeys: [] },
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

const makeResourceLoader = (): ResourceLoader => ({
	getSkills: () => ({
		skills: ["coding-standards", "test-driven-development", "frontend-ui-engineering", "frontend-design"].map(
			(name) => ({
				name,
				description: "test skill",
				filePath: `/skills/${name}/SKILL.md`,
				baseDir: "/skills",
				disableModelInvocation: false,
				sourceInfo: sourceInfo(name),
			}),
		),
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

describe("isDomainRoutingEnabled", () => {
	it("only enables domain routing with explicit opt-in", () => {
		expect(isDomainRoutingEnabled({})).toBe(false);
		expect(isDomainRoutingEnabled({ OMK_DOMAIN_ROUTING: "0" })).toBe(false);
		expect(isDomainRoutingEnabled({ OMK_DOMAIN_ROUTING: "1" })).toBe(true);
	});
});

describe("tryDomainDispatch", () => {
	it("returns a no-op result when opt-in is off", () => {
		const result = tryDomainDispatch({
			role: "coder",
			initialPrompt: "build a frontend UI component",
			session: makeSession(),
			resourceLoader: makeResourceLoader(),
			cwd: "/project",
			agentDir: "/agent",
			env: {},
		});

		expect(result).toEqual({
			loadoutAccessPolicy: undefined,
			domainUsed: undefined,
			fallback: false,
			warnings: [],
			trace: undefined,
		});
	});

	it("creates a policy for an opted-in frontend prompt", () => {
		const result = tryDomainDispatch({
			role: "coder",
			initialPrompt: "Implement a responsive frontend UI component with Tailwind CSS",
			session: makeSession(),
			resourceLoader: makeResourceLoader(),
			cwd: "/project",
			agentDir: "/agent",
			env: { OMK_DOMAIN_ROUTING: "1" },
			scopeHints: { readScope: ["src"], writeScope: ["src/Button.tsx"] },
		});

		expect(result.domainUsed).toBe("frontend-ui");
		expect(result.fallback).toBe(false);
		expect(result.loadoutAccessPolicy?.activeTools).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
		expect(result.trace?.composedAuthority).toBe("write-scoped");
	});

	it("falls back with warnings when runtime blockers are produced", () => {
		const roleProfileOverride: LoadoutProfile = {
			...BUILTIN_LOADOUTS.code,
			name: "requires-missing-tool",
			tools: { allow: ["read"], require: ["missing-tool"] },
		};

		const result = tryDomainDispatch({
			role: "coder",
			initialPrompt: "frontend component",
			session: makeSession(["read"]),
			resourceLoader: makeResourceLoader(),
			cwd: "/project",
			agentDir: "/agent",
			env: { OMK_DOMAIN_ROUTING: "1" },
			roleProfileOverride,
		});

		expect(result.loadoutAccessPolicy).toBeUndefined();
		expect(result.fallback).toBe(true);
		expect(result.warnings.join("\n")).toContain("missing required tool: missing-tool");
	});
});
