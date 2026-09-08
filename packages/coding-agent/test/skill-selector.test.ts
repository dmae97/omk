import { describe, expect, it } from "vitest";
import { selectGrokHarnessSkills } from "../src/core/grok-harness.ts";
import {
	MAX_SELECTED_SKILLS,
	SKILL_AMBIGUITY_MARGIN,
	SKILL_STRONG_THRESHOLD,
	SKILL_WEAK_THRESHOLD,
	type SkillSelectionResult,
	selectSkills,
} from "../src/core/skill-selector.ts";

function selectedNames(skills: SkillSelectionResult["selected"]): string[] {
	return skills.map((skill) => skill.name);
}

const catalog = [
	{
		name: "debugging",
		description: "Runtime failures, hanging process, crash, empty response, silent bugs, attach a debugger, node",
	},
	{
		name: "programming",
		description: "TypeScript Python Rust Go edit, bug fix, type-strict implementation, TDD",
	},
	{
		name: "seaborn",
		description: "Statistical visualization with pandas, box plots, violin plots, heatmaps",
	},
	{
		name: "docker-patterns",
		description: "Docker Compose, container security, networking, multi-service orchestration",
	},
	{
		name: "headroom",
		description: "Compress oversized logs, tool output, and evidence under context pressure",
	},
] as const;

const grokCatalog = [
	...catalog,
	{ name: "packages", description: "Multi-package repository context" },
	{ name: "adaptorch-route", description: "AdaptOrch DAG topology routing and parallel lanes" },
	{ name: "adaptorch-synthesize", description: "AdaptOrch evidence synthesis" },
	{ name: "understand-anything", description: "Repository graph and architecture comprehension" },
] as const;

describe("skill selector constants", () => {
	it("matches the documented lane grant cap and ranking thresholds", () => {
		expect(MAX_SELECTED_SKILLS).toBe(3);
		expect(SKILL_STRONG_THRESHOLD).toBe(0.7);
		expect(SKILL_WEAK_THRESHOLD).toBeGreaterThan(0.3);
		expect(SKILL_AMBIGUITY_MARGIN).toBeGreaterThan(0);
	});
});

describe("selectSkills", () => {
	it("falls back when the task has no skill signals", () => {
		const result = selectSkills({ task: "hello there", skills: catalog });
		expect(result.selected).toEqual([]);
		expect(result.confidence).toBe("fallback");
		expect(result.ambiguous).toBe(false);
	});

	it("falls back when the query is empty", () => {
		const result = selectSkills({ task: "   ", skills: catalog });
		expect(result.selected).toEqual([]);
		expect(result.confidence).toBe("fallback");
	});

	it("selects the most specific matching skill for a runtime failure", () => {
		const result = selectSkills({
			task: "why is this node process hanging after the crash",
			skills: catalog,
		});
		expect(result.selected[0]?.name).toBe("debugging");
		expect(result.confidence).not.toBe("fallback");
		expect(result.selected.length).toBeGreaterThan(0);
		expect(result.selected.length).toBeLessThanOrEqual(MAX_SELECTED_SKILLS);
	});

	it("prefers a name match over an unrelated description hit", () => {
		const result = selectSkills({
			task: "seaborn heatmap of the distribution",
			skills: catalog,
		});
		expect(selectedNames(result.selected)).toEqual(["seaborn"]);
		expect(result.confidence).toBe("confident");
	});

	it("caps the grant at the documented 2-3 skill maximum", () => {
		const bloated = [
			...catalog,
			{ name: "matplotlib", description: "plot visualization charts heatmap figures dashboard" },
			{ name: "plotly", description: "plot visualization charts heatmap figures dashboard" },
			{ name: "scientific-visualization", description: "plot visualization charts heatmap figures dashboard" },
		];
		const result = selectSkills({
			task: "plot visualization charts heatmap figures dashboard",
			skills: bloated,
		});
		expect(result.selected.length).toBeLessThanOrEqual(MAX_SELECTED_SKILLS);
		expect(result.selected.length).toBeGreaterThan(0);
	});

	it("breaks score ties by input order", () => {
		const twins = [
			{ name: "alpha-tool", description: "widget frobnicator" },
			{ name: "beta-tool", description: "widget frobnicator" },
		];
		const result = selectSkills({ task: "widget frobnicator", skills: twins });
		expect(selectedNames(result.selected)).toEqual(["alpha-tool", "beta-tool"]);
	});

	it("flags ambiguity when a tentative leader is within the documented margin", () => {
		const close = [
			{ name: "alpha-tool", description: "shared token alpha" },
			{ name: "beta-tool", description: "shared token beta" },
		];
		const result = selectSkills({ task: "shared token extra unmatched", skills: close });
		expect(result.confidence).toBe("tentative");
		expect(result.ambiguous).toBe(true);
		expect(selectedNames(result.selected)).toEqual(["alpha-tool", "beta-tool"]);
	});

	it("is deterministic for the same task and catalog", () => {
		const input = { task: "docker compose networking", skills: catalog };
		expect(selectSkills(input)).toEqual(selectSkills(input));
	});

	it("uses path hints as an independent signal instead of diluting them into task tokens", () => {
		const withoutPath = selectSkills({ task: "deploy the app", skills: catalog });
		const withPath = selectSkills({
			task: "deploy the app",
			paths: ["one/two/three/four/five/six/seven/eight/nine/ten/infra/docker-compose.yml"],
			skills: catalog,
		});
		expect(withoutPath.confidence).toBe("fallback");
		expect(selectedNames(withPath.selected)).toEqual(["docker-patterns"]);
		expect(withPath.confidence).not.toBe("fallback");
	});

	it("does not treat a generic path token as a description match", () => {
		const result = selectSkills({
			task: "deploy",
			paths: ["src/app/index.ts"],
			skills: [{ name: "unrelated-skill", description: "Handles app rendering" }],
		});
		expect(result.confidence).toBe("fallback");
		expect(result.selected).toEqual([]);
	});

	it("splits camelCase path segments before scoring", () => {
		const result = selectSkills({
			task: "deploy the app",
			paths: ["infra/DockerComposeConfig.yml"],
			skills: catalog,
		});
		expect(selectedNames(result.selected)).toEqual(["docker-patterns"]);
	});

	it("clamps max to the documented cap and treats non-finite values as the default", () => {
		const bloated = [
			...catalog,
			{ name: "matplotlib", description: "plot visualization charts heatmap figures dashboard" },
			{ name: "plotly", description: "plot visualization charts heatmap figures dashboard" },
			{ name: "scientific-visualization", description: "plot visualization charts heatmap figures dashboard" },
		];
		const query = { task: "plot visualization charts heatmap figures dashboard", skills: bloated };
		expect(selectSkills({ ...query, max: 99 }).selected).toHaveLength(MAX_SELECTED_SKILLS);
		expect(selectSkills({ ...query, max: 0 }).selected).toEqual([]);
		expect(selectSkills({ ...query, max: Number.NaN }).selected).toHaveLength(MAX_SELECTED_SKILLS);
		expect(selectSkills({ ...query, max: -2 }).selected).toHaveLength(MAX_SELECTED_SKILLS);
	});

	it("keeps the first of duplicate skill names", () => {
		const result = selectSkills({
			task: "seaborn heatmap",
			skills: [
				{ name: "seaborn", description: "Statistical visualization heatmaps" },
				{ name: "seaborn", description: "unrelated duplicate that must not double-count" },
			],
		});
		expect(result.scores.filter((entry) => entry.name === "seaborn")).toHaveLength(1);
		expect(result.selected[0]?.description).toBe("Statistical visualization heatmaps");
	});
});

describe("selectGrokHarnessSkills", () => {
	it("keeps a TypeScript edit inside the programming lane and under the cap", () => {
		const selected = selectGrokHarnessSkills("fix this typescript bug in the edit tool", grokCatalog);
		expect(selected).toContain("programming");
		expect(selected.length).toBeGreaterThan(0);
		expect(selected.length).toBeLessThanOrEqual(MAX_SELECTED_SKILLS);
		expect(selected).not.toContain("headroom");
	});

	it("routes a hang/crash to debugging", () => {
		const selected = selectGrokHarnessSkills("the agent is hanging and the response is empty", grokCatalog);
		expect(selected[0]).toBe("debugging");
		expect(selected.length).toBeLessThanOrEqual(MAX_SELECTED_SKILLS);
	});

	it("routes DAG routing work to adaptorch-route", () => {
		const selected = selectGrokHarnessSkills("recommend an adaptorch DAG topology for parallel lanes", grokCatalog);
		expect(selected).toContain("adaptorch-route");
		expect(selected.length).toBeLessThanOrEqual(MAX_SELECTED_SKILLS);
	});

	it("adds headroom only under lexical or measured context pressure", () => {
		const withoutPressure = selectGrokHarnessSkills("edit the python module", grokCatalog);
		const lexicalPressure = selectGrokHarnessSkills(
			"compress this oversized context window before the next edit",
			grokCatalog,
		);
		const measuredPressure = selectGrokHarnessSkills("edit the python module", grokCatalog, {
			contextPressure: true,
		});
		expect(withoutPressure).not.toContain("headroom");
		expect(lexicalPressure).toContain("headroom");
		expect(measuredPressure).toContain("headroom");
		expect(measuredPressure.length).toBeLessThanOrEqual(MAX_SELECTED_SKILLS);
	});

	it("intersects the live inventory when provided", () => {
		const selected = selectGrokHarnessSkills("fix this typescript bug", [
			{ name: "debugging", description: "Runtime failures and silent bugs" },
			{ name: "seaborn", description: "Statistical visualization" },
		]);
		expect(selected).not.toContain("programming");
		for (const name of selected) {
			expect(["debugging", "seaborn"]).toContain(name);
		}
	});

	it("returns an empty grant instead of the full allowlist when nothing matches", () => {
		expect(selectGrokHarnessSkills("hello there", grokCatalog)).toEqual([]);
	});

	it("uses path hints when the task text is otherwise silent", () => {
		const selected = selectGrokHarnessSkills("deploy the app", grokCatalog, {
			paths: ["packages/foo/bar.ts"],
		});
		expect(selected).toContain("packages");
		expect(selected.length).toBeLessThanOrEqual(MAX_SELECTED_SKILLS);
	});

	it("does not auto-select an explicit-only skill", () => {
		const selected = selectGrokHarnessSkills("compress the oversized context window", [
			{ name: "headroom", description: "Compress oversized context", disableModelInvocation: true },
		]);
		expect(selected).toEqual([]);
	});
});
