/**
 * Native addon loader and bindings.
 *
 * Each module extends NativeBindings via declaration merging in its types.ts.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import packageJson from "../package.json" with { type: "json" };
import type { NativeBindings } from "./bindings";
import { embeddedAddon } from "./embedded-addon";

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
import "./work/types";

export type { NativeBindings, TsFunc } from "./bindings";

const require = createRequire(import.meta.url);
const platformTag = `${process.platform}-${process.arch}`;
const addonFilename = `pi_natives.${platformTag}.node`;
const packageVersion = (packageJson as { version: string }).version;
const nativeDir = path.join(import.meta.dir, "..", "native");
const execDir = path.dirname(process.execPath);
const versionedDir = path.join(os.homedir(), ".omp", "natives", packageVersion);
const versionedAddonPath = path.join(versionedDir, addonFilename);
const legacyUserDataDir =
	process.platform === "win32"
		? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "omp")
		: path.join(os.homedir(), ".local", "bin");
const downloadUrl = `https://github.com/can1357/oh-my-pi/releases/latest/download/${addonFilename}`;
const isCompiledBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

const SUPPORTED_PLATFORMS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

const debugCandidates = [path.join(nativeDir, "pi_natives.dev.node"), path.join(execDir, "pi_natives.dev.node")];

const baseReleaseCandidates = [
	// Platform-tagged builds (preferred - always correct platform)
	path.join(nativeDir, addonFilename),
	path.join(execDir, addonFilename),
	// Fallback untagged (only created for native builds, not cross-compilation)
	path.join(nativeDir, "pi_natives.node"),
	path.join(execDir, "pi_natives.node"),
];

const compiledCandidates = [
	versionedAddonPath,
	path.join(legacyUserDataDir, addonFilename),
	path.join(legacyUserDataDir, "pi_natives.node"),
];

const releaseCandidates = isCompiledBinary ? [...compiledCandidates, ...baseReleaseCandidates] : baseReleaseCandidates;
const candidates = process.env.OMP_DEV ? [...debugCandidates, ...releaseCandidates] : releaseCandidates;

function maybeExtractEmbeddedAddon(errors: string[]): string | null {
	if (!isCompiledBinary || !embeddedAddon) return null;
	if (embeddedAddon.platform !== platformTag || embeddedAddon.version !== packageVersion) return null;

	try {
		fs.mkdirSync(versionedDir, { recursive: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		errors.push(`embedded addon dir: ${message}`);
		return null;
	}

	try {
		fs.statSync(versionedAddonPath);
		return versionedAddonPath;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`embedded addon stat: ${message}`);
			return null;
		}
	}

	try {
		const buffer = fs.readFileSync(embeddedAddon.filePath);
		fs.writeFileSync(versionedAddonPath, buffer);
		return versionedAddonPath;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		errors.push(`embedded addon write: ${message}`);
		return null;
	}
}

function loadNative(): NativeBindings {
	const errors: string[] = [];
	const embeddedCandidate = maybeExtractEmbeddedAddon(errors);
	const runtimeCandidates = embeddedCandidate ? [embeddedCandidate, ...candidates] : candidates;

	for (const candidate of runtimeCandidates) {
		try {
			const bindings = require(candidate) as NativeBindings;
			validateNative(bindings, candidate);
			if (process.env.OMP_DEV) {
				console.log(`Loaded native addon from ${candidate}`);
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
	let helpMessage: string;
	if (isCompiledBinary) {
		helpMessage =
			`The compiled binary should extract the native addon to:\n` +
			`  ${versionedAddonPath}\n\n` +
			`If it is missing, delete ${versionedDir} and re-run, or download manually:\n` +
			`  curl -fsSL "${downloadUrl}" -o "${versionedAddonPath}"`;
	} else {
		helpMessage =
			"If installed via npm/bun, try reinstalling: bun install @oh-my-pi/pi-natives\n" +
			"If developing locally, build with: bun --cwd=packages/natives run build:native";
	}

	throw new Error(
		`Failed to load pi_natives native addon for ${platformTag}.\n\n` + `Tried:\n${details}\n\n${helpMessage}`,
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
	checkFn("getWorkProfile");

	if (missing.length) {
		throw new Error(
			`Native addon missing exports (${source}). Missing: ${missing.join(", ")}. ` +
				"Rebuild with `bun --cwd=packages/natives run build:native`.",
		);
	}
}

export const native = loadNative();
