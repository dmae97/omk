/**
 * Marketplace catalog fetcher.
 *
 * Classifies a source string, resolves it, and loads the catalog.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent, logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";

import type { MarketplaceCatalog, MarketplaceSourceType } from "./types";
import { isValidNameSegment } from "./types";

// ── Types ─────────────────────────────────────────────────────────────

export interface FetchResult {
	catalog: MarketplaceCatalog;
	/** For git sources: path to the cloned marketplace directory. */
	clonePath?: string;
}

// ── classifySource ────────────────────────────────────────────────────

/**
 * Detects Windows-style absolute paths cross-platform:
 *   C:\path, C:/path  → drive-letter + colon + separator
 *   \\server\share    → UNC path
 *
 * Needed because path.isAbsolute("C:\...") returns false on POSIX.
 */
const WIN_ABS_RE = /^[A-Za-z]:[/\\]|^\\\\/;

/**
 * GitHub owner/repo shorthand: lowercase alphanumeric + hyphens/dots, one slash.
 * Must NOT start with a protocol — that is ruled out by earlier checks.
 */
const GITHUB_SHORTHAND_RE = /^[a-z0-9-]+\/[a-z0-9._-]+$/i;

/**
 * Classify a marketplace source string into one of the four source types.
 *
 * Rules are ordered; the first match wins. Protocol/pattern checks (rules 1-3)
 * run before any path.isAbsolute() check so that SCP-style git@ URLs are
 * never misclassified as local paths on Windows.
 *
 * @throws if the source format is unrecognized.
 */
export function classifySource(source: string): MarketplaceSourceType {
	// Rule 1: HTTP(S) URLs — .json suffix → url, everything else → git
	if (source.startsWith("https://") || source.startsWith("http://")) {
		try {
			const { pathname } = new URL(source);
			return pathname.endsWith(".json") ? "url" : "git";
		} catch {
			// Malformed URL — treat as git
			return "git";
		}
	}

	// Rule 2: SCP-style SSH git URLs
	if (source.startsWith("git@") || source.startsWith("ssh://")) {
		return "git";
	}

	// Rule 3: GitHub owner/repo shorthand (no protocol, no leading slash)
	if (GITHUB_SHORTHAND_RE.test(source)) {
		return "github";
	}

	// Rule 4: Explicit relative or home-relative paths
	if (source.startsWith("./") || source.startsWith("~/")) {
		return "local";
	}

	// Rule 5: Absolute paths — POSIX via path.isAbsolute, Windows via regex
	if (path.isAbsolute(source) || WIN_ABS_RE.test(source)) {
		return "local";
	}

	throw new Error(`Unrecognized source format. Did you mean './${source}' (local) or 'owner/repo' (GitHub)?`);
}

// ── parseMarketplaceCatalog ───────────────────────────────────────────

function assertField(condition: boolean, field: string, filePath: string): void {
	if (!condition) {
		throw new Error(`Missing or invalid field "${field}" in catalog: ${filePath}`);
	}
}

/**
 * Parse and validate a marketplace.json catalog from raw JSON content.
 *
 * Required fields: name (valid name segment), owner.name, plugins array.
 * Each plugin entry requires name (string) and source (string or object
 * with a "source" field). Extra fields are preserved via spread.
 *
 * @throws on JSON parse failure or missing/invalid required fields.
 */
export function parseMarketplaceCatalog(content: string, filePath: string): MarketplaceCatalog {
	let raw: unknown;
	try {
		raw = JSON.parse(content);
	} catch (err) {
		throw new Error(`Failed to parse marketplace catalog at ${filePath}: ${(err as Error).message}`);
	}

	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`Marketplace catalog at ${filePath} must be a JSON object`);
	}

	const obj = raw as Record<string, unknown>;

	// name: required, must be a valid name segment
	assertField(typeof obj.name === "string" && isValidNameSegment(obj.name), "name", filePath);

	// owner: required object with name string
	assertField(typeof obj.owner === "object" && obj.owner !== null && !Array.isArray(obj.owner), "owner", filePath);
	const owner = obj.owner as Record<string, unknown>;
	assertField(typeof owner.name === "string", "owner.name", filePath);

	// plugins: required array
	assertField(Array.isArray(obj.plugins), "plugins", filePath);

	const plugins = obj.plugins as unknown[];
	for (let i = 0; i < plugins.length; i++) {
		const entry = plugins[i];
		assertField(typeof entry === "object" && entry !== null && !Array.isArray(entry), `plugins[${i}]`, filePath);
		const p = entry as Record<string, unknown>;
		assertField(typeof p.name === "string" && isValidNameSegment(p.name), `plugins[${i}].name`, filePath);
		// source can be a string path or a typed object (github/url/git-subdir/npm)
		// all typed objects carry a "source" discriminant string field
		assertField(
			typeof p.source === "string" ||
				(typeof p.source === "object" &&
					p.source !== null &&
					!Array.isArray(p.source) &&
					typeof (p.source as Record<string, unknown>).source === "string"),
			`plugins[${i}].source`,
			filePath,
		);
		// String sources must be relative paths starting with "./"
		if (typeof p.source === "string") {
			assertField((p.source as string).startsWith("./"), `plugins[${i}].source (must start with "./")`, filePath);
		}
		// Validate required fields for typed source variants
		if (typeof p.source === "object" && p.source !== null) {
			const src = p.source as Record<string, unknown>;
			const variant = src.source as string;
			if (variant === "github") {
				assertField(typeof src.repo === "string" && src.repo.length > 0, `plugins[${i}].source.repo`, filePath);
			} else if (variant === "url" || variant === "git-subdir") {
				assertField(typeof src.url === "string" && src.url.length > 0, `plugins[${i}].source.url`, filePath);
				if (variant === "git-subdir") {
					assertField(typeof src.path === "string" && src.path.length > 0, `plugins[${i}].source.path`, filePath);
				}
			} else if (variant === "npm") {
				assertField(
					typeof src.package === "string" && src.package.length > 0,
					`plugins[${i}].source.package`,
					filePath,
				);
			}
		}
	}

	// Extra fields are preserved — cast through unknown for type safety
	return obj as unknown as MarketplaceCatalog;
}

// ── fetchMarketplace ──────────────────────────────────────────────────

/** Relative path from a marketplace root to its catalog file. */
const CATALOG_RELATIVE_PATH = path.join(".claude-plugin", "marketplace.json");

/**
 * Expand a `~/...` path to an absolute path using os.homedir().
 * Other paths are returned unchanged.
 */
function expandHome(p: string): string {
	if (p.startsWith("~/")) {
		return path.join(os.homedir(), p.slice(2));
	}
	return p;
}

/**
 * Fetch a marketplace catalog from a source.
 *
 * Dispatches on the source type: local filesystem paths are read directly;
 * GitHub/git sources are cloned with `git`; URL sources are fetched over HTTP.
 *
 * @param source   Source identifier: path, GitHub shorthand, git URL, or HTTP URL.
 * @param cacheDir Cache directory root for non-local sources.
 */
export async function fetchMarketplace(source: string, cacheDir: string): Promise<FetchResult> {
	const type = classifySource(source);

	if (type === "local") {
		const resolved = path.resolve(expandHome(source));
		const catalogPath = path.join(resolved, CATALOG_RELATIVE_PATH);

		let content: string;
		try {
			content = await Bun.file(catalogPath).text();
		} catch (err) {
			if (isEnoent(err)) {
				throw new Error(
					`Marketplace catalog not found at "${catalogPath}". ` +
						`Ensure the directory exists and contains a .claude-plugin/marketplace.json file.`,
				);
			}
			throw err;
		}

		const catalog = parseMarketplaceCatalog(content, catalogPath);
		return { catalog };
	}

	if (type === "github") {
		const url = `https://github.com/${source}.git`;
		return cloneAndReadCatalog(url, cacheDir);
	}

	if (type === "git") {
		return cloneAndReadCatalog(source, cacheDir);
	}

	// type === "url"
	const response = await fetch(source, { signal: AbortSignal.timeout(60_000) });
	if (!response.ok) {
		throw new Error(
			`Failed to fetch marketplace catalog from ${source}: HTTP ${response.status} ${response.statusText}`,
		);
	}
	const text = await response.text();
	const catalog = parseMarketplaceCatalog(text, source);

	const catalogDir = path.join(cacheDir, catalog.name);
	await Bun.write(path.join(catalogDir, "marketplace.json"), text);

	return { catalog };
}

// ── cloneAndReadCatalog ───────────────────────────────────────────────

/**
 * Clone a git repository and read its marketplace catalog.
 *
 * Clones to a temp directory first, reads the catalog to determine the
 * canonical name, then renames the temp dir to the final location.
 * Cleans up on any failure to avoid leaving partial state in cacheDir.
 */
async function cloneAndReadCatalog(url: string, cacheDir: string): Promise<FetchResult> {
	if (!Bun.which("git")) {
		throw new Error("git is not installed. Install git to use git-based marketplace sources.");
	}

	const tmpDir = path.join(cacheDir, `.tmp-clone-${Date.now()}`);
	await fs.mkdir(cacheDir, { recursive: true });

	logger.debug(`[marketplace] cloning ${url} → ${tmpDir}`);

	const result = await $`git clone --depth 1 --single-branch ${url} ${tmpDir}`.quiet().nothrow();
	if (result.exitCode !== 0) {
		await fs.rm(tmpDir, { recursive: true, force: true });
		const stderr = result.stderr.toString().trim();
		throw new Error(`git clone failed (exit ${result.exitCode}): ${stderr || "unknown error"}`);
	}

	const catalogPath = path.join(tmpDir, CATALOG_RELATIVE_PATH);
	let content: string;
	try {
		content = await Bun.file(catalogPath).text();
	} catch (err) {
		await fs.rm(tmpDir, { recursive: true, force: true });
		if (isEnoent(err)) {
			throw new Error(`Cloned repository has no marketplace catalog at ${CATALOG_RELATIVE_PATH}`);
		}
		throw err;
	}

	let catalog: MarketplaceCatalog;
	try {
		catalog = parseMarketplaceCatalog(content, catalogPath);
	} catch (err) {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
		throw err;
	}

	const finalDir = path.join(cacheDir, catalog.name);
	await fs.rm(finalDir, { recursive: true, force: true });
	await fs.rename(tmpDir, finalDir);

	return { catalog, clonePath: finalDir };
}

/**
 * Clone a git repository to a target directory. Shared by fetcher (marketplace clones)
 * and source-resolver (plugin source clones).
 *
 * @param url - Git clone URL (HTTPS, SSH, or GitHub shorthand expanded to HTTPS)
 * @param targetDir - Directory to clone into (must not exist)
 * @param options.ref - Optional branch/tag to clone
 * @param options.sha - Optional commit SHA to checkout after clone
 */
export async function cloneGitRepo(
	url: string,
	targetDir: string,
	options?: { ref?: string; sha?: string },
): Promise<void> {
	if (!Bun.which("git")) {
		throw new Error("git is not installed. Install git to use git-based plugin sources.");
	}

	const cloneArgs = ["git", "clone", "--depth", "1"];
	if (options?.ref) {
		cloneArgs.push("--branch", options.ref, "--single-branch");
	} else {
		cloneArgs.push("--single-branch");
	}
	cloneArgs.push(url, targetDir);

	logger.debug("[marketplace] cloning plugin source", { url, targetDir });

	const result = await $`${cloneArgs}`.quiet().nothrow();
	if (result.exitCode !== 0) {
		await fs.rm(targetDir, { recursive: true, force: true });
		const stderr = result.stderr.toString().trim();
		throw new Error(`git clone failed (exit ${result.exitCode}): ${stderr || "unknown error"}`);
	}

	// If a specific SHA is requested, checkout that commit
	if (options?.sha) {
		const checkout = await $`git -C ${targetDir} checkout ${options.sha}`.quiet().nothrow();
		if (checkout.exitCode !== 0) {
			await fs.rm(targetDir, { recursive: true, force: true });
			throw new Error(`Failed to checkout SHA ${options.sha} — shallow clone may not contain this commit`);
		}
	}
}
