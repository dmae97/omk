import { describe, expect, it } from "vitest";
import { getDomainProfile } from "../src/core/domain-loadouts.ts";
import { composeLoadout } from "../src/core/loadout-compose.ts";
import { SECURITY_HOOK_NAMES } from "../src/core/loadout-safety.ts";
import {
	BUILTIN_LOADOUTS,
	inferLoadoutForRole,
	type LoadoutRole,
	validateLoadoutProfile,
} from "../src/core/loadouts.ts";

const expectValidProfile = (role: LoadoutRole, domainId: string): void => {
	const composed = composeLoadout(role, domainId);
	expect(validateLoadoutProfile(composed)).toEqual({ valid: true, errors: [] });

	const roleTools = new Set(BUILTIN_LOADOUTS[inferLoadoutForRole(role)].tools.allow ?? []);
	for (const toolName of composed.tools.allow ?? []) {
		expect(roleTools.has(toolName)).toBe(true);
	}
};

describe("composeLoadout", () => {
	it("validates representative role/domain combinations", () => {
		expectValidProfile("coder", "frontend-ui");
		expectValidProfile("tester", "data-science");
		expectValidProfile("security", "backend-api");
	});

	it("removes write tools and downgrades filesystem MCP for a reviewer in a frontend domain", () => {
		const composed = composeLoadout("reviewer", getDomainProfile("frontend-ui"));

		expect(composed.authority).toBe("review-only");
		expect(composed.tools.allow).toEqual(["find", "grep", "ls", "read"]);
		expect(composed.tools.allow).not.toContain("edit");
		expect(composed.tools.allow).not.toContain("write");
		expect(composed.mcp?.allow?.[0]?.names).toContain("filesystem-readonly");
		expect(composed.mcp?.allow?.[0]?.names).not.toContain("filesystem");
		expect(composed.composition.downgraded).toContainEqual({ mcp: "filesystem", to: "filesystem-readonly" });
		expect(composed.composition.stripped).toContainEqual({
			kind: "skill",
			name: "frontend-ui-engineering",
			reason: "read-only authority cannot activate write-like skills",
		});
		expect(validateLoadoutProfile(composed)).toEqual({ valid: true, errors: [] });
	});

	it("forces security hooks for every composed loadout", () => {
		const composed = composeLoadout("planner", "research");
		const hookNames = composed.hooks?.allow?.[0]?.names ?? [];

		for (const hookName of SECURITY_HOOK_NAMES) {
			expect(hookNames).toContain(hookName);
		}
	});

	it("caps authority with the optional grant authority", () => {
		const composed = composeLoadout("coder", "frontend-ui", { grantAuthority: "execute-tests" });

		expect(composed.authority).toBe("execute-tests");
		expect(composed.commands).toEqual({ mode: "tests-only" });
		expect(validateLoadoutProfile(composed)).toEqual({ valid: true, errors: [] });
	});
});
