import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildGalleryInstallSpec,
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

	it("detects OMK and legacy Pi gallery keywords", () => {
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

	it("builds install specs without introducing a URL source type", () => {
		expect(buildGalleryInstallSpec({ kind: "npm", name: "@scope/theme", version: "1.2.3" }, false)).toEqual({
			kind: "npm",
			source: "npm:@scope/theme@1.2.3",
			installCommand: "omk install npm:@scope/theme@1.2.3",
			tryEphemeralCommand: "omk -e npm:@scope/theme@1.2.3",
			trust: "declarative",
		});
		expect(buildGalleryInstallSpec({ kind: "git", repo: "github.com/acme/pkg", ref: "v1" }, true)).toEqual({
			kind: "git",
			source: "git:github.com/acme/pkg@v1",
			installCommand: "omk install git:github.com/acme/pkg@v1",
			tryEphemeralCommand: "omk -e git:github.com/acme/pkg@v1",
			trust: "code-execution",
		});
		expect(buildGalleryInstallSpec({ kind: "local", path: "./theme-pack" }, false, { local: true })).toEqual({
			kind: "local",
			source: "./theme-pack",
			installCommand: "omk install ./theme-pack -l",
			tryEphemeralCommand: "omk -e ./theme-pack",
			trust: "declarative",
		});
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
