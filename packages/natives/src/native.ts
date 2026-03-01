/**
 * Native addon loader and bindings.
 *
 * Each module extends NativeBindings via declaration merging in its types.ts.
 */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { $env, getNativesDir, logger } from "@oh-my-pi/pi-utils";
import packageJson from "../package.json";
import type { NativeBindings } from "./bindings";
import { embeddedAddon } from "./embedded-addon";
import "./appearance/types";
import "./ast/types";
import "./clipboard/types";
import "./glob/types";
import "./grep/types";
import "./highlight/types";
import "./html/types";
import "./image/types";
import "./keys/types";
import "./ps/types";
import "./pty/types";
import "./shell/types";
import "./text/types";
import "./work/types";

export type { NativeBindings, TsFunc } from "./bindings";

type CpuVariant = "modern" | "baseline";
const require = createRequire(import.meta.url);
const platformTag = `${process.platform}-${process.arch}`;
const packageVersion = (packageJson as { version: string }).version;
const nativeDir = path.join(import.meta.dir, "..", "native");
const execDir = path.dirname(process.execPath);
const versionedDir = path.join(getNativesDir(), packageVersion);
const userDataDir =
	process.platform === "win32"
		? path.join(Bun.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "omp")
		: path.join(os.homedir(), ".local", "bin");
const isCompiledBinary =
	Bun.env.PI_COMPILED ||
	import.meta.url.includes("$bunfs") ||
	import.meta.url.includes("~BUN") ||
	import.meta.url.includes("%7EBUN");
const SUPPORTED_PLATFORMS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

const variantOverride = getVariantOverride();
const selectedVariant = resolveCpuVariant(variantOverride);
const addonFilenames = getAddonFilenames(platformTag, selectedVariant);
const addonLabel = selectedVariant ? `${platformTag} (${selectedVariant})` : platformTag;

const debugCandidates = [path.join(nativeDir, "pi_natives.dev.node"), path.join(execDir, "pi_natives.dev.node")];
const baseReleaseCandidates = addonFilenames.flatMap(filename => [
	path.join(nativeDir, filename),
	path.join(execDir, filename),
]);
const compiledCandidates = addonFilenames.flatMap(filename => [
	path.join(versionedDir, filename),
	path.join(userDataDir, filename),
]);
const releaseCandidates = isCompiledBinary ? [...compiledCandidates, ...baseReleaseCandidates] : baseReleaseCandidates;
const candidates = $env.PI_DEV ? [...debugCandidates, ...releaseCandidates] : releaseCandidates;
const dedupedCandidates = [...new Set(candidates)];

function runCommand(command: string, args: string[]): string | null {
	const cmdLine = `${command} '${args.join(" ")}'`;
	return logger.time(`runCommand:${cmdLine}`, () => {
		try {
			const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
			if (result.exitCode !== 0) return null;
			return result.stdout.toString("utf-8").trim();
		} catch {
			return null;
		}
	});
}

function getVariantOverride(): CpuVariant | null {
	const value = Bun.env.PI_NATIVE_VARIANT;
	if (!value) return null;
	if (value === "modern" || value === "baseline") return value;
	return null;
}

function detectAvx2Support(): boolean {
	if (process.arch !== "x64") {
		return false;
	}

	if (process.platform === "linux") {
		try {
			const cpuInfo = fs.readFileSync("/proc/cpuinfo", "utf8");
			return /\bavx2\b/i.test(cpuInfo);
		} catch {
			return false;
		}
	}

	if (process.platform === "darwin") {
		const leaf7 = runCommand("sysctl", ["-n", "machdep.cpu.leaf7_features"]);
		if (leaf7 && /\bAVX2\b/i.test(leaf7)) {
			return true;
		}
		const features = runCommand("sysctl", ["-n", "machdep.cpu.features"]);
		return Boolean(features && /\bAVX2\b/i.test(features));
	}

	if (process.platform === "win32") {
		const output = runCommand("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"[System.Runtime.Intrinsics.X86.Avx2]::IsSupported",
		]);
		return output?.toLowerCase() === "true";
	}

	return false;
}

function resolveCpuVariant(override: CpuVariant | null): CpuVariant | null {
	if (process.arch !== "x64") return null;
	if (override) return override;
	return logger.time("native:detectAvx2Support", () => detectAvx2Support()) ? "modern" : "baseline";
}

function getAddonFilenames(tag: string, variant: CpuVariant | null): string[] {
	const defaultFilename = `pi_natives.${tag}.node`;
	if (process.arch !== "x64" || !variant) return [defaultFilename];
	const baselineFilename = `pi_natives.${tag}-baseline.node`;
	const modernFilename = `pi_natives.${tag}-modern.node`;
	if (variant === "modern") {
		return [modernFilename, baselineFilename, defaultFilename];
	}
	return [baselineFilename, defaultFilename];
}

function selectEmbeddedAddonFile(): { filename: string; filePath: string } | null {
	if (!embeddedAddon) return null;
	const defaultFile = embeddedAddon.files.find(file => file.variant === "default") ?? null;
	if (process.arch !== "x64") return defaultFile ?? embeddedAddon.files[0] ?? null;
	if (selectedVariant === "modern") {
		return (
			embeddedAddon.files.find(file => file.variant === "modern") ??
			embeddedAddon.files.find(file => file.variant === "baseline") ??
			null
		);
	}
	return embeddedAddon.files.find(file => file.variant === "baseline") ?? null;
}
function maybeExtractEmbeddedAddon(errors: string[]): string | null {
	if (!isCompiledBinary || !embeddedAddon) return null;
	if (embeddedAddon.platformTag !== platformTag || embeddedAddon.version !== packageVersion) return null;

	const selectedEmbeddedFile = selectEmbeddedAddonFile();
	if (!selectedEmbeddedFile) return null;
	const targetPath = path.join(versionedDir, selectedEmbeddedFile.filename);

	try {
		fs.mkdirSync(versionedDir, { recursive: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		errors.push(`embedded addon dir: ${message}`);
		return null;
	}

	if (fs.existsSync(targetPath)) {
		return targetPath;
	}

	try {
		const buffer = fs.readFileSync(selectedEmbeddedFile.filePath);
		fs.writeFileSync(targetPath, buffer);
		return targetPath;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		errors.push(`embedded addon write (${selectedEmbeddedFile.filename}): ${message}`);
		return null;
	}
}
function loadNative(): NativeBindings {
	const errors: string[] = [];
	const embeddedCandidate = logger.time("native:maybeExtractEmbeddedAddon", () => maybeExtractEmbeddedAddon(errors));
	const runtimeCandidates = embeddedCandidate ? [embeddedCandidate, ...dedupedCandidates] : dedupedCandidates;
	for (const candidate of runtimeCandidates) {
		try {
			const bindings = logger.time(`native:loadNative:require:${path.basename(candidate)}`, () =>
				require(candidate),
			) as NativeBindings;
			validateNative(bindings, candidate);
			if ($env.PI_DEV) {
				console.log(`Loaded native addon from ${candidate}`);
			}
			return bindings;
		} catch (err) {
			if ($env.PI_DEV) {
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
		const expectedPaths = addonFilenames.map(filename => `  ${path.join(versionedDir, filename)}`).join("\n");
		const downloadHints = addonFilenames
			.map(filename => {
				const downloadUrl = `https://github.com/can1357/oh-my-pi/releases/latest/download/${filename}`;
				const targetPath = path.join(versionedDir, filename);
				return `  curl -fsSL "${downloadUrl}" -o "${targetPath}"`;
			})
			.join("\n");
		helpMessage =
			`The compiled binary should extract one of:\n${expectedPaths}\n\n` +
			`If missing, delete ${versionedDir} and re-run, or download manually:\n${downloadHints}`;
	} else {
		helpMessage =
			"If installed via npm/bun, try reinstalling: bun install @oh-my-pi/pi-natives\n" +
			"If developing locally, build with: bun --cwd=packages/natives run build:native\n" +
			"Optional x64 variants: TARGET_VARIANT=baseline|modern bun --cwd=packages/natives run build:native";
	}

	throw new Error(`Failed to load pi_natives native addon for ${addonLabel}.\n\nTried:\n${details}\n\n${helpMessage}`);
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
	checkFn("glob");
	checkFn("fuzzyFind");
	checkFn("grep");
	checkFn("search");
	checkFn("hasMatch");
	checkFn("htmlToMarkdown");
	checkFn("highlightCode");
	checkFn("supportsLanguage");
	checkFn("getSupportedLanguages");
	checkFn("truncateToWidth");
	checkFn("sanitizeText");
	checkFn("wrapTextWithAnsi");
	checkFn("sliceWithWidth");
	checkFn("extractSegments");
	checkFn("matchesKittySequence");
	checkFn("executeShell");
	checkFn("PtySession");
	checkFn("Shell");
	checkFn("parseKey");
	checkFn("matchesLegacySequence");
	checkFn("parseKittySequence");
	checkFn("matchesKey");
	checkFn("visibleWidth");
	checkFn("killTree");
	checkFn("listDescendants");
	checkFn("getWorkProfile");
	checkFn("invalidateFsScanCache");
	checkFn("astGrep");
	checkFn("astEdit");
	checkFn("detectMacOSAppearance");
	checkFn("MacAppearanceObserver");
	if (missing.length) {
		throw new Error(
			`Native addon missing exports (${source}). Missing: ${missing.join(", ")}. ` +
				"Rebuild with `bun --cwd=packages/natives run build:native`.",
		);
	}
}
export const native = logger.time("native:loadNative", () => loadNative());
