/**
 * Agents (standard) Provider
 *
 * Loads user-level skills from ~/.agents/skills.
 */
import * as path from "node:path";
import { registerProvider } from "../capability";
import { type Skill, skillCapability } from "../capability/skill";
import type { LoadContext, LoadResult } from "../capability/types";
import { loadSkillsFromDir } from "./helpers";

const PROVIDER_ID = "agents";
const DISPLAY_NAME = "Agents (standard)";
const PRIORITY = 70;

async function loadSkills(ctx: LoadContext): Promise<LoadResult<Skill>> {
	const userSkillsDir = path.join(ctx.home, ".agents", "skills");
	const result = await loadSkillsFromDir(ctx, {
		dir: userSkillsDir,
		providerId: PROVIDER_ID,
		level: "user",
	});

	return {
		items: result.items,
		warnings: result.warnings ?? [],
	};
}

registerProvider<Skill>(skillCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load skills from ~/.agents/skills",
	priority: PRIORITY,
	load: loadSkills,
});
