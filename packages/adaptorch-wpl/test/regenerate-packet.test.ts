import { describe, expect, it } from "vitest";
import { POLICY_FLAG } from "../src/policy-wall.ts";
import { buildRegeneratePacket } from "../src/regenerate-packet.ts";

describe("buildRegeneratePacket", () => {
	it("enables hints when auto-regenerate on and BLOCKED with budget", () => {
		const packet = buildRegeneratePacket({
			userVerdict: "BLOCKED",
			policyFlags: [POLICY_FLAG.CANDIDATE_LEAK_SUSPECT],
			previewOnly: true,
			diffPaths: ["packages/foo/bar.ts"],
			attemptCount: 0,
			budgetOverride: 2,
			autoRegenerateEnabled: true,
		});
		expect(packet.enabled).toBe(true);
		expect(packet.hints.length).toBeGreaterThan(0);
	});

	it("disables when auto-regenerate off", () => {
		const packet = buildRegeneratePacket({
			userVerdict: "BLOCKED",
			policyFlags: [POLICY_FLAG.SECRET_SUSPECT],
			previewOnly: true,
			diffPaths: ["x"],
			attemptCount: 0,
			autoRegenerateEnabled: false,
		});
		expect(packet.enabled).toBe(false);
	});
});
