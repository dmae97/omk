import { describe, expect, it } from "vitest";
import { selectRoute, WEAK_THRESHOLD } from "../src/core/domain-confidence.ts";
import { DOMAIN_PROFILES, FALLBACK_DOMAIN_ID } from "../src/core/domain-loadouts.ts";
import { inspectRegistry, routeDomain } from "../src/core/domain-router.ts";
import { compileDomain, scoreDomain } from "../src/core/domain-score.ts";
import { keywordMatcher, regexMatcher } from "../src/core/domain-trigger-match.ts";
import type { DomainProfile, DomainScore } from "../src/core/domain-types.ts";

const makeProfile = (triggers: DomainProfile["triggers"]): DomainProfile => ({
	schemaVersion: "omk.loadout.v1",
	id: "fixture-domain",
	name: "fixture-domain",
	label: "Fixture Domain",
	authority: "write-scoped",
	tools: { allow: [] },
	triggers,
	routingPrompt: "Fixture routing prompt used only by domain router core tests.",
});

const primaryId = (task: string, paths?: readonly string[]): string => routeDomain({ task, paths }).primary.id;

describe("domain trigger matchers", () => {
	it("keyword matcher counts repeated literal phrases and caps contributions at three", () => {
		const match = keywordMatcher("a+b");
		expect(match("a+b a+b a+b a+b")).toBe(3);
		expect(match("a+b and a-b")).toBe(1);
	});

	it("keyword matcher uses boundaries for Latin alphanumeric terms", () => {
		const match = keywordMatcher("orm");
		expect(match("analyze the query performance")).toBe(0);
		expect(match("typeorm model")).toBe(0);
		expect(match("orm query orm")).toBe(2);
	});

	it("regex matcher tests once regardless of repeated matches", () => {
		const match = regexMatcher("ui");
		expect(match("ui ui ui")).toBe(1);
	});
});

describe("domain scoring", () => {
	it("path and extension triggers contribute once even when multiple paths match", () => {
		const domain = compileDomain(
			makeProfile([
				{ kind: "extension", pattern: ".tsx", weight: 4 },
				{ kind: "path", pattern: "components/", weight: 5 },
			]),
		);

		const score = scoreDomain(domain, "", ["src/components/Button.tsx", "src/components/Card.tsx"]);

		expect(score.score).toBe(9);
		expect(score.matchedSignals).toEqual(["ext:.tsx +4", "path:components/ +5"]);
	});
});

describe("domain confidence selection", () => {
	it("falls back when the leading score is below the weak threshold", () => {
		const scores: readonly DomainScore[] = [
			{ id: "frontend-ui", label: "Frontend & UI", score: WEAK_THRESHOLD - 1, matchedSignals: [] },
		];

		const result = selectRoute(scores, DOMAIN_PROFILES, FALLBACK_DOMAIN_ID);

		expect(result.primary.id).toBe(FALLBACK_DOMAIN_ID);
		expect(result.confidence).toBe("fallback");
		expect(result.reason).toContain("threshold");
	});
});

describe("domain router facade", () => {
	it("preserves representative frontend, security, and fallback behavior", () => {
		expect(primaryId("build a responsive tailwind component", ["src/app/page.tsx"])).toBe("frontend-ui");
		expect(primaryId("scan for xss and sql injection vulnerabilities")).toBe("security-audit");
		expect(primaryId("hello there")).toBe("general");
	});

	it("inspectRegistry reports every domain", () => {
		const registry = inspectRegistry();
		expect(registry.map((entry) => entry.id)).toEqual(Object.keys(DOMAIN_PROFILES));
		for (const entry of registry) expect(entry.triggerCount).toBeGreaterThan(0);
	});
});
