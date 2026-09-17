import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPackageDir } from "../config.ts";
import { type LoadSkillsOptions, type LoadSkillsResult, loadSkills, loadSkillsFromDir } from "./skills.ts";

const DISABLED = new Set(["0", "false", "off", "disable", "disabled"]);

/** User/project/explicit skills keep ownership of names. Bundled instructions grant no tool authority. */
export function loadSkillsWithBundled(noSkills: boolean, options: LoadSkillsOptions): LoadSkillsResult {
	const selected = loadSkills(options);
	if (noSkills || DISABLED.has((process.env.OMK_BUNDLED_SKILLS ?? "").trim().toLowerCase())) return selected;
	const dir = join(getPackageDir(), "resources", "neo", "skills");
	if (!existsSync(dir)) {
		return {
			...selected,
			diagnostics: [...selected.diagnostics, { type: "warning", path: dir, message: "Bundled Neo skills are missing from this installation; reinstall a complete package." }],
		};
	}
	const bundled = loadSkillsFromDir({ dir, source: "builtin" });
	const occupied = new Set(selected.skills.map((skill) => skill.name));
	return {
		skills: [...selected.skills, ...bundled.skills.filter((skill) => !occupied.has(skill.name))],
		diagnostics: [...selected.diagnostics, ...bundled.diagnostics],
	};
}
