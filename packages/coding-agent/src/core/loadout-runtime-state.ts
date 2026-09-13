/**
 * Loadout runtime state shape and the blocked-state constructors shared by
 * profile validation and builtin-shadow detection. Pure data; no session access.
 */

import type { CapabilityInventory, LoadoutAuthority, LoadoutProfile, SchedulerFields } from "./loadouts.ts";

export interface LoadoutRuntimeState {
	profileName: string;
	authority: LoadoutAuthority;
	activeTools: string[];
	activeSkills: string[];
	activeMcp: string[];
	activeHooks: string[];
	schedulerFields: SchedulerFields;
	blockers: string[];
	warnings: string[];
}

/** A runtime state that activates nothing because the profile could not be applied. */
export function blockedLoadoutRuntime(
	profile: Pick<LoadoutProfile, "name" | "authority">,
	blockers: string[],
): LoadoutRuntimeState {
	return {
		profileName: profile.name,
		authority: profile.authority,
		activeTools: [],
		activeSkills: [],
		activeMcp: [],
		activeHooks: [],
		schedulerFields: { readSet: [], writeSet: [], parallelizable: true },
		blockers,
		warnings: [],
	};
}

/**
 * A builtin always wins a name collision; an extension tool must never shadow
 * `bash` (mirrors the AgentSession._refreshToolRegistry check). Returns the
 * sorted, deduplicated builtin names that non-builtin inventory tools reuse.
 */
export function shadowedBuiltinTools(
	builtinNames: Iterable<string>,
	inventory: Pick<CapabilityInventory, "tools">,
): string[] {
	const builtins = new Set(builtinNames);
	const shadowed = new Set<string>();
	for (const tool of inventory.tools) {
		if (tool.source !== "builtin" && tool.source !== "sdk" && builtins.has(tool.name)) shadowed.add(tool.name);
	}
	return [...shadowed].sort(compareCodeUnits);
}

/** Same ordering as the default `Array.prototype.sort` for strings, made explicit. */
function compareCodeUnits(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}
