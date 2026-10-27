import * as kit from "open-multi-agent-kit";
import * as kitHooks from "open-multi-agent-kit/hooks";
import { describe, expect, it } from "vitest";
import * as hooksSource from "../src/core/hooks/index.ts";
import * as source from "../src/index.ts";

// Examples import the package by name ("open-multi-agent-kit"), and the subagent example tests load
// them in-process. Without an alias the name resolved through node_modules to dist/: a checkout that
// was never built (a fresh worktree) failed to load the file, and a built one tested yesterday's dist
// instead of the source under test, with module state (mutation queue, agent dir) split in two.
describe("open-multi-agent-kit in tests", () => {
	it("is this checkout's source, not a built copy", () => {
		expect(kit.getAgentDir).toBe(source.getAgentDir);
		expect(kit.withFileMutationQueue).toBe(source.withFileMutationQueue);
	});

	it("resolves the hooks subpath to source as well", () => {
		expect(Object.keys(kitHooks).sort()).toEqual(Object.keys(hooksSource).sort());
		for (const key of Object.keys(hooksSource)) {
			expect((kitHooks as Record<string, unknown>)[key]).toBe((hooksSource as Record<string, unknown>)[key]);
		}
	});
});
