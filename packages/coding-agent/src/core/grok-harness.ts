import { getDomainProfile } from "./domain-loadouts.ts";
import { GROK_OAUTH_PROVIDER } from "./grok-playbook.ts";
import {
	type HarnessSkillCandidate,
	type HarnessSkillSelectionOptions,
	selectHarnessSkills,
} from "./harness-skills.ts";
import { capabilityGateNames } from "./loadout-safety.ts";
import type { ProviderHarnessSpec } from "./provider-harness-dispatch.ts";

/** Domain loadout id applied automatically when Grok OAuth provider is active. */
export const GROK_HARNESS_DOMAIN_ID = "grok-harness";

const GROK_HARNESS_AUTO_APPLY_ENV = "OMK_GROK_HARNESS";

export const GROK_IMAGINE_MODEL_PREFIX = "grok-imagine-";

export type GrokModelRoute = "text-chat" | "imagine-tool-only";
export type GrokHarnessIntent = "code" | "debug" | "plan" | "image" | "media";

const SKILLS_BY_INTENT = {
	code: ["packages", "programming"],
	debug: ["packages", "debugging", "programming"],
	plan: ["packages", "adaptorch-route"],
	image: ["image-prompt"],
	media: ["image-prompt", "adaptorch-route"],
} as const satisfies Record<GrokHarnessIntent, readonly string[]>;

class GrokImagineModelCompletionError extends Error {
	readonly name = "GrokImagineModelCompletionError";
	readonly modelId: string;
	readonly provider: string;

	constructor(modelId: string, provider: string) {
		super(
			`Grok Imagine model "${modelId}" is tool-only on ${provider}; select a text-chat Grok model for completions.`,
		);
		this.modelId = modelId;
		this.provider = provider;
	}
}

export function isGrokImagineModelId(id: string): boolean {
	return id.startsWith(GROK_IMAGINE_MODEL_PREFIX);
}

export function classifyGrokModelRoute(modelId: string): GrokModelRoute {
	if (isGrokImagineModelId(modelId)) {
		return "imagine-tool-only";
	}
	return "text-chat";
}

export function assertTextChatModelForCompletion(modelId: string, provider?: string): void {
	if (provider === GROK_OAUTH_PROVIDER && isGrokImagineModelId(modelId)) {
		throw new GrokImagineModelCompletionError(modelId, provider);
	}
}

export function recommendedSkillTierForIntent(intent: GrokHarnessIntent): readonly string[] {
	return SKILLS_BY_INTENT[intent];
}

export type GrokHarnessSkillCandidate = HarnessSkillCandidate;
export type GrokHarnessSkillSelectionOptions = HarnessSkillSelectionOptions;

const GROK_HARNESS_ALLOWED_SKILLS: ReadonlySet<string> = new Set(
	capabilityGateNames(getDomainProfile(GROK_HARNESS_DOMAIN_ID).skills),
);

/**
 * Smallest grok-harness skill grant from the live inventory. The domain
 * profile owns the allowlist; explicit-only skills are excluded. `headroom`
 * requires lexical or measured pressure, and the result never exceeds
 * `MAX_SELECTED_SKILLS` names.
 */
export function selectGrokHarnessSkills(
	task: string,
	inventory: readonly GrokHarnessSkillCandidate[],
	options: GrokHarnessSkillSelectionOptions = {},
): readonly string[] {
	return selectHarnessSkills(GROK_HARNESS_ALLOWED_SKILLS, task, inventory, options);
}

export function isGrokOAuthProvider(provider: string | undefined): boolean {
	return provider === GROK_OAUTH_PROVIDER;
}

/** Provider-harness spec consumed by `tryProviderHarnessDispatch()`. */
export const GROK_HARNESS_SPEC: ProviderHarnessSpec = {
	domainId: GROK_HARNESS_DOMAIN_ID,
	applies: (provider, env) => grokHarnessAutoApplyEnabled(env) && isGrokOAuthProvider(provider),
	selectSkills: (task, inventory, options) => selectGrokHarnessSkills(task, inventory, { paths: options.paths }),
};

/**
 * When true (default), selecting native `xai` applies the `grok-harness` domain loadout
 * (skills/MCP/hooks/tool gate). Set `OMK_GROK_HARNESS=0` to disable.
 */
export function grokHarnessAutoApplyEnabled(
	env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	const raw = env[GROK_HARNESS_AUTO_APPLY_ENV]?.trim().toLowerCase();
	if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
		return false;
	}
	return true;
}
