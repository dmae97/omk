/**
 * Shared provider-harness dispatch: apply one provider's domain loadout when
 * that provider is active, without requiring `OMK_DOMAIN_ROUTING=1`.
 *
 * Each provider harness (native `xai` → `grok-harness`, `devin` → `devin-harness`)
 * supplies a {@link ProviderHarnessSpec}; this module owns loadout composition,
 * runtime application, and policy bridging. The loadout runtime functions are
 * injected ({@link ProviderHarnessRuntime}) so this module stays outside the
 * `sdk.ts` ↔ `loadout-runtime.ts` import cycle and can be tested in isolation.
 */

import { getAgentDir } from "../config.ts";
import type { LoadoutAccessPolicy } from "./loadout-access-policy.ts";
import { type ComposedLoadout, composeLoadout } from "./loadout-compose.ts";
import { uniqueSorted } from "./loadout-safety.ts";
import type { LoadoutCommands, LoadoutProfile, LoadoutRole } from "./loadouts.ts";
import type { SkillCandidate } from "./skill-selector.ts";

export interface ProviderHarnessSkillSource {
	getSkills(): { readonly skills: readonly SkillCandidate[] };
}

export interface ProviderHarnessRuntimeState {
	readonly activeSkills: readonly string[];
	readonly blockers: readonly string[];
	readonly warnings: readonly string[];
}

/** Loadout runtime entry points, structurally typed so callers inject the real implementations. */
export interface ProviderHarnessRuntime<
	TSession,
	TLoader extends ProviderHarnessSkillSource,
	TState extends ProviderHarnessRuntimeState,
> {
	readonly applyLoadoutToRuntime: (
		session: TSession,
		resourceLoader: TLoader,
		cwd: string,
		agentDir: string,
		request: { readonly profile: LoadoutProfile; readonly role: LoadoutRole },
	) => TState;
	readonly createLoadoutPolicyFromRuntimeState: (
		state: TState,
		options: { readonly cwd: string; readonly commands?: LoadoutCommands },
	) => LoadoutAccessPolicy;
}

export interface ProviderHarnessDispatchInput<TSession, TLoader extends ProviderHarnessSkillSource> {
	readonly provider: string | undefined;
	readonly session: TSession;
	readonly resourceLoader: TLoader;
	readonly cwd: string;
	readonly agentDir?: string;
	readonly env?: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;
	/** When set, narrow the harness skill grant to the documented 2–3 subset. */
	readonly task?: string;
	/** Optional path hints scored with the task text. */
	readonly paths?: readonly string[];
}

export interface ProviderHarnessDispatchResult<TState extends ProviderHarnessRuntimeState> {
	readonly loadoutAccessPolicy: LoadoutAccessPolicy | undefined;
	readonly warnings: readonly string[];
	readonly runtimeState: TState | undefined;
}

export interface ProviderHarnessSpec {
	/** Domain loadout id registered in `domain-loadouts.ts`. */
	readonly domainId: string;
	/** True when `provider` is the harness's provider and its auto-apply flag is on. */
	readonly applies: (
		provider: string | undefined,
		env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
	) => boolean;
	/** Smallest skill grant for the task from the live inventory. */
	readonly selectSkills: (
		task: string,
		inventory: readonly SkillCandidate[],
		options: { readonly paths?: readonly string[] },
	) => readonly string[];
}

export function tryProviderHarnessDispatch<
	TSession,
	TLoader extends ProviderHarnessSkillSource,
	TState extends ProviderHarnessRuntimeState,
>(
	spec: ProviderHarnessSpec,
	runtime: ProviderHarnessRuntime<TSession, TLoader, TState>,
	input: ProviderHarnessDispatchInput<TSession, TLoader>,
): ProviderHarnessDispatchResult<TState> {
	const env = input.env ?? process.env;
	if (!spec.applies(input.provider, env)) {
		return { loadoutAccessPolicy: undefined, warnings: [], runtimeState: undefined };
	}

	const agentDir = input.agentDir ?? getAgentDir();
	try {
		const profile = composeProviderHarnessProfile(spec, input);
		const state = runtime.applyLoadoutToRuntime(input.session, input.resourceLoader, input.cwd, agentDir, {
			profile,
			role: "coder",
		});
		if (state.blockers.length > 0) {
			return { loadoutAccessPolicy: undefined, warnings: state.blockers, runtimeState: state };
		}
		const policy = runtime.createLoadoutPolicyFromRuntimeState(state, {
			cwd: input.cwd,
			commands: profile.commands,
		});
		return {
			loadoutAccessPolicy: policy,
			warnings: uniqueSorted([
				...state.warnings,
				...(input.task?.trim() && state.activeSkills.length === 0 ? [`no ${spec.domainId} skill signals`] : []),
			]),
			runtimeState: state,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { loadoutAccessPolicy: undefined, warnings: [message], runtimeState: undefined };
	}
}

function composeProviderHarnessProfile(
	spec: ProviderHarnessSpec,
	input: ProviderHarnessDispatchInput<unknown, ProviderHarnessSkillSource>,
): ComposedLoadout {
	const profile = composeLoadout("coder", spec.domainId);
	const task = input.task?.trim();
	if (!task) {
		return { ...profile, skills: { allow: [{ kind: "skill", names: [] }] } };
	}

	const inventory = input.resourceLoader.getSkills().skills;
	const selected = spec.selectSkills(task, inventory, { paths: input.paths });
	return {
		...profile,
		skills: { allow: [{ kind: "skill", names: [...selected] }] },
	};
}
