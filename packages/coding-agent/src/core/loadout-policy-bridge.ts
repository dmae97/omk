/**
 * Bridge from runtime loadout state into the AgentSession access policy shape.
 *
 * This wrapper keeps policy creation fail-closed for blocker-bearing states and
 * exposes a lightweight integrity check for SDK/domain-dispatch integration.
 */

import type { LoadoutAccessPolicy } from "./loadout-access-policy.ts";
import { buildLoadoutAccessPolicy, type LoadoutRuntimeState } from "./loadout-runtime.ts";
import type { LoadoutCommands } from "./loadouts.ts";

export interface PolicyBridgeOptions {
	readonly cwd: string;
	readonly blockedPaths?: readonly string[];
	readonly commands?: LoadoutCommands;
	readonly additionalSecurityChecks?: boolean;
}

export interface PolicyIntegrityResult {
	readonly valid: boolean;
	readonly warnings: readonly string[];
}

export function createLoadoutPolicyFromRuntimeState(
	state: LoadoutRuntimeState,
	options: PolicyBridgeOptions,
): LoadoutAccessPolicy {
	if (state.blockers.length > 0) {
		throw new Error(`cannot create loadout access policy with blockers: ${state.blockers.join("; ")}`);
	}
	return buildLoadoutAccessPolicy(state, {
		cwd: options.cwd,
		blockedPaths: options.blockedPaths,
		commands: options.commands,
	});
}

export function validatePolicyIntegrity(
	policy: LoadoutAccessPolicy,
	state: LoadoutRuntimeState,
): PolicyIntegrityResult {
	const warnings: string[] = [];
	if (!sameStringSet(policy.activeTools, state.activeTools)) {
		warnings.push("policy active tools do not match runtime active tools");
	}
	const expectedReadRoots = countPathRoots(state.schedulerFields.readSet);
	const expectedWriteRoots = countPathRoots(state.schedulerFields.writeSet);
	if (policy.readRoots.length !== expectedReadRoots) {
		warnings.push("policy read roots do not match runtime scheduler read set");
	}
	if (policy.writeRoots.length !== expectedWriteRoots) {
		warnings.push("policy write roots do not match runtime scheduler write set");
	}
	return { valid: warnings.length === 0, warnings };
}

function countPathRoots(entries: readonly { readonly path: string; readonly symbols?: readonly string[] }[]): number {
	return entries.filter((entry) => entry.symbols === undefined || entry.symbols.length === 0).length;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
	const normalizedLeft = uniqueSorted(left);
	const normalizedRight = uniqueSorted(right);
	if (normalizedLeft.length !== normalizedRight.length) return false;
	return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort((a, b) => {
		if (a < b) return -1;
		if (a > b) return 1;
		return 0;
	});
}
