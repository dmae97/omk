import { isAbsolute, relative, resolve } from "node:path";

export type GalleryResourceType = "extension" | "skill" | "prompt" | "theme";
export type GalleryManifestKey = "omk" | "pi";
export type GalleryInstallSourceKind = "npm" | "git" | "local";
export type GalleryInstallTrust = "code-execution" | "declarative";
export type GalleryPreviewKind = "video" | "image" | "generated-theme";
export type ExtensionCapabilityBadge = "tools" | "commands" | "hooks" | "provider" | "ui" | "compaction";

export interface NormalizedGalleryManifest {
	manifestKey: GalleryManifestKey;
	extensions: string[];
	skills: string[];
	prompts: string[];
	themes: string[];
	video: string | undefined;
	image: string | undefined;
	description: string | undefined;
}

export interface GalleryTypedEntry {
	resourceTypes: readonly GalleryResourceType[];
}

export interface GalleryPreviewInput {
	video?: string;
	image?: string;
	resourceTypes: readonly GalleryResourceType[];
	themeName?: string;
}

export interface GalleryPreviewSelection {
	kind: GalleryPreviewKind;
	url?: string;
	marker?: string;
}

export type GalleryInstallSource =
	| { kind: "npm"; name: string; version?: string }
	| { kind: "git"; repo: string; ref?: string }
	| { kind: "local"; path: string };

export interface GalleryInstallOptions {
	local?: boolean;
}

export interface GalleryInstallSpec {
	kind: GalleryInstallSourceKind;
	source: string;
	installCommand: string;
	tryEphemeralCommand: string;
	trust: GalleryInstallTrust;
}

export type GalleryEntryIdentity =
	| { kind: "npm"; name: string }
	| { kind: "git"; repo: string; ref?: string }
	| { kind: "local"; path: string };

export interface GalleryEntryWithIdentity {
	identity: GalleryEntryIdentity;
}

const RESOURCE_ORDER: readonly GalleryResourceType[] = ["extension", "skill", "prompt", "theme"];
const CAPABILITY_ORDER: readonly ExtensionCapabilityBadge[] = [
	"tools",
	"commands",
	"hooks",
	"provider",
	"ui",
	"compaction",
];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"] as const;

const FACET_ALIASES: Readonly<Record<string, GalleryResourceType>> = {
	extension: "extension",
	extensions: "extension",
	skill: "skill",
	skills: "skill",
	prompt: "prompt",
	prompts: "prompt",
	theme: "theme",
	themes: "theme",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
}

function toOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function readManifestRecord(pkgJson: unknown): { key: GalleryManifestKey; manifest: Record<string, unknown> } | null {
	if (!isRecord(pkgJson)) return null;
	if (isRecord(pkgJson.omk)) return { key: "omk", manifest: pkgJson.omk };
	if (isRecord(pkgJson.pi)) return { key: "pi", manifest: pkgJson.pi };
	return null;
}

export function normalizeGalleryManifest(pkgJson: unknown): NormalizedGalleryManifest | null {
	const source = readManifestRecord(pkgJson);
	if (!source) return null;

	return {
		manifestKey: source.key,
		extensions: toStringArray(source.manifest.extensions),
		skills: toStringArray(source.manifest.skills),
		prompts: toStringArray(source.manifest.prompts),
		themes: toStringArray(source.manifest.themes),
		video: toOptionalString(source.manifest.video),
		image: toOptionalString(source.manifest.image),
		description: toOptionalString(source.manifest.description),
	};
}

export function hasGalleryKeyword(pkgJson: unknown): boolean {
	if (!isRecord(pkgJson) || !Array.isArray(pkgJson.keywords)) return false;
	return pkgJson.keywords.some((keyword) => keyword === "omk-package" || keyword === "pi-package");
}

function hasManifestResources(manifest: NormalizedGalleryManifest | null, type: GalleryResourceType): boolean {
	if (!manifest) return false;
	if (type === "extension") return manifest.extensions.length > 0;
	if (type === "skill") return manifest.skills.length > 0;
	if (type === "prompt") return manifest.prompts.length > 0;
	return manifest.themes.length > 0;
}

export function resolveGalleryTypeFacet(facet: string | undefined): GalleryResourceType | undefined {
	if (!facet) return undefined;
	return FACET_ALIASES[facet.trim().toLowerCase()];
}

export function classifyGalleryResourceTypes(
	manifest: NormalizedGalleryManifest | null,
	conventionDirs: readonly string[] = [],
): GalleryResourceType[] {
	const types = new Set<GalleryResourceType>();
	for (const type of RESOURCE_ORDER) {
		if (hasManifestResources(manifest, type)) types.add(type);
	}
	for (const dir of conventionDirs) {
		const firstSegment = dir.trim().replace(/\\/g, "/").split("/").filter(Boolean)[0];
		const type = resolveGalleryTypeFacet(firstSegment);
		if (type) types.add(type);
	}
	return RESOURCE_ORDER.filter((type) => types.has(type));
}

export function filterGalleryEntriesByType<T extends GalleryTypedEntry>(
	entries: readonly T[],
	facet: string | undefined,
): T[] {
	if (facet === undefined) return [...entries];
	const type = resolveGalleryTypeFacet(facet);
	if (!type) return [];
	return entries.filter((entry) => entry.resourceTypes.includes(type));
}

function parseAllowedGalleryUrl(url: string | undefined): URL | null {
	if (!url) return null;
	if (/[\s\u0000-\u001f\u007f]/.test(url)) return null;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") return null;
		if (parsed.username || parsed.password) return null;
		if (parsed.port) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function isValidGalleryVideoUrl(url: string | undefined): boolean {
	const parsed = parseAllowedGalleryUrl(url);
	return parsed ? parsed.pathname.toLowerCase().endsWith(".mp4") : false;
}

export function isValidGalleryImageUrl(url: string | undefined): boolean {
	const parsed = parseAllowedGalleryUrl(url);
	return parsed ? IMAGE_EXTENSIONS.some((extension) => parsed.pathname.toLowerCase().endsWith(extension)) : false;
}

export function selectGalleryPreview(input: GalleryPreviewInput): GalleryPreviewSelection | null {
	if (isValidGalleryVideoUrl(input.video)) return { kind: "video", url: input.video };
	if (isValidGalleryImageUrl(input.image)) return { kind: "image", url: input.image };
	if (input.resourceTypes.includes("theme")) {
		const marker = input.themeName?.trim() || "theme";
		return { kind: "generated-theme", marker };
	}
	return null;
}

export function filterManifestEntriesInsideRoot(packageRoot: string, entries: readonly string[]): string[] {
	const root = resolve(packageRoot);
	const safeEntries: string[] = [];
	for (const entry of entries) {
		const trimmed = entry.trim();
		if (!trimmed || isAbsolute(trimmed)) continue;
		const resolved = resolve(root, trimmed);
		const rel = relative(root, resolved);
		if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
		safeEntries.push(rel.replace(/\\/g, "/"));
	}
	return safeEntries;
}

function requireNonEmpty(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} must not be empty`);
	return trimmed;
}

function buildGallerySource(source: GalleryInstallSource): { kind: GalleryInstallSourceKind; source: string } {
	if (source.kind === "npm") {
		const name = requireNonEmpty(source.name, "npm package name");
		const version = source.version ? `@${requireNonEmpty(source.version, "npm package version")}` : "";
		return { kind: "npm", source: `npm:${name}${version}` };
	}
	if (source.kind === "git") {
		const repo = requireNonEmpty(source.repo, "git repository").replace(/^git:/, "");
		const ref = source.ref ? `@${requireNonEmpty(source.ref, "git ref")}` : "";
		return { kind: "git", source: `git:${repo}${ref}` };
	}
	return { kind: "local", source: requireNonEmpty(source.path, "local path") };
}

export function buildGalleryInstallSpec(
	input: GalleryInstallSource,
	hasExtension: boolean,
	options: GalleryInstallOptions = {},
): GalleryInstallSpec {
	const source = buildGallerySource(input);
	const localFlag = options.local ? " -l" : "";
	return {
		kind: source.kind,
		source: source.source,
		installCommand: `omk install ${source.source}${localFlag}`,
		tryEphemeralCommand: `omk -e ${source.source}`,
		trust: hasExtension ? "code-execution" : "declarative",
	};
}

function stripComments(sourceText: string, stripStrings: boolean): string {
	let output = "";
	let index = 0;
	while (index < sourceText.length) {
		const current = sourceText[index];
		const next = sourceText[index + 1];
		if (current === "/" && next === "/") {
			index += 2;
			while (index < sourceText.length && sourceText[index] !== "\n") index += 1;
			output += "\n";
			index += 1;
			continue;
		}
		if (current === "/" && next === "*") {
			index += 2;
			while (index < sourceText.length && !(sourceText[index] === "*" && sourceText[index + 1] === "/")) index += 1;
			index += 2;
			output += " ";
			continue;
		}
		if (stripStrings && (current === '"' || current === "'" || current === "`")) {
			const quote = current;
			index += 1;
			while (index < sourceText.length) {
				if (sourceText[index] === "\\") {
					index += 2;
					continue;
				}
				if (sourceText[index] === quote) {
					index += 1;
					break;
				}
				index += 1;
			}
			output += " ";
			continue;
		}
		output += current;
		index += 1;
	}
	return output;
}

function capabilityOrder(badge: ExtensionCapabilityBadge): number {
	return CAPABILITY_ORDER.indexOf(badge);
}

export function inferExtensionCapabilityBadges(sourceText: string): ExtensionCapabilityBadge[] {
	const withoutComments = stripComments(sourceText, false);
	const code = stripComments(sourceText, true);
	const badges = new Set<ExtensionCapabilityBadge>();

	if (/\bomk\s*\.\s*registerTool\s*\(/.test(code)) badges.add("tools");
	if (/\bomk\s*\.\s*registerCommand\s*\(/.test(code)) badges.add("commands");
	if (/\bomk\s*\.\s*on\s*\(/.test(code) || /\bregisterHook\s*\(/.test(code)) badges.add("hooks");
	if (/\bomk\s*\.\s*registerProvider\s*\(/.test(code)) badges.add("provider");
	if (
		/\bomk\s*\.\s*(registerShortcut|registerFlag|registerMessageRenderer|registerComponent|setFooter)\s*\(/.test(code)
	) {
		badges.add("ui");
	}
	if (/\bomk\s*\.\s*on\s*\(\s*(["'`])(?:session_before_compact|session_compact|context)\1/.test(withoutComments)) {
		badges.add("hooks");
		badges.add("compaction");
	}

	return [...badges].sort((left, right) => capabilityOrder(left) - capabilityOrder(right));
}

function identityKey(identity: GalleryEntryIdentity): string {
	if (identity.kind === "npm") return `npm:${identity.name.trim().toLowerCase()}`;
	if (identity.kind === "git") {
		const repo = identity.repo
			.trim()
			.replace(/^git:/, "")
			.replace(/\.git$/i, "")
			.toLowerCase();
		return `git:${repo}`;
	}
	return `local:${resolve(identity.path)}`;
}

export function dedupeGalleryEntries<T extends GalleryEntryWithIdentity>(entries: readonly T[]): T[] {
	const seen = new Set<string>();
	const result: T[] = [];
	for (const entry of entries) {
		const key = identityKey(entry.identity);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(entry);
	}
	return result;
}
