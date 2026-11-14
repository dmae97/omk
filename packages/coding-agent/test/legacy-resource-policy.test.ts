import { describe, expect, it } from "vitest";
import { hasLegacyPathSegment, isLegacyAutoSkillResource } from "../src/core/legacy-resource-policy.ts";

describe("hasLegacyPathSegment", () => {
	it("matches a .legacy. substring inside one segment", () => {
		expect(hasLegacyPathSegment("a/b.legacy.x/c")).toBe(true);
		expect(hasLegacyPathSegment("a\\b.legacy.\\c")).toBe(true);
		expect(hasLegacyPathSegment("x.legacy.md")).toBe(true);
	});

	it("rejects a bare legacy segment without dots", () => {
		expect(hasLegacyPathSegment("a/legacy/c")).toBe(false);
	});
});

describe("isLegacyAutoSkillResource", () => {
	const legacyResource = {
		path: "skills/x.legacy.y/skill.md",
		metadata: { source: "auto", scope: "project", origin: "top-level" },
	} as const;

	it("is true when source, origin and path all qualify", () => {
		expect(isLegacyAutoSkillResource(legacyResource)).toBe(true);
	});

	it("is false when the source is not auto", () => {
		expect(
			isLegacyAutoSkillResource({
				...legacyResource,
				metadata: { ...legacyResource.metadata, source: "manual" },
			}),
		).toBe(false);
	});

	it("is false when the origin is not top-level", () => {
		expect(
			isLegacyAutoSkillResource({
				...legacyResource,
				metadata: { ...legacyResource.metadata, origin: "package" },
			}),
		).toBe(false);
	});

	it("is false when the path has no legacy segment", () => {
		expect(
			isLegacyAutoSkillResource({
				...legacyResource,
				path: "skills/plain/skill.md",
			}),
		).toBe(false);
	});
});
