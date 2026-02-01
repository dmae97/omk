import { $ } from "bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "../../..");
const rustDir = path.join(repoRoot, "crates/pi-natives");
const targetRoots = [
	process.env.CARGO_TARGET_DIR ? path.resolve(process.env.CARGO_TARGET_DIR) : undefined,
	path.join(repoRoot, "target"),
	path.join(rustDir, "target"),
].filter((value): value is string => Boolean(value));
const releaseDirs = targetRoots.map(root => path.join(root, "release"));
const nativeDir = path.join(import.meta.dir, "../native");

const platform = process.platform;
const arch = process.arch;

const buildResult = await $`cargo build --release`.cwd(rustDir).nothrow();
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

// Safe copy: mv old -> temp, cp new -> target, rm temp
// This avoids overwriting in-memory binaries which can crash running processes
async function safeCopy(src: string, dest: string): Promise<void> {
	const tempPath = `${dest}.old.${process.pid}`;
	try {
		await fs.rename(dest, tempPath);
	} catch (err) {
		// Ignore if dest doesn't exist
		if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code !== "ENOENT") {
			throw err;
		}
	}
	await fs.copyFile(src, dest);
	try {
		await fs.unlink(tempPath);
	} catch {
		// Ignore cleanup errors
	}
}

await safeCopy(sourcePath, taggedPath);
await safeCopy(sourcePath, fallbackPath);
if (sourcePath !== devPath) {
	await safeCopy(sourcePath, devPath);
}
