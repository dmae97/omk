import { createRequire } from "node:module";
import * as path from "node:path";
import type { FindMatch, FindOptions, FindResult } from "./find/types";
import type {
	FuzzyFindOptions,
	FuzzyFindResult,
	GrepOptions,
	GrepResult,
	SearchOptions,
	SearchResult,
} from "./grep/types";
import type { HighlightColors } from "./highlight/index";
import type { HtmlToMarkdownOptions } from "./html/types";
import type { ExtractSegmentsResult, SliceWithWidthResult, TextInput } from "./text/index";

export interface NativePhotonImage {
	getWidth(): number;
	getHeight(): number;
	getBytes(): Promise<Uint8Array>;
	getBytesJpeg(quality: number): Promise<Uint8Array>;
	getBytesWebp(): Promise<Uint8Array>;
	getBytesGif(): Promise<Uint8Array>;
	resize(width: number, height: number, filter: number): Promise<NativePhotonImage>;
}

export interface NativePhotonImageConstructor {
	newFromByteslice(bytes: Uint8Array): Promise<NativePhotonImage>;
	prototype: NativePhotonImage;
}

export interface NativeSamplingFilter {
	Nearest: 1;
	Triangle: 2;
	CatmullRom: 3;
	Gaussian: 4;
	Lanczos3: 5;
}

export interface NativeBindings {
	find(options: FindOptions, onMatch?: (match: FindMatch) => void): Promise<FindResult>;
	fuzzyFind(options: FuzzyFindOptions): Promise<FuzzyFindResult>;
	grep(options: GrepOptions): Promise<GrepResult>;
	search(content: string | Uint8Array, options: SearchOptions): SearchResult;
	hasMatch(
		content: string | Uint8Array,
		pattern: string | Uint8Array,
		ignoreCase: boolean,
		multiline: boolean,
	): boolean;
	htmlToMarkdown(html: string, options?: HtmlToMarkdownOptions | null): Promise<string>;
	highlightCode(code: string, lang: string | null | undefined, colors: HighlightColors): string;
	supportsLanguage(lang: string): boolean;
	getSupportedLanguages(): string[];
	SamplingFilter: NativeSamplingFilter;
	PhotonImage: NativePhotonImageConstructor;
	visibleWidth(text: TextInput): number;
	truncateToWidth(text: TextInput, maxWidth: number, ellipsis: TextInput, pad: boolean): string;
	sliceWithWidth(line: TextInput, startCol: number, length: number, strict: boolean): SliceWithWidthResult;
	extractSegments(
		line: TextInput,
		beforeEnd: number,
		afterStart: number,
		afterLen: number,
		strictAfter: boolean,
	): ExtractSegmentsResult;
}

const require = createRequire(import.meta.url);
const platformTag = `${process.platform}-${process.arch}`;
const nativeDir = path.join(import.meta.dir, "..", "native");
const repoRoot = path.join(import.meta.dir, "..", "..", "..");
const execDir = path.dirname(process.execPath);

const SUPPORTED_PLATFORMS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

const candidates = [
	path.join(nativeDir, `pi_natives.${platformTag}.node`),
	path.join(nativeDir, "pi_natives.node"),
	path.join(execDir, `pi_natives.${platformTag}.node`),
	path.join(execDir, "pi_natives.node"),
	path.join(repoRoot, "target", "release", "pi_natives.node"),
	path.join(repoRoot, "crates", "pi-natives", "target", "release", "pi_natives.node"),
];

function loadNative(): NativeBindings {
	const errors: string[] = [];

	for (const candidate of candidates) {
		try {
			const bindings = require(candidate) as NativeBindings;
			validateNative(bindings, candidate);
			return bindings;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`${candidate}: ${message}`);
		}
	}

	// Check if this is an unsupported platform
	if (!SUPPORTED_PLATFORMS.includes(platformTag)) {
		throw new Error(
			`Unsupported platform: ${platformTag}\n` +
				`Supported platforms: ${SUPPORTED_PLATFORMS.join(", ")}\n` +
				"If you need support for this platform, please open an issue.",
		);
	}

	const details = errors.map(error => `- ${error}`).join("\n");
	throw new Error(
		`Failed to load pi_natives native addon for ${platformTag}.\n\n` +
			`Tried:\n${details}\n\n` +
			"If installed via npm/bun, try reinstalling: bun install @oh-my-pi/pi-natives\n" +
			"If developing locally, build with: bun --cwd=packages/natives run build:native",
	);
}

function validateNative(bindings: NativeBindings, source: string): void {
	const missing: string[] = [];
	const checkFn = (name: keyof NativeBindings) => {
		if (typeof bindings[name] !== "function") {
			missing.push(name);
		}
	};

	checkFn("find");
	checkFn("fuzzyFind");
	checkFn("grep");
	checkFn("search");
	checkFn("hasMatch");
	checkFn("htmlToMarkdown");
	checkFn("highlightCode");
	checkFn("supportsLanguage");
	checkFn("getSupportedLanguages");
	checkFn("visibleWidth");
	checkFn("truncateToWidth");
	checkFn("sliceWithWidth");
	checkFn("extractSegments");

	if (!bindings.PhotonImage?.newFromByteslice) {
		missing.push("PhotonImage.newFromByteslice");
	}
	if (!bindings.PhotonImage?.prototype?.resize) {
		missing.push("PhotonImage.resize");
	}
	if (!bindings.SamplingFilter || typeof bindings.SamplingFilter.Lanczos3 !== "number") {
		missing.push("SamplingFilter");
	}

	if (missing.length) {
		throw new Error(
			`Native addon missing exports (${source}). Missing: ${missing.join(", ")}. ` +
				"Rebuild with `bun --cwd=packages/natives run build:native`.",
		);
	}
}

export const native = loadNative();
