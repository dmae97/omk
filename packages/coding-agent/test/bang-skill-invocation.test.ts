import { describe, expect, test } from "vitest";
import { parseBangInvocation } from "../src/core/bang-skill-invocation.ts";

const registry = {
	hasSkill: (name: string): boolean => name === "browser-feedback" || name === "git",
};

describe("parseBangInvocation", () => {
	test("routes explicit known skill invocations", () => {
		expect(parseBangInvocation("!skill:browser-feedback inspect", registry)).toEqual({
			kind: "skill",
			skillName: "browser-feedback",
			prompt: "inspect",
			activeSkillNames: ["browser-feedback"],
			source: "bang",
		});
	});

	test("routes shorthand known skill invocations", () => {
		expect(parseBangInvocation("!browser-feedback inspect", registry)).toEqual({
			kind: "skill",
			skillName: "browser-feedback",
			prompt: "inspect",
			activeSkillNames: ["browser-feedback"],
			source: "bang",
		});
	});

	test("preserves bang-space and double-bang bash", () => {
		expect(parseBangInvocation("! git status", registry)).toEqual({
			kind: "bash",
			command: "git status",
			includeContext: true,
		});
		expect(parseBangInvocation("!! git status", registry)).toEqual({
			kind: "bash",
			command: "git status",
			includeContext: false,
		});
	});

	test("lets shorthand skills win over unknown bash when a skill is loaded", () => {
		expect(parseBangInvocation("!git status", registry)).toEqual({
			kind: "skill",
			skillName: "git",
			prompt: "status",
			activeSkillNames: ["git"],
			source: "bang",
		});
	});

	test("does not run explicit unknown skills as bash", () => {
		expect(parseBangInvocation("!skill:missing inspect", registry)).toEqual({
			kind: "unknownSkill",
			skillName: "missing",
			prompt: "inspect",
			source: "bang",
		});
	});
});
