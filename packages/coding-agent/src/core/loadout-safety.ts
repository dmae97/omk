/**
 * Shared safety helpers for loadout composition and domain dispatch.
 *
 * This module is pure and I/O-free. It centralizes authority ordering,
 * read-only downgrades, write-capability stripping, security hook forcing, and
 * command-mode clamping so additive composition modules cannot accidentally
 * widen lane authority.
 */

import type {
	CapabilityGate,
	CommandMode,
	LoadoutAuthority,
	LoadoutCommands,
	LoadoutRole,
	ResourceKind,
} from "./loadouts.ts";

export type CapabilityGateNameKind = "tool" | "skill" | "mcp" | "hook";

export interface StrippedCapability {
	readonly kind: CapabilityGateNameKind;
	readonly name: string;
	readonly reason: string;
}

export interface StripNamesResult {
	readonly names: readonly string[];
	readonly stripped: readonly StrippedCapability[];
}

export interface McpDowngradeTrace {
	readonly mcp: string;
	readonly to: string;
}

export interface McpDowngradeResult {
	readonly names: readonly string[];
	readonly downgraded: readonly McpDowngradeTrace[];
}

export const SECURITY_HOOK_NAMES = ["pre-shell-guard", "protect-secrets", "stop-verify"] as const;
export const SECURITY_HOOKS: ReadonlySet<string> = new Set(SECURITY_HOOK_NAMES);

export const WRITE_TOOL_NAMES = ["edit", "write"] as const;
export const WRITE_TOOLS: ReadonlySet<string> = new Set(WRITE_TOOL_NAMES);

export const MCP_READONLY_DOWNGRADE: Readonly<Record<string, string>> = {
	filesystem: "filesystem-readonly",
};

export const AUTHORITY_RANK: Readonly<Record<LoadoutAuthority, number>> = {
	advisory: 0,
	"read-only": 1,
	"review-only": 1,
	"security-review": 2,
	"execute-tests": 3,
	"write-scoped": 4,
};

export const COMMAND_MODE_RANK: Readonly<Record<CommandMode, number>> = {
	none: 0,
	"read-only-shell": 1,
	"tests-only": 2,
	"scoped-shell": 3,
};

const WRITING_ROLES: ReadonlySet<LoadoutRole> = new Set([
	"coder",
	"tester",
	"security",
	"synthesizer",
	"package-maintainer",
]);

const READ_ONLY_SAFE_SKILLS: ReadonlySet<string> = new Set([
	"analyze",
	"audit-context-building",
	"best-practice-research",
	"code-review",
	"contrast-checker",
	"differential-review",
	"fp-check",
	"literature-review",
	"security-review",
	"understand-chat",
	"use-of-color",
	"verification-before-completion",
	"web-design-guidelines",
]);

const WRITE_LIKE_SKILL_FRAGMENTS = [
	"add-",
	"build",
	"clone",
	"commit",
	"create",
	"deploy",
	"edit",
	"fix",
	"frontend-ui-engineering",
	"generate",
	"implement",
	"land-and-deploy",
	"publish",
	"redesign",
	"ship",
	"tdd",
	"test-driven-development",
	"update",
	"visual-ralph",
	"write-",
] as const;

export const WRITE_SKILLS: ReadonlySet<string> = new Set(WRITE_LIKE_SKILL_FRAGMENTS);

export function authorityRank(authority: LoadoutAuthority): number {
	return AUTHORITY_RANK[authority];
}

export function minAuthority(...authorities: readonly (LoadoutAuthority | undefined)[]): LoadoutAuthority {
	const present = authorities.filter((authority): authority is LoadoutAuthority => authority !== undefined);
	if (present.length === 0) return "advisory";
	let lowest = present[0];
	for (const authority of present.slice(1)) {
		if (authorityRank(authority) < authorityRank(lowest)) lowest = authority;
	}
	return lowest;
}

export function isReadOnlyAuthority(authority: LoadoutAuthority): boolean {
	return authority === "advisory" || authority === "read-only" || authority === "review-only";
}

export function isWritingRole(role: LoadoutRole): boolean {
	return WRITING_ROLES.has(role);
}

export function stripWriteToolsForAuthority(names: readonly string[], authority: LoadoutAuthority): StripNamesResult {
	if (!isReadOnlyAuthority(authority)) return { names: uniqueSorted(names), stripped: [] };
	const stripped: StrippedCapability[] = [];
	const kept: string[] = [];
	for (const name of names) {
		if (WRITE_TOOLS.has(name)) {
			stripped.push({ kind: "tool", name, reason: "read-only authority cannot activate write tools" });
			continue;
		}
		kept.push(name);
	}
	return { names: uniqueSorted(kept), stripped };
}

export function isWriteLikeSkillName(name: string): boolean {
	const lowerName = name.toLowerCase();
	if (READ_ONLY_SAFE_SKILLS.has(lowerName)) return false;
	return WRITE_LIKE_SKILL_FRAGMENTS.some((fragment) => lowerName.includes(fragment));
}

export function stripWriteSkillsForAuthority(names: readonly string[], authority: LoadoutAuthority): StripNamesResult {
	if (!isReadOnlyAuthority(authority)) return { names: uniqueSorted(names), stripped: [] };
	const stripped: StrippedCapability[] = [];
	const kept: string[] = [];
	for (const name of names) {
		if (isWriteLikeSkillName(name)) {
			stripped.push({ kind: "skill", name, reason: "read-only authority cannot activate write-like skills" });
			continue;
		}
		kept.push(name);
	}
	return { names: uniqueSorted(kept), stripped };
}

export function stripWriteToolsForReadOnlyAuthority(names: readonly string[]): readonly string[] {
	return stripWriteToolsForAuthority(names, "read-only").names;
}

export function stripWriteSkillsForReadOnlyRole(names: readonly string[]): readonly string[] {
	return stripWriteSkillsForAuthority(names, "read-only").names;
}

export function downgradeMcpForAuthority(names: readonly string[], authority: LoadoutAuthority): McpDowngradeResult {
	if (!isReadOnlyAuthority(authority)) return { names: uniqueSorted(names), downgraded: [] };
	const downgraded: McpDowngradeTrace[] = [];
	const mapped = names.map((name) => {
		const replacement = MCP_READONLY_DOWNGRADE[name];
		if (!replacement) return name;
		downgraded.push({ mcp: name, to: replacement });
		return replacement;
	});
	return { names: uniqueSorted(mapped), downgraded: uniqueMcpDowngrades(downgraded) };
}

export function downgradeMcpForReadOnlyRole(names: readonly string[]): readonly string[] {
	return downgradeMcpForAuthority(names, "read-only").names;
}

export function forceSecurityHooks(
	names: readonly string[],
	forced: readonly string[] = SECURITY_HOOK_NAMES,
): string[] {
	return uniqueSorted([...names, ...forced]);
}

export function commandModeRank(mode: CommandMode): number {
	return COMMAND_MODE_RANK[mode];
}

export function clampCommandModeForAuthority(mode: CommandMode, authority: LoadoutAuthority): CommandMode {
	if (authority === "write-scoped") return mode;
	if (authority === "execute-tests") {
		return commandModeRank(mode) > commandModeRank("tests-only") ? "tests-only" : mode;
	}
	if (commandModeRank(mode) > commandModeRank("read-only-shell")) return "read-only-shell";
	return mode;
}

export function selectSafestCommandMode(
	authority: LoadoutAuthority,
	...modes: readonly (CommandMode | undefined)[]
): LoadoutCommands {
	const normalized = modes.map((mode) => mode ?? "none");
	let safest: CommandMode = "scoped-shell";
	for (const mode of normalized) {
		if (commandModeRank(mode) < commandModeRank(safest)) safest = mode;
	}
	return { mode: clampCommandModeForAuthority(safest, authority) };
}

export function capabilityGateNames(
	gate: CapabilityGate | undefined,
	group: "allow" | "exclude" | "require" = "allow",
): string[] {
	const selectors = gate?.[group] ?? [];
	const names: string[] = [];
	for (const selector of selectors) {
		for (const name of selector.names ?? []) names.push(name);
	}
	return uniqueSorted(names);
}

export function unionCapabilityGateNames(
	group: "allow" | "exclude" | "require",
	...gates: readonly (CapabilityGate | undefined)[]
): string[] {
	return uniqueSorted(gates.flatMap((gate) => capabilityGateNames(gate, group)));
}

export function namesToCapabilityGate(
	kind: Exclude<ResourceKind, "extension" | "prompt" | "theme" | "tool">,
	names: readonly string[],
): CapabilityGate {
	return { allow: [{ kind, names: uniqueSorted(names) }] };
}

export function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))].sort(compareString);
}

function uniqueMcpDowngrades(values: readonly McpDowngradeTrace[]): McpDowngradeTrace[] {
	const seen = new Set<string>();
	const result: McpDowngradeTrace[] = [];
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
