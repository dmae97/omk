// OS-agnostic "which" helper with robust macOS toolchain lookup and flexible cache control.
//
// - Falls back to macOS Xcode toolchain locations and `xcrun` if standard `Bun.which()` fails on Darwin.
// - Supports four cache modes (`none`, `fresh`, `ro`, `cached`) for control over discovery cost and determinism.
// - Computes a stable cache key from command + options to avoid redundant lookups within a process.
// - Returns path to resolved binary or null if not found.
//

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Extra toolchain directories for Apple tool CLI binaries not on PATH by default
const MACOS_TOOL_PATHS = [
	"/Library/Developer/CommandLineTools/usr/bin",
	"/Applications/Xcode.app/Contents/Developer/usr/bin",
] as const;

// Map: cache key -> resolved binary path or null (not found)
const toolCache = new Map<string | bigint, string | null>();

/**
 * Cache policy for which lookups.
 */
export const enum WhichCachePolicy {
	/**
	 * Use cached result if available.
	 */
	Cached = 0,
	/**
	 * Bypass cache and perform a new lookup.
	 */
	Bypass,
	/**
	 * Always update cache.
	 */
	Fresh,
	/**
	 * Read-only, serves from cache if present, but doesn't write.
	 */
	ReadOnly,
}

// Extension: additional cache policy for tool path lookup
export interface WhichOptions extends Bun.WhichOptions {
	/**
	 * Cache policy for the lookup.
	 * Defaults to `WhichCachePolicy.Fresh`.
	 */
	cache?: WhichCachePolicy;
}

// Darwin-specific "which" shim: consult extra Xcode locations, then fallback to xcrun
function darwinWhich(command: string, _options?: Bun.WhichOptions): string | null {
	const regular = Bun.which(command);
	if (regular) return regular;
	for (const toolPath of MACOS_TOOL_PATHS) {
		const candidate = path.join(toolPath, command);
		if (fs.existsSync(candidate)) return candidate;
	}
	const xcrun = Bun.which("xcrun");
	if (!xcrun) return null;
	const result = Bun.spawnSync([xcrun, "-f", command], {
		stdout: "pipe",
		stderr: "ignore",
	});
	if (result.exitCode !== 0) return null;
	// xcrun -f returns path or empty string on failure
	const resolved = Buffer.from(result.stdout).toString("utf-8").trim();
	const candidate = resolved.length > 0 && fs.existsSync(resolved) ? resolved : null;
	return candidate;
}

// Which function that incorporates Darwin Xcode logic if platform reports as 'darwin'
export const whichFresh = os.platform() === "darwin" ? darwinWhich : Bun.which;

// Derive stable cache key from command and lookup options
function cacheKey(command: string, options?: Bun.WhichOptions): string | bigint {
	if (!options) return command;
	if (!options.cwd && !options.PATH) return command;
	let h = Bun.hash.xxHash64(command);
	if (options.cwd) h = Bun.hash.xxHash64(options.cwd, h);
	if (options.PATH) h = Bun.hash.xxHash64(options.PATH, h);
	return h;
}

/**
 * Locate binary on PATH (with flexible caching).
 *
 * @param command - Binary name to resolve
 * @param options - Bun.WhichOptions plus `cache` control
 * @returns Filesystem path if found, else null
 */
export function $which(command: string, options?: WhichOptions): string | null {
	const cachePolicy = options?.cache ?? WhichCachePolicy.Cached;
	let key: string | bigint | undefined;

	if (cachePolicy !== WhichCachePolicy.Bypass) {
		key = cacheKey(command, options);
		if (cachePolicy !== WhichCachePolicy.Fresh) {
			const cached = toolCache.get(key);
			if (cached !== undefined) return cached;
		}
	}

	const result = whichFresh(command, options);
	if (key != null && cachePolicy !== WhichCachePolicy.ReadOnly) {
		toolCache.set(key, result);
	}
	return result;
}
