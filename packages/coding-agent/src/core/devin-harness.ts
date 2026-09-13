/**
 * Devin SWE-2 harness: provider identity, auto-apply flag, per-turn skill
 * grants, and the optional `~/.omk/agent/devin.md` operator overlay.
 *
 * The canonical operator contract is `docs/devin-harness.md`; the domain
 * loadout is `devin-harness` in `domain-loadouts.ts`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";
import { getDomainProfile } from "./domain-loadouts.ts";
import {
	type HarnessSkillCandidate,
	type HarnessSkillSelectionOptions,
	selectHarnessSkills,
} from "./harness-skills.ts";
import { capabilityGateNames } from "./loadout-safety.ts";
import type { ProviderHarnessSpec } from "./provider-harness-dispatch.ts";

/** Built-in provider id for the Devin CLI subscription adapter. */
export const DEVIN_PROVIDER = "devin";

/** The only logical model the Devin adapter serves. */
export const DEVIN_SWE2_MODEL_ID = "swe-2";

/** Local context budget bundled with `devin/swe-2`; mirrors `DEVIN_LONG_CONTEXT_TOKENS` in omk-ai. */
export const DEVIN_SWE2_CONTEXT_WINDOW = 1_000_000;

/** Domain loadout id applied automatically when the Devin provider is active. */
export const DEVIN_HARNESS_DOMAIN_ID = "devin-harness";

const DEVIN_HARNESS_AUTO_APPLY_ENV = "OMK_DEVIN_HARNESS";

/** Optional host-specific operator overlay appended to the system prompt on Devin sessions. */
export const DEVIN_PLAYBOOK_FILENAME = "devin.md";

/** Cap live system-prompt append size to reduce threshold autocompaction churn. */
export const DEVIN_PLAYBOOK_MAX_APPEND_CHARS = 24_000;

/** SWE-2 efforts the adapter accepts; every other thinking level is rejected before credentials are sent. */
export const DEVIN_SWE2_EFFORTS = ["medium", "high", "max"] as const;
export type DevinSwe2Effort = (typeof DEVIN_SWE2_EFFORTS)[number];

export type DevinHarnessIntent = "code" | "debug" | "test" | "repo";

const SKILLS_BY_INTENT = {
	code: ["packages", "programming"],
	debug: ["packages", "debugging", "programming"],
	test: ["tdd-workflow", "programming"],
	repo: ["understand-anything", "packages"],
} as const satisfies Record<DevinHarnessIntent, readonly string[]>;

export type DevinHarnessSkillCandidate = HarnessSkillCandidate;
export type DevinHarnessSkillSelectionOptions = HarnessSkillSelectionOptions;

const DEVIN_HARNESS_ALLOWED_SKILLS: ReadonlySet<string> = new Set(
	capabilityGateNames(getDomainProfile(DEVIN_HARNESS_DOMAIN_ID).skills),
);

export function isDevinProvider(provider: string | undefined): boolean {
	return provider === DEVIN_PROVIDER;
}

export function isDevinSwe2Effort(level: string | undefined): level is DevinSwe2Effort {
	return (DEVIN_SWE2_EFFORTS as readonly string[]).includes(level ?? "");
}

/**
 * Recommended effort for a task class. SWE-2 medium acts sooner on simple and
 * intermediate work; high and max plan and verify more on complex work.
 */
export function recommendedDevinEffortForIntent(intent: DevinHarnessIntent): DevinSwe2Effort {
	switch (intent) {
		case "code":
			return "medium";
		case "test":
			return "high";
		case "debug":
		case "repo":
			return "max";
	}
}

export function recommendedDevinSkillTierForIntent(intent: DevinHarnessIntent): readonly string[] {
	return SKILLS_BY_INTENT[intent];
}

/**
 * Smallest devin-harness skill grant from the live inventory. The domain
 * profile owns the allowlist; explicit-only skills are excluded. `headroom`
 * requires lexical or measured pressure, and the result never exceeds
 * `MAX_SELECTED_SKILLS` names.
 */
export function selectDevinHarnessSkills(
	task: string,
	inventory: readonly DevinHarnessSkillCandidate[],
	options: DevinHarnessSkillSelectionOptions = {},
): readonly string[] {
	return selectHarnessSkills(DEVIN_HARNESS_ALLOWED_SKILLS, task, inventory, options);
}

/**
 * When true (default), selecting the `devin` provider applies the `devin-harness`
 * domain loadout (skills/MCP/hooks/tool gate). Set `OMK_DEVIN_HARNESS=0` to disable.
 */
export function devinHarnessAutoApplyEnabled(
	env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	const raw = env[DEVIN_HARNESS_AUTO_APPLY_ENV]?.trim().toLowerCase();
	if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
		return false;
	}
	return true;
}

/** Provider-harness spec consumed by `tryProviderHarnessDispatch()`. */
export const DEVIN_HARNESS_SPEC: ProviderHarnessSpec = {
	domainId: DEVIN_HARNESS_DOMAIN_ID,
	applies: (provider, env) => devinHarnessAutoApplyEnabled(env) && isDevinProvider(provider),
	selectSkills: (task, inventory, options) => selectDevinHarnessSkills(task, inventory, { paths: options.paths }),
};

/** Read ~/.omk/agent/devin.md for appending to the system prompt on Devin sessions. */
export function loadDevinPlaybookAppend(): string | undefined {
	const path = join(getAgentDir(), DEVIN_PLAYBOOK_FILENAME);
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		let text = readFileSync(path, "utf-8").trim();
		if (text.length === 0) {
			return undefined;
		}
		if (text.length > DEVIN_PLAYBOOK_MAX_APPEND_CHARS) {
			text = `${text.slice(0, DEVIN_PLAYBOOK_MAX_APPEND_CHARS)}\n\n[... devin.md truncated for system prompt; full file: ${path}]`;
		}
		return text;
	} catch {
		return undefined;
	}
}

export function devinPlaybookAppendForProvider(provider: string | undefined): string | undefined {
	if (!isDevinProvider(provider)) {
		return undefined;
	}
	return loadDevinPlaybookAppend();
}
