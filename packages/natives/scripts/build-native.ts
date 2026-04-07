import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";

const repoRoot = path.join(import.meta.dir, "../../..");
const rustDir = path.join(repoRoot, "crates/pi-natives");
const nativeDir = path.join(import.meta.dir, "../native");
const packageJsonPath = path.join(import.meta.dir, "../package.json");

const crossTarget = Bun.env.CROSS_TARGET;
const targetPlatform = Bun.env.TARGET_PLATFORM || process.platform;
const targetArch = Bun.env.TARGET_ARCH || process.arch;
const configuredVariantRaw = Bun.env.TARGET_VARIANT;
const isCrossCompile = Boolean(crossTarget) || targetPlatform !== process.platform || targetArch !== process.arch;

type X64Variant = "modern" | "baseline";

let configuredVariant: X64Variant | undefined;
if (configuredVariantRaw) {
	if (targetArch !== "x64") {
		throw new Error(`TARGET_VARIANT is only supported for x64 builds, got ${targetPlatform}-${targetArch}.`);
	}
	if (configuredVariantRaw !== "modern" && configuredVariantRaw !== "baseline") {
		throw new Error(`Unsupported TARGET_VARIANT: ${configuredVariantRaw}. Expected "modern" or "baseline".`);
	}
	configuredVariant = configuredVariantRaw;
}

function runCommand(command: string, args: string[]): string | null {
	try {
		const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
		if (result.exitCode !== 0) return null;
		return result.stdout.toString("utf-8").trim();
	} catch {
		return null;
	}
}

function detectHostAvx2Support(): boolean {
	if (process.arch !== "x64") return false;

	if (process.platform === "linux") {
		try {
			const cpuInfo = fsSync.readFileSync("/proc/cpuinfo", "utf8");
			return /\bavx2\b/i.test(cpuInfo);
		} catch {
			return false;
		}
	}

	if (process.platform === "darwin") {
		const leaf7 = runCommand("sysctl", ["-n", "machdep.cpu.leaf7_features"]);
		if (leaf7 && /\bAVX2\b/i.test(leaf7)) return true;
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

function resolveEffectiveVariant(): X64Variant | null {
	if (targetArch !== "x64") return null;
	if (configuredVariant) return configuredVariant;
	if (isCrossCompile) {
		throw new Error("x64 cross-builds require TARGET_VARIANT=modern or TARGET_VARIANT=baseline.");
	}
	return detectHostAvx2Support() ? "modern" : "baseline";
}

const effectiveVariant = resolveEffectiveVariant();
const variantSuffix = effectiveVariant ? `-${effectiveVariant}` : "";

// Default to native CPU optimization for local builds; explicit variants use fixed ISA targets.
if (!isCrossCompile && !Bun.env.RUSTFLAGS) {
	if (effectiveVariant === "modern") {
		Bun.env.RUSTFLAGS = "-C target-cpu=x86-64-v3";
	} else if (effectiveVariant === "baseline") {
		Bun.env.RUSTFLAGS = "-C target-cpu=x86-64-v2";
	} else {
		Bun.env.RUSTFLAGS = "-C target-cpu=native";
	}
}

async function cleanupStaleTemps(dir: string): Promise<void> {
	try {
		const entries = await fs.readdir(dir);
		for (const entry of entries) {
			if (entry.includes(".tmp.") || entry.includes(".old.") || entry.includes(".new.")) {
				await fs.unlink(path.join(dir, entry)).catch(() => {});
			}
		}
	} catch {
		// Directory might not exist yet
	}
}

async function installBinary(src: string, dest: string): Promise<void> {
	const tempPath = `${dest}.tmp.${process.pid}`;

	await fs.copyFile(src, tempPath);

	try {
		// Atomic rename - works even if dest is loaded on Linux/macOS (old inode stays valid)
		await fs.rename(tempPath, dest);
	} catch {
		// On Windows, loaded DLLs cannot be overwritten via rename
		// Try delete-then-rename as fallback
		try {
			await fs.unlink(dest);
		} catch (unlinkErr) {
			if ((unlinkErr as NodeJS.ErrnoException).code !== "ENOENT") {
				await fs.unlink(tempPath).catch(() => {});
				const isWindows = process.platform === "win32";
				throw new Error(
					`Cannot replace ${path.basename(dest)}${isWindows ? " (file may be in use - close any running processes)" : ""}: ${(unlinkErr as Error).message}`,
				);
			}
		}
		try {
			await fs.rename(tempPath, dest);
		} catch (finalErr) {
			await fs.unlink(tempPath).catch(() => {});
			throw new Error(`Failed to install ${path.basename(dest)}: ${(finalErr as Error).message}`);
		}
	}
}

async function resolveBuiltAddonPath(canonicalFilename: string): Promise<string> {
	const canonicalFilenames = new Set([
		`pi_natives.${targetPlatform}-${targetArch}.node`,
		`pi_natives.${targetPlatform}-${targetArch}-modern.node`,
		`pi_natives.${targetPlatform}-${targetArch}-baseline.node`,
	]);
	const entries = await fs.readdir(nativeDir);

	if (entries.includes(canonicalFilename)) {
		return path.join(nativeDir, canonicalFilename);
	}

	const generatedCandidates = entries.filter(entry => {
		if (!entry.startsWith(`pi_natives.${targetPlatform}-${targetArch}`) || !entry.endsWith(".node")) {
			return false;
		}
		return !canonicalFilenames.has(entry);
	});

	if (generatedCandidates.length === 1) {
		return path.join(nativeDir, generatedCandidates[0]);
	}

	if (generatedCandidates.length === 0) {
		throw new Error(
			`napi build succeeded but did not emit a native addon for ${targetPlatform}-${targetArch}. Expected ${canonicalFilename} or an environment-tagged variant in ${nativeDir}.`,
		);
	}

	const formattedCandidates = generatedCandidates.map(candidate => `  - ${candidate}`).join("\n");
	throw new Error(
		`napi build emitted multiple unrecognized native addons for ${targetPlatform}-${targetArch}:\n${formattedCandidates}`,
	);
}

const isCI = Boolean(Bun.env.CI);
const useLocalProfile = !isCI && !isCrossCompile;

// Build napi args
const napiArgs = [
	"build",
	"--manifest-path",
	path.join(rustDir, "Cargo.toml"),
	"--package-json-path",
	packageJsonPath,
	"--platform",
	"--no-js",
	"--dts",
	"index.d.ts",
	"-o",
	nativeDir,
];

if (useLocalProfile) {
	napiArgs.push("--profile", "local");
} else {
	napiArgs.push("--release");
}

if (crossTarget) napiArgs.push("--target", crossTarget);

const profileLabel = useLocalProfile ? " (local)" : "";
const canonicalAddonFilename = `pi_natives.${targetPlatform}-${targetArch}${variantSuffix}.node`;
const canonicalAddonPath = path.join(nativeDir, canonicalAddonFilename);

console.log(`Building pi-natives for ${targetPlatform}-${targetArch}${variantSuffix}${profileLabel}…`);

await fs.mkdir(nativeDir, { recursive: true });
await cleanupStaleTemps(nativeDir);

// Resolve napi bin directly: `bunx @napi-rs/cli` can pick up the wrong bin on
// systems where `cli` exists on PATH (e.g. Mono's /usr/bin/cli on Ubuntu).
const napiBin = Bun.which("napi", {
	PATH: `${path.join(import.meta.dir, "..", "node_modules", ".bin")}:${path.join(repoRoot, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
});
if (!napiBin) {
	throw new Error("Could not locate @napi-rs/cli `napi` binary in node_modules/.bin");
}
const buildResult = await $`${napiBin} ${napiArgs}`.nothrow();
if (buildResult.exitCode !== 0) {
	const stderr = buildResult.stderr?.toString("utf-8") ?? "";
	throw new Error(`napi build failed${stderr ? `:\n${stderr}` : ""}`);
}

const builtAddonPath = await resolveBuiltAddonPath(canonicalAddonFilename);
if (builtAddonPath !== canonicalAddonPath) {
	console.log(`Normalizing native addon filename: ${path.basename(builtAddonPath)} → ${canonicalAddonFilename}`);
	await installBinary(builtAddonPath, canonicalAddonPath);
	await fs.unlink(builtAddonPath).catch(() => {});
}

// Generate runtime enum exports from const enums in index.d.ts
await $`bun ${path.join(import.meta.dir, "gen-enums.ts")}`;

console.log("Build complete.");
