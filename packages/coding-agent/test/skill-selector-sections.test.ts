import { describe, expect, it } from "vitest";
import { splitTaskClauses } from "../src/core/skill-clause-relevance.ts";
import { renderSkillSectionReports, skillSectionReports } from "../src/core/skill-section-report.ts";
import { MAX_REPORTED_SECTIONS, MAX_SECTION_HEADING_CHARS } from "../src/core/skill-section-selection.ts";
import { MAX_SELECTED_SKILLS, selectSkills } from "../src/core/skill-selector.ts";
import type { Skill } from "../src/core/skills.ts";

const skills = [
	{ name: "frontend-layout", description: "React frontend layout spacing responsive CSS" },
	{ name: "frontend-motion", description: "React frontend motion animation transitions" },
	{ name: "python-testing", description: "Python pytest regression fixtures coverage" },
	{ name: "docker-compose", description: "Docker compose networking services" },
];
const shortSections =
	"## React frontend\nFix spacing\n## Python pytest\nAdd fixtures\n## Docker compose\nCheck networking";
const repeatedFrontend = [
	"## Frontend",
	"Fix React frontend layout spacing.",
	"Add React frontend motion animation.",
	"## Tests",
	"Add Python pytest regression fixtures coverage.",
	"## Deployment",
	"Fix Docker compose networking services.",
].join("\n");

describe("request-section skill selection", () => {
	it("keeps section headings with short instructions instead of dropping both", () => {
		const clauses = splitTaskClauses(shortSections);
		expect(clauses.map((clause) => clause.text)).toEqual([
			"React frontend: Fix spacing",
			"Python pytest: Add fixtures",
			"Docker compose: Check networking",
		]);
	});

	it("selects a skill for each section and reports the section it covers", () => {
		const result = selectSkills({ task: shortSections, skills });
		expect(result.selected.map((skill) => skill.name).sort()).toEqual([
			"docker-compose",
			"frontend-layout",
			"python-testing",
		]);
		expect(result.selected.map((skill) => skill.section).sort()).toEqual([
			"Docker compose",
			"Python pytest",
			"React frontend",
		]);
	});

	it("does not spend multiple grant slots on different sentences of one section", () => {
		const result = selectSkills({ task: repeatedFrontend, skills });
		expect(result.selected).toHaveLength(MAX_SELECTED_SKILLS);
		expect(result.selected.map((skill) => skill.section).sort()).toEqual(["Deployment", "Frontend", "Tests"]);
		const duplicate = result.candidates.find((skill) => skill.name === "frontend-motion");
		expect(duplicate).toMatchObject({ section: "Frontend", selected: false, redundantWith: "frontend-layout" });
	});

	it("preserves parent context in nested headings and replaces sibling context", () => {
		const clauses = splitTaskClauses("## React frontend\n### Layout\nFix spacing\n## Python pytest\nAdd fixtures");
		expect(clauses.map((clause) => clause.text)).toEqual([
			"React frontend / Layout: Fix spacing",
			"Python pytest: Add fixtures",
		]);
	});

	it("assigns a single explicit section even when its clause ties the whole request", () => {
		const result = selectSkills({ task: "## React frontend\nFix layout spacing", skills });
		expect(result.selected[0]).toMatchObject({ name: "frontend-layout", section: "React frontend" });
	});

	it("does not turn expanded skill instructions or fenced headings into request sections", () => {
		const expanded =
			'<skill name="example" location="/tmp/example/SKILL.md">\n## Docker compose\nCheck networking\n</skill>\n';
		const task = `${expanded}\`\`\`md\n## Python pytest\nAdd fixtures\n\`\`\`\n## React frontend\nFix spacing`;
		expect(splitTaskClauses(task).map((clause) => clause.text)).toEqual(["React frontend: Fix spacing"]);
	});

	it("keeps fenced headings inert until a matching closing fence", () => {
		const task =
			"````md\n```\n## Python pytest\nAdd fixtures\n````still-code\n## Docker compose\nCheck networking\n````\n## React frontend\nFix spacing";
		expect(splitTaskClauses(task).map((clause) => clause.text)).toEqual(["React frontend: Fix spacing"]);
	});

	it("does not promote bare paths or empty section bodies to capability clauses", () => {
		expect(splitTaskClauses("## React frontend\n/tmp/frontend-layout.ts\n## Python pytest\nok")).toEqual([]);
	});

	it("keeps the same short instruction distinct in different sections", () => {
		const clauses = splitTaskClauses("## React frontend\nFix spacing\n## Visual design\nFix spacing");
		expect(clauses.map((clause) => clause.section)).toEqual(["React frontend", "Visual design"]);
	});

	it("preserves Korean section labels when matching Korean skill metadata", () => {
		const result = selectSkills({
			task: "## 프론트엔드\n레이아웃 간격 수정\n## 테스트\npytest 회귀 검사 추가",
			skills: [
				{ name: "frontend-layout", description: "프론트엔드 레이아웃 간격 수정" },
				{ name: "python-testing", description: "테스트 pytest 회귀 검사 추가" },
			],
		});
		expect(result.selected.map((skill) => skill.section).sort()).toEqual(["테스트", "프론트엔드"]);
	});

	it("keeps ordinary unsectioned requests unchanged and respects the existing cap", () => {
		const result = selectSkills({ task: "fix the React frontend layout spacing", skills });
		expect(result.selected[0]?.section).toBeUndefined();
		expect(result.selected.length).toBeLessThanOrEqual(MAX_SELECTED_SKILLS);
		expect(selectSkills({ task: repeatedFrontend, skills, max: 1 }).selected).toHaveLength(1);
	});

	it("reports selected skills and uncovered reasons for each section", () => {
		const result = selectSkills({
			task: `${shortSections}\n## Weather\nPredict rainfall humidity forecasts`,
			skills,
		});
		expect(result.sections).toEqual([
			expect.objectContaining({
				section: "React frontend",
				selected: [expect.objectContaining({ name: "frontend-layout" })],
			}),
			expect.objectContaining({
				section: "Python pytest",
				selected: [expect.objectContaining({ name: "python-testing" })],
			}),
			expect.objectContaining({
				section: "Docker compose",
				selected: [expect.objectContaining({ name: "docker-compose" })],
			}),
			expect.objectContaining({ section: "Weather", selected: [], missingReason: "no_match" }),
		]);
	});

	it("distinguishes a weak match from a grant blocked by the selection cap", () => {
		const weak = selectSkills({
			task: "## Weather\nalpha beta gamma delta",
			skills: [{ name: "cloud-advice", description: "alpha beta" }],
		});
		expect(weak.sections?.[0]).toMatchObject({ missingReason: "below_strong_threshold" });
		const capped = selectSkills({ task: shortSections, skills, max: 1 });
		expect(capped.sections?.filter((section) => section.missingReason === "selection_limit")).toHaveLength(2);
	});

	it("does not call a skill assigned to another section a missing match", () => {
		const result = selectSkills({
			task: "## First\nFix React frontend layout spacing\n## Second\nFix React frontend layout spacing",
			skills: [skills[0]!],
		});
		expect(result.sections?.[1]).toMatchObject({ selected: [], missingReason: "covered_elsewhere" });
		expect(result.sections?.[1]?.candidates[0]?.name).toBe("frontend-layout");
	});

	it("reports headings without usable bodies and clauses outside the scoring bound", () => {
		const task = `${Array.from({ length: 13 }, (_, i) => `## Part ${i}\nFix React frontend layout spacing`).join("\n")}\n## Empty`;
		const result = selectSkills({ task, skills });
		expect(result.sections?.find((section) => section.section === "Part 12")).toMatchObject({
			missingReason: "not_scored",
		});
		expect(result.sections?.find((section) => section.section === "Empty")).toMatchObject({
			missingReason: "insufficient_context",
		});
	});

	it("does not add section diagnostics to ordinary prose or fenced headings", () => {
		expect(selectSkills({ task: "Fix React frontend layout spacing", skills }).sections).toBeUndefined();
		expect(selectSkills({ task: "```md\n## Python pytest\nAdd fixtures\n```", skills }).sections).toBeUndefined();
	});

	it("hands uncovered sections to installed hubs and the available specialist discovery path", () => {
		const hub: Skill = {
			name: "omk-security",
			description: "entrypoint workflow catalog",
			filePath: "/missing/omk-security/SKILL.md",
			baseDir: "/missing/omk-security",
			sourceInfo: { path: "/missing/omk-security/SKILL.md", source: "test", scope: "user", origin: "top-level" },
			disableModelInvocation: false,
		};
		const sections =
			selectSkills({ task: "## Security\nFind threats malware vulnerabilities", skills: [] }).sections ?? [];
		const reports = skillSectionReports(sections, [hub], new Map());
		expect(reports[0]?.discovery?.hub).toEqual({ name: hub.name, location: hub.filePath });
		expect(renderSkillSectionReports(reports, true)).toContain("Specialist discovery: skill_search with query=");
		expect(renderSkillSectionReports(reports, false)).not.toContain("skill_search");
		expect(skillSectionReports(sections, [], new Map())[0]?.discovery?.hub).toBeUndefined();
		expect(
			skillSectionReports(sections, [{ ...hub, disableModelInvocation: true }], new Map())[0]?.discovery?.hub,
		).toBeUndefined();
		const index = { ...hub, name: "omk-skills" };
		expect(skillSectionReports(sections, [index], new Map())[0]?.discovery?.hub?.name).toBe("omk-skills");
	});

	it("bounds discovery queries and treats list-prefixed paths as insufficient context", () => {
		const task = `## Security\n${"unmatched capability words ".repeat(100)}\n## Paths\n- /tmp/frontend-layout.ts`;
		const result = selectSkills({ task, skills: [] });
		expect(result.sections?.[0]?.query.length).toBeLessThanOrEqual(512);
		expect(result.sections?.find((section) => section.section === "Paths")).toMatchObject({
			missingReason: "insufficient_context",
		});
	});

	it("bounds the section report count and heading length independently of scoring", () => {
		const heading = "Frontend layout ".repeat(30);
		const task = Array.from({ length: 30 }, (_, i) => `## ${i} ${heading}\nFix React frontend layout spacing`).join(
			"\n",
		);
		const sections = selectSkills({ task, skills }).sections ?? [];
		expect(sections).toHaveLength(MAX_REPORTED_SECTIONS);
		for (const section of sections) expect(section.section.length).toBeLessThanOrEqual(MAX_SECTION_HEADING_CHARS);
		expect(sections[0]?.selected.map((skill) => skill.name)).toEqual(["frontend-layout"]);
	});
});
