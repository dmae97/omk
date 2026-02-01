import { $ } from "bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "../../..");
const rustDir = path.join(repoRoot, "crates/pi-natives");
const nativeDir = path.join(import.meta.dir, "../native");

const crossTarget = process.env.CROSS_TARGET;
const targetPlatform = process.env.TARGET_PLATFORM || process.platform;
const targetArch = process.env.TARGET_ARCH || process.arch;
const isCrossCompile =
	Boolean(crossTarget) ||
	targetPlatform !== process.platform ||
	targetArch !== process.arch;

const cargoArgs = ["build", "--release"];
if (crossTarget) cargoArgs.push("--target", crossTarget);

console.log(`Building pi-natives for ${targetPlatform}-${targetArch}...`);
const buildResult = await $`cargo ${cargoArgs}`.cwd(rustDir).nothrow();
if (buildResult.exitCode !== 0) {
	const stderr =
		typeof buildResult.stderr === "string"
			? buildResult.stderr
			: buildResult.stderr?.length
				? new TextDecoder().decode(buildResult.stderr)
				: "";
	throw new Error(`cargo build --release failed${stderr ? `:\n${stderr}` : ""}`);
}

const targetRoots = [
	process.env.CARGO_TARGET_DIR ? path.resolve(process.env.CARGO_TARGET_DIR) : undefined,
	path.join(repoRoot, "target"),
	path.join(rustDir, "target"),
].filter((v): v is string => Boolean(v));

const releaseDirs = targetRoots.flatMap((root) => {
	if (crossTarget) {
		return [path.join(root, crossTarget, "release"), path.join(root, "release")];
	}
	return [path.join(root, "release")];
});

const libraryNames = ["libpi_natives.so", "libpi_natives.dylib", "pi_natives.dll", "libpi_natives.dll"];

let sourcePath: string | null = null;
for (const dir of releaseDirs) {
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

if (!sourcePath) {
	const checked = releaseDirs.map((d) => `  - ${d}`).join("\n");
	throw new Error(`Built library not found. Checked:\n${checked}`);
}

console.log(`Found: ${sourcePath}`);
await fs.mkdir(nativeDir, { recursive: true });

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
	} catch (renameErr) {
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

await cleanupStaleTemps(nativeDir);

const taggedPath = path.join(nativeDir, `pi_natives.${targetPlatform}-${targetArch}.node`);
console.log(`Installing: ${taggedPath}`);
await installBinary(sourcePath, taggedPath);

// Only create fallback for native (non-cross) builds to avoid overwriting with wrong-platform binaries
if (!isCrossCompile) {
	const fallbackPath = path.join(nativeDir, "pi_natives.node");
	console.log(`Installing: ${fallbackPath}`);
	await installBinary(sourcePath, fallbackPath);
}

console.log("Build complete.");
