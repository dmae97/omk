import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const ALWAYS_SKIP_DIRS = new Set([".git"]);
const DEFAULT_IGNORE_NAMES = new Set([
	"node_modules",
	"dist",
	"build",
	".worktrees",
	".next",
	".turbo",
	"__pycache__",
	".venv",
	"target",
]);

const SECRET_FILE_RE =
	/^(?:\.env(?:\..+)?|\.npmrc|\.netrc|\.pypirc|credentials\.json|auth\.json|secrets\.(?:json|ya?ml|toml)|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|id_ecdsa(?:\.pub)?|id_dsa(?:\.pub)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.jks|.*\.keystore|.*\.kdbx|key4\.db|logins\.json|cookies\.sqlite)$/i;

import type { RepoFileEntry, RepoFileKind, SearchRepoFilesOptions } from "./repo-files-search.ts";
export type { RepoFileEntry, RepoFileKind, SearchRepoFilesOptions };

export interface RepoDirectoryListing {
	readonly rootName: string;
	readonly path: string;
	readonly truncated: boolean;
	readonly totalEntries: number;
	readonly entries: readonly RepoFileEntry[];
}
export {
	type RepoFileSearchResult,
	type RepoFileSearchTruncationReason,
	searchRepoFiles,
	searchRepoFilesWithMeta,
} from "./repo-files-search.ts";

export interface RepoFilePreview {
	readonly path: string;
	readonly size: number;
	readonly binary: boolean;
	readonly blocked: boolean;
	readonly truncated: boolean;
	readonly content: string;
}

export interface ListRepoDirectoryOptions {
	readonly includeHidden?: boolean;
	readonly maxEntries?: number;
}

export function formatCompactSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "";
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)}K`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

export function isSecretFileName(name: string): boolean {
	return SECRET_FILE_RE.test(basename(name));
}

export function resolveSafeRepoPath(rootDir: string, relPath = ""): string {
	if (typeof relPath !== "string" || relPath.includes("\0") || isAbsolute(relPath)) {
		throw new Error("Path outside repository root");
	}
	const rootReal = realpathSync(resolve(rootDir));
	const cleaned = relPath.replace(/^\/+/, "");
	const candidate = resolve(rootReal, cleaned);
	const relToRoot = relative(rootReal, candidate);
	if (relToRoot === ".." || relToRoot.startsWith(`..${sep}`) || isAbsolute(relToRoot)) {
		throw new Error("Path outside repository root");
	}
	const resolvedReal = realpathSync(candidate);
	if (resolvedReal !== rootReal && !resolvedReal.startsWith(`${rootReal}${sep}`)) {
		throw new Error("Path outside repository root");
	}
	return resolvedReal;
}

export function listRepoDirectory(
	rootDir: string,
	relPath = "",
	options: ListRepoDirectoryOptions = {},
): RepoDirectoryListing {
	const includeHidden = Boolean(options.includeHidden);
	const maxEntries = Math.min(2000, Math.max(20, Number(options.maxEntries) || 300));
	const rootReal = realpathSync(resolve(rootDir));
	const targetDir = resolveSafeRepoPath(rootReal, relPath);
	const dirents = readdirSync(targetDir, { withFileTypes: true });

	const entries: RepoFileEntry[] = [];
	for (const dirent of dirents) {
		const name = dirent.name;
		if (ALWAYS_SKIP_DIRS.has(name)) continue;
		if (!includeHidden && (name.startsWith(".") || DEFAULT_IGNORE_NAMES.has(name))) continue;
		const full = join(targetDir, name);
		let kind: RepoFileKind = dirent.isDirectory() ? "dir" : "file";
		let size = 0;
		try {
			if (dirent.isSymbolicLink()) {
				const resolved = realpathSync(full);
				if (resolved !== rootReal && !resolved.startsWith(`${rootReal}${sep}`)) continue;
			}
			const st = statSync(full);
			kind = st.isDirectory() ? "dir" : "file";
			size = st.isFile() ? st.size : 0;
		} catch {
			continue;
		}
		const entryRel = relative(rootReal, full).split(sep).join("/");
		entries.push({ name, path: entryRel, kind, size });
	}

	entries.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});

	return {
		rootName: basename(rootReal) || rootReal,
		path: relative(rootReal, targetDir).split(sep).join("/"),
		truncated: entries.length > maxEntries,
		totalEntries: entries.length,
		entries: entries.slice(0, maxEntries),
	};
}

export function readSafeRepoFile(rootDir: string, relPath: string, maxBytes = 65_536): RepoFilePreview {
	const rootReal = realpathSync(resolve(rootDir));
	const targetFile = resolveSafeRepoPath(rootReal, relPath);
	const rel = relative(rootReal, targetFile).split(sep).join("/");
	const st = statSync(targetFile);
	if (!st.isFile()) throw new Error("Target is not a regular file");

	if (isSecretFileName(relPath) || isSecretFileName(targetFile)) {
		return { path: rel, size: st.size, binary: false, blocked: true, truncated: false, content: "" };
	}

	const toRead = Math.min(st.size, maxBytes);
	const buf = Buffer.alloc(toRead);
	const fd = openSync(targetFile, "r");
	try {
		if (toRead > 0) readSync(fd, buf, 0, toRead, 0);
	} finally {
		closeSync(fd);
	}

	const sampleLen = Math.min(buf.length, 4096);
	for (let i = 0; i < sampleLen; i++) {
		if (buf[i] === 0) {
			return { path: rel, size: st.size, binary: true, blocked: false, truncated: false, content: "" };
		}
	}

	return {
		path: rel,
		size: st.size,
		binary: false,
		blocked: false,
		truncated: st.size > maxBytes,
		content: buf.toString("utf8"),
	};
}
