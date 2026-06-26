import { describe, expect, it } from "vitest";
import {
	assessMaintainerTrust,
	type CandidatePackageInput,
	decideAdoption,
	EXACT_SEMVER_PATTERN,
	evaluateLicense,
	evaluateLifecycleScripts,
	evaluateReleaseAge,
	inferRisk,
	LIFECYCLE_SCRIPT_NAMES,
	normalizeCandidate,
	procureCandidate,
	procureCandidateBatch,
	scanLegacyOmkCompatibility,
	scanSourceCapabilities,
	validateExactNpmVersion,
	validateGitRef,
	validateNpmPackageName,
} from "../src/core/package-procurement.ts";

describe("validateExactNpmVersion", () => {
	it("accepts exact semver including prerelease and build metadata", () => {
		expect(validateExactNpmVersion("1.2.3")).toEqual({ ok: true, version: "1.2.3" });
		expect(validateExactNpmVersion("0.0.35")).toEqual({ ok: true, version: "0.0.35" });
		expect(validateExactNpmVersion("1.2.3-beta.1")).toEqual({ ok: true, version: "1.2.3-beta.1" });
		expect(validateExactNpmVersion("1.2.3+build.5")).toEqual({ ok: true, version: "1.2.3+build.5" });
	});

	it("uses the same exact-version pattern as the pinned-deps gate", () => {
		expect(EXACT_SEMVER_PATTERN.test("1.2.3")).toBe(true);
		expect(EXACT_SEMVER_PATTERN.test("^1.2.3")).toBe(false);
	});

	it("rejects missing versions", () => {
		const result = validateExactNpmVersion(undefined);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("missing");
	});

	it("rejects dist-tags as mutable", () => {
		for (const tag of ["latest", "next", "beta", "canary"]) {
			const result = validateExactNpmVersion(tag);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("dist-tag");
		}
	});

	it("rejects ranges and wildcards", () => {
		for (const range of ["^1.2.3", "~1.2.3", ">=1.0.0", "1.2.x", "1.x", "*", "1.2.3 - 2.0.0", "=1.2.3"]) {
			const result = validateExactNpmVersion(range);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("range");
		}
	});

	it("rejects malformed values as invalid", () => {
		for (const bad of ["1.2", "1", "v1.2.3", "1.2.3.4"]) {
			const result = validateExactNpmVersion(bad);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("invalid");
		}
	});
});

describe("validateNpmPackageName", () => {
	it("accepts plain and scoped names", () => {
		expect(validateNpmPackageName("pi-sandbox").ok).toBe(true);
		expect(validateNpmPackageName("@ayulab/pi-rewind").ok).toBe(true);
	});

	it("rejects uppercase, spaces, and traversal", () => {
		expect(validateNpmPackageName("OMK-Sandbox").ok).toBe(false);
		expect(validateNpmPackageName("pi sandbox").ok).toBe(false);
		expect(validateNpmPackageName("../evil").ok).toBe(false);
		expect(validateNpmPackageName("").ok).toBe(false);
	});
});

describe("validateGitRef", () => {
	it("accepts a full 40-char commit SHA", () => {
		const sha = "a".repeat(40);
		expect(validateGitRef(sha)).toEqual({ ok: true, ref: sha, commit: sha, kind: "commit" });
	});

	it("accepts a 64-char sha256 commit", () => {
		const sha = "0".repeat(64);
		const result = validateGitRef(sha);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.kind).toBe("commit");
	});

	it("accepts a tag only when a reviewed resolved commit is supplied", () => {
		const sha = "b".repeat(40);
		const result = validateGitRef("v1.2.3", sha);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.kind).toBe("resolved-tag");
			expect(result.commit).toBe(sha);
			expect(result.ref).toBe("v1.2.3");
		}
	});

	it("rejects a tag without a resolved commit", () => {
		const result = validateGitRef("v1.2.3");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unresolved-tag");
	});

	it("rejects mutable branches and HEAD", () => {
		for (const ref of ["main", "master", "develop", "HEAD", "refs/heads/feature"]) {
			const result = validateGitRef(ref);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe("mutable-branch");
		}
	});

	it("rejects abbreviated commit SHAs", () => {
		const result = validateGitRef("deadbeef");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("short-sha");
	});

	it("rejects missing refs", () => {
		const result = validateGitRef(undefined);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("missing");
	});
});

describe("normalizeCandidate", () => {
	it("normalizes npm input into an exact pinned source", () => {
		const result = normalizeCandidate({
			name: "pi-sandbox",
			exactVersion: "0.4.3",
			intendedUse: "ephemeral-adopt",
			expectedResources: ["extension"],
		});
		expect(result.ok).toBe(true);
		if (result.ok && result.kind === "npm") {
			expect(result.source).toBe("npm:pi-sandbox@0.4.3");
			expect(result.name).toBe("pi-sandbox");
			expect(result.version).toBe("0.4.3");
		}
	});

	it("normalizes git input with a full commit into a pinned source", () => {
		const sha = "c".repeat(40);
		const result = normalizeCandidate({
			name: "pi-rewind",
			gitRepo: "github.com/ayulab/pi-rewind",
			gitRef: sha,
			intendedUse: "vendor",
			expectedResources: ["extension"],
		});
		expect(result.ok).toBe(true);
		if (result.ok && result.kind === "git") {
			expect(result.host).toBe("github.com");
			expect(result.path).toBe("ayulab/pi-rewind");
			expect(result.commit).toBe(sha);
			expect(result.source).toBe(`git:github.com/ayulab/pi-rewind@${sha}`);
		}
	});

	it("rejects missing version/ref", () => {
		const result = normalizeCandidate({
			name: "pi-readseek",
			intendedUse: "native",
			expectedResources: ["extension"],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reasons.some((r) => r.includes("missing-source"))).toBe(true);
	});

	it("rejects a mutable npm range", () => {
		const result = normalizeCandidate({
			name: "pi-simplify",
			exactVersion: "^0.2.2",
			intendedUse: "ephemeral-adopt",
			expectedResources: ["extension"],
		});
		expect(result.ok).toBe(false);
	});

	it("rejects providing both npm and git sources", () => {
		const result = normalizeCandidate({
			name: "pi-sandbox",
			exactVersion: "0.4.3",
			gitRepo: "github.com/x/y",
			gitRef: "d".repeat(40),
			intendedUse: "ephemeral-adopt",
			expectedResources: ["extension"],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reasons.some((r) => r.includes("ambiguous-source"))).toBe(true);
	});
});

describe("evaluateLicense", () => {
	it("passes permissive licenses", () => {
		const result = evaluateLicense({ declaredLicense: "MIT", intendedUse: "ephemeral-adopt" });
		expect(result.verdict).toBe("pass");
		expect(result.classification).toBe("permissive");
	});

	it("flags Apache-2.0 as notice-needed but passing", () => {
		const result = evaluateLicense({ declaredLicense: "Apache-2.0", intendedUse: "ephemeral-adopt" });
		expect(result.verdict).toBe("pass");
		expect(result.noticeNeeded).toBe(true);
	});

	it("rejects strong and network copyleft", () => {
		expect(evaluateLicense({ declaredLicense: "GPL-3.0", intendedUse: "permanent-adopt" }).verdict).toBe("reject");
		expect(evaluateLicense({ declaredLicense: "AGPL-3.0", intendedUse: "permanent-adopt" }).verdict).toBe("reject");
		expect(evaluateLicense({ declaredLicense: "AGPL-3.0", intendedUse: "permanent-adopt" }).classification).toBe(
			"network-copyleft",
		);
	});

	it("treats LGPL as weak copyleft needing review", () => {
		const result = evaluateLicense({ declaredLicense: "LGPL-3.0", intendedUse: "vendor" });
		expect(result.verdict).toBe("review");
		expect(result.classification).toBe("weak-copyleft");
	});

	it("reviews missing or unknown licenses", () => {
		expect(evaluateLicense({ intendedUse: "ephemeral-adopt" }).verdict).toBe("review");
		expect(evaluateLicense({ declaredLicense: "WTF-CUSTOM", intendedUse: "ephemeral-adopt" }).verdict).toBe("review");
	});

	it("requires transitive inventory for permanent permissive adoption", () => {
		const result = evaluateLicense({ declaredLicense: "MIT", intendedUse: "permanent-adopt" });
		expect(result.verdict).toBe("review");
		expect(result.reasons.some((r) => r.includes("transitive"))).toBe(true);
	});

	it("rejects transitive copyleft contamination", () => {
		const result = evaluateLicense({
			declaredLicense: "MIT",
			transitiveLicenses: ["MIT", "GPL-3.0"],
			intendedUse: "permanent-adopt",
		});
		expect(result.verdict).toBe("reject");
	});
});

describe("evaluateLifecycleScripts", () => {
	it("exposes the lifecycle script names it gates", () => {
		expect(LIFECYCLE_SCRIPT_NAMES).toContain("preinstall");
		expect(LIFECYCLE_SCRIPT_NAMES).toContain("install");
		expect(LIFECYCLE_SCRIPT_NAMES).toContain("postinstall");
		expect(LIFECYCLE_SCRIPT_NAMES).toContain("prepare");
	});

	it("passes when no lifecycle scripts are declared", () => {
		const result = evaluateLifecycleScripts({ packageJsonScripts: { build: "tsc", test: "vitest" } });
		expect(result.verdict).toBe("pass");
		expect(result.declaredScripts).toEqual([]);
		expect(result.requiresException).toBe(false);
	});

	it("rejects undeclared lifecycle scripts by default", () => {
		const result = evaluateLifecycleScripts({ packageJsonScripts: { postinstall: "node setup.js" } });
		expect(result.verdict).toBe("reject");
		expect(result.declaredScripts).toEqual(["postinstall"]);
		expect(result.requiresException).toBe(true);
	});

	it("requires a reviewed allowlist entry when scripts are opted in", () => {
		const review = evaluateLifecycleScripts({
			packageJsonScripts: { postinstall: "node setup.js" },
			allowLifecycleScripts: true,
			source: "npm:pi-sandbox@0.4.3",
		});
		expect(review.verdict).toBe("review");

		const allowed = evaluateLifecycleScripts({
			packageJsonScripts: { postinstall: "node setup.js" },
			allowLifecycleScripts: true,
			source: "npm:pi-sandbox@0.4.3",
			identity: "npm:pi-sandbox",
			reviewedAllowlist: ["npm:pi-sandbox@0.4.3"],
		});
		expect(allowed.verdict).toBe("pass");
		expect(allowed.requiresException).toBe(true);
	});
});

describe("scanLegacyOmkCompatibility", () => {
	it("flags hardcoded legacy state paths as legacy-hardcoded", () => {
		const result = scanLegacyOmkCompatibility([
			{ path: "index.ts", text: 'const dir = "~/.pi/agents";\nwriteState(dir);\n' },
		]);
		expect(result.verdict).toBe("legacy-hardcoded");
		expect(result.findings.some((f) => f.severity === "block")).toBe(true);
	});

	it("flags pi CLI invocations as blocking", () => {
		const result = scanLegacyOmkCompatibility([{ path: "setup.sh", text: "pi install\npi update\n" }]);
		expect(result.verdict).toBe("legacy-hardcoded");
	});

	it("treats omk paths with no pi state as omk-native", () => {
		const result = scanLegacyOmkCompatibility([
			{ path: "index.ts", text: 'const out = ".omk/runs/result.md";\nsaveArtifact(out);\n' },
		]);
		expect(result.verdict).toBe("omk-native");
	});

	it("flags legacy pi imports as blocking", () => {
		const result = scanLegacyOmkCompatibility([
			{ path: "index.ts", text: 'import { x } from "@mariozechner/pi-tui";\n' },
		]);
		expect(result.findings.some((f) => f.kind === "legacy-import")).toBe(true);
		expect(result.findings.some((f) => f.severity === "block")).toBe(true);
		expect(result.verdict).toBe("legacy-hardcoded");
	});

	it("returns unknown for source with no signals", () => {
		const result = scanLegacyOmkCompatibility([{ path: "index.ts", text: "export const value = 1;\n" }]);
		expect(result.verdict).toBe("unknown");
	});
});

describe("scanSourceCapabilities", () => {
	it("detects credential file reads", () => {
		const result = scanSourceCapabilities([
			{ path: "index.ts", text: 'readFileSync("~/.ssh/id_rsa");\nreadFileSync("auth.json");\n' },
		]);
		expect(result.capabilities).toContain("credential-read");
	});

	it("detects process, network and filesystem-write capabilities", () => {
		const result = scanSourceCapabilities([
			{
				path: "index.ts",
				text: 'import { spawn } from "node:child_process";\nawait fetch("https://x");\nwriteFileSync("a.txt", "b");\n',
			},
		]);
		expect(result.capabilities).toContain("child-process");
		expect(result.capabilities).toContain("network");
		expect(result.capabilities).toContain("filesystem-write");
	});

	it("detects host sockets and browser control", () => {
		const result = scanSourceCapabilities([
			{ path: "index.ts", text: 'connect("/var/run/docker.sock");\nimport pptr from "puppeteer";\n' },
		]);
		expect(result.capabilities).toContain("host-socket");
		expect(result.capabilities).toContain("browser-control");
	});

	it("returns no capabilities for inert source", () => {
		const result = scanSourceCapabilities([{ path: "index.ts", text: "export const add = (a, b) => a + b;\n" }]);
		expect(result.capabilities).toEqual([]);
	});
});

describe("decideAdoption", () => {
	it("rejects when the pin is invalid", () => {
		const result = decideAdoption({
			intendedUse: "permanent-adopt",
			risk: "low",
			pinOk: false,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
		});
		expect(result.adoption).toBe("reject");
		expect(result.rejectedReasons).toContain("exact-pin-required");
	});

	it("allows pinned native clean-room even when upstream license is blocked", () => {
		const result = decideAdoption({
			intendedUse: "native",
			nativeSpec: { exists: true, trackId: "checkpoint" },
			risk: "high",
			pinOk: true,
			licenseVerdict: "reject",
			lifecycleVerdict: "reject",
			pathCompatibility: "legacy-hardcoded",
			capabilities: ["credential-read"],
		});
		// native does not import or copy upstream code, so license/path/capabilities are advisory after pinning
		expect(result.adoption).toBe("native");
	});

	it("rejects upstream adoption that reads credentials", () => {
		const result = decideAdoption({
			intendedUse: "ephemeral-adopt",
			risk: "high",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: ["credential-read"],
		});
		expect(result.adoption).toBe("reject");
		expect(result.rejectedReasons).toContain("reads-credentials");
	});

	it("downgrades permanent adoption to trial when review is still pending", () => {
		const result = decideAdoption({
			intendedUse: "permanent-adopt",
			risk: "low",
			pinOk: true,
			licenseVerdict: "review",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
		});
		expect(result.adoption).toBe("ephemeral-trial");
	});

	it("blocks high-risk permanent adoption", () => {
		const result = decideAdoption({
			intendedUse: "permanent-adopt",
			risk: "high",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: ["host-socket"],
		});
		expect(result.adoption).toBe("reject");
	});

	it("permits clean permanent adoption", () => {
		const result = decideAdoption({
			intendedUse: "permanent-adopt",
			risk: "low",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
		});
		expect(result.adoption).toBe("permanent-package");
	});
});

describe("procureCandidate", () => {
	const baseInput = (overrides: Partial<CandidatePackageInput>): CandidatePackageInput => ({
		name: "pi-sandbox",
		exactVersion: "0.4.3",
		intendedUse: "ephemeral-adopt",
		expectedResources: ["extension"],
		...overrides,
	});

	it("approves a clean permissive ephemeral candidate for trial", () => {
		const review = procureCandidate({
			candidate: baseInput({}),
			declaredLicense: "MIT",
			packageJsonScripts: { build: "tsc" },
			sources: [{ path: "index.ts", text: 'export const ok = ".omk/runs";\n' }],
		});
		expect(review.normalized?.source).toBe("npm:pi-sandbox@0.4.3");
		expect(review.licenseVerdict).toBe("pass");
		expect(review.lifecycleVerdict).toBe("pass");
		expect(review.adoption).toBe("ephemeral-trial");
	});

	it("rejects a candidate with a mutable version", () => {
		const review = procureCandidate({
			candidate: baseInput({ exactVersion: "latest" }),
			declaredLicense: "MIT",
		});
		expect(review.normalized).toBeNull();
		expect(review.adoption).toBe("reject");
		expect(review.rejectedReasons).toContain("exact-pin-required");
	});

	it("rejects a GPL candidate intended for permanent adoption", () => {
		const review = procureCandidate({
			candidate: baseInput({ intendedUse: "permanent-adopt" }),
			declaredLicense: "GPL-3.0",
			transitiveLicenses: ["GPL-3.0"],
			packageJsonScripts: { build: "tsc" },
		});
		expect(review.licenseVerdict).toBe("reject");
		expect(review.adoption).toBe("reject");
	});

	it("rejects a candidate that declares undisclosed lifecycle scripts", () => {
		const review = procureCandidate({
			candidate: baseInput({}),
			declaredLicense: "MIT",
			packageJsonScripts: { postinstall: "node steal.js" },
		});
		expect(review.lifecycleVerdict).toBe("reject");
		expect(review.adoption).toBe("reject");
	});

	it("rejects a candidate whose source reads credentials", () => {
		const review = procureCandidate({
			candidate: baseInput({}),
			declaredLicense: "MIT",
			packageJsonScripts: { build: "tsc" },
			sources: [{ path: "index.ts", text: 'readFileSync("~/.aws/credentials");\n' }],
		});
		expect(review.capabilities).toContain("credential-read");
		expect(review.adoption).toBe("reject");
		expect(review.rejectedReasons).toContain("reads-credentials");
	});

	it("rejects a candidate with hardcoded legacy state paths", () => {
		const review = procureCandidate({
			candidate: baseInput({}),
			declaredLicense: "MIT",
			packageJsonScripts: { build: "tsc" },
			sources: [{ path: "index.ts", text: 'const dir = "~/.pi/agents";\n' }],
		});
		expect(review.pathCompatibility).toBe("legacy-hardcoded");
		expect(review.adoption).toBe("reject");
	});

	it("keeps a pinned native reimplementation candidate native regardless of upstream risk", () => {
		const review = procureCandidate({
			candidate: baseInput({
				name: "@ayulab/pi-rewind",
				exactVersion: "0.1.0",
				intendedUse: "native",
				nativeSpec: { exists: true, trackId: "recovery-checkpoint" },
			}),
			declaredLicense: "GPL-3.0",
		});
		expect(review.adoption).toBe("native");
	});

	it("downgrades permanent permissive adoption to trial when transitive inventory is missing", () => {
		const review = procureCandidate({
			candidate: baseInput({ intendedUse: "permanent-adopt" }),
			declaredLicense: "MIT",
			packageJsonScripts: { build: "tsc" },
			sources: [{ path: "index.ts", text: 'export const ok = ".omk/runs";\n' }],
		});
		expect(review.licenseVerdict).toBe("review");
		expect(review.adoption).toBe("ephemeral-trial");
	});

	it("returns deferred for a native candidate missing an exact pin", () => {
		const review = procureCandidate({
			candidate: baseInput({ name: "@ayulab/pi-rewind", exactVersion: undefined, intendedUse: "native" }),
			declaredLicense: "MIT",
		});
		expect(review.adoption).toBe("deferred");
		expect(review.deferredReason).toBe("missing-exact-pin");
	});

	it("returns reference-only for a pinned workflow reference candidate", () => {
		const review = procureCandidate({
			candidate: {
				name: "@juicesharp/rpiv-workflow",
				exactVersion: "0.1.0",
				intendedUse: "reference",
				declaredUse: "workflow-reference",
				expectedResources: ["skill"],
			},
			declaredLicense: "MIT",
		});
		expect(review.adoption).toBe("reference-only");
	});
});

describe("deferred adoption outcomes", () => {
	it("defers native and advisory candidates when the exact pin is missing", () => {
		for (const intendedUse of ["native", "reference", "advisory", "report-only", "measurement-gated"] as const) {
			const result = decideAdoption({
				intendedUse,
				risk: "low",
				pinOk: false,
				licenseVerdict: "pass",
				lifecycleVerdict: "pass",
				pathCompatibility: "omk-native",
				capabilities: [],
			});
			expect(result.adoption).toBe("deferred");
			expect(result.deferredReason).toBe("missing-exact-pin");
		}
	});

	it("still rejects permanent adoption with a missing pin", () => {
		const result = decideAdoption({
			intendedUse: "permanent-adopt",
			risk: "low",
			pinOk: false,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
		});
		expect(result.adoption).toBe("reject");
		expect(result.rejectedReasons).toContain("exact-pin-required");
		expect(result.deferredReason).toBeUndefined();
	});
});

describe("first-class policy adoption outcomes", () => {
	it("maps pinned reference, advisory and report-only uses to their constrained outcomes", () => {
		for (const [intendedUse, adoption] of [
			["reference", "reference-only"],
			["advisory", "advisory-only"],
			["report-only", "report-only"],
		] as const) {
			const result = decideAdoption({
				intendedUse,
				risk: "low",
				pinOk: true,
				licenseVerdict: "pass",
				lifecycleVerdict: "pass",
				pathCompatibility: "omk-native",
				capabilities: [],
			});
			expect(result.adoption).toBe(adoption);
		}
	});

	it("requires metrics for measurement-gated adoption", () => {
		const missing = decideAdoption({
			intendedUse: "measurement-gated",
			risk: "low",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
			metrics: [],
		});
		expect(missing.adoption).toBe("deferred");
		expect(missing.deferredReason).toBe("pending-metrics");

		const present = decideAdoption({
			intendedUse: "measurement-gated",
			risk: "low",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
			metrics: ["cache-hit-ratio", "cost"],
		});
		expect(present.adoption).toBe("measurement-gated");
	});
});

describe("nativeSpec precondition", () => {
	it("defers native adoption when nativeSpec does not exist", () => {
		const result = decideAdoption({
			intendedUse: "native",
			nativeSpec: { exists: false, trackId: "sandbox-policy" },
			risk: "low",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
		});
		expect(result.adoption).toBe("deferred");
		expect(result.deferredReason).toBe("pending-native-spec");
	});

	it("prioritizes missing exact pin over missing nativeSpec", () => {
		const result = decideAdoption({
			intendedUse: "native",
			nativeSpec: { exists: false },
			risk: "low",
			pinOk: false,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
		});
		expect(result.adoption).toBe("deferred");
		expect(result.deferredReason).toBe("missing-exact-pin");
	});
});

describe("lifecycle exact allowlist", () => {
	const scripts = { postinstall: "node setup.js" };

	it("passes an exact reviewed allowlist entry by default", () => {
		const result = evaluateLifecycleScripts({
			packageJsonScripts: scripts,
			allowLifecycleScripts: true,
			source: "npm:pi-sandbox@0.4.3",
			reviewedAllowlist: ["npm:pi-sandbox@0.4.3"],
		});
		expect(result.verdict).toBe("pass");
	});

	it("reviews an identity-only allowlist entry under exact mode", () => {
		const result = evaluateLifecycleScripts({
			packageJsonScripts: scripts,
			allowLifecycleScripts: true,
			source: "npm:pi-sandbox@0.4.3",
			identity: "npm:pi-sandbox",
			reviewedAllowlist: ["npm:pi-sandbox"],
		});
		expect(result.verdict).toBe("review");
		expect(result.reasons.some((reason) => reason.includes("exact-allowlist"))).toBe(true);
	});

	it("passes an identity-only match when lifecycleAllowlistMode is identity", () => {
		const result = evaluateLifecycleScripts({
			packageJsonScripts: scripts,
			allowLifecycleScripts: true,
			source: "npm:pi-sandbox@0.4.3",
			identity: "npm:pi-sandbox",
			reviewedAllowlist: ["npm:pi-sandbox"],
			lifecycleAllowlistMode: "identity",
		});
		expect(result.verdict).toBe("pass");
	});
});

describe("release age and maintainer trust", () => {
	const now = new Date("2026-06-21T00:00:00Z");

	it("evaluates release age without I/O", () => {
		expect(evaluateReleaseAge({ publishedAt: "2026-06-15T00:00:00Z", minReleaseAgeDays: 2, now }).verdict).toBe(
			"pass",
		);
		expect(evaluateReleaseAge({ publishedAt: "2026-06-20T00:00:00Z", minReleaseAgeDays: 2, now }).verdict).toBe(
			"defer",
		);
		expect(evaluateReleaseAge({ minReleaseAgeDays: 2, now }).verdict).toBe("review");
	});

	it("uses maintainer trust as a risk floor", () => {
		expect(assessMaintainerTrust({ verifiedPublisher: false, accountAgeDays: 30 })).toBe("high");
		expect(assessMaintainerTrust({ verifiedPublisher: false, accountAgeDays: 90 })).toBe("medium");
		expect(assessMaintainerTrust({ verifiedPublisher: true, accountAgeDays: 30 })).toBe("low");
		expect(inferRisk([], "pass", "pass", { verifiedPublisher: false, accountAgeDays: 30 })).toBe("high");
	});
});

describe("declaredUse policy overlays", () => {
	it("requires a backend strategy for sandbox packages", () => {
		const blocked = decideAdoption({
			intendedUse: "permanent-adopt",
			risk: "low",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
			policyOverlay: { declaredUse: "sandbox" },
		});
		expect(blocked.adoption).toBe("reject");
		expect(blocked.rejectedReasons).toContain("sandbox-requires-backend");

		const trial = decideAdoption({
			intendedUse: "ephemeral-adopt",
			risk: "low",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
			policyOverlay: { declaredUse: "sandbox", sandboxBackend: "seatbelt" },
		});
		expect(trial.adoption).toBe("ephemeral-trial");
		expect(trial.rejectedReasons).toContain("sandbox-risk-floor-high");
	});

	it("requires export policy before permanent observability adoption", () => {
		const result = decideAdoption({
			intendedUse: "permanent-adopt",
			risk: "low",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: ["network"],
			policyOverlay: { declaredUse: "observability" },
		});
		expect(result.adoption).toBe("deferred");
		expect(result.deferredReason).toBe("pending-export-policy");
	});

	it("keeps advisor and quality packages report-only", () => {
		const result = decideAdoption({
			intendedUse: "advisory",
			risk: "low",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: ["filesystem-write"],
			policyOverlay: { declaredUse: "advisor", mutationMode: "report-only" },
		});
		expect(result.adoption).toBe("report-only");
		expect(result.rejectedReasons).toContain("report-only-mutation-denied");
	});

	it("rejects memory packages that read credentials", () => {
		const result = decideAdoption({
			intendedUse: "advisory",
			risk: "low",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: ["credential-read"],
			policyOverlay: { declaredUse: "memory", advisoryOnly: true, replayInput: false },
		});
		expect(result.adoption).toBe("reject");
		expect(result.rejectedReasons).toContain("memory-credential-read-rejected");
	});

	it("forces workflow-reference packages to reference-only", () => {
		const result = decideAdoption({
			intendedUse: "permanent-adopt",
			risk: "low",
			pinOk: true,
			licenseVerdict: "pass",
			lifecycleVerdict: "pass",
			pathCompatibility: "omk-native",
			capabilities: [],
			policyOverlay: { declaredUse: "workflow-reference", activateAlongsideScheduler: false },
		});
		expect(result.adoption).toBe("reference-only");
	});
});

const LEGACY_LIBRARY_FIXTURES: CandidatePackageInput[] = [
	{
		name: "pi-sandbox",
		exactVersion: "0.4.3",
		intendedUse: "native",
		declaredUse: "sandbox",
		nativeSpec: { exists: true, trackId: "sandbox-policy" },
		expectedResources: ["extension"],
		policyOverlay: { declaredUse: "sandbox", sandboxBackend: "seatbelt" },
	},
	{
		name: "pi-loadout",
		exactVersion: "0.0.35",
		intendedUse: "native",
		declaredUse: "loadout",
		nativeSpec: { exists: true, trackId: "loadout-schema" },
		expectedResources: ["extension"],
	},
	{
		name: "@ayulab/pi-rewind",
		intendedUse: "native",
		declaredUse: "checkpoint",
		nativeSpec: { exists: true, trackId: "recovery-checkpoint" },
		expectedResources: ["extension"],
	},
	{
		name: "@braintrust/pi-extension",
		exactVersion: "0.7.0",
		intendedUse: "advisory",
		declaredUse: "observability",
		expectedResources: ["extension"],
	},
	{
		name: "@juicesharp/rpiv-advisor",
		exactVersion: "1.20.0",
		intendedUse: "advisory",
		declaredUse: "advisor",
		expectedResources: ["skill"],
	},
	{
		name: "pi-readseek",
		exactVersion: "0.3.24",
		intendedUse: "native",
		declaredUse: "checkpoint",
		nativeSpec: { exists: true, trackId: "read-anchors" },
		expectedResources: ["extension"],
		excludeGroup: "code-intel-anchor",
	},
	{
		name: "pi-shazam",
		exactVersion: "0.13.1",
		intendedUse: "native",
		declaredUse: "checkpoint",
		nativeSpec: { exists: true, trackId: "read-anchors" },
		expectedResources: ["extension"],
		excludeGroup: "code-intel-anchor",
	},
	{
		name: "pi-simplify",
		exactVersion: "0.2.2",
		intendedUse: "advisory",
		declaredUse: "quality",
		expectedResources: ["skill"],
	},
	{
		name: "@juicesharp/rpiv-ask-user-question",
		intendedUse: "advisory",
		declaredUse: "memory",
		expectedResources: ["prompt"],
	},
	{
		name: "@juicesharp/rpiv-todo",
		intendedUse: "reference",
		declaredUse: "workflow-reference",
		expectedResources: ["prompt"],
	},
	{
		name: "pi-cache-optimizer",
		intendedUse: "measurement-gated",
		declaredUse: "cache-perf",
		expectedResources: ["extension"],
	},
	{
		name: "pi-hermes-memory",
		intendedUse: "advisory",
		declaredUse: "memory",
		expectedResources: ["extension"],
	},
	{
		name: "@juicesharp/rpiv-workflow",
		intendedUse: "reference",
		declaredUse: "workflow-reference",
		expectedResources: ["skill"],
	},
];

describe("procureCandidateBatch", () => {
	it("returns a coverage matrix for all 13 legacy library fixtures", () => {
		const result = procureCandidateBatch({ candidates: LEGACY_LIBRARY_FIXTURES });
		expect(result.coverage).toHaveLength(13);
		expect(result.coverage.every((row) => row.adoption !== undefined)).toBe(true);
		expect(result.globalBlockers).toEqual([]);
	});

	it("defers every fixture missing an exact pin", () => {
		const result = procureCandidateBatch({ candidates: LEGACY_LIBRARY_FIXTURES });
		const missingPin = [
			"@ayulab/pi-rewind",
			"@juicesharp/rpiv-ask-user-question",
			"@juicesharp/rpiv-todo",
			"pi-cache-optimizer",
			"pi-hermes-memory",
			"@juicesharp/rpiv-workflow",
		];
		for (const name of missingPin) {
			const row = result.coverage.find((entry) => entry.candidate.name === name);
			expect(row?.adoption).toBe("deferred");
			expect(row?.deferredReason).toBe("missing-exact-pin");
		}
	});

	it("enforces code-intel-anchor mutual exclusion between pi-readseek and pi-shazam", () => {
		const result = procureCandidateBatch({ candidates: LEGACY_LIBRARY_FIXTURES });
		const readseek = result.coverage.find((entry) => entry.candidate.name === "pi-readseek");
		const shazam = result.coverage.find((entry) => entry.candidate.name === "pi-shazam");
		const adopted = [readseek, shazam].filter((row) => row?.adoption === "native");
		expect(adopted).toHaveLength(1);
		const excluded = [readseek, shazam].find((row) => row?.adoption !== "native");
		expect(excluded?.adoption).toBe("deferred");
		expect(excluded?.deferredReason).toBe("group-excluded");
	});

	it("forces rpiv-workflow to reference-only once pinned", () => {
		const fixture = LEGACY_LIBRARY_FIXTURES.find((candidate) => candidate.name === "@juicesharp/rpiv-workflow");
		expect(fixture).toBeDefined();
		const pinned: CandidatePackageInput = { ...fixture!, exactVersion: "0.1.0" };
		const result = procureCandidateBatch({ candidates: [pinned] });
		expect(result.coverage[0].adoption).toBe("reference-only");
	});

	it("keeps Braintrust observability advisory-only until an export policy is supplied", () => {
		const result = procureCandidateBatch({ candidates: LEGACY_LIBRARY_FIXTURES });
		const braintrust = result.coverage.find((entry) => entry.candidate.name === "@braintrust/pi-extension");
		expect(braintrust?.adoption).toBe("advisory-only");
	});
});
