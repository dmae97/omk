/**
 * Role + domain loadout composition.
 *
 * The composer is pure and additive: it never mutates built-in role loadouts or
 * domain profiles. It can only narrow authority and active tools, while forcing
 * baseline security hooks and downgrading writable filesystem MCP access for
 * read-only authorities.
 */

import { type DomainProfile, getDomainProfile } from "./domain-loadouts.ts";
import {
	capabilityGateNames,
	downgradeMcpForAuthority,
	forceSecurityHooks,
	minAuthority,
	type StrippedCapability,
	selectSafestCommandMode,
	stripWriteSkillsForAuthority,
	stripWriteToolsForAuthority,
	unionCapabilityGateNames,
	uniqueSorted,
} from "./loadout-safety.ts";
import {
	BUILTIN_LOADOUTS,
	type CapabilityGate,
	inferLoadoutForRole,
	type LoadoutAuthority,
	type LoadoutProfile,
	type LoadoutRole,
	type ToolGate,
	validateLoadoutProfile,
} from "./loadouts.ts";

export interface SamplingProfile {
	readonly temperature?: number;
	readonly topP?: number;
	readonly topK?: number;
}

export interface ScopeHints {
	readonly readScope?: readonly string[];
	readonly writeScope?: readonly string[];
	readonly executeScope?: readonly string[];
}

export interface CompositionTrace {
	readonly roleAuthority: LoadoutAuthority;
	readonly domainAuthority: LoadoutAuthority;
	readonly grantAuthority?: LoadoutAuthority;
	readonly composedAuthority: LoadoutAuthority;
	readonly stripped: readonly StrippedCapability[];
	readonly downgraded: readonly { readonly mcp: string; readonly to: string }[];
	readonly warnings: readonly string[];
}

export interface ComposedLoadout extends LoadoutProfile {
	readonly role: LoadoutRole;
	readonly domainId: string;
	readonly domainResolvedFromFallback: boolean;
	readonly routingPrompt?: string;
	readonly samplingProfile?: SamplingProfile;
	readonly scopeHints?: ScopeHints;
	readonly composition: CompositionTrace;
}

export interface ComposeLoadoutOptions {
	readonly grantAuthority?: LoadoutAuthority;
	readonly preserveRoleAuthority?: boolean;
	readonly scopeHints?: ScopeHints;
	readonly forcedSecurityHooks?: readonly string[];
	readonly roleProfileOverride?: LoadoutProfile;
	readonly samplingProfile?: SamplingProfile;
}

export type ComposeOptions = ComposeLoadoutOptions;

interface ResolvedDomainProfile {
	readonly profile: DomainProfile;
	readonly fallback: boolean;
}

interface ComposedMcpGate {
	readonly gate: CapabilityGate;
	readonly downgraded: readonly { readonly mcp: string; readonly to: string }[];
}

export function composeLoadout(
	role: LoadoutRole,
	domain: DomainProfile | string,
	options: ComposeLoadoutOptions = {},
): ComposedLoadout {
	const roleProfile = options.roleProfileOverride ?? BUILTIN_LOADOUTS[inferLoadoutForRole(role)];
	const resolvedDomain = resolveDomainProfile(domain);
	const domainProfile = resolvedDomain.profile;
	const composedAuthority = minAuthority(roleProfile.authority, domainProfile.authority, options.grantAuthority);

	const stripped: StrippedCapability[] = [];
	const warnings: string[] = [];

	const toolGate = composeToolGate(roleProfile.tools, domainProfile.tools, composedAuthority, stripped);
	const skills = composeCapabilityGate("skill", roleProfile.skills, domainProfile.skills, composedAuthority, stripped);
	const mcp = composeMcpGate(roleProfile.mcp, domainProfile.mcp, composedAuthority);
	const hooks = composeHookGate(roleProfile.hooks, domainProfile.hooks, options.forcedSecurityHooks);
	const commands = selectSafestCommandMode(
		composedAuthority,
		roleProfile.commands?.mode,
		domainProfile.commands?.mode,
	);

	warnings.push(...selectorWarnings("role skills", roleProfile.skills));
	warnings.push(...selectorWarnings("domain skills", domainProfile.skills));
	warnings.push(...selectorWarnings("role mcp", roleProfile.mcp));
	warnings.push(...selectorWarnings("domain mcp", domainProfile.mcp));
	warnings.push(...selectorWarnings("role hooks", roleProfile.hooks));
	warnings.push(...selectorWarnings("domain hooks", domainProfile.hooks));

	const composed: ComposedLoadout = {
		schemaVersion: "omk.loadout.v1",
		name: `${roleProfile.name}+${domainProfile.id}`,
		description: `Composed ${roleProfile.name} role loadout with ${domainProfile.id} domain profile`,
		authority: composedAuthority,
		tools: toolGate,
		skills,
		mcp: mcp.gate,
		hooks,
		commands,
		role,
		domainId: domainProfile.id,
		domainResolvedFromFallback: resolvedDomain.fallback,
		routingPrompt: domainProfile.routingPrompt,
		...(options.samplingProfile ? { samplingProfile: options.samplingProfile } : {}),
		...(options.scopeHints ? { scopeHints: options.scopeHints } : {}),
		composition: {
			roleAuthority: roleProfile.authority,
			domainAuthority: domainProfile.authority,
			...(options.grantAuthority ? { grantAuthority: options.grantAuthority } : {}),
			composedAuthority,
			stripped: uniqueStripped(stripped),
			downgraded: mcp.downgraded,
			warnings: uniqueSorted(warnings),
		},
	};

	const validation = validateLoadoutProfile(composed);
	if (!validation.valid) {
		throw new Error(`composed loadout is invalid: ${validation.errors.join("; ")}`);
	}
	return composed;
}

function resolveDomainProfile(domain: DomainProfile | string): ResolvedDomainProfile {
	if (typeof domain !== "string") return { profile: domain, fallback: false };
	const profile = getDomainProfile(domain);
	return { profile, fallback: profile.id !== domain };
}

function composeToolGate(
	roleGate: ToolGate,
	domainGate: ToolGate,
	authority: LoadoutAuthority,
	stripped: StrippedCapability[],
): ToolGate {
	const roleAllow = roleGate.allow ?? [];
	const domainAllow = domainGate.allow ?? [];
	const allowed = intersectNames(roleAllow, domainAllow);
	const strippedTools = stripWriteToolsForAuthority(allowed, authority);
	stripped.push(...strippedTools.stripped);
	const require = uniqueSorted([...(roleGate.require ?? []), ...(domainGate.require ?? [])]);
	const exclude = uniqueSorted([...(roleGate.exclude ?? []), ...(domainGate.exclude ?? [])]);
	return cleanToolGate({
		allow: strippedTools.names,
		...(require.length > 0 ? { require } : {}),
		...(exclude.length > 0 ? { exclude } : {}),
	});
}

function composeCapabilityGate(
	kind: "skill",
	roleGate: CapabilityGate | undefined,
	domainGate: CapabilityGate | undefined,
	authority: LoadoutAuthority,
	stripped: StrippedCapability[],
): CapabilityGate {
	const allowNames = uniqueSorted([...capabilityGateNames(roleGate), ...capabilityGateNames(domainGate)]);
	const requireNames = uniqueSorted([
		...capabilityGateNames(roleGate, "require"),
		...capabilityGateNames(domainGate, "require"),
	]);
	const excludeNames = unionCapabilityGateNames("exclude", roleGate, domainGate);
	const strippedAllow = stripWriteSkillsForAuthority(allowNames, authority);
	const strippedRequire = stripWriteSkillsForAuthority(requireNames, authority);
	stripped.push(...strippedAllow.stripped, ...strippedRequire.stripped);
	return cleanCapabilityGate(kind, strippedAllow.names, strippedRequire.names, excludeNames);
}

function composeMcpGate(
	roleGate: CapabilityGate | undefined,
	domainGate: CapabilityGate | undefined,
	authority: LoadoutAuthority,
): ComposedMcpGate {
	const allowDowngrade = downgradeMcpForAuthority(
		uniqueSorted([...capabilityGateNames(roleGate), ...capabilityGateNames(domainGate)]),
		authority,
	);
	const requireDowngrade = downgradeMcpForAuthority(
		uniqueSorted([...capabilityGateNames(roleGate, "require"), ...capabilityGateNames(domainGate, "require")]),
		authority,
	);
	const excludeNames = unionCapabilityGateNames("exclude", roleGate, domainGate);
	return {
		gate: cleanCapabilityGate("mcp", allowDowngrade.names, requireDowngrade.names, excludeNames),
		downgraded: uniqueMcpDowngrades([...allowDowngrade.downgraded, ...requireDowngrade.downgraded]),
	};
}

function composeHookGate(
	roleGate: CapabilityGate | undefined,
	domainGate: CapabilityGate | undefined,
	forcedSecurityHooks: readonly string[] | undefined,
): CapabilityGate {
	const allowNames = forceSecurityHooks(
		uniqueSorted([...capabilityGateNames(roleGate), ...capabilityGateNames(domainGate)]),
		forcedSecurityHooks,
	);
	const requireNames = uniqueSorted([
		...capabilityGateNames(roleGate, "require"),
		...capabilityGateNames(domainGate, "require"),
	]);
	const excludeNames = unionCapabilityGateNames("exclude", roleGate, domainGate);
	return cleanCapabilityGate("hook", allowNames, requireNames, excludeNames);
}

function cleanToolGate(gate: ToolGate): ToolGate {
	return {
		allow: uniqueSorted(gate.allow ?? []),
		...(gate.require && gate.require.length > 0 ? { require: uniqueSorted(gate.require) } : {}),
		...(gate.exclude && gate.exclude.length > 0 ? { exclude: uniqueSorted(gate.exclude) } : {}),
	};
}

function cleanCapabilityGate(
	kind: "skill" | "mcp" | "hook",
	allow: readonly string[],
	require: readonly string[],
	exclude: readonly string[],
): CapabilityGate {
	return {
		allow: [{ kind, names: uniqueSorted(allow) }],
		...(require.length > 0 ? { require: [{ kind, names: uniqueSorted(require) }] } : {}),
		...(exclude.length > 0 ? { exclude: [{ kind, names: uniqueSorted(exclude) }] } : {}),
	};
}

function intersectNames(left: readonly string[], right: readonly string[]): string[] {
	const rightSet = new Set(right);
	return uniqueSorted(left.filter((value) => rightSet.has(value)));
}

function selectorWarnings(label: string, gate: CapabilityGate | undefined): string[] {
	const warnings: string[] = [];
	for (const group of ["allow", "exclude", "require"] as const) {
		for (const selector of gate?.[group] ?? []) {
			if (selector.names === undefined || selector.names.length === 0) {
				warnings.push(
					`${label}.${group} contains a non-name selector that cannot be represented by composed gates`,
				);
			}
		}
	}
	return warnings;
}

function uniqueStripped(values: readonly StrippedCapability[]): StrippedCapability[] {
	const seen = new Set<string>();
	const result: StrippedCapability[] = [];
	for (const value of values) {
		const key = `${value.kind}\0${value.name}\0${value.reason}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(value);
	}
	return result.sort((a, b) => compareString(a.kind, b.kind) || compareString(a.name, b.name));
}

function uniqueMcpDowngrades(
	values: readonly { readonly mcp: string; readonly to: string }[],
): { readonly mcp: string; readonly to: string }[] {
	const seen = new Set<string>();
	const result: { readonly mcp: string; readonly to: string }[] = [];
	for (const value of values) {
		const key = `${value.mcp}\0${value.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(value);
	}
	return result.sort((a, b) => compareString(a.mcp, b.mcp) || compareString(a.to, b.to));
}

function compareString(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}
