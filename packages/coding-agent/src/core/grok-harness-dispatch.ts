/**
 * Apply the `grok-harness` domain loadout when the active provider is Grok OAuth.
 * Does not require `OMK_DOMAIN_ROUTING=1`.
 */

import { getAgentDir } from "../config.ts";
import { GROK_HARNESS_DOMAIN_ID, grokHarnessAutoApplyEnabled, isGrokOAuthProvider } from "./grok-harness.ts";
import type { LoadoutAccessPolicy } from "./loadout-access-policy.ts";
import { composeLoadout } from "./loadout-compose.ts";
import { createLoadoutPolicyFromRuntimeState } from "./loadout-policy-bridge.ts";
import { applyLoadoutToRuntime, type LoadoutRuntimeSession, type LoadoutRuntimeState } from "./loadout-runtime.ts";
import type { ResourceLoader } from "./resource-loader.ts";

export interface GrokHarnessDispatchInput {
	readonly provider: string | undefined;
	readonly session: LoadoutRuntimeSession;
	readonly resourceLoader: ResourceLoader;
	readonly cwd: string;
	readonly agentDir?: string;
	readonly env?: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;
}

export interface GrokHarnessDispatchResult {
	readonly loadoutAccessPolicy: LoadoutAccessPolicy | undefined;
	readonly warnings: readonly string[];
	readonly runtimeState: LoadoutRuntimeState | undefined;
}

export function tryGrokHarnessDispatch(input: GrokHarnessDispatchInput): GrokHarnessDispatchResult {
	const env = input.env ?? process.env;
	if (!grokHarnessAutoApplyEnabled(env) || !isGrokOAuthProvider(input.provider)) {
		return { loadoutAccessPolicy: undefined, warnings: [], runtimeState: undefined };
	}

	const agentDir = input.agentDir ?? getAgentDir();
	try {
		const profile = composeLoadout("coder", GROK_HARNESS_DOMAIN_ID);
		const state = applyLoadoutToRuntime(input.session, input.resourceLoader, input.cwd, agentDir, {
			profile,
			role: "coder",
		});
		if (state.blockers.length > 0) {
			return {
				loadoutAccessPolicy: undefined,
				warnings: state.blockers,
				runtimeState: state,
			};
		}
		const policy = createLoadoutPolicyFromRuntimeState(state, {
			cwd: input.cwd,
			commands: profile.commands,
		});
		return {
			loadoutAccessPolicy: policy,
			warnings: state.warnings,
			runtimeState: state,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { loadoutAccessPolicy: undefined, warnings: [message], runtimeState: undefined };
	}
}
