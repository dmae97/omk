import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPackageDir } from "../config.ts";
import { type LoadSkillsOptions, type LoadSkillsResult, loadSkills, loadSkillsFromDir } from "./skills.ts";

const DISABLED = new Set(["0", "false", "off", "disable", "disabled"]);

/** User/project/explicit skills keep ownership of names. Bundled instructions grant no tool authority. */
export function loadSkillsWithBundled(noSkills: boolean, options: LoadSkillsOptions): LoadSkillsResult {
	const selected = loadSkills(options);
	if (noSkills || DISABLED.has((process.env.OMK_BUNDLED_SKILLS ?? "").trim().toLowerCase())) return selected;
	const occupied = new Set(selected.skills.map((skill) => skill.name));
	for (const [label, dir] of [
		["Neo", join(getPackageDir(), "resources", "neo", "skills")],
		["core", join(getPackageDir(), "resources", "skills")],
	]) {
		if (!existsSync(dir)) {
			selected.diagnostics.push({
				type: "warning",
				path: dir,
				message: `Bundled ${label} skills are missing from this installation; reinstall a complete package.`,
			});
			continue;
		}
		const bundled = loadSkillsFromDir({ dir, source: "builtin" });
		selected.diagnostics.push(...bundled.diagnostics);
		for (const skill of bundled.skills) {
			if (occupied.has(skill.name)) continue;
			selected.skills.push(skill);
			occupied.add(skill.name);
		}
	}
	return selected;
}
