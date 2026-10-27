/**
 * Deterministic unit tests for the agent → capability router.
 *
 * The router is fully deterministic (no LLM, no randomness, no I/O inside the
 * router itself), so every assertion here is an exact expected value. The only
 * I/O is the one-time module-scope catalog build, which scans the live skill
 * tree under the agent directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { auditCapabilities, classifyAgent, deriveCapabilities } from "./agent-capability-router.ts";
import { buildCapabilityCatalog } from "./capabilities.ts";
import { DOMAIN_PROFILES } from "./domain-profiles.ts";

// Deterministic fixture catalog. The live agent skill tree differs per machine
// and no longer carries every pool name (for example react-patterns and seo),
// so binding these ranking assertions to it made them depend on the operator's
// checkout instead of the router logic under test.
const fixtureAgentDir = mkdtempSync(join(tmpdir(), "omk-capability-router-"));
for (const name of ["react-patterns", "vercel-react-best-practices", "seo"]) {
	const dir = join(fixtureAgentDir, "skills", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: fixture skill\n---\nbody\n`);
}
const catalog = buildCapabilityCatalog({ agentDir: fixtureAgentDir });
const hasSkillCatalog = catalog.skills.size > 0;

afterAll(() => {
	rmSync(fixtureAgentDir, { recursive: true, force: true });
});

describe("domain profile safety", () => {
	it("does not route agents to offensive jailbreak skills", () => {
		expect(DOMAIN_PROFILES.flatMap((profile) => profile.skillPool)).not.toContain("offensive-jailbreak");
	});
});

describe("classifyAgent", () => {
	it("classifies by name token: seo-specialist → marketing-content", () => {
		expect(classifyAgent("seo-specialist", "x")?.id).toBe("marketing-content");
	});

	it("classifies smart-contract-auditor → security", () => {
		expect(classifyAgent("smart-contract-auditor", "x")?.id).toBe("security");
	});

	it("classifies react-developer → frontend-web", () => {
		expect(classifyAgent("react-developer", "x")?.id).toBe("frontend-web");
	});

	it("guards the gin→engineer substring regression: ml-engineer is NOT backend-api", () => {
		// "engineer" contains "gin"; a naive first-match classifier would route
		// this to backend-api. Boundary-anchored voting must not.
		expect(classifyAgent("ml-engineer", "AI/ML")?.id).not.toBe("backend-api");
	});

	it("guards the gis→strategist substring regression: account-strategist is NOT gis-spatial", () => {
		// "strategist" contains "gis"; must not flip into the GIS domain.
		expect(classifyAgent("account-strategist", "x")?.id).not.toBe("gis-spatial");
	});

	it("returns null when no domain matches", () => {
		expect(classifyAgent("zzz-nonexistent-xyz", "nothing relevant here")).toBeNull();
	});
});

describe("deriveCapabilities", () => {
	it.skipIf(!hasSkillCatalog)(
		"weights the name token: react-developer's first derived skill is react-patterns",
		() => {
			const { skills } = deriveCapabilities("react-developer", "React frontend", catalog);
			expect(skills[0]).toBe("react-patterns");
		},
	);

	it.skipIf(!hasSkillCatalog)("includes the literal domain skill for seo-specialist", () => {
		const { skills } = deriveCapabilities("seo-specialist", "SEO", catalog);
		expect(skills).toContain("seo");
	});

	it("returns empty skills for an unmatched domain", () => {
		const { skills } = deriveCapabilities("zzz-unknown", "x", catalog);
		expect(skills.length).toBe(0);
	});

	it.skipIf(!hasSkillCatalog)("only emits skills that exist in the live catalog", () => {
		const { skills } = deriveCapabilities("react-developer", "React frontend", catalog);
		expect(skills.length).toBeGreaterThan(0);
		for (const skill of skills) {
			expect(catalog.skills.has(skill)).toBe(true);
		}
	});

	it("derived MCP is a subset of the catalog MCP set", () => {
		const { mcp } = deriveCapabilities("devops-automator", "kubernetes", catalog);
		expect(mcp.length).toBeGreaterThan(0);
		for (const server of mcp) {
			expect(catalog.mcp.has(server)).toBe(true);
		}
	});
});

describe("auditCapabilities", () => {
	it("identical sets → jaccard 1.0 and verdict match", () => {
		const caps = { skills: ["react-patterns"], mcp: [], hooks: [] };
		const result = auditCapabilities(caps, caps, catalog);
		expect(result.jaccard).toBe(1.0);
		expect(result.verdict).toBe("match");
	});

	it("disjoint sets → jaccard 0 and verdict divergent", () => {
		const declared = { skills: ["react-patterns"], mcp: [], hooks: [] };
		const derived = { skills: ["seo"], mcp: [], hooks: [] };
		const result = auditCapabilities(declared, derived, catalog);
		expect(result.jaccard).toBe(0);
		expect(result.verdict).toBe("divergent");
	});

	it("half overlap → jaccard within [0,1] and verdict drift or match", () => {
		const declared = { skills: ["react-patterns", "seo"], mcp: [], hooks: [] };
		const derived = { skills: ["react-patterns"], mcp: [], hooks: [] };
		const result = auditCapabilities(declared, derived, catalog);
		expect(result.jaccard).toBeGreaterThanOrEqual(0);
		expect(result.jaccard).toBeLessThanOrEqual(1);
		expect(["drift", "match"]).toContain(result.verdict);
	});

	it("surfaces declared-but-unknown skills in declaredUnknownSkills", () => {
		const declared = { skills: ["fake-skill-xyz"], mcp: [], hooks: [] };
		const derived = { skills: [], mcp: [], hooks: [] };
		const result = auditCapabilities(declared, derived, catalog);
		expect(result.declaredUnknownSkills).toContain("fake-skill-xyz");
	});

	it("both-empty skills → jaccard 1.0", () => {
		const empty = { skills: [], mcp: [], hooks: [] };
		const result = auditCapabilities(empty, empty, catalog);
		expect(result.jaccard).toBe(1.0);
	});
});
