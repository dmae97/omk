import { describe, expect, it } from "vitest";
import { normalizeReverseSkillName, routeReverseSkill } from "../src/index.ts";

// Smoke test for the deduplicated canonical reverse-skill module. The
// coding-agent copy is now a thin re-export of this implementation through the
// omk-agent-core public entry, so this asserts the canonical module is reachable
// through the public specifier and that deterministic behavior is stable.
// Assertions mirror packages/coding-agent/test/reverse-skill.test.ts.
describe("reverse-skill canonical module (omk-agent-core public surface)", () => {
	it("normalizes skill names and routes frontend signature work deterministically", () => {
		expect(normalizeReverseSkillName("APK Reverse!! Workflow__2026")).toBe("apk-reverse-workflow-2026");

		const decision = routeReverseSkill({
			query: "Find the frontend signature and encrypted params in a webpack app using CDP breakpoints",
		});
		expect(decision.unmatched).toBe(false);
		expect(decision.primary?.route.id).toBe("js-reverse");
	});
});
