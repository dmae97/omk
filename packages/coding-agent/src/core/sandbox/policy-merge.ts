import { isInsideSandboxPath, matchesSandboxPath, normalizeSandboxPath } from "./policy-paths.ts";
import type { NetworkMode, SandboxMode, SandboxPolicy } from "./policy-types.ts";

/** Untrusted overrides can only narrow; allowBroaden is a caller-owned, explicit policy decision. */
export function mergeSandboxPolicy(
	base: SandboxPolicy,
	override: Partial<SandboxPolicy>,
	options: { allowBroaden?: boolean } = {},
): SandboxPolicy {
	const allowBroaden = options.allowBroaden === true;
	const modes: Record<SandboxMode, number> = { off: 0, audit: 1, enforce: 2 };
	const requestedMode = override.mode ?? base.mode;
	const root = override.filesystem?.root ?? base.filesystem.root;
	return {
		mode: allowBroaden || modes[requestedMode] >= modes[base.mode] ? requestedMode : base.mode,
		profile: override.profile ?? base.profile,
		filesystem: {
			root: allowBroaden || isInsideSandboxPath(base.filesystem.root, root) ? root : base.filesystem.root,
			readAllow: allowBroaden
				? (override.filesystem?.readAllow ?? base.filesystem.readAllow)
				: intersectOrBase(base.filesystem.readAllow, override.filesystem?.readAllow),
			readDeny: union(base.filesystem.readDeny, override.filesystem?.readDeny),
			writeAllow: allowBroaden
				? (override.filesystem?.writeAllow ?? base.filesystem.writeAllow)
				: intersectOrBase(base.filesystem.writeAllow, override.filesystem?.writeAllow),
			denyWrite: union(base.filesystem.denyWrite, override.filesystem?.denyWrite),
			tempWrite: allowBroaden
				? (override.filesystem?.tempWrite ?? base.filesystem.tempWrite)
				: intersectOrBase(base.filesystem.tempWrite, override.filesystem?.tempWrite),
			followSymlinks: false,
		},
		network: {
			mode: allowBroaden
				? (override.network?.mode ?? base.network.mode)
				: narrowNetworkMode(base.network.mode, override.network?.mode),
			allowedDomains: allowBroaden
				? (override.network?.allowedDomains ?? base.network.allowedDomains)
				: intersectOrBase(base.network.allowedDomains, override.network?.allowedDomains),
			deniedDomains: union(base.network.deniedDomains, override.network?.deniedDomains),
			allowUnixSockets: allowBroaden
				? (override.network?.allowUnixSockets ?? base.network.allowUnixSockets)
				: intersectOrBase(base.network.allowUnixSockets, override.network?.allowUnixSockets),
			allowBrowser: false,
		},
		process: {
			allowExec: allowBroaden
				? (override.process?.allowExec ?? base.process.allowExec)
				: base.process.allowExec && (override.process?.allowExec ?? true),
			allowShell: allowBroaden
				? (override.process?.allowShell ?? base.process.allowShell)
				: base.process.allowShell && (override.process?.allowShell ?? true),
			allowPrivilege: false,
		},
	};
}

function union(base: readonly string[], override: readonly string[] | undefined): string[] {
	return [...new Set([...base, ...(override ?? [])])];
}

function intersectOrBase(base: readonly string[], override: readonly string[] | undefined): string[] {
	if (override === undefined) return [...base];
	const result: string[] = [];
	for (const candidate of override) {
		for (const entry of base) {
			if (normalizeSandboxPath(candidate) === normalizeSandboxPath(entry) || matchesSandboxPath(entry, candidate)) {
				result.push(candidate);
			} else if (matchesSandboxPath(candidate, entry)) result.push(entry);
		}
	}
	return [...new Set(result)];
}

function narrowNetworkMode(base: NetworkMode, override: NetworkMode | undefined): NetworkMode {
	if (override === undefined) return base;
	const rank: Record<NetworkMode, number> = { none: 0, loopback: 1, "domain-allowlist": 2, "all-explicit": 3 };
	return rank[override] <= rank[base] ? override : base;
}
