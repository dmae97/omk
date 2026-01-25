import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logger, TempDir } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { APP_NAME, getBinDir } from "../config";

const TOOLS_DIR = getBinDir();
const TOOL_DOWNLOAD_TIMEOUT_MS = 15000;

interface ToolConfig {
	name: string;
	repo: string; // GitHub repo (e.g., "sharkdp/fd")
	binaryName: string; // Name of the binary inside the archive
	tagPrefix: string; // Prefix for tags (e.g., "v" for v1.0.0, "" for 1.0.0)
	isDirectBinary?: boolean; // If true, asset is a direct binary (not an archive)
	getAssetName: (version: string, plat: string, architecture: string) => string | null;
}

const TOOLS: Record<string, ToolConfig> = {
	fd: {
		name: "fd",
		repo: "sharkdp/fd",
		binaryName: "fd",
		tagPrefix: "v",
		getAssetName: (version, plat, architecture) => {
			if (plat === "darwin") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `fd-v${version}-${archStr}-apple-darwin.tar.gz`;
			} else if (plat === "linux") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `fd-v${version}-${archStr}-unknown-linux-gnu.tar.gz`;
			} else if (plat === "win32") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `fd-v${version}-${archStr}-pc-windows-msvc.zip`;
			}
			return null;
		},
	},
	rg: {
		name: "ripgrep",
		repo: "BurntSushi/ripgrep",
		binaryName: "rg",
		tagPrefix: "",
		getAssetName: (version, plat, architecture) => {
			if (plat === "darwin") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `ripgrep-${version}-${archStr}-apple-darwin.tar.gz`;
			} else if (plat === "linux") {
				if (architecture === "arm64") {
					return `ripgrep-${version}-aarch64-unknown-linux-gnu.tar.gz`;
				}
				return `ripgrep-${version}-x86_64-unknown-linux-musl.tar.gz`;
			} else if (plat === "win32") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `ripgrep-${version}-${archStr}-pc-windows-msvc.zip`;
			}
			return null;
		},
	},
	sd: {
		name: "sd",
		repo: "chmln/sd",
		binaryName: "sd",
		tagPrefix: "v",
		getAssetName: (version, plat, architecture) => {
			if (plat === "darwin") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `sd-v${version}-${archStr}-apple-darwin.tar.gz`;
			} else if (plat === "linux") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `sd-v${version}-${archStr}-unknown-linux-musl.tar.gz`;
			} else if (plat === "win32") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `sd-v${version}-${archStr}-pc-windows-msvc.zip`;
			}
			return null;
		},
	},
	sg: {
		name: "ast-grep",
		repo: "ast-grep/ast-grep",
		binaryName: "sg",
		tagPrefix: "",
		getAssetName: (_version, plat, architecture) => {
			if (plat === "darwin") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `ast-grep-${archStr}-apple-darwin.zip`;
			} else if (plat === "linux") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `ast-grep-${archStr}-unknown-linux-gnu.zip`;
			} else if (plat === "win32") {
				const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
				return `ast-grep-${archStr}-pc-windows-msvc.zip`;
			}
			return null;
		},
	},
	"yt-dlp": {
		name: "yt-dlp",
		repo: "yt-dlp/yt-dlp",
		binaryName: "yt-dlp",
		tagPrefix: "",
		isDirectBinary: true,
		getAssetName: (_version, plat, architecture) => {
			if (plat === "darwin") {
				return "yt-dlp_macos"; // Universal binary
			} else if (plat === "linux") {
				return architecture === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
			} else if (plat === "win32") {
				return architecture === "arm64" ? "yt-dlp_arm64.exe" : "yt-dlp.exe";
			}
			return null;
		},
	},
};

// Python packages installed via uv/pip
interface PythonToolConfig {
	name: string;
	package: string; // PyPI package name
	binaryName: string; // CLI command name after install
}

const PYTHON_TOOLS: Record<string, PythonToolConfig> = {
	markitdown: {
		name: "markitdown",
		package: "markitdown",
		binaryName: "markitdown",
	},
	html2text: {
		name: "html2text",
		package: "html2text",
		binaryName: "html2text",
	},
};

export type ToolName = "fd" | "rg" | "sd" | "sg" | "yt-dlp" | "markitdown" | "html2text";

// Get the path to a tool (system-wide or in our tools dir)
export async function getToolPath(tool: ToolName): Promise<string | null> {
	// Check Python tools first
	const pythonConfig = PYTHON_TOOLS[tool];
	if (pythonConfig) {
		return Bun.which(pythonConfig.binaryName);
	}

	const config = TOOLS[tool];
	if (!config) return null;

	// Check our tools directory first
	const localPath = path.join(TOOLS_DIR, config.binaryName + (os.platform() === "win32" ? ".exe" : ""));
	if (await Bun.file(localPath).exists()) {
		return localPath;
	}

	// Check system PATH
	return Bun.which(config.binaryName);
}

// Fetch latest release version from GitHub
async function getLatestVersion(repo: string): Promise<string> {
	let response: Response;
	try {
		response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
			headers: { "User-Agent": `${APP_NAME}-coding-agent` },
			signal: AbortSignal.timeout(TOOL_DOWNLOAD_TIMEOUT_MS),
		});
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new Error("GitHub API request timed out");
		}
		throw err;
	}

	if (!response.ok) {
		throw new Error(`GitHub API error: ${response.status}`);
	}

	const data = (await response.json()) as { tag_name: string };
	return data.tag_name.replace(/^v/, "");
}

// Download a file from URL
async function downloadFile(url: string, dest: string): Promise<void> {
	let response: Response;
	try {
		response = await fetch(url, {
			signal: AbortSignal.timeout(TOOL_DOWNLOAD_TIMEOUT_MS),
		});
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new Error(`Download timed out: ${url}`);
		}
		throw err;
	}
	if (!response.ok) {
		throw new Error(`Failed to download: ${response.status}`);
	} else if (!response.body) {
		throw new Error("No response body");
	}
	await Bun.write(dest, response);
}

// Download and install a tool
async function downloadTool(tool: ToolName): Promise<string> {
	const config = TOOLS[tool];
	if (!config) throw new Error(`Unknown tool: ${tool}`);

	const plat = os.platform();
	const architecture = os.arch();

	// Get latest version
	const version = await getLatestVersion(config.repo);

	// Get asset name for this platform
	const assetName = config.getAssetName(version, plat, architecture);
	if (!assetName) {
		throw new Error(`Unsupported platform: ${plat}/${architecture}`);
	}

	// Create tools directory
	await fs.mkdir(TOOLS_DIR, { recursive: true });

	const downloadUrl = `https://github.com/${config.repo}/releases/download/${config.tagPrefix}${version}/${assetName}`;
	const binaryExt = plat === "win32" ? ".exe" : "";
	const binaryPath = path.join(TOOLS_DIR, config.binaryName + binaryExt);

	// Handle direct binary downloads (no archive extraction needed)
	if (config.isDirectBinary) {
		await downloadFile(downloadUrl, binaryPath);
		if (plat !== "win32") {
			await fs.chmod(binaryPath, 0o755);
		}
		return binaryPath;
	}

	// Download archive
	const archivePath = path.join(TOOLS_DIR, assetName);
	await downloadFile(downloadUrl, archivePath);

	// Extract
	const tmp = await TempDir.create("@omp-tools-extract-");

	try {
		if (assetName.endsWith(".tar.gz") || assetName.endsWith(".zip")) {
			const archive = new Bun.Archive(await Bun.file(archivePath).arrayBuffer());
			const files = await archive.files();
			for (const [filePath, file] of files) {
				await Bun.write(path.join(tmp.path(), filePath), file);
			}
		}

		// Find the binary in extracted files
		// ast-grep releases the binary directly in the zip, not in a subdirectory
		let extractedBinary: string;
		if (tool === "sg") {
			extractedBinary = path.join(tmp.path(), config.binaryName + binaryExt);
		} else {
			const extractedDir = path.join(tmp.path(), assetName.replace(/\.(tar\.gz|zip)$/, ""));
			extractedBinary = path.join(extractedDir, config.binaryName + binaryExt);
		}

		if (await Bun.file(extractedBinary).exists()) {
			await fs.rename(extractedBinary, binaryPath);
		} else {
			throw new Error(`Binary not found in archive: ${extractedBinary}`);
		}

		// Make executable (Unix only)
		if (plat !== "win32") {
			await fs.chmod(binaryPath, 0o755);
		}
	} finally {
		// Cleanup
		await tmp.remove();
		await fs.rm(archivePath, { force: true });
	}

	return binaryPath;
}

// Install a Python package via uv (preferred) or pip
async function installPythonPackage(pkg: string): Promise<boolean> {
	// Try uv first (faster, better isolation)
	const uv = Bun.which("uv");
	if (uv) {
		const result = await $`${uv} tool install ${pkg}`.quiet().nothrow();
		if (result.exitCode === 0) return true;
	}

	// Fall back to pip
	const pip = Bun.which("pip3") || Bun.which("pip");
	if (pip) {
		const result = await $`${pip} install --user ${pkg}`.quiet().nothrow();
		return result.exitCode === 0;
	}

	return false;
}

// Ensure a tool is available, downloading if necessary
// Returns the path to the tool, or null if unavailable
type EnsureToolOptions = {
	silent?: boolean;
	notify?: (message: string) => void;
};

export async function ensureTool(
	tool: ToolName,
	silentOrOptions: boolean | EnsureToolOptions = false,
): Promise<string | undefined> {
	const options = typeof silentOrOptions === "object" ? silentOrOptions : { silent: silentOrOptions };
	const silent = options.silent ?? false;
	const existingPath = await getToolPath(tool);
	if (existingPath) {
		return existingPath;
	}

	// Handle Python tools
	const pythonConfig = PYTHON_TOOLS[tool];
	if (pythonConfig) {
		if (!silent) {
			logger.debug(`${pythonConfig.name} not found. Installing via uv/pip...`);
		}
		options.notify?.(`Installing ${pythonConfig.name}...`);
		const success = await installPythonPackage(pythonConfig.package);
		if (success) {
			// Re-check for the command after installation
			const path = Bun.which(pythonConfig.binaryName);
			if (path) {
				if (!silent) {
					logger.debug(`${pythonConfig.name} installed successfully`);
				}
				return path;
			}
		}
		if (!silent) {
			logger.warn(`Failed to install ${pythonConfig.name}`);
		}
		return undefined;
	}

	const config = TOOLS[tool];
	if (!config) return undefined;

	// Tool not found - download it
	if (!silent) {
		logger.debug(`${config.name} not found. Downloading...`);
	}
	options.notify?.(`Downloading ${config.name}...`);

	try {
		const path = await downloadTool(tool);
		if (!silent) {
			logger.debug(`${config.name} installed to ${path}`);
		}
		return path;
	} catch (e) {
		if (!silent) {
			logger.warn(`Failed to download ${config.name}`, {
				error: e instanceof Error ? e.message : String(e),
			});
		}
		return undefined;
	}
}
