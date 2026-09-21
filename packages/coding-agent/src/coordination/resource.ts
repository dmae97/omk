/**
 * Resource claim identity and conflict algebra.
 *
 * Two claims conflict when they name overlapping resources and at least one
 * side writes. Overlap is prefix containment on path components, so `src`
 * covers `src/a/x` but never `src/ab` — a shared character prefix that straddles
 * a component boundary is a different resource, not a nested one.
 */

import type { ClaimAccess, ClaimNamespace, ResourceClaim } from "./types.ts";
import { sequence } from "./types.ts";

const CLAIM_NAMESPACES: ReadonlySet<string> = new Set<ClaimNamespace>([
	"filesystem",
	"git-ref",
	"contract",
	"socket",
	"database",
	"host-budget",
]);
const CLAIM_ACCESS: ReadonlySet<string> = new Set<ClaimAccess>(["read", "write"]);
const MAX_KEY_LENGTH = 4096;

export interface ResourceClaimInput {
	readonly namespace: string;
	readonly instanceId: string;
	readonly canonicalKey: string;
	readonly access: string;
	readonly generation: string;
}

/**
 * Validate and freeze one claim.
 *
 * A non-canonical key is rejected rather than normalized: normalizing
 * `a/../b` here would let one session hold `a/../b` and another hold `b`
 * while both believe their scopes are disjoint.
 */
export function canonicalClaim(input: ResourceClaimInput): ResourceClaim {
	if (!CLAIM_NAMESPACES.has(input.namespace)) {
		throw new TypeError(`unsupported claim namespace: ${String(input.namespace)}`);
	}
	if (!CLAIM_ACCESS.has(input.access)) {
		throw new TypeError(`unsupported claim access: ${String(input.access)}`);
	}
	if (
		typeof input.instanceId !== "string" ||
		input.instanceId.length === 0 ||
		input.instanceId.length > MAX_KEY_LENGTH ||
		input.instanceId.includes("\u0000")
	) {
		throw new TypeError("claim instanceId must be a non-empty string");
	}
	assertCanonicalKey(input.canonicalKey);
	return Object.freeze({
		namespace: input.namespace as ClaimNamespace,
		instanceId: input.instanceId,
		canonicalKey: input.canonicalKey,
		access: input.access as ClaimAccess,
		generation: sequence(input.generation),
	});
}

function assertCanonicalKey(key: unknown): asserts key is string {
	if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) {
		throw new TypeError("claim canonicalKey must be a bounded non-empty string");
	}
	if (key.startsWith("/")) throw new TypeError("claim canonicalKey must be relative");
	if (key.includes("\u0000") || key.includes("\\")) {
		throw new TypeError("claim canonicalKey must use slash components without NUL");
	}
	for (const part of key.split("/")) {
		if (part === "" || part === "." || part === "..") {
			throw new TypeError(`claim canonicalKey is not canonical: ${key}`);
		}
	}
}

/** Same resource identity, or one key nested under the other. Ignores access. */
export function resourcesOverlap(a: ResourceClaim, b: ResourceClaim): boolean {
	if (a.namespace !== b.namespace || a.instanceId !== b.instanceId) return false;
	if (a.canonicalKey === b.canonicalKey) return true;
	return a.canonicalKey.startsWith(`${b.canonicalKey}/`) || b.canonicalKey.startsWith(`${a.canonicalKey}/`);
}

export function claimsConflict(a: ResourceClaim, b: ResourceClaim): boolean {
	return resourcesOverlap(a, b) && (a.access === "write" || b.access === "write");
}

export function claimSetsConflict(a: readonly ResourceClaim[], b: readonly ResourceClaim[]): boolean {
	return a.some((x) => b.some((y) => claimsConflict(x, y)));
}

/** Stable key for exact-set comparison when binding a start to its reservation. */
export function claimKey(claim: ResourceClaim): string {
	return JSON.stringify([claim.namespace, claim.instanceId, claim.canonicalKey, claim.access, claim.generation]);
}

/** Exact set equality by identity+access+generation; a post-hook that widened scope fails this. */
export function sameClaimSet(a: readonly ResourceClaim[], b: readonly ResourceClaim[]): boolean {
	if (a.length !== b.length) return false;
	const byCodeUnit = (x: string, y: string): number => {
		if (x < y) return -1;
		return x > y ? 1 : 0;
	};
	const left = a.map(claimKey).sort(byCodeUnit);
	const right = b.map(claimKey).sort(byCodeUnit);
	return left.every((value, index) => value === right[index]);
}
