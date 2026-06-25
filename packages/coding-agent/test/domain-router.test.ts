import { describe, expect, it } from "vitest";
import { DOMAIN_PROFILES } from "../src/core/domain-loadouts.ts";
import {
	AMBIGUITY_MARGIN,
	inspectRegistry,
	type RouteResult,
	routeDomain,
	WEAK_THRESHOLD,
} from "../src/core/domain-router.ts";

function primaryId(result: RouteResult): string {
	return result.primary.id;
}

describe("domain-router determinism", () => {
	it("is stable across repeated calls with identical input", () => {
		const a = routeDomain({ task: "build a login form with tailwind", paths: ["src/app/page.tsx"] });
		const b = routeDomain({ task: "build a login form with tailwind", paths: ["src/app/page.tsx"] });
		expect(a).toEqual(b);
	});

	it("scores every non-fallback domain and returns them best-first", () => {
		const result = routeDomain({ task: "docker deploy" });
		expect(result.scores.length).toBeGreaterThan(0);
		const scores = result.scores.map((s) => s.score);
		const sorted = [...scores].sort((x, y) => y - x);
		expect(scores).toEqual(sorted);
	});
});

describe("domain-router classification", () => {
	it("routes a Tailwind component task to frontend-ui", () => {
		const r = routeDomain({ task: "build a responsive login form with tailwind", paths: ["src/app/page.tsx"] });
		expect(primaryId(r)).toBe("frontend-ui");
		expect(r.confidence).not.toBe("fallback");
	});

	it("routes a vulnerability scan to security-audit", () => {
		const r = routeDomain({ task: "scan for xss and sql injection vulnerabilities, check for secret leaks" });
		expect(primaryId(r)).toBe("security-audit");
		expect(r.confidence).toBe("confident");
	});

	it("routes a literature review to research", () => {
		const r = routeDomain({ task: "do a literature review on RLHF alignment, cite arxiv sources" });
		expect(primaryId(r)).toBe("research");
	});

	it("routes a SwiftUI change (with .swift path) to mobile", () => {
		const r = routeDomain({ task: "refactor the navigation stack", paths: ["ios/App/Navigator.swift"] });
		expect(primaryId(r)).toBe("mobile");
		expect(r.confidence).toBe("confident");
	});

	it("routes a Dockerfile + Vercel deploy to devops-infra", () => {
		const r = routeDomain({ task: "write a dockerfile and deploy to vercel", paths: ["Dockerfile"] });
		expect(primaryId(r)).toBe("devops-infra");
		expect(r.confidence).toBe("confident");
	});

	it("routes failing playwright tests to qa-testing", () => {
		const r = routeDomain({ task: "fix the failing playwright e2e tests", paths: ["tests/login.test.ts"] });
		expect(primaryId(r)).toBe("qa-testing");
		expect(r.confidence).toBe("confident");
	});

	it("routes a postgres migration to backend-api", () => {
		const r = routeDomain({ task: "add a postgres migration for the users table", paths: ["migrations/0001.sql"] });
		expect(primaryId(r)).toBe("backend-api");
		expect(r.confidence).toBe("confident");
	});

	it("routes a notebook modeling task to data-science", () => {
		const r = routeDomain({
			task: "train a classifier on the dataset and plot results",
			paths: ["notebooks/model.ipynb"],
		});
		expect(primaryId(r)).toBe("data-science");
		expect(r.confidence).toBe("confident");
	});

	it("routes readme + changelog writing to docs-writing", () => {
		const r = routeDomain({ task: "write the readme and the changelog entry" });
		expect(primaryId(r)).toBe("docs-writing");
		expect(r.confidence).toBe("confident");
	});

	it("routes an MCP server + agent eval build to ai-agent-ops", () => {
		const r = routeDomain({ task: "build an mcp server and eval the agent harness" });
		expect(primaryId(r)).toBe("ai-agent-ops");
		expect(r.confidence).toBe("confident");
	});
});

describe("domain-router fallback and ambiguity", () => {
	it("falls back to general when no domain signals are detected", () => {
		const r = routeDomain({ task: "hello there" });
		expect(primaryId(r)).toBe("general");
		expect(r.confidence).toBe("fallback");
		expect(r.reason).toContain("signals");
	});

	it("falls back to general when the best signal is below the weak threshold", () => {
		// "fix" matches only the general domain (weight 2), which is < WEAK_THRESHOLD.
		const r = routeDomain({ task: "fix" });
		expect(primaryId(r)).toBe("general");
		expect(r.confidence).toBe("fallback");
		expect(r.reason).toContain("threshold");
	});

	it("falls back to general on empty input without throwing", () => {
		const r = routeDomain({ task: "" });
		expect(primaryId(r)).toBe("general");
		expect(r.confidence).toBe("fallback");
	});

	it("flags ambiguity when the runner-up is within the margin of a tentative leader", () => {
		// "ui" (frontend) vs "api" (backend): both weak signals, within margin.
		const r = routeDomain({ task: "improve the ui api" });
		expect(r.ambiguous).toBe(true);
		expect(r.confidence).toBe("tentative");
		// Leader still wins deterministically; runner-up recorded.
		expect(r.scores.length).toBeGreaterThanOrEqual(2);
		expect(r.scores[0].score - r.scores[1].score).toBeLessThanOrEqual(AMBIGUITY_MARGIN);
	});

	it("does not flag ambiguity when the leader is confident", () => {
		const r = routeDomain({ task: "xss vulnerability injection cve exploit" });
		expect(r.confidence).toBe("confident");
		expect(r.ambiguous).toBe(false);
	});

	it("respects WEAK_THRESHOLD boundary for tentative vs fallback", () => {
		// A single medium frontend keyword lands at exactly one tailwind hit (5).
		const r = routeDomain({ task: "tailwind" });
		if (r.scores[0] && r.scores[0].score >= WEAK_THRESHOLD) {
			expect(r.confidence).not.toBe("fallback");
		} else {
			expect(r.confidence).toBe("fallback");
		}
	});
});

describe("domain-router signals", () => {
	it("matchedSignals describe every contributing trigger for the leader", () => {
		const r = routeDomain({ task: "deploy with docker to vercel", paths: ["Dockerfile"] });
		const leader = r.scores[0];
		expect(leader.id).toBe("devops-infra");
		expect(leader.matchedSignals.length).toBeGreaterThan(0);
		for (const signal of leader.matchedSignals) expect(signal).toMatch(/\+\d+$/);
	});

	it("path hints can flip routing toward the file's domain", () => {
		// Same generic verb, but the .swift path makes it mobile.
		const r = routeDomain({ task: "refactor this", paths: ["Sources/App.swift"] });
		expect(primaryId(r)).toBe("mobile");
	});

	it("inspectRegistry reports a trigger count for every domain", () => {
		const registry = inspectRegistry();
		expect(registry.length).toBe(Object.keys(DOMAIN_PROFILES).length);
		for (const entry of registry) expect(entry.triggerCount).toBeGreaterThan(0);
	});
});
