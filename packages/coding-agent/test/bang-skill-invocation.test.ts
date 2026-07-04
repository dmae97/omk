import { describe, expect, test } from "vitest";
import { parseBangInvocation } from "../src/core/bang-skill-invocation.ts";

const registry = {
	hasSkill: (name: string): boolean =>
		[
			"browser-feedback",
			"git",
			"omk-skills",
			"omk-frontend",
			"omk-backend-data",
			"omk-loop",
			"omk-plan",
			"omk-engineering",
		].includes(name),
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

	test("routes !omk without arguments to the OMK skill index", () => {
		expect(parseBangInvocation("!omk", registry)).toEqual({
			kind: "skill",
			skillName: "omk-skills",
			prompt: "",
			activeSkillNames: ["omk-skills"],
			source: "bang",
		});
	});

	test("routes !omk explicit role aliases to OMK role hubs", () => {
		expect(parseBangInvocation("!omk frontend build dashboard", registry)).toEqual({
			kind: "skill",
			skillName: "omk-frontend",
			prompt: "build dashboard",
			activeSkillNames: ["omk-skills", "omk-frontend"],
			source: "bang",
		});
		expect(parseBangInvocation("!omk backend add api", registry)).toEqual({
			kind: "skill",
			skillName: "omk-backend-data",
			prompt: "add api",
			activeSkillNames: ["omk-skills", "omk-backend-data"],
			source: "bang",
		});
		expect(parseBangInvocation("!OMK frontend build dashboard", registry)).toEqual({
			kind: "skill",
			skillName: "omk-frontend",
			prompt: "build dashboard",
			activeSkillNames: ["omk-skills", "omk-frontend"],
			source: "bang",
		});
		expect(parseBangInvocation("!omk loop ralph", registry)).toEqual({
			kind: "skill",
			skillName: "omk-loop",
			prompt: "ralph",
			activeSkillNames: ["omk-skills", "omk-loop"],
			source: "bang",
		});
		expect(parseBangInvocation("!omk plan release", registry)).toEqual({
			kind: "skill",
			skillName: "omk-plan",
			prompt: "release",
			activeSkillNames: ["omk-skills", "omk-plan"],
			source: "bang",
		});
	});

	test("scores !omk free-form prompts when no role alias is first", () => {
		expect(parseBangInvocation("!omk make a plan for release", registry)).toEqual({
			kind: "skill",
			skillName: "omk-plan",
			prompt: "make a plan for release",
			activeSkillNames: ["omk-skills", "omk-plan"],
			source: "bang",
		});
		expect(parseBangInvocation("!omk fix this typescript bug minimally", registry)).toEqual({
			kind: "skill",
			skillName: "omk-engineering",
			prompt: "fix this typescript bug minimally",
			activeSkillNames: ["omk-skills", "omk-engineering"],
			source: "bang",
		});
	});

	test("falls back to the OMK index when a selected role hub is unavailable", () => {
		const indexOnlyRegistry = { hasSkill: (name: string): boolean => name === "omk-skills" };
		expect(parseBangInvocation("!omk frontend build dashboard", indexOnlyRegistry)).toEqual({
			kind: "skill",
			skillName: "omk-skills",
			prompt: "build dashboard",
			activeSkillNames: ["omk-skills"],
			source: "bang",
		});
	});

	test("does not run !omk as bash when OMK hubs are unavailable", () => {
		const emptyRegistry = { hasSkill: (_name: string): boolean => false };
		expect(parseBangInvocation("!omk frontend build dashboard", emptyRegistry)).toEqual({
			kind: "unknownSkill",
			skillName: "omk-frontend",
			prompt: "build dashboard",
			source: "bang",
		});
	});
});
