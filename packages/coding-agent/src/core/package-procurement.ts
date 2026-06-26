/**
 * Package procurement / exact-pin gate.
 *
 * Pure, native-only procurement algorithms for OMK package adoption. None of these
 * functions install, fetch, clone, spawn, or touch the filesystem/network. They take
 * already-supplied source-review inputs (manifest fields, license metadata, source
 * text) and return advisory verdicts so an external installer never runs against an
 * unvetted, mutable, or copyleft-contaminated source.
 *
 * Implements PR A from .omk/runs/omk-package-hardening-plan/{procurement.md,algorithm-plan.md}:
 *   - exact npm semver validation (shared pattern with scripts/check-pinned-deps.mjs)
 *   - mutable range/tag/branch rejection
 *   - candidate input normalization to a canonical pinned source string
 *   - license verdict gate (permissive / weak / strong / network copyleft / unknown)
 *   - lifecycle-script gate (fail-closed; reviewed allowlist exception only)
 *   - legacy/OMK compatibility scan over provided source text
 *   - source capability scan (credential reads, sockets, network, exec, fs writes)
 *   - risk/adoption decision matrix
 */

import { parseGitUrl } from "../utils/git.ts";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type IntendedUse =
	| "native"
	| "vendor"
	| "ephemeral-adopt"
	| "permanent-adopt"
	| "theme-port"
	| "reference"
	| "advisory"
	| "report-only"
	| "measurement-gated";
export type DeclaredUse =
	| "sandbox"
	| "loadout"
	| "checkpoint"
	| "observability"
	| "advisor"
	| "quality"
	| "memory"
	| "workflow-reference"
	| "cache-perf";
export type ResourceKind = "extension" | "skill" | "prompt" | "theme" | "tool";
export type RiskLevel = "low" | "medium" | "high";
export type GateVerdict = "pass" | "review" | "reject";
export type PathCompatibility = "omk-native" | "legacy-hardcoded" | "unknown";
export type Adoption =
	| "native"
	| "vendor"
	| "ephemeral-trial"
	| "permanent-package"
	| "reference-only"
	| "advisory-only"
	| "report-only"
	| "measurement-gated"
	| "deferred"
	| "reject";
export type DeferredReason =
	| "missing-exact-pin"
	| "pending-native-spec"
	| "pending-metrics"
	| "pending-export-policy"
	| "group-excluded"
	| "pending-identity-reconciliation"
	| "pending-advisory-spec"
	| "pending-measurement-plan"
	| "pending-sandbox-backend";
export type LifecycleAllowlistMode = "exact" | "identity";
export type SandboxBackend = "seatbelt" | "bubblewrap" | "none";
export type MutationMode = "report-only";

export interface NativeSpecPrecondition {
	exists: boolean;
	trackId?: string;
	specPath?: string;
}

export interface MaintainerTrustInput {
	scope?: string;
	verifiedPublisher?: boolean;
	accountAgeDays?: number;
}

export interface ExportPolicyOverlay {
	defaultOff: boolean;
	offlineDisables: boolean;
	denyRawPrompt: boolean;
	denyRawToolOutput: boolean;
	payloadTier?: "metadata" | "summary" | "full";
}

export interface PolicyOverlay {
	declaredUse: DeclaredUse;
	sandboxBackend?: SandboxBackend;
	exportPolicy?: ExportPolicyOverlay;
	mutationMode?: MutationMode;
	advisoryOnly?: boolean;
	replayInput?: boolean;
	activateAlongsideScheduler?: boolean;
}

export interface CandidatePackageInput {
	name: string;
	exactVersion?: string;
	gitRepo?: string;
	gitRef?: string;
	/** Reviewed full commit SHA used to anchor an otherwise-mutable tag. */
	resolvedCommit?: string;
	intendedUse: IntendedUse;
	declaredUse?: DeclaredUse;
	expectedResources: ResourceKind[];
	allowLifecycleScripts?: boolean;
	risk?: RiskLevel;
	nativeSpec?: NativeSpecPrecondition;
	policyOverlay?: PolicyOverlay;
	metrics?: string[];
	excludeGroup?: string;
	publishedAt?: string;
	minReleaseAgeDays?: number;
	maintainer?: MaintainerTrustInput;
}

export interface SourceText {
	path?: string;
	text: string;
}

// ---------------------------------------------------------------------------
// Exact npm version validation
// ---------------------------------------------------------------------------

/** Exact semver shape, identical to scripts/check-pinned-deps.mjs. */
export const EXACT_SEMVER_PATTERN =
	/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const DIST_TAGS = new Set([
	"latest",
	"next",
	"beta",
	"alpha",
	"canary",
	"rc",
	"dev",
	"nightly",
	"stable",
	"experimental",
	"insiders",
]);

// whitespace, range operators (^ ~ > < = *), or a standalone wildcard x/X
const RANGE_INDICATOR = /[\s^~><=*|]|\bx\b|\bX\b/;

export type NpmVersionRejectReason = "missing" | "dist-tag" | "range" | "invalid";
export type NpmVersionVerdict =
	| { ok: true; version: string }
	| { ok: false; reason: NpmVersionRejectReason; message: string };

export function validateExactNpmVersion(version: string | undefined): NpmVersionVerdict {
	const value = (version ?? "").trim();
	if (!value) {
		return { ok: false, reason: "missing", message: "exact version is required" };
	}
	if (DIST_TAGS.has(value.toLowerCase())) {
		return { ok: false, reason: "dist-tag", message: `dist-tag "${value}" is mutable` };
	}
	if (EXACT_SEMVER_PATTERN.test(value)) {
		return { ok: true, version: value };
	}
	if (RANGE_INDICATOR.test(value)) {
		return { ok: false, reason: "range", message: `range/wildcard "${value}" is not an exact version` };
	}
	return { ok: false, reason: "invalid", message: `"${value}" is not a valid exact semver` };
}

// ---------------------------------------------------------------------------
// npm package name validation
// ---------------------------------------------------------------------------

const NPM_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export type NpmNameVerdict = { ok: true; name: string } | { ok: false; message: string };

export function validateNpmPackageName(name: string): NpmNameVerdict {
	const value = (name ?? "").trim();
	if (!value) {
		return { ok: false, message: "package name is required" };
	}
	if (value.length > 214) {
		return { ok: false, message: "package name exceeds 214 characters" };
	}
	if (value !== value.toLowerCase()) {
		return { ok: false, message: "package name must be lowercase" };
	}
	if (value.includes("..")) {
		return { ok: false, message: "package name must not contain path traversal" };
	}
	if (!NPM_NAME_PATTERN.test(value)) {
		return { ok: false, message: `"${value}" is not a valid npm package name` };
	}
	return { ok: true, name: value };
}

// ---------------------------------------------------------------------------
// git ref validation
// ---------------------------------------------------------------------------

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HEX_ONLY = /^[0-9a-f]+$/;
const MUTABLE_BRANCHES = new Set(["main", "master", "develop", "dev", "trunk", "head", "release", "stable", "latest"]);

export type GitRefRejectReason = "missing" | "mutable-branch" | "short-sha" | "unresolved-tag" | "invalid";
export type GitRefVerdict =
	| { ok: true; ref: string; commit: string; kind: "commit" | "resolved-tag" }
	| { ok: false; reason: GitRefRejectReason; message: string };

export function validateGitRef(ref: string | undefined, resolvedCommit?: string): GitRefVerdict {
	const value = (ref ?? "").trim();
	if (!value) {
		return { ok: false, reason: "missing", message: "git ref is required" };
	}
	if (FULL_SHA.test(value)) {
		return { ok: true, ref: value, commit: value, kind: "commit" };
	}

	const lower = value.toLowerCase();
	if (MUTABLE_BRANCHES.has(lower) || value === "HEAD" || value.startsWith("refs/heads/")) {
		return { ok: false, reason: "mutable-branch", message: `"${value}" is a mutable branch` };
	}
	if (HEX_ONLY.test(lower) && lower.length < 40) {
		return { ok: false, reason: "short-sha", message: `"${value}" is an abbreviated commit; full SHA required` };
	}

	// Treat anything else as a tag: immutable only when anchored to a reviewed full commit.
	const commit = (resolvedCommit ?? "").trim();
	if (!commit) {
		return { ok: false, reason: "unresolved-tag", message: `tag "${value}" needs a reviewed resolved commit SHA` };
	}
	if (!FULL_SHA.test(commit)) {
		return { ok: false, reason: "invalid", message: `resolvedCommit "${commit}" is not a full SHA` };
	}
	return { ok: true, ref: value, commit, kind: "resolved-tag" };
}

// ---------------------------------------------------------------------------
// Candidate normalization
// ---------------------------------------------------------------------------

export type NormalizedSource =
	| { ok: true; kind: "npm"; source: string; name: string; version: string }
	| { ok: true; kind: "git"; source: string; repo: string; host: string; path: string; ref: string; commit: string };

export type NormalizedCandidate = NormalizedSource | { ok: false; reasons: string[] };

export function normalizeCandidate(input: CandidatePackageInput): NormalizedCandidate {
	const reasons: string[] = [];
	const hasNpm = Boolean(input.exactVersion);
	const hasGit = Boolean(input.gitRepo || input.gitRef);

	if (hasNpm && hasGit) {
		reasons.push("ambiguous-source: provide either an npm exactVersion or a git repo+ref, not both");
		return { ok: false, reasons };
	}
	if (!hasNpm && !hasGit) {
		reasons.push("missing-source: provide exactVersion (npm) or gitRepo+gitRef (git)");
		return { ok: false, reasons };
	}

	if (hasNpm) {
		const nameCheck = validateNpmPackageName(input.name);
		if (!nameCheck.ok) reasons.push(`invalid-npm-name: ${nameCheck.message}`);
		const versionCheck = validateExactNpmVersion(input.exactVersion);
		if (!versionCheck.ok) reasons.push(`version: ${versionCheck.message}`);
		if (nameCheck.ok && versionCheck.ok) {
			return {
				ok: true,
				kind: "npm",
				source: `npm:${nameCheck.name}@${versionCheck.version}`,
				name: nameCheck.name,
				version: versionCheck.version,
			};
		}
		return { ok: false, reasons };
	}

	// git
	const git = resolveGitRepo(input.gitRepo ?? "");
	if (!git) reasons.push("invalid-git-repo: could not parse a host/org/repo from gitRepo");
	const refCheck = validateGitRef(input.gitRef, input.resolvedCommit);
	if (!refCheck.ok) reasons.push(`git-ref: ${refCheck.message}`);
	if (git && refCheck.ok) {
		return {
			ok: true,
			kind: "git",
			source: `git:${git.host}/${git.path}@${refCheck.commit}`,
			repo: git.repo,
			host: git.host,
			path: git.path,
			ref: refCheck.ref,
			commit: refCheck.commit,
		};
	}
	return { ok: false, reasons };
}

function resolveGitRepo(repo: string): { repo: string; host: string; path: string } | null {
	const trimmed = repo.trim();
	if (!trimmed) return null;
	const parsed = parseGitUrl(trimmed) ?? parseGitUrl(`git:${trimmed}`);
	if (!parsed) return null;
	return { repo: parsed.repo, host: parsed.host, path: parsed.path };
}

// ---------------------------------------------------------------------------
// License gate
// ---------------------------------------------------------------------------

export type LicenseClassification = "permissive" | "weak-copyleft" | "strong-copyleft" | "network-copyleft" | "unknown";

export interface LicenseInput {
	declaredLicense?: string;
	licenseFiles?: string[];
	transitiveLicenses?: string[];
	intendedUse: IntendedUse;
}

export interface LicenseVerdictResult {
	verdict: GateVerdict;
	classification: LicenseClassification;
	noticeNeeded: boolean;
	reasons: string[];
}

const PERMISSIVE_LICENSES = new Set([
	"MIT",
	"MIT-0",
	"ISC",
	"BSD",
	"BSD-2-CLAUSE",
	"BSD-3-CLAUSE",
	"APACHE-2.0",
	"0BSD",
	"UNLICENSE",
	"CC0-1.0",
	"BLUEOAK-1.0.0",
	"ZLIB",
	"PYTHON-2.0",
	"WTFPL",
]);

const NOTICE_REQUIRED_LICENSES = new Set(["APACHE-2.0", "BSD", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "MPL-2.0"]);

function licenseKey(license: string): string {
	return license.trim().toUpperCase().replace(/\s+/g, "");
}

export function classifyLicense(license: string | undefined): LicenseClassification {
	if (!license || !license.trim()) return "unknown";
	const key = licenseKey(license);
	if (key.includes("AGPL") || key.includes("SSPL")) return "network-copyleft";
	if (key.includes("LGPL") || key.includes("MPL") || key.includes("EPL") || key.includes("CDDL")) {
		return "weak-copyleft";
	}
	if (key.includes("GPL")) return "strong-copyleft";
	if (PERMISSIVE_LICENSES.has(key)) return "permissive";
	return "unknown";
}

export function evaluateLicense(input: LicenseInput): LicenseVerdictResult {
	const reasons: string[] = [];
	const classification = classifyLicense(input.declaredLicense);
	const noticeNeeded =
		Boolean(input.declaredLicense) &&
		(NOTICE_REQUIRED_LICENSES.has(licenseKey(input.declaredLicense ?? "")) || classification === "weak-copyleft");

	if (classification === "unknown") {
		reasons.push(input.declaredLicense ? `unrecognized-license: ${input.declaredLicense}` : "missing-license");
		return { verdict: "review", classification, noticeNeeded, reasons };
	}
	if (classification === "network-copyleft" || classification === "strong-copyleft") {
		reasons.push(`copyleft-blocks-adoption: ${input.declaredLicense}`);
		return { verdict: "reject", classification, noticeNeeded, reasons };
	}
	if (classification === "weak-copyleft") {
		reasons.push(`weak-copyleft-needs-review: ${input.declaredLicense}`);
		return { verdict: "review", classification, noticeNeeded, reasons };
	}

	// Permissive: runtime/permanent adoption needs a transitive license inventory.
	if (
		input.intendedUse === "permanent-adopt" &&
		(!input.transitiveLicenses || input.transitiveLicenses.length === 0)
	) {
		reasons.push("transitive-license-inventory-required");
		return { verdict: "review", classification, noticeNeeded, reasons };
	}
	if (input.transitiveLicenses) {
		for (const transitive of input.transitiveLicenses) {
			const transitiveClass = classifyLicense(transitive);
			if (transitiveClass === "strong-copyleft" || transitiveClass === "network-copyleft") {
				reasons.push(`transitive-copyleft: ${transitive}`);
				return { verdict: "reject", classification, noticeNeeded, reasons };
			}
			if (transitiveClass === "unknown" || transitiveClass === "weak-copyleft") {
				reasons.push(`transitive-needs-review: ${transitive}`);
				return { verdict: "review", classification, noticeNeeded, reasons };
			}
		}
	}
	return { verdict: "pass", classification, noticeNeeded, reasons };
}

// ---------------------------------------------------------------------------
// Lifecycle-script gate
// ---------------------------------------------------------------------------

/** npm/pnpm/bun lifecycle hooks that run automatically during install or pack. */
export const LIFECYCLE_SCRIPT_NAMES: readonly string[] = [
	"preinstall",
	"install",
	"postinstall",
	"preuninstall",
	"uninstall",
	"postuninstall",
	"prepare",
	"prepublish",
	"prepublishOnly",
	"prepack",
	"postpack",
];

export interface LifecycleScriptInput {
	packageJsonScripts?: Record<string, string>;
	allowLifecycleScripts?: boolean;
	reviewedAllowlist?: string[];
	/** Full pinned source spec, e.g. npm:pi-sandbox@0.4.3 */
	source?: string;
	/** Identity without version/ref, e.g. npm:pi-sandbox */
	identity?: string;
	/** Defaults to exact, matching the published shrinkwrap allowlist semantics. */
	lifecycleAllowlistMode?: LifecycleAllowlistMode;
}

export interface LifecycleVerdictResult {
	verdict: GateVerdict;
	declaredScripts: string[];
	requiresException: boolean;
	reasons: string[];
}

export function evaluateLifecycleScripts(input: LifecycleScriptInput): LifecycleVerdictResult {
	const scripts = input.packageJsonScripts ?? {};
	const declared = LIFECYCLE_SCRIPT_NAMES.filter((name) => {
		const value = scripts[name];
		return typeof value === "string" && value.trim().length > 0;
	});

	if (declared.length === 0) {
		return { verdict: "pass", declaredScripts: [], requiresException: false, reasons: [] };
	}

	if (!input.allowLifecycleScripts) {
		return {
			verdict: "reject",
			declaredScripts: declared,
			requiresException: true,
			reasons: [`lifecycle-scripts-present: ${declared.join(", ")}`],
		};
	}

	const allow = new Set((input.reviewedAllowlist ?? []).filter((entry) => Boolean(entry?.trim())));
	const exactMatched = Boolean(input.source && allow.has(input.source));
	const identityMatched = Boolean(input.identity && allow.has(input.identity));
	const mode = input.lifecycleAllowlistMode ?? "exact";
	if (!exactMatched && !(mode === "identity" && identityMatched)) {
		return {
			verdict: "review",
			declaredScripts: declared,
			requiresException: true,
			reasons: [
				identityMatched
					? "lifecycle-scripts-require-exact-allowlist-entry"
					: "lifecycle-scripts-opt-in-without-reviewed-allowlist-entry",
			],
		};
	}
	return {
		verdict: "pass",
		declaredScripts: declared,
		requiresException: true,
		reasons: [`lifecycle-scripts-allowed-by-reviewed-allowlist: ${declared.join(", ")}`],
	};
}

// ---------------------------------------------------------------------------
// Legacy / OMK compatibility scan
// ---------------------------------------------------------------------------

export type FindingSeverity = "info" | "warn" | "block";

export interface ScanFinding {
	kind: string;
	severity: FindingSeverity;
	path?: string;
	line: number;
	snippet: string;
}

export interface CompatibilityScanResult {
	verdict: PathCompatibility;
	findings: ScanFinding[];
}

interface PatternRule {
	kind: string;
	severity: FindingSeverity;
	pattern: RegExp;
}

const LEGACY_CONFIG_DIR_NAME = "pi";

const COMPATIBILITY_RULES: PatternRule[] = [
	{
		kind: "legacy-home-path",
		severity: "block",
		pattern: new RegExp(`${String.raw`~\/\.`}${LEGACY_CONFIG_DIR_NAME}${String.raw`(?:\/|\b)`}`),
	},
	{
		kind: "legacy-state-dir",
		severity: "block",
		pattern: new RegExp(`${String.raw`\.`}${LEGACY_CONFIG_DIR_NAME}${String.raw`\/agents\b`}`),
	},
	{
		kind: "legacy-project-path",
		severity: "block",
		pattern: new RegExp(`${String.raw`(?:^|[^.\w])\.`}${LEGACY_CONFIG_DIR_NAME}${String.raw`\/`}`),
	},
	{ kind: "legacy-package-path", severity: "block", pattern: /pi-coding-agent/ },
	{ kind: "legacy-cli-invocation", severity: "block", pattern: /\bpi\s+(?:install|update)\b/ },
	{ kind: "legacy-env", severity: "warn", pattern: /\bPI_[A-Z][A-Z0-9_]*\b/ },
	{ kind: "legacy-import", severity: "block", pattern: /@(?:mariozechner|earendil-works)\/pi-/ },
	{ kind: "omk-path", severity: "info", pattern: /(?:^|[^.\w])\.omk\// },
];

function scanWithRules(sources: SourceText[], rules: PatternRule[]): ScanFinding[] {
	const findings: ScanFinding[] = [];
	for (const source of sources) {
		const lines = source.text.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			for (const rule of rules) {
				if (rule.pattern.test(line)) {
					findings.push({
						kind: rule.kind,
						severity: rule.severity,
						path: source.path,
						line: i + 1,
						snippet: line.trim().slice(0, 200),
					});
				}
			}
		}
	}
	return findings;
}

export function scanLegacyOmkCompatibility(sources: SourceText[]): CompatibilityScanResult {
	const findings = scanWithRules(sources, COMPATIBILITY_RULES);
	const hasBlock = findings.some((f) => f.severity === "block");
	const hasOmk = findings.some((f) => f.kind === "omk-path");
	const hasWarn = findings.some((f) => f.severity === "warn");

	let verdict: PathCompatibility;
	if (hasBlock) {
		verdict = "legacy-hardcoded";
	} else if (hasOmk) {
		verdict = "omk-native";
	} else if (hasWarn) {
		verdict = "unknown";
	} else {
		verdict = "unknown";
	}
	return { verdict, findings };
}

// ---------------------------------------------------------------------------
// Source capability scan
// ---------------------------------------------------------------------------

export interface CapabilityScanResult {
	capabilities: string[];
	findings: ScanFinding[];
}

const CAPABILITY_RULES: PatternRule[] = [
	// Credential / secret file reads are the hard blocker.
	{ kind: "credential-read", severity: "block", pattern: /["'`][^"'`]*\.env(?:\.[\w-]+)?["'`]/ },
	{ kind: "credential-read", severity: "block", pattern: /auth\.json|\.npmrc|\.netrc/ },
	{
		kind: "credential-read",
		severity: "block",
		pattern: /id_rsa|id_ed25519|\.ssh\/|\.aws\/credentials|\.kube\/config/,
	},
	{ kind: "credential-read", severity: "block", pattern: /BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY/ },
	{ kind: "host-socket", severity: "block", pattern: /\/var\/run\/docker\.sock|dockerode|kubeconfig/ },
	{ kind: "child-process", severity: "warn", pattern: /child_process|\bspawn\s*\(|\bexec(?:Sync|File)?\s*\(/ },
	{
		kind: "network",
		severity: "warn",
		pattern: /\bfetch\s*\(\s*["'`]?https?:|https?\.request|node-fetch|axios|undici|got\(/,
	},
	{
		kind: "filesystem-write",
		severity: "warn",
		pattern: /writeFileSync|appendFileSync|\bfs\.(?:write|append)|rmSync|unlinkSync|mkdirSync/,
	},
	{ kind: "browser-control", severity: "warn", pattern: /puppeteer|playwright|chrome-devtools|:9222\b/ },
	{ kind: "telemetry", severity: "warn", pattern: /\btelemetry\b|posthog|segment\.io|@braintrust|analytics\b/ },
	{ kind: "setFooter", severity: "info", pattern: /\bsetFooter\s*\(/ },
	{ kind: "setHeader", severity: "info", pattern: /\bsetHeader\s*\(/ },
	{ kind: "setEditorComponent", severity: "info", pattern: /\bsetEditorComponent\s*\(/ },
	{ kind: "setStatus", severity: "info", pattern: /\bsetStatus\s*\(/ },
	{ kind: "setActiveTools", severity: "info", pattern: /\bsetActiveTools\s*\(/ },
	{ kind: "setModel", severity: "warn", pattern: /\bsetModel\s*\(/ },
	{ kind: "setThinkingLevel", severity: "warn", pattern: /\bsetThinkingLevel\s*\(/ },
	{ kind: "renderCall", severity: "info", pattern: /\brenderCall\s*[:(]/ },
	{ kind: "renderResult", severity: "info", pattern: /\brenderResult\s*[:(]/ },
	{ kind: "registerMessageRenderer", severity: "info", pattern: /\bregisterMessageRenderer\s*\(/ },
	{ kind: "before_provider_request", severity: "warn", pattern: /["'`]before_provider_request["'`]/ },
	{ kind: "context", severity: "warn", pattern: /["'`]context["'`]/ },
	{ kind: "session_before_compact", severity: "warn", pattern: /["'`]session_before_compact["'`]/ },
	{ kind: "env-secret-access", severity: "info", pattern: /process\.env\.[A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)/ },
];

export function scanSourceCapabilities(sources: SourceText[]): CapabilityScanResult {
	const findings = scanWithRules(sources, CAPABILITY_RULES);
	const capabilities = [...new Set(findings.map((f) => f.kind))];
	return { capabilities, findings };
}

// ---------------------------------------------------------------------------
// Release-age and maintainer trust gates
// ---------------------------------------------------------------------------

export type ReleaseAgeVerdict = "pass" | "review" | "defer";

export interface ReleaseAgeInput {
	publishedAt?: string;
	minReleaseAgeDays?: number;
	now?: Date;
}

export interface ReleaseAgeResult {
	verdict: ReleaseAgeVerdict;
	reason?: string;
	ageDays?: number;
}

export function evaluateReleaseAge(input: ReleaseAgeInput): ReleaseAgeResult {
	const minAge = input.minReleaseAgeDays ?? 0;
	if (minAge <= 0) return { verdict: "pass", reason: "release-age-not-required" };
	if (!input.publishedAt) return { verdict: "review", reason: "release-age-published-at-missing" };
	const published = Date.parse(input.publishedAt);
	if (Number.isNaN(published)) return { verdict: "review", reason: "release-age-invalid-published-at" };
	const now = input.now?.getTime() ?? Date.now();
	const ageDays = (now - published) / 86_400_000;
	if (ageDays < minAge) {
		return { verdict: "defer", reason: `release-age-below-${minAge}-days`, ageDays };
	}
	return { verdict: "pass", reason: "release-age-ok", ageDays };
}

export function assessMaintainerTrust(input: MaintainerTrustInput = {}): RiskLevel {
	if (input.verifiedPublisher === true) return "low";
	if (input.verifiedPublisher === false && (input.accountAgeDays ?? Number.POSITIVE_INFINITY) < 60) return "high";
	if (input.verifiedPublisher === false) return "medium";
	return "low";
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
	const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
	return rank[a] >= rank[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Risk inference
// ---------------------------------------------------------------------------

const HIGH_RISK_CAPABILITIES = new Set(["credential-read", "host-socket"]);
const MEDIUM_RISK_CAPABILITIES = new Set(["child-process", "network", "browser-control"]);

export function inferRisk(
	capabilities: string[],
	licenseVerdict: GateVerdict,
	lifecycleVerdict: GateVerdict,
	maintainer?: MaintainerTrustInput,
): RiskLevel {
	let risk: RiskLevel = "low";
	if (
		licenseVerdict === "reject" ||
		lifecycleVerdict === "reject" ||
		capabilities.some((capability) => HIGH_RISK_CAPABILITIES.has(capability))
	) {
		risk = "high";
	} else if (
		licenseVerdict === "review" ||
		lifecycleVerdict === "review" ||
		capabilities.some((capability) => MEDIUM_RISK_CAPABILITIES.has(capability))
	) {
		risk = "medium";
	}
	return maxRisk(risk, assessMaintainerTrust(maintainer));
}

// ---------------------------------------------------------------------------
// Adoption decision matrix
// ---------------------------------------------------------------------------

export interface AdoptionInput {
	intendedUse: IntendedUse;
	risk: RiskLevel;
	pinOk: boolean;
	licenseVerdict: GateVerdict;
	lifecycleVerdict: GateVerdict;
	pathCompatibility: PathCompatibility;
	capabilities: string[];
	nativeSpec?: NativeSpecPrecondition;
	policyOverlay?: PolicyOverlay;
	metrics?: string[];
}

export interface AdoptionDecision {
	adoption: Adoption;
	rejectedReasons: string[];
	deferredReason?: DeferredReason;
}

function baseAdoptionFor(intendedUse: IntendedUse): Adoption {
	switch (intendedUse) {
		case "native":
			return "native";
		case "vendor":
		case "theme-port":
			return "vendor";
		case "ephemeral-adopt":
			return "ephemeral-trial";
		case "permanent-adopt":
			return "permanent-package";
		case "reference":
			return "reference-only";
		case "advisory":
			return "advisory-only";
		case "report-only":
			return "report-only";
		case "measurement-gated":
			return "measurement-gated";
	}
}

function deferred(reason: DeferredReason, rejectedReasons: string[] = []): AdoptionDecision {
	return { adoption: "deferred", deferredReason: reason, rejectedReasons: [reason, ...rejectedReasons] };
}

function policyOverlayFor(input: AdoptionInput): PolicyOverlay | undefined {
	return input.policyOverlay;
}

function hasValidExportPolicy(policy: ExportPolicyOverlay | undefined): boolean {
	return Boolean(
		policy?.defaultOff === true &&
			policy.offlineDisables === true &&
			policy.denyRawPrompt === true &&
			policy.denyRawToolOutput === true,
	);
}

export function decideAdoption(input: AdoptionInput): AdoptionDecision {
	const reasons: string[] = [];
	const base = baseAdoptionFor(input.intendedUse);
	const policy = policyOverlayFor(input);

	if (!input.pinOk) {
		if (
			base === "native" ||
			base === "reference-only" ||
			base === "advisory-only" ||
			base === "report-only" ||
			base === "measurement-gated"
		) {
			return deferred("missing-exact-pin");
		}
		reasons.push("exact-pin-required");
		return { adoption: "reject", rejectedReasons: reasons };
	}

	if (base === "native") {
		if (input.nativeSpec?.exists === false) return deferred("pending-native-spec");
		if (input.capabilities.includes("credential-read")) reasons.push("reads-credentials-upstream");
		if (input.licenseVerdict === "reject") reasons.push("license-blocked-upstream");
		if (input.lifecycleVerdict === "reject") reasons.push("lifecycle-scripts-blocked-upstream");
		if (input.pathCompatibility === "legacy-hardcoded") reasons.push("legacy-hardcoded-paths-upstream");
		if (policy?.declaredUse === "sandbox" && !policy.sandboxBackend) return deferred("pending-sandbox-backend");
		if (policy?.declaredUse === "sandbox") reasons.push("sandbox-risk-floor-high");
		return { adoption: "native", rejectedReasons: reasons };
	}

	if (policy?.declaredUse === "memory" && input.capabilities.includes("credential-read")) {
		reasons.push("memory-credential-read-rejected");
		return { adoption: "reject", rejectedReasons: reasons };
	}
	if (input.capabilities.includes("credential-read")) {
		reasons.push("reads-credentials");
		return { adoption: "reject", rejectedReasons: reasons };
	}
	if (input.licenseVerdict === "reject") {
		reasons.push("license-blocked");
		return { adoption: "reject", rejectedReasons: reasons };
	}
	if (input.lifecycleVerdict === "reject") {
		reasons.push("lifecycle-scripts-blocked");
		return { adoption: "reject", rejectedReasons: reasons };
	}
	if (input.pathCompatibility === "legacy-hardcoded") {
		reasons.push("legacy-hardcoded-paths");
		return { adoption: "reject", rejectedReasons: reasons };
	}

	if (policy?.declaredUse === "workflow-reference") {
		if (policy.activateAlongsideScheduler === true) {
			return { adoption: "reject", rejectedReasons: ["scheduler-coexistence-denied"] };
		}
		return { adoption: "reference-only", rejectedReasons: reasons };
	}

	if (policy?.declaredUse === "sandbox") {
		if (!policy.sandboxBackend) {
			reasons.push("sandbox-requires-backend");
			return { adoption: "reject", rejectedReasons: reasons };
		}
		reasons.push("sandbox-risk-floor-high");
	}

	if (
		policy?.declaredUse === "observability" &&
		base === "permanent-package" &&
		!hasValidExportPolicy(policy.exportPolicy)
	) {
		return deferred("pending-export-policy");
	}

	if (policy?.declaredUse === "advisor" || policy?.declaredUse === "quality") {
		if (input.capabilities.includes("filesystem-write") || input.capabilities.includes("child-process")) {
			reasons.push("report-only-mutation-denied");
		}
		return { adoption: "report-only", rejectedReasons: reasons };
	}

	if (base === "measurement-gated") {
		if (!input.metrics || input.metrics.length === 0) return deferred("pending-metrics");
		return { adoption: "measurement-gated", rejectedReasons: reasons };
	}

	if (base === "reference-only" || base === "advisory-only" || base === "report-only") {
		return { adoption: base, rejectedReasons: reasons };
	}

	if (base === "permanent-package") {
		if (input.risk === "high") {
			reasons.push("high-risk-permanent-blocked");
			return { adoption: "reject", rejectedReasons: reasons };
		}
		if (
			input.licenseVerdict === "review" ||
			input.lifecycleVerdict === "review" ||
			input.pathCompatibility === "unknown"
		) {
			reasons.push("needs-review-before-permanent");
			return { adoption: "ephemeral-trial", rejectedReasons: reasons };
		}
		return { adoption: "permanent-package", rejectedReasons: reasons };
	}

	if (base === "vendor") {
		if (input.licenseVerdict === "review") reasons.push("license-review-before-vendor");
		return { adoption: "vendor", rejectedReasons: reasons };
	}

	return { adoption: "ephemeral-trial", rejectedReasons: reasons };
}

// ---------------------------------------------------------------------------
// Top-level procurement review
// ---------------------------------------------------------------------------

export interface ProcurementReviewInputs {
	candidate: CandidatePackageInput;
	packageJsonScripts?: Record<string, string>;
	declaredLicense?: string;
	licenseFiles?: string[];
	transitiveLicenses?: string[];
	sources?: SourceText[];
	reviewedScriptAllowlist?: string[];
	lifecycleAllowlistMode?: LifecycleAllowlistMode;
	policyOverlay?: PolicyOverlay;
	now?: Date;
}

export interface ProcurementReview {
	candidate: CandidatePackageInput;
	normalized: NormalizedSource | null;
	pinned: boolean;
	licenseVerdict: GateVerdict;
	licenseClassification: LicenseClassification;
	noticeNeeded: boolean;
	lifecycleVerdict: GateVerdict;
	declaredLifecycleScripts: string[];
	pathCompatibility: PathCompatibility;
	compatibilityFindings: ScanFinding[];
	capabilities: string[];
	capabilityFindings: ScanFinding[];
	risk: RiskLevel;
	adoption: Adoption;
	deferredReason?: DeferredReason;
	releaseAgeVerdict: ReleaseAgeVerdict;
	maintainerRisk: RiskLevel;
	rejectedReasons: string[];
}

export function procureCandidate(inputs: ProcurementReviewInputs): ProcurementReview {
	const candidate = inputs.candidate;
	const normalized = normalizeCandidate(candidate);
	const pinned = normalized.ok;

	const license = evaluateLicense({
		declaredLicense: inputs.declaredLicense,
		licenseFiles: inputs.licenseFiles,
		transitiveLicenses: inputs.transitiveLicenses,
		intendedUse: candidate.intendedUse,
	});

	const lifecycle = evaluateLifecycleScripts({
		packageJsonScripts: inputs.packageJsonScripts,
		allowLifecycleScripts: candidate.allowLifecycleScripts,
		reviewedAllowlist: inputs.reviewedScriptAllowlist,
		source: normalized.ok ? normalized.source : undefined,
		identity: normalized.ok ? sourceIdentity(normalized) : undefined,
		lifecycleAllowlistMode: inputs.lifecycleAllowlistMode,
	});

	const sources = inputs.sources ?? [];
	const compatibility = scanLegacyOmkCompatibility(sources);
	const capabilities = scanSourceCapabilities(sources);
	const releaseAge = evaluateReleaseAge({
		publishedAt: candidate.publishedAt,
		minReleaseAgeDays: candidate.minReleaseAgeDays,
		now: inputs.now,
	});
	const maintainerRisk = assessMaintainerTrust(candidate.maintainer);
	const risk =
		candidate.risk ?? inferRisk(capabilities.capabilities, license.verdict, lifecycle.verdict, candidate.maintainer);
	const policyOverlay =
		inputs.policyOverlay ??
		candidate.policyOverlay ??
		(candidate.declaredUse === undefined ? undefined : { declaredUse: candidate.declaredUse });

	const decision = decideAdoption({
		intendedUse: candidate.intendedUse,
		risk,
		pinOk: pinned,
		licenseVerdict: license.verdict,
		lifecycleVerdict: lifecycle.verdict,
		pathCompatibility: compatibility.verdict,
		capabilities: capabilities.capabilities,
		nativeSpec: candidate.nativeSpec,
		policyOverlay,
		metrics: candidate.metrics,
	});

	const rejectedReasons = [...decision.rejectedReasons];
	if (!normalized.ok) {
		rejectedReasons.push(...normalized.reasons);
	}

	return {
		candidate,
		normalized: normalized.ok ? normalized : null,
		pinned,
		licenseVerdict: license.verdict,
		licenseClassification: license.classification,
		noticeNeeded: license.noticeNeeded,
		lifecycleVerdict: lifecycle.verdict,
		declaredLifecycleScripts: lifecycle.declaredScripts,
		pathCompatibility: compatibility.verdict,
		compatibilityFindings: compatibility.findings,
		capabilities: capabilities.capabilities,
		capabilityFindings: capabilities.findings,
		risk,
		adoption: decision.adoption,
		...(decision.deferredReason === undefined ? {} : { deferredReason: decision.deferredReason }),
		releaseAgeVerdict: releaseAge.verdict,
		maintainerRisk,
		rejectedReasons,
	};
}

export interface ProcurementBatchInput {
	candidates: readonly CandidatePackageInput[];
	packageJsonScripts?: Record<string, string>;
	declaredLicense?: string;
	transitiveLicenses?: string[];
	sources?: SourceText[];
	reviewedScriptAllowlist?: string[];
	lifecycleAllowlistMode?: LifecycleAllowlistMode;
	now?: Date;
}

export interface ProcurementBatchResult {
	coverage: ProcurementReview[];
	globalBlockers: string[];
	selectedByGroup: Record<string, string>;
}

function withBatchDeferral(
	review: ProcurementReview,
	reason: DeferredReason,
	rejectedReason: string,
): ProcurementReview {
	return {
		...review,
		adoption: "deferred",
		deferredReason: reason,
		rejectedReasons: [...review.rejectedReasons, rejectedReason],
	};
}

function isAdoptedForGroup(review: ProcurementReview): boolean {
	return review.adoption !== "reject" && review.adoption !== "deferred";
}

export function procureCandidateBatch(input: ProcurementBatchInput): ProcurementBatchResult {
	const selectedByGroup: Record<string, string> = {};
	const coverage: ProcurementReview[] = [];
	for (const candidate of input.candidates) {
		const review = procureCandidate({
			candidate,
			packageJsonScripts: input.packageJsonScripts,
			declaredLicense: input.declaredLicense ?? "MIT",
			transitiveLicenses: input.transitiveLicenses,
			sources: input.sources,
			reviewedScriptAllowlist: input.reviewedScriptAllowlist,
			lifecycleAllowlistMode: input.lifecycleAllowlistMode,
			now: input.now,
		});
		const group = candidate.excludeGroup;
		if (group && isAdoptedForGroup(review)) {
			if (selectedByGroup[group] === undefined) {
				selectedByGroup[group] = candidate.name;
				coverage.push(review);
			} else {
				coverage.push(withBatchDeferral(review, "group-excluded", `group-exclusion: ${group}`));
			}
		} else {
			coverage.push(review);
		}
	}
	return { coverage, globalBlockers: [], selectedByGroup };
}

function sourceIdentity(normalized: NormalizedSource): string {
	if (normalized.kind === "npm") {
		return `npm:${normalized.name}`;
	}
	return `git:${normalized.host}/${normalized.path}`;
}
