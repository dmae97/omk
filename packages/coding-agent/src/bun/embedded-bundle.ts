import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { EMBEDDED_THEMES, EMBEDDED_VERSION } from "./embedded-assets.ts";

function isCompiledBunBinary(): boolean {
	return import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");
}

function ensurePrivateDir(dir: string): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const stat = lstatSync(dir);
	if (!stat.isDirectory() || stat.isSymbolicLink()) {
		throw new Error(`unsafe standalone cache directory: ${dir}`);
	}
}

/**
 * Self-contained single-file binary bootstrap (P0-10).
 * When the compiled `omk` binary is copied alone into an empty directory without adjacent
 * `package.json` or `theme/`, safely materialize embedded package metadata and built-in themes
 * into an owner-only (0o700) version+digest cache directory and point OMK_PACKAGE_DIR at it.
 */
export function ensureStandaloneSingleFileAssets(): string | undefined {
	if (!isCompiledBunBinary()) return undefined;
	if (process.env.OMK_PACKAGE_DIR) return process.env.OMK_PACKAGE_DIR;

	const execDir = dirname(process.execPath);
	if (existsSync(join(execDir, "package.json")) && existsSync(join(execDir, "theme", "dark.json"))) {
		return execDir;
	}
	if (!EMBEDDED_VERSION || Object.keys(EMBEDDED_THEMES).length === 0) {
		return undefined;
	}

	const pkgPayload = JSON.stringify(
		{
			name: "open-multi-agent-kit",
			version: EMBEDDED_VERSION,
			omkConfig: { name: "omk", configDir: ".omk" },
		},
		null,
		2,
	);
	const digest = createHash("sha256")
		.update(pkgPayload)
		.update(JSON.stringify(Object.keys(EMBEDDED_THEMES).sort()))
		.digest("hex")
		.slice(0, 12);

	const agentBase = process.env.OMK_CODING_AGENT_DIR || join(homedir(), ".omk", "agent");
	const cacheDir = join(agentBase, "cache", "standalone", `${EMBEDDED_VERSION}-${digest}`);
	const themeDir = join(cacheDir, "theme");

	if (!existsSync(join(cacheDir, "package.json")) || !existsSync(join(themeDir, "dark.json"))) {
		ensurePrivateDir(cacheDir);
		ensurePrivateDir(themeDir);
		writeFileSync(join(cacheDir, "package.json"), `${pkgPayload}\n`, { encoding: "utf8", mode: 0o600 });
		for (const [name, content] of Object.entries(EMBEDDED_THEMES)) {
			writeFileSync(join(themeDir, name), `${JSON.stringify(content, null, 2)}\n`, {
				encoding: "utf8",
				mode: 0o600,
			});
		}
	}

	process.env.OMK_PACKAGE_DIR = cacheDir;
	return cacheDir;
}
