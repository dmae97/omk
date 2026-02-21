import { $ } from "bun";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "../../..");
const rustDir = path.join(repoRoot, "crates/pi-natives");
const nativeDir = path.join(import.meta.dir, "../native");

const isDev = process.argv.includes("--dev");
const crossTarget = Bun.env.CROSS_TARGET;
const targetPlatform = Bun.env.TARGET_PLATFORM || process.platform;
const targetArch = Bun.env.TARGET_ARCH || process.arch;
const configuredVariantRaw = Bun.env.TARGET_VARIANT;
const isCrossCompile =
	Boolean(crossTarget) ||
	targetPlatform !== process.platform ||
	targetArch !== process.arch;

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

const cargoArgs = ["build"];
if (!isDev) cargoArgs.push("--release");
if (crossTarget) cargoArgs.push("--target", crossTarget);

console.log(`Building pi-natives for ${targetPlatform}-${targetArch}${variantSuffix}${isDev ? " (debug)" : ""}…`);
const buildResult = await $`cargo ${cargoArgs}`.cwd(rustDir).nothrow();
if (buildResult.exitCode !== 0) {
	const stderr = buildResult.stderr?.toString("utf-8") ?? "";
	throw new Error(`cargo build --release failed${stderr ? `:\n${stderr}` : ""}`);
}

const profile = isDev ? "debug" : "release";
const targetRoots = [
	Bun.env.CARGO_TARGET_DIR ? path.resolve(Bun.env.CARGO_TARGET_DIR) : undefined,
	path.join(repoRoot, "target"),
	path.join(rustDir, "target"),
].filter((v): v is string => Boolean(v));

const profileDirs = targetRoots.flatMap(root => {
	if (crossTarget) {
		return [path.join(root, crossTarget, profile), path.join(root, profile)];
	}
	return [path.join(root, profile)];
});

const libraryNames = ["libpi_natives.so", "libpi_natives.dylib", "pi_natives.dll", "libpi_natives.dll"];

let sourcePath: string | null = null;
for (const dir of profileDirs) {
	for (const name of libraryNames) {
		const fullPath = path.join(dir, name);
		try {
			await fs.stat(fullPath);
			sourcePath = fullPath;
			break;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		}
	}
	if (sourcePath) break;
}

await fs.mkdir(nativeDir, { recursive: true });
await cleanupStaleTemps(nativeDir);

if (!sourcePath) {
	const checked = profileDirs.map(d => `  - ${d}`).join("\n");
	throw new Error(`Built library not found. Checked:\n${checked}`);
}

console.log(`Found: ${sourcePath}`);
const taggedPath =
	isDev
		? path.join(nativeDir, "pi_natives.dev.node")
		: path.join(nativeDir, `pi_natives.${targetPlatform}-${targetArch}${variantSuffix}.node`);
console.log(`Installing: ${taggedPath}`);
await installBinary(sourcePath, taggedPath);

console.log("Build complete.");
