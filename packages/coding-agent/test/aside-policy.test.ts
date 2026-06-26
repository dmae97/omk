import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_POLICY,
	loadPolicy,
	loadPolicyWithDiagnostics,
	mergePolicy,
} from "../examples/extensions/aside-computer-use/policy.ts";

const scratchRoot = join(tmpdir(), `aside-policy-test-${process.pid}-${Date.now()}`);

afterEach(() => {
	if (existsSync(scratchRoot)) rmSync(scratchRoot, { recursive: true, force: true });
});

describe("DEFAULT_POLICY", () => {
	it("uses yolo mode by default while keeping hard-deny floors", () => {
		expect(DEFAULT_POLICY.defaultMode).toBe("yolo");
		expect(DEFAULT_POLICY.allowedOrigins.some((o) => o.includes("localhost"))).toBe(true);
		expect(DEFAULT_POLICY.deniedActions).toContain("payment");
		expect(DEFAULT_POLICY.deniedActions).toContain("credential_export");
		expect(DEFAULT_POLICY.limits.maxSteps).toBeGreaterThan(0);
	});
});

describe("mergePolicy", () => {
	it("overrides scalar fields and origin array while unioning deny/approval floors", () => {
		const merged = mergePolicy(DEFAULT_POLICY, {
			executable: "/usr/local/bin/aside",
			defaultMode: "yolo",
			allowedOrigins: ["https://github.com"],
			deniedActions: ["custom_denied"],
			approvalRequiredActions: ["custom_approval"],
		});
		expect(merged.executable).toBe("/usr/local/bin/aside");
		expect(merged.defaultMode).toBe("yolo");
		expect(merged.allowedOrigins).toEqual(["https://github.com"]);
		expect(merged.deniedActions).toContain("payment");
		expect(merged.deniedActions).toContain("custom_denied");
		expect(merged.approvalRequiredActions).toContain("submit");
		expect(merged.approvalRequiredActions).toContain("custom_approval");
	});

	it("cannot remove default denied actions through an empty override", () => {
		const merged = mergePolicy(DEFAULT_POLICY, { deniedActions: [] });
		expect(merged.deniedActions).toContain("payment");
		expect(merged.deniedActions).toContain("account_deletion");
		expect(merged.deniedActions).toContain("credential_export");
	});

	it("keeps evidence floors enabled even when normal overrides set booleans false", () => {
		const merged = mergePolicy(DEFAULT_POLICY, {
			evidence: {
				captureFinalScreenshot: false,
				recordFinalUrl: false,
				requireDomAssertions: false,
				hashDownloadedFiles: false,
			},
		});
		expect(merged.evidence).toEqual(DEFAULT_POLICY.evidence);
	});

	it("clamps malformed, fractional, negative, NaN, and huge limits to finite integers", () => {
		const merged = mergePolicy(DEFAULT_POLICY, {
			limits: {
				maxSteps: -10,
				maxRetries: Number.NaN,
				maxWallTimeSeconds: 9_999_999,
				maxDownloads: 3.9,
			},
		});
		expect(merged.limits.maxSteps).toBe(1);
		expect(merged.limits.maxRetries).toBe(DEFAULT_POLICY.limits.maxRetries);
		expect(merged.limits.maxWallTimeSeconds).toBe(3600);
		expect(merged.limits.maxDownloads).toBe(3);
		for (const value of Object.values(merged.limits)) {
			expect(Number.isInteger(value)).toBe(true);
			expect(Number.isFinite(value)).toBe(true);
		}
	});

	it("keeps only bounded structured R3 grants for generic click/submit privileges", () => {
		const expiresAt = new Date(Date.now() + 60_000).toISOString();
		const merged = mergePolicy(DEFAULT_POLICY, {
			privilegedR3ActionGrants: [
				{ kind: "click", origin: "https://example.com", expiresAt, reason: "missing target" },
				{
					kind: "click",
					origin: "https://example.com",
					selectorOrLabel: "Delete account",
					expiresAt,
					reason: "bounded target",
				},
			],
		});
		expect(merged.privilegedR3ActionGrants ?? []).toHaveLength(1);
		expect(merged.privilegedR3ActionGrants?.[0]?.selectorOrLabel).toBe("Delete account");
	});

	it("ignores unknown fields and malformed values", () => {
		const merged = mergePolicy(DEFAULT_POLICY, {
			junk: true,
			defaultMode: "bogus",
			allowedOrigins: "not-an-array",
		});
		expect(merged.defaultMode).toBe(DEFAULT_POLICY.defaultMode);
		expect(merged.allowedOrigins).toEqual(DEFAULT_POLICY.allowedOrigins);
	});
});

describe("loadPolicy", () => {
	it("returns defaults when no policy files exist", () => {
		const empty = join(scratchRoot, "empty");
		const policy = loadPolicy(empty, join(scratchRoot, "no-agent"));
		expect(policy.defaultMode).toBe(DEFAULT_POLICY.defaultMode);
		expect(policy.allowedOrigins).toEqual(DEFAULT_POLICY.allowedOrigins);
	});

	it("merges global then project files with restrictive union floors", () => {
		const agentDir = join(scratchRoot, "agent");
		const globalExt = join(agentDir, "extensions");
		mkdirSync(globalExt, { recursive: true });
		writeFileSync(
			join(globalExt, "aside-policy.json"),
			JSON.stringify({ allowedOrigins: ["https://global.example.com"], deniedActions: ["global_deny"] }),
		);

		const cwd = join(scratchRoot, "project");
		const omk = join(cwd, ".omk");
		mkdirSync(omk, { recursive: true });
		writeFileSync(
			join(omk, "aside-policy.json"),
			JSON.stringify({
				allowedOrigins: ["https://project.example.com"],
				deniedActions: [],
				limits: { maxSteps: 5 },
			}),
		);

		const policy = loadPolicy(cwd, agentDir);
		expect(policy.allowedOrigins).toEqual(["https://project.example.com"]);
		expect(policy.deniedActions).toContain("payment");
		expect(policy.deniedActions).toContain("global_deny");
		expect(policy.limits.maxSteps).toBe(5);
	});

	it("does not let project policy disable evidence defaults", () => {
		const cwd = join(scratchRoot, "project-evidence");
		const omk = join(cwd, ".omk");
		mkdirSync(omk, { recursive: true });
		writeFileSync(
			join(omk, "aside-policy.json"),
			JSON.stringify({ evidence: { captureFinalScreenshot: false, recordFinalUrl: false } }),
		);
		const policy = loadPolicy(cwd, join(scratchRoot, "agent-evidence"));
		expect(policy.evidence.captureFinalScreenshot).toBe(true);
		expect(policy.evidence.recordFinalUrl).toBe(true);
	});

	it("keeps defaults and exposes diagnostics for malformed JSON", () => {
		const agentDir = join(scratchRoot, "agent-bad");
		const globalExt = join(agentDir, "extensions");
		mkdirSync(globalExt, { recursive: true });
		writeFileSync(join(globalExt, "aside-policy.json"), "{ not valid json");
		const result = loadPolicyWithDiagnostics(join(scratchRoot, "cwd-bad"), agentDir);
		expect(result.policy.defaultMode).toBe(DEFAULT_POLICY.defaultMode);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]?.path).toContain("aside-policy.json");
	});
});
