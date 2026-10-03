import { describe, expect, it } from "vitest";
import registerSubagent from "./index.ts";
import { canSpawnSubagents, childSubagentEnv, currentSubagentDepth, SUBAGENT_DEPTH_ENV } from "./nesting.ts";

function registeredToolNames(env: NodeJS.ProcessEnv): string[] {
	const saved = { ...process.env };
	const names: string[] = [];
	try {
		for (const key of Object.keys(process.env)) delete process.env[key];
		Object.assign(process.env, env);
		registerSubagent({ registerTool: (tool: { name: string }) => names.push(tool.name) } as never);
	} finally {
		for (const key of Object.keys(process.env)) delete process.env[key];
		Object.assign(process.env, saved);
	}
	return names;
}

describe("subagent nesting guard", () => {
	it("lets the top-level session spawn and stops its children by default", () => {
		expect(canSpawnSubagents({})).toBe(true);
		const child = childSubagentEnv({});
		expect(child[SUBAGENT_DEPTH_ENV]).toBe("1");
		expect(canSpawnSubagents(child)).toBe(false);
	});

	it("increments depth for each generation and honours a raised max depth", () => {
		const grandchild = childSubagentEnv(childSubagentEnv({ OMK_SUBAGENT_MAX_DEPTH: "2" }));
		expect(currentSubagentDepth(grandchild)).toBe(2);
		expect(canSpawnSubagents(childSubagentEnv({ OMK_SUBAGENT_MAX_DEPTH: "2" }))).toBe(true);
		expect(canSpawnSubagents(grandchild)).toBe(false);
	});

	it("treats malformed depth values as defaults", () => {
		expect(currentSubagentDepth({ [SUBAGENT_DEPTH_ENV]: "-3" })).toBe(0);
		expect(canSpawnSubagents({ OMK_SUBAGENT_MAX_DEPTH: "lots" })).toBe(true);
	});

	it("does not register the subagent tool in a child at the limit", () => {
		expect(registeredToolNames({})).toEqual(["subagent"]);
		expect(registeredToolNames({ [SUBAGENT_DEPTH_ENV]: "1" })).toEqual([]);
	});
});
