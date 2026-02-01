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
import type { ShellExecuteOptions, ShellExecuteResult } from "./shell/types";
import type { ExtractSegmentsResult, SliceWithWidthResult } from "./text/index";
import type { ClipboardImage } from "./clipboard/types";

export type { RequestOptions } from "./request-options";

/**
 * Event types from Kitty keyboard protocol (flag 2)
 * 1 = key press, 2 = key repeat, 3 = key release
 */
export const enum KeyEventType {
	Press = 1,
	Repeat = 2,
	Release = 3,
}
/** Parsed Kitty keyboard protocol sequence result. */
export interface ParsedKittyResult {
	codepoint: number;
	shiftedKey?: number;
	baseLayoutKey?: number;
	modifier: number;
	eventType?: KeyEventType;
}

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

import type { GrepMatch } from "./grep/types";

export interface NativeBindings {
	copyToClipboard(text: string): Promise<void>;
	readImageFromClipboard(): Promise<ClipboardImage | null>;
	find(options: FindOptions, onMatch?: (error: Error | null, match: FindMatch) => void): Promise<FindResult>;
	fuzzyFind(options: FuzzyFindOptions): Promise<FuzzyFindResult>;
	grep(options: GrepOptions, onMatch?: (error: Error | null, match: GrepMatch) => void): Promise<GrepResult>;
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
	truncateToWidth(text: string, maxWidth: number, ellipsisKind: number, pad: boolean): string;
	wrapTextWithAnsi(text: string, width: number): string[];
	sliceWithWidth(line: string, startCol: number, length: number, strict: boolean): SliceWithWidthResult;
	visibleWidth(text: string): number;
	extractSegments(
		line: string,
		beforeEnd: number,
		afterStart: number,
		afterLen: number,
		strictAfter: boolean,
	): ExtractSegmentsResult;
	matchesKittySequence(data: string, expectedCodepoint: number, expectedModifier: number): boolean;
	executeShell(
		options: ShellExecuteOptions,
		onChunk?: (error: Error | null, chunk: string) => void,
	): Promise<ShellExecuteResult>;
	abortShellExecution(executionId: string): void;
	parseKey(data: string, kittyProtocolActive: boolean): string | null;
	matchesLegacySequence(data: string, keyName: string): boolean;
	parseKittySequence(data: string): ParsedKittyResult | null;
	matchesKey(data: string, keyId: string, kittyProtocolActive: boolean): boolean;
	killTree(pid: number, signal: number): number;
	listDescendants(pid: number): number[];
}

const require = createRequire(import.meta.url);
const platformTag = `${process.platform}-${process.arch}`;
const nativeDir = path.join(import.meta.dir, "..", "native");
const repoRoot = path.join(import.meta.dir, "..", "..", "..");
const execDir = path.dirname(process.execPath);

const SUPPORTED_PLATFORMS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

const debugCandidates = [path.join(nativeDir, "pi_natives.dev.node"), path.join(execDir, "pi_natives.dev.node")];

const releaseCandidates = [
	// Platform-tagged builds (preferred - always correct platform)
	path.join(nativeDir, `pi_natives.${platformTag}.node`),
	path.join(execDir, `pi_natives.${platformTag}.node`),
	// Fallback untagged (only created for native builds, not cross-compilation)
	path.join(nativeDir, "pi_natives.node"),
	path.join(execDir, "pi_natives.node"),
];

const candidates = process.env.OMP_DEV ? [...debugCandidates, ...releaseCandidates] : releaseCandidates;

function loadNative(): NativeBindings {
	const errors: string[] = [];

	for (const candidate of candidates) {
		try {
			const bindings = require(candidate) as NativeBindings;
			validateNative(bindings, candidate);
			if (process.env.OMP_DEV) {
				console.log(`Loaded native addon from ${candidate}`);
				console.log(` - Root: ${repoRoot}`);
			}
			return bindings;
		} catch (err) {
			if (process.env.OMP_DEV) {
				console.error(`Error loading native addon from ${candidate}:`, err);
			}
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

	checkFn("copyToClipboard");
	checkFn("readImageFromClipboard");
	checkFn("find");
	checkFn("fuzzyFind");
	checkFn("grep");
	checkFn("search");
	checkFn("hasMatch");
	checkFn("htmlToMarkdown");
	checkFn("highlightCode");
	checkFn("supportsLanguage");
	checkFn("getSupportedLanguages");
	checkFn("truncateToWidth");
	checkFn("wrapTextWithAnsi");
	checkFn("sliceWithWidth");
	checkFn("extractSegments");
	checkFn("matchesKittySequence");
	checkFn("executeShell");
	checkFn("abortShellExecution");
	checkFn("parseKey");
	checkFn("matchesLegacySequence");
	checkFn("parseKittySequence");
	checkFn("matchesKey");
	checkFn("visibleWidth");
	checkFn("killTree");
	checkFn("listDescendants");

	if (missing.length) {
		throw new Error(
			`Native addon missing exports (${source}). Missing: ${missing.join(", ")}. ` +
				"Rebuild with `bun --cwd=packages/natives run build:native`.",
		);
	}
}

export const native = loadNative();
