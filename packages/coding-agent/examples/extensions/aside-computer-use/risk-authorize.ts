/**
 * Risk authorizer — turns a (action, risk band, policy) triple into an
 * allow / approve / deny decision. This is the core safety gate.
 *
 * Policy (always enforced, in this order, first match wins):
 *   1. Denied actions → DENY (cannot be overridden by mode or allowlist).
 *   2. Mutating unresolved/non-http/foreign origin → DENY.
 *   3. R0 respects allowReadAnyOrigin: foreign reads deny unless explicitly enabled.
 *   4. R3 → DENY unless an exact unexpired privilege matches; then APPROVE.
 *   5. R2 → APPROVE (human confirmation required before execution).
 *   6. R1 → ALLOW only on allowed origin and within policy gates.
 *
 * Pure module — no I/O.
 */

import type { PrivilegedR3ActionGrant } from "./policy.ts";
import type { Authorization, BrowserAction, RiskLevel } from "./types.ts";
import { originMatches, resolveOrigin } from "./url-origin.ts";

/** Public policy surface consumed by the authorizer (subset of AsidePolicy). */
export interface AuthorizerPolicy {
	readonly deniedActions: readonly string[];
	readonly approvalRequiredActions?: readonly string[];
	/** Compatibility surface. Only known critical action/tool exact matches are honored. */
	readonly privilegedR3Actions: readonly string[];
	readonly privilegedR3ActionGrants?: readonly PrivilegedR3ActionGrant[];
	readonly allowedOrigins: readonly string[];
	readonly allowReadAnyOrigin: boolean;
}

const LEGACY_PRIVILEGEABLE_R3_ACTIONS = new Set([
	"delete",
	"payment",
	"pay",
	"account_deletion",
	"credential_export",
	"security_setting_change",
]);

function normalizeName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
}

function normalizeTarget(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[_\-.]+/g, " ")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function actionCandidates(action: BrowserAction): readonly string[] {
	return [action.kind, action.asideTool].filter((value): value is string => typeof value === "string");
}

function actionDenied(action: BrowserAction, denied: readonly string[]): boolean {
	const set = new Set(denied.map(normalizeName));
	return actionCandidates(action).some((candidate) => set.has(normalizeName(candidate)));
}

function actionRequiresApproval(action: BrowserAction, approvalRequired: readonly string[]): boolean {
	const set = new Set(approvalRequired.map(normalizeName));
	return actionCandidates(action).some((candidate) => set.has(normalizeName(candidate)));
}

function legacyPrivileged(action: BrowserAction, allow: readonly string[]): boolean {
	const set = new Set(allow.map(normalizeName));
	return actionCandidates(action).some((candidate) => {
		const normalized = normalizeName(candidate);
		return LEGACY_PRIVILEGEABLE_R3_ACTIONS.has(normalized) && set.has(normalized);
	});
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function targetValues(action: BrowserAction): readonly string[] {
	const values: string[] = [];
	if (action.description.trim()) values.push(action.description);
	const args = action.asideArgs;
	if (!args) return values.map(normalizeTarget);
	for (const key of ["selector", "label", "ariaLabel", "accessibleName", "name", "text", "target", "locator"]) {
		const value = stringValue(args[key]);
		if (value) values.push(value);
	}
	return values.map(normalizeTarget);
}

function grantExpired(expiresAt: string): boolean {
	const timestamp = Date.parse(expiresAt);
	return Number.isNaN(timestamp) || timestamp <= Date.now();
}

function grantKindNeedsTarget(kind: string): boolean {
	const normalized = normalizeName(kind);
	return normalized === "click" || normalized === "submit";
}

function structuredGrantMatches(
	action: BrowserAction,
	targetOrigin: string | undefined,
	grant: PrivilegedR3ActionGrant,
): boolean {
	if (!targetOrigin) return false;
	if (normalizeName(grant.kind) !== normalizeName(action.kind)) return false;
	if (grant.asideTool && normalizeName(grant.asideTool) !== normalizeName(action.asideTool ?? "")) return false;
	if (grantExpired(grant.expiresAt)) return false;
	if (!originMatches(targetOrigin, [grant.origin])) return false;
	const expectedTarget = grant.selectorOrLabel ? normalizeTarget(grant.selectorOrLabel) : undefined;
	if (!expectedTarget) return !grantKindNeedsTarget(grant.kind);
	return targetValues(action).some((value) => value === expectedTarget);
}

function structuredPrivileged(
	action: BrowserAction,
	targetOrigin: string | undefined,
	grants: readonly PrivilegedR3ActionGrant[] | undefined,
): boolean {
	if (!grants) return false;
	return grants.some((grant) => structuredGrantMatches(action, targetOrigin, grant));
}

/**
 * Decide how the controller should handle an action.
 *
 * @example
 * authorize(action, "R0", policy).decision  // "allow"
 * authorize(submitAction, "R2", policy).decision // "approve"
 */
export function authorize(action: BrowserAction, risk: RiskLevel, policy: AuthorizerPolicy): Authorization {
	const targetOrigin = resolveOrigin(action.url ?? "");

	// 1. Denied actions are absolute.
	if (actionDenied(action, policy.deniedActions)) {
		return { decision: "deny", reason: "action is on the denied list", risk, targetOrigin };
	}

	const originAllowed = originMatches(targetOrigin, policy.allowedOrigins);
	const mutating = risk === "R1" || risk === "R2" || risk === "R3";

	// 2. Mutating actions must have a resolved http(s) origin in the allowlist.
	if (mutating && !originAllowed) {
		return {
			decision: "deny",
			reason: `target origin not in allowedOrigins: ${targetOrigin ?? "(none)"}`,
			risk,
			targetOrigin,
		};
	}

	// 3. R0 read-only observation follows allowReadAnyOrigin exactly.
	if (risk === "R0") {
		if (policy.allowReadAnyOrigin) {
			return {
				decision: "allow",
				reason: "R0 read-only observation with any-origin reads enabled",
				risk,
				targetOrigin,
			};
		}
		if (originAllowed) {
			return { decision: "allow", reason: "R0 read-only observation on allowed origin", risk, targetOrigin };
		}
		return {
			decision: "deny",
			reason: `R0 read origin not in allowedOrigins: ${targetOrigin ?? "(none)"}`,
			risk,
			targetOrigin,
		};
	}

	// 4. R3 default-deny unless explicitly and narrowly privileged.
	if (risk === "R3") {
		if (
			structuredPrivileged(action, targetOrigin, policy.privilegedR3ActionGrants) ||
			legacyPrivileged(action, policy.privilegedR3Actions)
		) {
			return { decision: "approve", reason: "privileged R3 action — approval required", risk, targetOrigin };
		}
		return { decision: "deny", reason: "R3 critical mutation denied by default", risk, targetOrigin };
	}

	if (actionRequiresApproval(action, policy.approvalRequiredActions ?? [])) {
		return { decision: "approve", reason: "action requires approval by policy", risk, targetOrigin };
	}

	// 5. R2 needs human approval.
	if (risk === "R2") {
		return { decision: "approve", reason: "R2 external mutation — approval required", risk, targetOrigin };
	}

	// 6. R1: origin gate already passed, so allow.
	return { decision: "allow", reason: "R1 on allowed origin", risk, targetOrigin };
}
