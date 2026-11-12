import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { scoreSkillRelevance } from "../src/core/context-budget-relevance.ts";
import { collectSuggestionFacts } from "../src/core/next-suggestion-facts.ts";
import { buildSuggestion, renderSuggestionPrompt, suggestionSkillQuery } from "../src/core/next-suggestion-prompt.ts";
import { MIN_CLAUSE_TOKENS, scoreSkillByClauses, splitTaskClauses } from "../src/core/skill-clause-relevance.ts";
import { MAX_SELECTED_SKILLS, selectSkills } from "../src/core/skill-selector.ts";

const catalog = [
	{ name: "review-work", description: "Review work for quality, security issues and regressions before merging" },
	{
		name: "security-review",
		description: "Security review checklist for authentication, secrets and network exposure",
	},
	{ name: "frontend-ui", description: "React frontend layout, CSS and responsive UI bug fixes" },
	{ name: "python-testing", description: "pytest regression tests, fixtures and coverage for Python handlers" },
	{ name: "docker-patterns", description: "Docker compose networking, volumes and container security patterns" },
	{ name: "debugging", description: "Debug runtime crashes, hangs and failing commands by reproducing them" },
];

const multi =
	"Fix the React frontend layout bug, add pytest regression tests for the API handler, and review the Docker compose networking";

describe("capability clauses", () => {
	it("splits on sentence, list and conjunction boundaries and drops short or repeated fragments", () => {
		const clauses = splitTaskClauses(
			"Fix the parser crash. Then add unit tests\n- ok\nfix the parser crash; 그리고 문서 업데이트 링크 검사, and review docs links",
		);
		expect(clauses.map((clause) => clause.text)).toEqual([
			"Fix the parser crash",
			"add unit tests",
			"문서 업데이트 링크 검사",
			"review docs links",
		]);
		for (const clause of clauses) expect(clause.tokens.length).toBeGreaterThanOrEqual(MIN_CLAUSE_TOKENS);
	});

	it("whole score equals scoreSkillRelevance, and a counted clause equals it on the clause text", () => {
		const token = fc.stringMatching(/^[a-z][a-z0-9]{2,9}$/);
		fc.assert(
			fc.property(
				fc.array(token, { minLength: 1, maxLength: 3 }),
				fc.array(token, { maxLength: 10 }),
				fc.array(fc.array(token, { minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 4 }),
				(name, description, parts) => {
					const skill = { name: name.join("-"), description: description.join(" ") };
					const task = parts.map((part) => part.join(" ")).join(". ");
					const clauses = splitTaskClauses(task);
					const scores = scoreSkillByClauses(skill, task, clauses);
					expect(scores.whole).toBeCloseTo(scoreSkillRelevance(skill, task), 12);
					for (const [index, clause] of clauses.entries()) {
						const value = scores.clauses[index] ?? 0;
						if (value > 0) expect(value).toBeCloseTo(scoreSkillRelevance(skill, clause.text), 12);
					}
				},
			),
			{ numRuns: 300 },
		);
	});
});

describe("selectSkills with several capabilities", () => {
	it("before: whole-request coverage dilutes every specialist; after: one skill per clause", () => {
		// The whole-request score alone never reaches the strong threshold for any specialist.
		for (const skill of catalog) expect(scoreSkillRelevance(skill, multi)).toBeLessThan(0.7);
		const result = selectSkills({ task: multi, skills: catalog });
		expect(result.selected.map((skill) => skill.name).sort()).toEqual([
			"docker-patterns",
			"frontend-ui",
			"python-testing",
		]);
		expect(result.selected).toHaveLength(MAX_SELECTED_SKILLS);
		for (const skill of result.selected) expect(skill.covers).toBeDefined();
		// Exploration is wider than the grant, and every non-granted overlap names who covers it.
		expect(result.candidates.length).toBeGreaterThan(result.selected.length);
		for (const candidate of result.candidates.filter((entry) => !entry.selected && entry.redundantWith)) {
			expect(result.selected.map((skill) => skill.name)).toContain(candidate.redundantWith);
		}
		expect(new Set(result.selected.map((skill) => skill.covers)).size).toBe(result.selected.length);
	});

	it("a single-capability request keeps the single-skill path and whole-request ranking", () => {
		const result = selectSkills({ task: "debug the runtime crash", skills: catalog });
		expect(result.selected[0]?.name).toBe("debugging");
		expect(result.selected[0]?.covers).toBeUndefined();
		expect(result.scores[0]).toEqual({
			name: "debugging",
			score: scoreSkillRelevance(catalog[5]!, "debug the runtime crash"),
		});
	});

	it("no matching skill falls back to the general path with an explicit reason", () => {
		const result = selectSkills({ task: "translate this poem into French please", skills: catalog });
		expect(result).toMatchObject({ selected: [], candidates: [], confidence: "fallback" });
		expect(result.reason).toBe("no skill signals detected");
	});

	it("only offers skills that exist in the input inventory", () => {
		const result = selectSkills({ task: `${multi}. Also use the kubernetes-operator skill`, skills: catalog });
		const names = new Set(catalog.map((skill) => skill.name));
		for (const entry of [...result.selected, ...result.candidates]) expect(names.has(entry.name)).toBe(true);
	});

	it("an accepted suggestion prompt is matched by its task line, not the host checklist", () => {
		const facts = collectSuggestionFacts({
			messages: [
				{ role: "user", content: "add a retry", timestamp: 1 },
				{ role: "assistant", content: [], stopReason: "stop" },
			],
			outcome: "completed",
		});
		const prompt = renderSuggestionPrompt(
			buildSuggestion(facts, "Add pytest regression tests for the upload handler"),
		);
		const query = suggestionSkillQuery(prompt);
		expect(query?.split("\n")[0]).toBe("Add pytest regression tests for the upload handler");
		expect(selectSkills({ task: query ?? "", skills: catalog }).selected[0]?.name).toBe("python-testing");
		expect(suggestionSkillQuery("plain user text")).toBeUndefined();
	});
});
