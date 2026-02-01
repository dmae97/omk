import { $ } from "bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "../../..");
const rustDir = path.join(repoRoot, "crates/pi-natives");
const cargoTarget = process.env.CROSS_TARGET || undefined;
const targetRoots = [
	process.env.CARGO_TARGET_DIR ? path.resolve(process.env.CARGO_TARGET_DIR) : undefined,
	path.join(repoRoot, "target"),
	path.join(rustDir, "target"),
].filter((value): value is string => Boolean(value));
const releaseDirs = targetRoots.flatMap(root => {
	const base = cargoTarget ? path.join(root, cargoTarget, "release") : path.join(root, "release");
	return cargoTarget ? [base, path.join(root, "release")] : [base];
});
const nativeDir = path.join(import.meta.dir, "../native");

const platform = process.env.TARGET_PLATFORM || process.platform;
const arch = process.env.TARGET_ARCH || process.arch;

const cargoArgs = ["build", "--release"];
if (cargoTarget) cargoArgs.push("--target", cargoTarget);
const buildResult = await $`cargo ${cargoArgs}`.cwd(rustDir).nothrow();
if (buildResult.exitCode !== 0) {
	const stderrText =
		typeof buildResult.stderr === "string"
			? buildResult.stderr
			: buildResult.stderr?.length
				? new TextDecoder().decode(buildResult.stderr)
				: "";
	throw new Error(
		`cargo build --release failed${stderrText ? `:\n${stderrText}` : ""}`,
	);
}

const candidateNames = [
	"pi_natives.node",
	"libpi_natives.so",
	"libpi_natives.dylib",
	"pi_natives.dll",
	"libpi_natives.dll",
];

let sourcePath: string | null = null;
for (const releaseDir of releaseDirs) {
	for (const candidate of candidateNames) {
		const fullPath = path.join(releaseDir, candidate);
		try {
			await fs.stat(fullPath);
			sourcePath = fullPath;
			break;
		} catch (err) {
			if (err && typeof err === "object" && "code" in err) {
				const code = (err as { code?: string }).code;
				if (code === "ENOENT") {
					continue;
				}
			}
			throw err;
		}
	}
	if (sourcePath) break;
}

if (!sourcePath) {
	const locations = releaseDirs.map(dir => `- ${dir}`).join("\n");
	throw new Error(`Built library not found. Checked:\n${locations}`);
}

await fs.mkdir(nativeDir, { recursive: true });

const taggedPath = path.join(nativeDir, `pi_natives.${platform}-${arch}.node`);
const fallbackPath = path.join(nativeDir, "pi_natives.node");
const devPath = path.join(path.dirname(sourcePath), "pi_natives.node");

// Safe copy pattern for in-use binaries (especially Windows DLLs):
// 1. Copy new file to temp location first
// 2. Rename old file out of the way (works even if DLL is loaded)
// 3. Rename new file to target
// 4. Clean up old file
// This ensures we never lose the original if something fails.
async function safeCopy(src: string, dest: string): Promise<void> {
	const tempOld = `${dest}.old.${process.pid}`;
	const tempNew = `${dest}.new.${process.pid}`;

	// Step 1: Copy new file to temp location
	await fs.copyFile(src, tempNew);

	// Step 2: Move old file out of the way (if exists)
	try {
		await fs.rename(dest, tempOld);
	} catch (err) {
		if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code !== "ENOENT") {
			// Rename failed for reason other than "file doesn't exist"
			await fs.unlink(tempNew).catch(() => {});
			throw err;
		}
	}

	// Step 3: Move new file to target
	try {
		await fs.rename(tempNew, dest);
	} catch {
		// If rename fails, try to restore old file
		await fs.rename(tempOld, dest).catch(() => {});
		await fs.unlink(tempNew).catch(() => {});
		throw new Error(`Failed to install native binary to ${dest}`);
	}

	// Step 4: Clean up old file (best effort)
	await fs.unlink(tempOld).catch(() => {});
}

await safeCopy(sourcePath, taggedPath);
await safeCopy(sourcePath, fallbackPath);
if (sourcePath !== devPath) {
	await safeCopy(sourcePath, devPath);
}
