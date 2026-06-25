/**
 * Opt-in domain dispatch orchestration.
 *
 * Callers can invoke it to route an initial prompt, compose a role/domain
 * loadout, apply it to the current runtime inventory, and receive an access
 * policy suitable for existing AgentSession enforcement.
 */

import { routeDomain } from "./domain-router.ts";
import type { RegisteredTool, ToolDefinition } from "./extensions/types.ts";
import type { LoadoutAccessPolicy } from "./loadout-access-policy.ts";
import {
	type ComposeLoadoutOptions,
	type CompositionTrace,
	composeLoadout,
	type ScopeHints,
} from "./loadout-compose.ts";
import { createLoadoutPolicyFromRuntimeState, validatePolicyIntegrity } from "./loadout-policy-bridge.ts";
import { applyLoadoutToRuntime, type LoadoutRuntimeSession, type LoadoutRuntimeState } from "./loadout-runtime.ts";
import type { LoadoutAuthority, LoadoutProfile, LoadoutRole } from "./loadouts.ts";
import type { ResourceLoader } from "./resource-loader.ts";

export interface DomainDispatchInput {
	readonly role: LoadoutRole;
	readonly initialPrompt: string;
	readonly session: LoadoutRuntimeSession;
	readonly resourceLoader: ResourceLoader;
	readonly cwd: string;
	readonly agentDir: string;
	readonly grantAuthority?: LoadoutAuthority;
	readonly scopeHints?: ScopeHints;
	readonly env?: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;
	readonly roleProfileOverride?: LoadoutProfile;
	readonly blockedPaths?: readonly string[];
}

export interface DomainDispatchResult {
	readonly loadoutAccessPolicy: LoadoutAccessPolicy | undefined;
	readonly domainUsed: string | undefined;
	readonly fallback: boolean;
	readonly warnings: readonly string[];
	readonly trace: CompositionTrace | undefined;
}

export interface DomainDispatchRuntimeSessionOptions {
	readonly baseToolNames: readonly string[];
	readonly resourceLoader: ResourceLoader;
	readonly customTools?: readonly ToolDefinition[];
	readonly allowedToolNames?: readonly string[];
	readonly excludedToolNames?: readonly string[];
}

export function createDomainDispatchRuntimeSession(
	options: DomainDispatchRuntimeSessionOptions,
): LoadoutRuntimeSession {
	const allowedToolNameSet = options.allowedToolNames ? new Set(options.allowedToolNames) : undefined;
	const excludedToolNameSet = options.excludedToolNames ? new Set(options.excludedToolNames) : undefined;
	const isAllowedTool = (name: string): boolean =>
		(!allowedToolNameSet || allowedToolNameSet.has(name)) && !excludedToolNameSet?.has(name);

	const base = new Map<string, ToolDefinition>();
	for (const name of uniqueSorted(options.baseToolNames).filter(isAllowedTool)) {
		base.set(name, { name } as unknown as ToolDefinition);
	}

	const extensionToolsByName = new Map<string, RegisteredTool>();
	for (const extension of options.resourceLoader.getExtensions().extensions) {
		for (const tool of extension.tools.values()) {
			const name = tool.definition.name;
			if (isAllowedTool(name) && !extensionToolsByName.has(name)) {
				extensionToolsByName.set(name, tool);
			}
		}
	}

	return {
		_baseToolDefinitions: base,
		_extensionRunner: { getAllRegisteredTools: () => [...extensionToolsByName.values()] },
		_customTools: [...(options.customTools ?? [])].filter((tool) => isAllowedTool(tool.name)),
	};
}

export function isDomainRoutingEnabled(
	env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return env.OMK_DOMAIN_ROUTING === "1";
}

export function tryDomainDispatch(input: DomainDispatchInput): DomainDispatchResult {
	if (!isDomainRoutingEnabled(input.env)) {
		return noPolicy(false, [], undefined, undefined);
	}

	let domainUsed: string | undefined;
	let trace: CompositionTrace | undefined;
	try {
		const route = routeDomain({ task: input.initialPrompt });
		domainUsed = route.primary.id;
		const composeOptions: ComposeLoadoutOptions = {
			grantAuthority: input.grantAuthority,
			scopeHints: input.scopeHints,
			roleProfileOverride: input.roleProfileOverride,
		};
		const profile = composeLoadout(input.role, route.primary, composeOptions);
		trace = profile.composition;
		const state = applyLoadoutToRuntime(input.session, input.resourceLoader, input.cwd, input.agentDir, {
			profile,
			role: input.role,
			grantAuthority: input.grantAuthority,
			assignedReadPaths: input.scopeHints?.readScope,
			assignedWritePaths: input.scopeHints?.writeScope,
		});
		const policy = createPolicyOrThrow(state, profile.commands, input.cwd, input.blockedPaths);
		const integrity = validatePolicyIntegrity(policy, state);
		return {
			loadoutAccessPolicy: policy,
			domainUsed,
			fallback: route.confidence === "fallback",
			warnings: uniqueSorted([
				...routeWarnings(route),
				...profile.composition.warnings,
				...state.warnings,
				...integrity.warnings,
			]),
			trace,
		};
	} catch (error) {
		return noPolicy(true, [errorMessage(error)], domainUsed, trace);
	}
}

function createPolicyOrThrow(
	state: LoadoutRuntimeState,
	commands: LoadoutProfile["commands"],
	cwd: string,
	blockedPaths: readonly string[] | undefined,
): LoadoutAccessPolicy {
	return createLoadoutPolicyFromRuntimeState(state, {
		cwd,
		blockedPaths,
		commands,
	});
}

function noPolicy(
	fallback: boolean,
	warnings: readonly string[],
	domainUsed: string | undefined,
	trace: CompositionTrace | undefined,
): DomainDispatchResult {
	return {
		loadoutAccessPolicy: undefined,
		domainUsed,
		fallback,
		warnings: uniqueSorted(warnings),
		trace,
	};
}

function routeWarnings(route: ReturnType<typeof routeDomain>): string[] {
	const warnings: string[] = [];
	if (route.ambiguous) warnings.push(route.reason);
	if (route.confidence === "fallback") warnings.push(route.reason);
	return warnings;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))].sort((a, b) => {
		if (a < b) return -1;
		if (a > b) return 1;
		return 0;
	});
}
