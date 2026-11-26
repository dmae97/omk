import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as nodeResolvePath, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnProcessSync } from "./child-process.ts";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

export interface PathInputOptions {
	/** Trim leading/trailing whitespace before normalization. */
	trim?: boolean;
	/** Expand leading `~` to a home directory. Defaults to true. */
	expandTilde?: boolean;
	/** Home directory used for `~` expansion. Defaults to `os.homedir()`. */
	homeDir?: string;
	/** Strip a leading `@`, used for CLI @file paths. */
	stripAtPrefix?: boolean;
	/** Normalize unicode space variants to regular spaces. */
	normalizeUnicodeSpaces?: boolean;
	/** Override platform for deterministic WSL path resolution tests. */
	platform?: NodeJS.Platform;
	/** Override environment for deterministic WSL path resolution tests. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Resolve a path to its canonical (real) form, following symlinks.
 * Falls back to the raw path if resolution fails (e.g. the target does
 * not exist yet), so that callers never crash on missing filesystem
 * entries.
 */
export function canonicalizePath(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		try {
			return realpathSync(path);
		} catch {
			return path;
		}
	}
}

/**
 * Returns true if the value is NOT a package source (npm:, git:, etc.)
 * or a remote URL protocol. Bare names, relative paths, and file: URLs
 * are considered local.
 */
export function isLocalPath(value: string): boolean {
	const trimmed = value.trim();
	// Known non-local prefixes. file: URLs are local paths and are intentionally resolved by resolvePath().
	if (
		trimmed.startsWith("npm:") ||
		trimmed.startsWith("git:") ||
		trimmed.startsWith("github:") ||
		trimmed.startsWith("http:") ||
		trimmed.startsWith("https:") ||
		trimmed.startsWith("ssh:")
	) {
		return false;
	}
	return true;
}

export function normalizePath(input: string, options: PathInputOptions = {}): string {
	let normalized = options.trim ? input.trim() : input;
	if (options.normalizeUnicodeSpaces) {
		normalized = normalized.replace(UNICODE_SPACES, " ");
	}
	if (options.stripAtPrefix && normalized.startsWith("@")) {
		normalized = normalized.slice(1);
	}

	if (options.expandTilde ?? true) {
		const home = options.homeDir ?? homedir();
		if (normalized === "~") return home;
		if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
			return join(home, normalized.slice(2));
		}
	}

	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const wslTranslated = translateWslWindowsPath(normalized, env, platform);
	if (wslTranslated !== undefined) {
		return wslTranslated;
	}
	if (/^file:\/\//.test(normalized)) {
		return fileURLToPath(normalized);
	}

	return normalized;
}

function decodeUriPath(rawPath: string): string {
	return decodeURIComponent(rawPath);
}

function translateWslWindowsPath(input: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
	const distro = env.WSL_DISTRO_NAME?.trim();
	if (platform !== "linux" || !distro) return undefined;

	const driveMatch = /^([a-z]):[\\/](.*)$/i.exec(input);
	if (driveMatch) {
		const rest = driveMatch[2].replaceAll("\\", "/");
		return `/mnt/${driveMatch[1].toLowerCase()}/${rest}`;
	}

	const uncMatch = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\(.*)$/i.exec(input);
	if (uncMatch) {
		if (uncMatch[1].toLowerCase() !== distro.toLowerCase()) return undefined;
		return `/${uncMatch[2].replaceAll("\\", "/")}`;
	}

	const fileDriveMatch = /^file:\/\/\/([a-z]):\/(.*)$/i.exec(input);
	if (fileDriveMatch) {
		return `/mnt/${fileDriveMatch[1].toLowerCase()}/${decodeUriPath(fileDriveMatch[2])}`;
	}

	const fileWslMatch = /^file:\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)\/(.*)$/i.exec(input);
	if (fileWslMatch) {
		if (fileWslMatch[1].toLowerCase() !== distro.toLowerCase()) return undefined;
		return `/${decodeUriPath(fileWslMatch[2])}`;
	}

	return undefined;
}

export function resolvePath(input: string, baseDir: string = process.cwd(), options: PathInputOptions = {}): string {
	const normalized = normalizePath(input, options);
	const normalizedBaseDir = normalizePath(baseDir);
	return isAbsolute(normalized) ? nodeResolvePath(normalized) : nodeResolvePath(normalizedBaseDir, normalized);
}

export function getCwdRelativePath(filePath: string, cwd: string): string | undefined {
	const resolvedCwd = resolvePath(cwd);
	const resolvedPath = resolvePath(filePath, resolvedCwd);
	const relativePath = relative(resolvedCwd, resolvedPath);
	const isInsideCwd =
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));

	return isInsideCwd ? relativePath || "." : undefined;
}

export function formatPathRelativeToCwdOrAbsolute(filePath: string, cwd: string): string {
	const absolutePath = resolvePath(filePath, cwd);
	return (getCwdRelativePath(absolutePath, cwd) ?? absolutePath).split(sep).join("/");
}

export function markPathIgnoredByCloudSync(path: string): void {
	const attrs =
		process.platform === "darwin"
			? ["com.dropbox.ignored", "com.apple.fileprovider.ignore#P"]
			: process.platform === "linux"
				? ["user.com.dropbox.ignored"]
				: [];

	for (const attr of attrs) {
		if (process.platform === "darwin") {
			spawnProcessSync("xattr", ["-w", attr, "1", path], { encoding: "utf-8", stdio: "ignore" });
		} else {
			spawnProcessSync("setfattr", ["-n", attr, "-v", "1", path], { encoding: "utf-8", stdio: "ignore" });
		}
	}
}
