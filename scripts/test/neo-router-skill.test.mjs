import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadSkillsFromDir } from "../../packages/coding-agent/src/core/skills.ts";

const checkoutRoot = fileURLToPath(new URL("../..", import.meta.url));
const skillPath = join(checkoutRoot, ".omk/skills/omk-neo/SKILL.md");
const BUNDLE_SKILLS = ["omk-browser", "omk-code-review", "omk-computeruse", "omk-mcp-setup", "omk-research", "omk-site"];

test("omk-neo routes every Neo workflow by loadable name, not by relative file path", () => {
	const text = readFileSync(skillPath, "utf8");
	assert.match(text, /^---\nname: omk-neo\ndescription: .+\n---\n/s);
	assert.ok(!text.includes("../omk-"), "relative sibling paths break outside the bundle");
	for (const skill of BUNDLE_SKILLS) {
		assert.ok(text.includes(`\`${skill}\``), `routing row for ${skill}`);
		assert.ok(existsSync(join(checkoutRoot, "packages/coding-agent/resources/neo/skills", skill, "SKILL.md")), `${skill} must exist in the bundle`);
	}
});

test("loader discovers omk-neo from the project skill directory with clean diagnostics", () => {
	const result = loadSkillsFromDir({ dir: join(checkoutRoot, ".omk/skills/omk-neo"), source: "project" });
	assert.deepEqual(result.skills.map((skill) => skill.name), ["omk-neo"]);
	const own = result.diagnostics.filter((diagnostic) => diagnostic.path?.includes("omk-neo"));
	assert.deepEqual(own, []);
});
