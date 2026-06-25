import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	assessGalleryTrialGate,
	buildGalleryInstallSpec,
	buildGalleryInstallSpecFromReview,
	classifyGalleryResourceTypes,
	dedupeGalleryEntries,
	filterGalleryEntriesByType,
	filterManifestEntriesInsideRoot,
	hasGalleryKeyword,
	inferExtensionCapabilityBadges,
	isValidGalleryImageUrl,
	isValidGalleryVideoUrl,
	normalizeGalleryManifest,
	resolveGalleryTypeFacet,
	selectGalleryPreview,
} from "../src/core/package-gallery.ts";
import { type ProcurementReview, procureCandidate } from "../src/core/package-procurement.ts";

const FULL_COMMIT_SHA = "1234567890abcdef1234567890abcdef12345678";

describe("package gallery algorithms", () => {
	it("normalizes omk manifests before legacy pi manifests", () => {
		expect(
			normalizeGalleryManifest({
				pi: { themes: ["legacy.json"], video: "https://cdn.example/legacy.mp4" },
				omk: {
					extensions: [" index.ts ", ""],
					themes: ["theme.json"],
					video: "https://cdn.example/demo.mp4",
					image: 42,
					description: " Neon theme ",
				},
			}),
		).toEqual({
			manifestKey: "omk",
			extensions: ["index.ts"],
			skills: [],
			prompts: [],
			themes: ["theme.json"],
			video: "https://cdn.example/demo.mp4",
			image: undefined,
			description: "Neon theme",
		});
	});

	it("falls back to legacy pi manifests and ignores invalid arrays", () => {
		expect(
			normalizeGalleryManifest({
				pi: { extensions: "extension.ts", skills: [" skill.md "], themes: ["", "theme.json"] },
			}),
		).toEqual({
			manifestKey: "pi",
			extensions: [],
			skills: ["skill.md"],
			prompts: [],
			themes: ["theme.json"],
			video: undefined,
			image: undefined,
			description: undefined,
		});
		expect(normalizeGalleryManifest({})).toBeNull();
		expect(normalizeGalleryManifest(null)).toBeNull();
	});

	it("detects OMK and legacy gallery keywords", () => {
		expect(hasGalleryKeyword({ keywords: ["omk-package"] })).toBe(true);
		expect(hasGalleryKeyword({ keywords: ["pi-package"] })).toBe(true);
		expect(hasGalleryKeyword({ keywords: ["other"] })).toBe(false);
		expect(hasGalleryKeyword(null)).toBe(false);
	});

	it("classifies resource types from manifests and convention directories", () => {
		const manifest = normalizeGalleryManifest({
			omk: { extensions: ["index.ts"], themes: ["theme.json"], skills: [] },
		});

		expect(classifyGalleryResourceTypes(manifest, ["skills", "themes"])).toEqual(["extension", "skill", "theme"]);
		expect(classifyGalleryResourceTypes(null, ["prompts"])).toEqual(["prompt"]);
		expect(classifyGalleryResourceTypes(null)).toEqual([]);
	});

	it("resolves and applies type facets with type=theme semantics", () => {
		expect(resolveGalleryTypeFacet("Theme")).toBe("theme");
		expect(resolveGalleryTypeFacet("themes")).toBe("theme");
		expect(resolveGalleryTypeFacet("extension")).toBe("extension");
		expect(resolveGalleryTypeFacet("bogus")).toBeUndefined();

		const entries = [
			{ name: "theme-a", resourceTypes: ["theme"] as const },
			{ name: "extension-a", resourceTypes: ["extension"] as const },
			{ name: "both", resourceTypes: ["extension", "theme"] as const },
		];

		expect(filterGalleryEntriesByType(entries, "theme").map((entry) => entry.name)).toEqual(["theme-a", "both"]);
		expect(filterGalleryEntriesByType(entries, "bogus")).toEqual([]);
		expect(filterGalleryEntriesByType(entries, undefined)).toEqual(entries);
	});

	it("validates gallery media URLs with https and extension allowlists", () => {
		expect(isValidGalleryVideoUrl("https://cdn.example/demo.mp4?token=abc")).toBe(true);
		expect(isValidGalleryVideoUrl("http://cdn.example/demo.mp4")).toBe(false);
		expect(isValidGalleryVideoUrl("https://cdn.example/demo.webm")).toBe(false);
		expect(isValidGalleryVideoUrl("data:video/mp4;base64,abc")).toBe(false);
		expect(isValidGalleryVideoUrl("https://user:pass@cdn.example/demo.mp4")).toBe(false);

		expect(isValidGalleryImageUrl("https://cdn.example/demo.png")).toBe(true);
		expect(isValidGalleryImageUrl("https://cdn.example/demo.jpeg?x=1")).toBe(true);
		expect(isValidGalleryImageUrl("https://cdn.example/demo.svg")).toBe(false);
		expect(isValidGalleryImageUrl("http://cdn.example/demo.png")).toBe(false);
		expect(isValidGalleryImageUrl(undefined)).toBe(false);
	});

	it("selects preview media with video before image and theme generated fallback", () => {
		expect(
			selectGalleryPreview({
				video: "https://cdn.example/demo.mp4",
				image: "https://cdn.example/demo.png",
				resourceTypes: ["theme"],
				themeName: "omk-neon-ops",
			}),
		).toEqual({ kind: "video", url: "https://cdn.example/demo.mp4" });
		expect(
			selectGalleryPreview({
				video: "http://cdn.example/demo.mp4",
				image: "https://cdn.example/demo.webp",
				resourceTypes: ["theme"],
			}),
		).toEqual({ kind: "image", url: "https://cdn.example/demo.webp" });
		expect(selectGalleryPreview({ resourceTypes: ["theme"], themeName: "omk-neon-ops" })).toEqual({
			kind: "generated-theme",
			marker: "omk-neon-ops",
		});
		expect(selectGalleryPreview({ resourceTypes: ["extension"] })).toBeNull();
	});

	it("filters manifest entries that escape the package root", () => {
		const root = resolve("/tmp/package-gallery-root/pkg");

		expect(
			filterManifestEntriesInsideRoot(root, [
				"themes/dark.json",
				"themes/../themes/light.json",
				"../../../etc/passwd",
				"/abs/evil.ts",
				"",
			]),
		).toEqual(["themes/dark.json", "themes/light.json"]);
	});

	it("filters manifest entries by realpath so symlink escapes are rejected", () => {
		const root = join(tmpdir(), `package-gallery-realpath-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const outside = join(tmpdir(), `package-gallery-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`);

		try {
			mkdirSync(join(root, "themes"), { recursive: true });
			mkdirSync(outside, { recursive: true });
			writeFileSync(join(root, "themes", "dark.json"), "{}");
			writeFileSync(join(outside, "evil.json"), "{}");
			symlinkSync(join(root, "themes", "dark.json"), join(root, "inside-link.json"));
			symlinkSync(join(outside, "evil.json"), join(root, "escape-link.json"));

			expect(
				filterManifestEntriesInsideRoot(root, [
					"themes/dark.json",
					"inside-link.json",
					"escape-link.json",
					"../outside.json",
				]),
			).toEqual(["themes/dark.json", "inside-link.json"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("builds install specs without introducing a URL source type", () => {
		expect(buildGalleryInstallSpec({ kind: "npm", name: "@scope/theme", version: "1.2.3" }, false)).toEqual({
			kind: "npm",
			source: "npm:@scope/theme@1.2.3",
			installCommand: "omk install npm:@scope/theme@1.2.3",
			tryEphemeralCommand: "omk -e npm:@scope/theme@1.2.3",
			trust: "declarative",
		});
		expect(buildGalleryInstallSpec({ kind: "git", repo: "github.com/acme/pkg", ref: FULL_COMMIT_SHA }, true)).toEqual(
			{
				kind: "git",
				source: `git:github.com/acme/pkg@${FULL_COMMIT_SHA}`,
				installCommand: `omk install git:github.com/acme/pkg@${FULL_COMMIT_SHA}`,
				tryEphemeralCommand: `omk -e git:github.com/acme/pkg@${FULL_COMMIT_SHA}`,
				trust: "code-execution",
			},
		);
		expect(buildGalleryInstallSpec({ kind: "local", path: "./theme-pack" }, false, { local: true })).toEqual({
			kind: "local",
			source: "./theme-pack",
			installCommand: "omk install ./theme-pack -l",
			tryEphemeralCommand: "omk -e ./theme-pack",
			trust: "declarative",
		});
	});

	it("refuses gallery install specs for mutable remote sources", () => {
		expect(() => buildGalleryInstallSpec({ kind: "npm", name: "pkg" }, false)).toThrow(/exact pinned version/);
		expect(() => buildGalleryInstallSpec({ kind: "npm", name: "pkg", version: "latest" }, false)).toThrow(
			/exact pinned version/,
		);
		expect(() => buildGalleryInstallSpec({ kind: "git", repo: "github.com/acme/pkg" }, true)).toThrow(
			/full commit SHA/,
		);
		expect(() => buildGalleryInstallSpec({ kind: "git", repo: "github.com/acme/pkg", ref: "main" }, true)).toThrow(
			/full commit SHA/,
		);
	});

	it("derives install trust from procurement review instead of manifest claims", () => {
		const cleanExtensionReview = {
			pinned: true,
			capabilities: [],
			adoption: "ephemeral-trial",
			rejectedReasons: [],
			candidate: { expectedResources: ["extension"] },
		} as const;

		expect(
			buildGalleryInstallSpecFromReview(
				{ kind: "npm", name: "@acme/extension", version: "1.2.3" },
				cleanExtensionReview,
			).trust,
		).toBe("code-execution");
		expect(() =>
			buildGalleryInstallSpecFromReview(
				{ kind: "npm", name: "@acme/extension", version: "1.2.3" },
				{ ...cleanExtensionReview, pinned: false },
			),
		).toThrow(/Gallery trial blocked/);
	});

	it("infers extension capability badges from code while ignoring comments and strings", () => {
		expect(
			inferExtensionCapabilityBadges(`
				// omk.registerTool({ name: "fake" })
				const example = "omk.registerCommand('fake')";
				omk.registerTool({ name: "real" });
				omk.on("tool_call", handler);
				omk.registerProvider("demo", provider);
				omk.registerMessageRenderer(renderer);
			`),
		).toEqual(["tools", "hooks", "provider", "ui"]);
		expect(inferExtensionCapabilityBadges("registerToolbar(); other.registerTool();")).toEqual([]);
		expect(inferExtensionCapabilityBadges('omk.on("session_before_compact", handler);')).toEqual([
			"hooks",
			"compaction",
		]);
	});

	it("deduplicates cards by npm name, git repo without ref, and resolved local path", () => {
		const entries = [
			{ id: "a", identity: { kind: "npm", name: "@scope/pkg" } as const },
			{ id: "b", identity: { kind: "npm", name: "@scope/pkg" } as const },
			{ id: "c", identity: { kind: "git", repo: "github.com/acme/pkg", ref: "v1" } as const },
			{ id: "d", identity: { kind: "git", repo: "github.com/acme/pkg", ref: "v2" } as const },
			{ id: "e", identity: { kind: "local", path: "./pkg" } as const },
			{ id: "f", identity: { kind: "local", path: "./pkg" } as const },
		];

		expect(dedupeGalleryEntries(entries).map((entry) => entry.id)).toEqual(["a", "c", "e"]);
	});
});

describe("gallery trial procurement gate (G9)", () => {
	it("admits a pinned, contained, non-rejected package as an ephemeral trial", () => {
		const status = assessGalleryTrialGate(
			{ kind: "npm", name: "@scope/pkg" },
			{ pinned: true, capabilities: [], adoption: "ephemeral-trial", rejectedReasons: [] },
		);

		expect(status).toEqual({
			outcome: "admitted",
			identity: "npm:@scope/pkg",
			adoption: "ephemeral-trial",
			pinned: true,
			reasons: [],
		});
	});

	it("blocks unpinned sources with exact-pin-required before any trial side effect", () => {
		const status = assessGalleryTrialGate(
			{ kind: "npm", name: "pkg" },
			{ pinned: false, capabilities: [], adoption: "reject", rejectedReasons: ["exact-pin-required"] },
		);

		expect(status.outcome).toBe("blocked");
		expect(status.pinned).toBe(false);
		expect(status.reasons).toContain("exact-pin-required");
	});

	it("blocks credential-read capability even when procurement would otherwise admit", () => {
		const status = assessGalleryTrialGate(
			{ kind: "git", repo: "github.com/acme/pkg", ref: "v1" },
			{
				pinned: true,
				capabilities: ["network", "credential-read"],
				adoption: "reject",
				rejectedReasons: ["reads-credentials"],
			},
		);

		expect(status.outcome).toBe("blocked");
		expect(status.reasons).toContainEqual(expect.stringContaining("capability-hard-block: credential-read"));
		expect(status.reasons).toContain("reads-credentials");
	});

	it("blocks host-socket capability for unpromoted trials", () => {
		const status = assessGalleryTrialGate(
			{ kind: "npm", name: "pkg" },
			{
				pinned: true,
				capabilities: ["host-socket"],
				adoption: "ephemeral-trial",
				rejectedReasons: [],
			},
		);

		expect(status.outcome).toBe("blocked");
		expect(status.reasons).toContainEqual(expect.stringContaining("host-socket"));
	});

	it("admits reference-only and report-only adoptions when pinned and contained", () => {
		for (const adoption of ["reference-only", "report-only", "advisory-only"] as const) {
			const status = assessGalleryTrialGate(
				{ kind: "npm", name: "pkg" },
				{ pinned: true, capabilities: [], adoption, rejectedReasons: [] },
			);
			expect(status.outcome).toBe("admitted");
		}
	});

	it("blocks rejected adoption and surfaces the procurement rejection reasons verbatim", () => {
		const status = assessGalleryTrialGate(
			{ kind: "npm", name: "pkg" },
			{
				pinned: true,
				capabilities: [],
				adoption: "reject",
				rejectedReasons: ["license-blocked", "pi-hardcoded-paths"],
			},
		);

		expect(status.outcome).toBe("blocked");
		expect(status.adoption).toBe("reject");
		expect(status.reasons).toEqual(["license-blocked", "pi-hardcoded-paths"]);
	});

	it("blocks explicit license, lifecycle, and path gate failures even if adoption was not rejected", () => {
		const base = {
			pinned: true,
			capabilities: [],
			adoption: "ephemeral-trial",
			rejectedReasons: [],
		} as const;

		const licenseBlocked = assessGalleryTrialGate(
			{ kind: "npm", name: "pkg" },
			{
				...base,
				licenseVerdict: "reject",
			},
		);
		const lifecycleBlocked = assessGalleryTrialGate(
			{ kind: "npm", name: "pkg" },
			{
				...base,
				lifecycleVerdict: "reject",
			},
		);
		const pathBlocked = assessGalleryTrialGate(
			{ kind: "npm", name: "pkg" },
			{
				...base,
				pathCompatibility: "pi-hardcoded",
			},
		);

		expect(licenseBlocked).toMatchObject({ outcome: "blocked", reasons: ["license-blocked"] });
		expect(lifecycleBlocked).toMatchObject({ outcome: "blocked", reasons: ["lifecycle-scripts-blocked"] });
		expect(pathBlocked).toMatchObject({ outcome: "blocked", reasons: ["pi-hardcoded-paths"] });
	});

	it("normalizes identity independent of git ref and .git suffix", () => {
		const base = { pinned: true, capabilities: [], adoption: "ephemeral-trial", rejectedReasons: [] } as const;

		const withRef = assessGalleryTrialGate({ kind: "git", repo: "github.com/acme/pkg.git", ref: "v1" }, base);
		const withoutRef = assessGalleryTrialGate({ kind: "git", repo: "github.com/acme/pkg" }, base);

		expect(withRef.identity).toBe("git:github.com/acme/pkg");
		expect(withRef.identity).toBe(withoutRef.identity);
	});

	it("accepts a full ProcurementReview structurally and derives trust from its capability scan", () => {
		// Malicious source text: reads .env and opens a host docker socket. Procurement must
		// reject this regardless of the manifest's declared extensions; the gallery gate then
		// blocks the unpromoted trial off the capability scan, not the manifest claims.
		const review: ProcurementReview = procureCandidate({
			candidate: {
				name: "evil-pkg",
				exactVersion: "1.2.3",
				intendedUse: "ephemeral-adopt",
				expectedResources: ["extension"],
			},
			declaredLicense: "MIT",
			sources: [
				{
					path: "index.ts",
					text: 'const env = readFileSync(".env"); const sock = "/var/run/docker.sock";',
				},
			],
		});

		const status = assessGalleryTrialGate({ kind: "npm", name: "evil-pkg" }, review);

		expect(status.outcome).toBe("blocked");
		expect(status.adoption).toBe("reject");
		expect(status.pinned).toBe(true);
		expect(status.reasons).toContainEqual(expect.stringContaining("capability-hard-block"));
	});

	it("admits a clean pinned package review produced by full procurement", () => {
		const review: ProcurementReview = procureCandidate({
			candidate: {
				name: "clean-pkg",
				exactVersion: "1.2.3",
				intendedUse: "ephemeral-adopt",
				expectedResources: ["prompt"],
			},
			declaredLicense: "MIT",
			sources: [{ path: "README.md", text: "# clean package" }],
		});

		const status = assessGalleryTrialGate({ kind: "npm", name: "clean-pkg" }, review);

		expect(status.outcome).toBe("admitted");
		expect(status.pinned).toBe(true);
		expect(status.reasons).toEqual([]);
	});
});
