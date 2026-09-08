/**
 * Grok harness auto-dispatch: when provider is native xai and OMK_GROK_HARNESS is not off,
 * tryGrokHarnessDispatch applies the grok-harness domain loadout without OMK_DOMAIN_ROUTING=1.
 */
import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { tryGrokHarnessDispatch } from "../src/core/grok-harness-dispatch.ts";
import { GROK_OAUTH_PROVIDER } from "../src/core/grok-playbook.ts";
import type { LoadoutRuntimeSession } from "../src/core/loadout-runtime.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import type { SourceInfo } from "../src/core/source-info.ts";

vi.mock("../src/core/mcp-inventory.ts", () => ({
	loadMcpInventory: () => ({
		entries: [
			{ name: "adaptorch", source: "/project/.omk/mcp.json", commandSummary: "adaptorch", envKeys: [] },
			{ name: "fetch", source: "/project/.omk/mcp.json", commandSummary: "fetch", envKeys: [] },
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
	"adaptorch-route": "AdaptOrch DAG topology routing",
	"understand-anything": "Repository graph architecture comprehension",
	headroom: "Compress oversized context window",
};

const makeResourceLoader = (): ResourceLoader => ({
	getSkills: () => ({
		skills: ["packages", "programming", "debugging", "adaptorch-route", "understand-anything", "headroom"].map(
			(name) => ({
				name,
				description: skillDescriptions[name] ?? name,
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

describe("tryGrokHarnessDispatch", () => {
	it("is a no-op for non-Grok providers", () => {
		const result = tryGrokHarnessDispatch({
			provider: "anthropic",
			session: makeSession(),
			resourceLoader: makeResourceLoader(),
			cwd: "/project",
			agentDir: "/agent",
			env: {},
		});
		expect(result.loadoutAccessPolicy).toBeUndefined();
		expect(result.warnings).toEqual([]);
	});

	it("is a no-op when OMK_GROK_HARNESS is disabled", () => {
		const result = tryGrokHarnessDispatch({
			provider: GROK_OAUTH_PROVIDER,
			session: makeSession(),
			resourceLoader: makeResourceLoader(),
			cwd: "/project",
			agentDir: "/agent",
			env: { OMK_GROK_HARNESS: "0" },
		});
		expect(result.loadoutAccessPolicy).toBeUndefined();
	});

	it("applies grok-harness loadout for native xai without domain routing opt-in", () => {
		const result = tryGrokHarnessDispatch({
			provider: GROK_OAUTH_PROVIDER,
			session: makeSession(),
			resourceLoader: makeResourceLoader(),
			cwd: "/project",
			agentDir: "/agent",
			env: {},
		});
		expect(result.loadoutAccessPolicy).toBeDefined();
		expect(result.loadoutAccessPolicy?.activeTools).toEqual(
			expect.arrayContaining(["read", "bash", "edit", "write"]),
		);
		expect(result.runtimeState?.profileName).toMatch(/grok|coder/i);
		expect(result.runtimeState?.activeSkills).toEqual([]);
	});

	it("narrows grok-harness skills to the documented 2-3 grant when a task is given", () => {
		const result = tryGrokHarnessDispatch({
			provider: GROK_OAUTH_PROVIDER,
			session: makeSession(),
			resourceLoader: makeResourceLoader(),
			cwd: "/project",
			agentDir: "/agent",
			env: {},
			task: "the agent is hanging and the response is empty",
		});
		expect(result.runtimeState?.activeSkills).toContain("debugging");
		expect(result.runtimeState?.activeSkills.length).toBeGreaterThan(0);
		expect(result.runtimeState?.activeSkills.length).toBeLessThanOrEqual(3);
		expect(result.runtimeState?.activeSkills).not.toContain("headroom");
	});

	it("does not fall back to the full grok-harness allowlist when the task has no skill signals", () => {
		const result = tryGrokHarnessDispatch({
			provider: GROK_OAUTH_PROVIDER,
			session: makeSession(),
			resourceLoader: makeResourceLoader(),
			cwd: "/project",
			agentDir: "/agent",
			env: {},
			task: "hello there",
		});
		expect(result.runtimeState?.activeSkills ?? []).toEqual([]);
		expect(result.warnings).toContain("no grok-harness skill signals");
	});

	it("uses path hints to grant a grok-harness skill the task text would miss", () => {
		const result = tryGrokHarnessDispatch({
			provider: GROK_OAUTH_PROVIDER,
			session: makeSession(),
			resourceLoader: makeResourceLoader(),
			cwd: "/project",
			agentDir: "/agent",
			env: {},
			task: "deploy the app",
			paths: ["packages/foo/bar.ts"],
		});
		expect(result.runtimeState?.activeSkills).toContain("packages");
		expect(result.runtimeState?.activeSkills.length).toBeLessThanOrEqual(3);
	});
});
