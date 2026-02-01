/**
 * Native addon loader and bindings.
 *
 * Each module extends NativeBindings via declaration merging in its types.ts.
 */

import { createRequire } from "node:module";
import * as path from "node:path";
import type { NativeBindings } from "./bindings";

// Import types to trigger declaration merging
import "./clipboard/types";
import "./find/types";
import "./grep/types";
import "./highlight/types";
import "./html/types";
import "./image/types";
import "./keys/types";
import "./ps/types";
import "./shell/types";
import "./system-info/types";
import "./text/types";

export type { NativeBindings, TsFunc } from "./bindings";

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
	checkFn("Shell");
	checkFn("parseKey");
	checkFn("matchesLegacySequence");
	checkFn("parseKittySequence");
	checkFn("matchesKey");
	checkFn("visibleWidth");
	checkFn("killTree");
	checkFn("listDescendants");
	checkFn("getSystemInfo");

	if (missing.length) {
		throw new Error(
			`Native addon missing exports (${source}). Missing: ${missing.join(", ")}. ` +
				"Rebuild with `bun --cwd=packages/natives run build:native`.",
		);
	}
}

export const native = loadNative();
