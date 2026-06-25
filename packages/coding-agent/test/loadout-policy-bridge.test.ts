import { describe, expect, it } from "vitest";
import { createLoadoutAccessPolicy } from "../src/core/loadout-access-policy.ts";
import { createLoadoutPolicyFromRuntimeState, validatePolicyIntegrity } from "../src/core/loadout-policy-bridge.ts";
import type { LoadoutRuntimeState } from "../src/core/loadout-runtime.ts";

const cleanState: LoadoutRuntimeState = {
	profileName: "code+frontend-ui",
	authority: "write-scoped",
	activeTools: ["edit", "read"],
	activeSkills: ["coding-standards"],
	activeMcp: ["filesystem"],
	activeHooks: ["pre-shell-guard", "protect-secrets", "stop-verify"],
	schedulerFields: {
		readSet: [{ path: "src" }],
		writeSet: [{ path: "src/feature.ts" }],
		parallelizable: false,
	},
	blockers: [],
	warnings: [],
};

describe("createLoadoutPolicyFromRuntimeState", () => {
	it("generates a policy from a clean runtime state", () => {
		const policy = createLoadoutPolicyFromRuntimeState(cleanState, {
			cwd: "/repo",
			commands: { mode: "none" },
		});

		expect(policy.activeTools).toEqual(["edit", "read"]);
		expect(policy.readRoots.length).toBe(1);
		expect(policy.writeRoots.length).toBe(1);
		expect(validatePolicyIntegrity(policy, cleanState)).toEqual({ valid: true, warnings: [] });
	});

	it("throws when runtime state has blockers", () => {
		expect(() =>
			createLoadoutPolicyFromRuntimeState(
				{
					...cleanState,
					blockers: ["missing required tool: edit", "loadout authority write-scoped exceeds grant read-only"],
				},
				{ cwd: "/repo" },
			),
		).toThrow("missing required tool: edit; loadout authority write-scoped exceeds grant read-only");
	});
});

describe("validatePolicyIntegrity", () => {
	it("reports integrity mismatch warnings", () => {
		const policy = createLoadoutAccessPolicy({
			cwd: "/repo",
			activeTools: ["read", "write"],
			readSet: [],
			writeSet: [],
		});

		const result = validatePolicyIntegrity(policy, cleanState);

		expect(result.valid).toBe(false);
		expect(result.warnings).toContain("policy active tools do not match runtime active tools");
		expect(result.warnings).toContain("policy read roots do not match runtime scheduler read set");
		expect(result.warnings).toContain("policy write roots do not match runtime scheduler write set");
	});
});
