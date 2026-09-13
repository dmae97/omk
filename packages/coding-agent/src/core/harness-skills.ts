/**
 * Shared skill-grant selection for provider harnesses (Grok, Devin SWE-2).
 * The domain profile owns the allowlist; this module applies the common
 * exclusions and the `headroom` pressure rule on top of `selectSkills()`.
 */

import { MAX_SELECTED_SKILLS, type SkillCandidate, selectSkills } from "./skill-selector.ts";

export interface HarnessSkillCandidate extends SkillCandidate {
	readonly disableModelInvocation?: boolean;
}

export interface HarnessSkillSelectionOptions {
	readonly paths?: readonly string[];
	readonly contextPressure?: boolean;
}

const HEADROOM_SKILL = "headroom";
const HEADROOM_PRESSURE_RE = /headroom|oversized|context window|context pressure|token budget|\bcompress\b/i;

/**
 * Smallest harness skill grant from the live inventory. Explicit-only skills
 * are excluded; `headroom` requires lexical or measured pressure; the result
 * never exceeds {@link MAX_SELECTED_SKILLS} names.
 */
export function selectHarnessSkills(
	allowed: ReadonlySet<string>,
	task: string,
	inventory: readonly HarnessSkillCandidate[],
	options: HarnessSkillSelectionOptions = {},
): readonly string[] {
	const pressure = options.contextPressure === true || HEADROOM_PRESSURE_RE.test(task);
	const skills = inventory.filter((skill) => {
		if (!allowed.has(skill.name)) return false;
		if (skill.disableModelInvocation) return false;
		if (skill.name === HEADROOM_SKILL && !pressure) return false;
		return true;
	});
	const selected = selectSkills({
		task,
		skills,
		paths: options.paths,
		max: MAX_SELECTED_SKILLS,
	}).selected.map((skill) => skill.name);
	const headroom = pressure ? skills.find((skill) => skill.name === HEADROOM_SKILL) : undefined;
	if (!headroom || selected.includes(headroom.name)) return selected;
	return [...selected.slice(0, MAX_SELECTED_SKILLS - 1), headroom.name];
}
