/**
 * Update CLI command handler.
 *
 * Handles `omp update` to check for and install updates.
 * Uses bun if available, otherwise downloads binary from GitHub releases.
 */
import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { APP_NAME, VERSION } from "@oh-my-pi/pi-utils/dirs";
import chalk from "chalk";
import { theme } from "../modes/theme/theme";

/**
 * Detect if we're running as a Bun compiled binary.
 */
const isBunBinary =
	Bun.env.PI_COMPILED ||
	import.meta.url.includes("$bunfs") ||
	import.meta.url.includes("~BUN") ||
	import.meta.url.includes("%7EBUN");

const REPO = "can1357/oh-my-pi";
const PACKAGE = "@oh-my-pi/pi-coding-agent";

interface ReleaseInfo {
	tag: string;
	version: string;
	assets: Array<{ name: string; url: string }>;
}

/**
 * Parse update subcommand arguments.
 * Returns undefined if not an update command.
 */
export function parseUpdateArgs(args: string[]): { force: boolean; check: boolean } | undefined {
	if (args.length === 0 || args[0] !== "update") {
		return undefined;
	}

	return {
		force: args.includes("--force") || args.includes("-f"),
		check: args.includes("--check") || args.includes("-c"),
	};
}

/**
 * Check if bun is available in PATH.
 */
function hasBun(): boolean {
	try {
		const result = spawnSync("bun", ["--version"], { encoding: "utf-8", stdio: "pipe" });
		return result.status === 0;
	} catch {
		return false;
	}
}

/**
 * Get the latest release info from the npm registry.
 * Uses npm instead of GitHub API to avoid unauthenticated rate limiting.
 */
async function getLatestRelease(): Promise<ReleaseInfo> {
	const response = await fetch(`https://registry.npmjs.org/${PACKAGE}/latest`);
	if (!response.ok) {
		throw new Error(`Failed to fetch release info: ${response.statusText}`);
	}

	const data = (await response.json()) as { version: string };
	const version = data.version;
	const tag = `v${version}`;

	// Construct deterministic GitHub release download URLs for the current platform
	const makeAsset = (name: string) => ({
		name,
		url: `https://github.com/${REPO}/releases/download/${tag}/${name}`,
	});
	return {
		tag,
		version,
		assets: [makeAsset(getBinaryName()), ...getNativeAddonNames().map(makeAsset)],
	};
}

/**
 * Compare semver versions. Returns:
 * - negative if a < b
 * - 0 if a == b
 * - positive if a > b
 */
function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);

	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = pa[i] || 0;
		const nb = pb[i] || 0;
		if (na !== nb) return na - nb;
	}
	return 0;
}

/**
 * Get the appropriate binary name for this platform.
 */
function getBinaryName(): string {
	const platform = process.platform;
	const arch = process.arch;

	let os: string;
	switch (platform) {
		case "linux":
			os = "linux";
			break;
		case "darwin":
			os = "darwin";
			break;
		case "win32":
			os = "windows";
			break;
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}

	let archName: string;
	switch (arch) {
		case "x64":
			archName = "x64";
			break;
		case "arm64":
			archName = "arm64";
			break;
		default:
			throw new Error(`Unsupported architecture: ${arch}`);
	}

	if (os === "windows") {
		return `${APP_NAME}-${os}-${archName}.exe`;
	}
	return `${APP_NAME}-${os}-${archName}`;
}

/**
 * Get native addon names for this platform, ordered by preference.
 */
function getNativeAddonNames(): string[] {
	const platform = process.platform;
	const arch = process.arch;
	if (!["linux", "darwin", "win32"].includes(platform)) {
		throw new Error(`Unsupported platform: ${platform}`);
	}
	if (!["x64", "arm64"].includes(arch)) {
		throw new Error(`Unsupported architecture: ${arch}`);
	}

	const baseName = `pi_natives.${platform}-${arch}.node`;
	if (arch !== "x64") {
		return [baseName];
	}

	return [`pi_natives.${platform}-${arch}-modern.node`, `pi_natives.${platform}-${arch}-baseline.node`];
}

/**
 * Update via bun package manager.
 */
async function updateViaBun(expectedVersion: string): Promise<void> {
	console.log(chalk.dim("Updating via bun..."));
	try {
		execSync(`bun install -g ${PACKAGE}@${expectedVersion}`, { stdio: "inherit" });
	} catch (error) {
		throw new Error("bun install failed", { cause: error });
	}

	// Verify the update actually took effect
	try {
		const result = spawnSync("bun", ["pm", "ls", "-g"], { encoding: "utf-8", stdio: "pipe" });
		const output = result.stdout || "";
		const match = output.match(new RegExp(`${PACKAGE.replace("/", "\\/")}@(\\S+)`));
		if (match) {
			const installedVersion = match[1];
			if (compareVersions(installedVersion, expectedVersion) < 0) {
				console.log(
					chalk.yellow(`\nWarning: bun reports ${installedVersion} installed, expected ${expectedVersion}`),
				);
				console.log(chalk.yellow(`Try: bun install -g ${PACKAGE}@latest`));
				return;
			}
		}
	} catch {
		// Verification is best-effort, don't fail the update
	}
	console.log(chalk.green(`\n${theme.status.success} Update complete`));
}

/**
 * Update by downloading binary from GitHub releases.
 */
async function updateViaBinary(release: ReleaseInfo): Promise<void> {
	const binaryName = getBinaryName();
	const nativeAddonNames = getNativeAddonNames();
	const asset = release.assets.find(a => a.name === binaryName);
	if (!asset) {
		throw new Error(`No binary found for ${binaryName}`);
	}
	const execPath = process.execPath;
	const execDir = path.dirname(execPath);
	const tempPath = `${execPath}.new`;
	const backupPath = `${execPath}.bak`;
	const nativeDownloads: Array<{ name: string; tempPath: string; finalPath: string }> = [];

	const downloadNativeAsset = async (name: string, required: boolean): Promise<boolean> => {
		const nativeAsset = release.assets.find(assetEntry => assetEntry.name === name);
		if (!nativeAsset) {
			if (required) throw new Error(`No native addon found for ${name}`);
			return false;
		}

		console.log(chalk.dim(`Downloading ${name}…`));
		try {
			const nativeResponse = await fetch(nativeAsset.url, { redirect: "follow" });
			if (!nativeResponse.ok || !nativeResponse.body) {
				if (required) throw new Error(`Native addon download failed for ${name}: ${nativeResponse.statusText}`);
				return false;
			}

			const nativeFinalPath = path.join(execDir, name);
			const nativeTempPath = `${nativeFinalPath}.new`;
			const nativeFileStream = fs.createWriteStream(nativeTempPath, { mode: 0o755 });
			await pipeline(nativeResponse.body, nativeFileStream);
			nativeDownloads.push({ name, tempPath: nativeTempPath, finalPath: nativeFinalPath });
			return true;
		} catch (err) {
			if (required) throw err;
			return false;
		}
	};

	console.log(chalk.dim(`Downloading ${binaryName}…`));

	// Download binary to temp file
	const response = await fetch(asset.url, { redirect: "follow" });
	if (!response.ok || !response.body) {
		throw new Error(`Download failed: ${response.statusText}`);
	}
	const fileStream = fs.createWriteStream(tempPath, { mode: 0o755 });
	await pipeline(response.body, fileStream);
	for (const nativeAddonName of nativeAddonNames) {
		await downloadNativeAsset(nativeAddonName, true);
	}
	// Replace current binary
	console.log(chalk.dim("Installing update..."));
	try {
		try {
			await fs.promises.unlink(backupPath);
		} catch (err) {
			if (!isEnoent(err)) throw err;
		}
		await fs.promises.rename(execPath, backupPath);
		await fs.promises.rename(tempPath, execPath);
		await fs.promises.unlink(backupPath);

		for (const nativeDownload of nativeDownloads) {
			await fs.promises.rename(nativeDownload.tempPath, nativeDownload.finalPath);
		}
		console.log(chalk.green(`\n${theme.status.success} Updated to ${release.version}`));
		console.log(chalk.dim(`Installed ${nativeDownloads.length} native addon file(s)`));
		console.log(chalk.dim(`Restart ${APP_NAME} to use the new version`));
	} catch (err) {
		if (fs.existsSync(backupPath) && !fs.existsSync(execPath)) {
			await fs.promises.rename(backupPath, execPath);
		}
		if (fs.existsSync(tempPath)) {
			await fs.promises.unlink(tempPath);
		}
		for (const nativeDownload of nativeDownloads) {
			if (fs.existsSync(nativeDownload.tempPath)) {
				await fs.promises.unlink(nativeDownload.tempPath);
			}
		}
		throw err;
	}
}

/**
 * Run the update command.
 */
export async function runUpdateCommand(opts: { force: boolean; check: boolean }): Promise<void> {
	console.log(chalk.dim(`Current version: ${VERSION}`));

	// Check for updates
	let release: ReleaseInfo;
	try {
		release = await getLatestRelease();
	} catch (err) {
		console.error(chalk.red(`Failed to check for updates: ${err}`));
		process.exit(1);
	}

	const comparison = compareVersions(release.version, VERSION);

	if (comparison <= 0 && !opts.force) {
		console.log(chalk.green(`${theme.status.success} Already up to date`));
		return;
	}

	if (comparison > 0) {
		console.log(chalk.cyan(`New version available: ${release.version}`));
	} else {
		console.log(chalk.yellow(`Forcing reinstall of ${release.version}`));
	}

	if (opts.check) {
		// Just check, don't install
		return;
	}

	// Choose update method
	try {
		if (!isBunBinary && hasBun()) {
			await updateViaBun(release.version);
		} else {
			await updateViaBinary(release);
		}
	} catch (err) {
		console.error(chalk.red(`Update failed: ${err}`));
		process.exit(1);
	}
}

/**
 * Print update command help.
 */
export function printUpdateHelp(): void {
	console.log(`${chalk.bold(`${APP_NAME} update`)} - Check for and install updates

${chalk.bold("Usage:")}
  ${APP_NAME} update [options]

${chalk.bold("Options:")}
  -c, --check   Check for updates without installing
  -f, --force   Force reinstall even if up to date

${chalk.bold("Examples:")}
  ${APP_NAME} update           Update to latest version
  ${APP_NAME} update --check   Check if updates are available
  ${APP_NAME} update --force   Force reinstall
`);
}
