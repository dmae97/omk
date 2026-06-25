/**
 * Policy: load, merge, and validate the OMK-owned Aside policy.
 *
 * The policy is OMK's parallel gate layered on top of Aside's own Allow/Ask/Deny
 * modes. OMK's deny is always final. Defaults are deliberately conservative:
 * guard mode, localhost/test origins only, all critical mutations denied.
 *
 * Loading merges (later wins where safe):
 *   defaults  ←  global ~/.omk/agent/extensions/aside-policy.json
 *             ←  project <cwd>/.omk/aside-policy.json
 *
 * Security floors are restrictive: deny/approval lists are unioned, evidence
 * defaults cannot be disabled by normal config, and numeric limits are clamped.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AsideMode } from "./types.ts";

/** Limits + evidence settings bound on every task. */
export interface PolicyLimits {
	maxSteps: number;
	maxRetries: number;
	maxWallTimeSeconds: number;
	maxDownloads: number;
}

export interface PolicyEvidence {
	captureFinalScreenshot: boolean;
	recordFinalUrl: boolean;
	requireDomAssertions: boolean;
	hashDownloadedFiles: boolean;
}

export interface PrivilegedR3ActionGrant {
	readonly kind: string;
	readonly asideTool?: string;
	readonly origin: string;
	readonly selectorOrLabel?: string;
	readonly expiresAt: string;
	readonly reason: string;
}

export interface AsidePolicy {
	executable: string;
	transport: "mcp-stdio";
	defaultMode: AsideMode;
	allowedOrigins: readonly string[];
	deniedActions: readonly string[];
	approvalRequiredActions: readonly string[];
	/** Compatibility surface. Generic verbs are bounded by the authorizer. */
	privilegedR3Actions: readonly string[];
	/** Structured R3 grants with origin, expiry, reason, and optional exact target. */
	privilegedR3ActionGrants?: readonly PrivilegedR3ActionGrant[];
	limits: PolicyLimits;
	evidence: PolicyEvidence;
	allowReadAnyOrigin: boolean;
}

export interface PolicyLoadDiagnostic {
	readonly path: string;
	readonly source: "global" | "project";
	readonly message: string;
}

export interface PolicyLoadResult {
	readonly policy: AsidePolicy;
	readonly diagnostics: readonly PolicyLoadDiagnostic[];
}

/** Conservative defaults — read/localhost only, no critical mutations. */
export const DEFAULT_POLICY: AsidePolicy = {
	executable: "aside",
	transport: "mcp-stdio",
	defaultMode: "guard",
	allowedOrigins: ["http://localhost:*", "https://localhost:*", "http://127.0.0.1:*", "https://127.0.0.1:*"],
	deniedActions: ["credential_export", "payment", "security_setting_change", "account_deletion", "pay"],
	approvalRequiredActions: ["submit", "send_message", "publish", "delete", "change_permission"],
	privilegedR3Actions: [],
	privilegedR3ActionGrants: [],
	limits: { maxSteps: 80, maxRetries: 2, maxWallTimeSeconds: 900, maxDownloads: 10 },
	evidence: {
		captureFinalScreenshot: true,
		recordFinalUrl: true,
		requireDomAssertions: true,
		hashDownloadedFiles: true,
	},
	allowReadAnyOrigin: false,
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asStringArray(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((v): v is string => typeof v === "string");
}

function asNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function unionStringArrays(left: readonly string[], right: readonly string[]): readonly string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of [...left, ...right]) {
		const trimmed = value.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}
	return out;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
	const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	const integer = Math.trunc(numeric);
	return Math.min(max, Math.max(min, integer));
}

function clonePolicy(policy: AsidePolicy): AsidePolicy {
	return {
		...policy,
		allowedOrigins: [...policy.allowedOrigins],
		deniedActions: [...policy.deniedActions],
		approvalRequiredActions: [...policy.approvalRequiredActions],
		privilegedR3Actions: [...policy.privilegedR3Actions],
		privilegedR3ActionGrants: [...(policy.privilegedR3ActionGrants ?? [])],
		limits: { ...policy.limits },
		evidence: { ...policy.evidence },
	};
}

function grantKindNeedsTarget(kind: string): boolean {
	const normalized = kind
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/g, "_");
	return normalized === "click" || normalized === "submit";
}

function asPrivilegedR3ActionGrant(value: unknown): PrivilegedR3ActionGrant | undefined {
	if (!isObject(value)) return undefined;
	const kind = asNonEmptyString(value.kind);
	const origin = asNonEmptyString(value.origin);
	const expiresAt = asNonEmptyString(value.expiresAt);
	const reason = asNonEmptyString(value.reason);
	if (!kind || !origin || !expiresAt || !reason) return undefined;
	if (Number.isNaN(Date.parse(expiresAt))) return undefined;
	const selectorOrLabel = asNonEmptyString(value.selectorOrLabel);
	if (grantKindNeedsTarget(kind) && !selectorOrLabel) return undefined;
	const asideTool = asNonEmptyString(value.asideTool);
	return asideTool
		? { kind, asideTool, origin, selectorOrLabel, expiresAt, reason }
		: { kind, origin, selectorOrLabel, expiresAt, reason };
}

function asPrivilegedR3ActionGrantArray(value: unknown): readonly PrivilegedR3ActionGrant[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.map((entry) => asPrivilegedR3ActionGrant(entry))
		.filter((entry): entry is PrivilegedR3ActionGrant => entry !== undefined);
}

/** Merge a partial override into a policy. Unknown fields are ignored. */
export function mergePolicy(base: AsidePolicy, override: Record<string, unknown>): AsidePolicy {
	const next = clonePolicy(base);
	if (typeof override.executable === "string") next.executable = override.executable;
	if (override.defaultMode === "readonly" || override.defaultMode === "guard" || override.defaultMode === "full") {
		next.defaultMode = override.defaultMode;
	}
	const origins = asStringArray(override.allowedOrigins);
	if (origins) next.allowedOrigins = origins;
	const denied = asStringArray(override.deniedActions);
	if (denied) next.deniedActions = unionStringArrays(base.deniedActions, denied);
	const approval = asStringArray(override.approvalRequiredActions);
	if (approval) next.approvalRequiredActions = unionStringArrays(base.approvalRequiredActions, approval);
	const priv = asStringArray(override.privilegedR3Actions);
	if (priv) next.privilegedR3Actions = unionStringArrays(base.privilegedR3Actions, priv);
	const structuredPriv = asPrivilegedR3ActionGrantArray(override.privilegedR3ActionGrants);
	if (structuredPriv) next.privilegedR3ActionGrants = [...(base.privilegedR3ActionGrants ?? []), ...structuredPriv];
	if (typeof override.allowReadAnyOrigin === "boolean") next.allowReadAnyOrigin = override.allowReadAnyOrigin;
	if (isObject(override.limits)) {
		const l = override.limits;
		next.limits = {
			maxSteps: clampInteger(l.maxSteps, base.limits.maxSteps, 1, 500),
			maxRetries: clampInteger(l.maxRetries, base.limits.maxRetries, 0, 10),
			maxWallTimeSeconds: clampInteger(l.maxWallTimeSeconds, base.limits.maxWallTimeSeconds, 1, 3600),
			maxDownloads: clampInteger(l.maxDownloads, base.limits.maxDownloads, 0, 100),
		};
	}
	if (isObject(override.evidence)) {
		const e = override.evidence;
		next.evidence = {
			captureFinalScreenshot: base.evidence.captureFinalScreenshot || e.captureFinalScreenshot === true,
			recordFinalUrl: base.evidence.recordFinalUrl || e.recordFinalUrl === true,
			requireDomAssertions: base.evidence.requireDomAssertions || e.requireDomAssertions === true,
			hashDownloadedFiles: base.evidence.hashDownloadedFiles || e.hashDownloadedFiles === true,
		};
	}
	return next;
}

function diagnosticMessage(error: unknown): string {
	return error instanceof Error ? error.message : "unknown policy parse error";
}

function readJsonIfExists(
	path: string,
	source: "global" | "project",
	diagnostics: PolicyLoadDiagnostic[],
): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw);
		if (isObject(parsed)) return parsed;
		diagnostics.push({ path, source, message: "policy root must be a JSON object" });
		return undefined;
	} catch (error) {
		diagnostics.push({ path, source, message: diagnosticMessage(error) });
		return undefined;
	}
}

/**
 * Load the effective policy and non-fatal diagnostics. Malformed files are
 * skipped so the restrictive default policy remains in force.
 */
export function loadPolicyWithDiagnostics(cwd: string, globalDir?: string): PolicyLoadResult {
	const agentDir = globalDir ?? join(homedir(), ".omk", "agent");
	const diagnostics: PolicyLoadDiagnostic[] = [];
	let policy = clonePolicy(DEFAULT_POLICY);
	const globalFile = readJsonIfExists(join(agentDir, "extensions", "aside-policy.json"), "global", diagnostics);
	if (globalFile) policy = mergePolicy(policy, globalFile);
	const projectFile = readJsonIfExists(join(cwd, ".omk", "aside-policy.json"), "project", diagnostics);
	if (projectFile) policy = mergePolicy(policy, projectFile);
	return { policy, diagnostics };
}

/**
 * Load the effective policy by merging defaults with global + project files.
 * Missing/unreadable files are skipped and defaults remain.
 */
export function loadPolicy(cwd: string, globalDir?: string): AsidePolicy {
	return loadPolicyWithDiagnostics(cwd, globalDir).policy;
}
