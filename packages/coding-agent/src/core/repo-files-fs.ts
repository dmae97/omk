import { closeSync, type Dirent, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
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
	/^(?:\.env(?:\..+)?|credentials\.json|auth\.json|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.kdbx|key4\.db|logins\.json|cookies\.sqlite)$/i;

export type RepoFileKind = "dir" | "file";

export interface RepoFileEntry {
	readonly name: string;
	readonly path: string;
	readonly kind: RepoFileKind;
	readonly size: number;
}

export interface RepoDirectoryListing {
	readonly rootName: string;
	readonly path: string;
	readonly truncated: boolean;
	readonly entries: readonly RepoFileEntry[];
}

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

export interface SearchRepoFilesOptions {
	readonly includeHidden?: boolean;
	readonly maxResults?: number;
	readonly maxDepth?: number;
	readonly maxScanned?: number;
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
	const maxEntries = Math.min(500, Math.max(20, Number(options.maxEntries) || 300));
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
		entries: entries.slice(0, maxEntries),
	};
}

export function searchRepoFiles(
	rootDir: string,
	query: string,
	options: SearchRepoFilesOptions = {},
): readonly RepoFileEntry[] {
	const term = query.trim().toLowerCase();
	if (!term) return [];
	const includeHidden = Boolean(options.includeHidden);
	const maxResults = Math.min(200, Math.max(10, Number(options.maxResults) || 80));
	const maxDepth = Math.min(8, Math.max(1, Number(options.maxDepth) || 6));
	const maxScanned = Math.min(5000, Math.max(100, Number(options.maxScanned) || 1500));
	const rootReal = realpathSync(resolve(rootDir));
	const matches: { entry: RepoFileEntry; score: number }[] = [];
	let scanned = 0;

	const walk = (dir: string, depth: number): void => {
		if (depth > maxDepth || scanned >= maxScanned) return;
		let dirents: Dirent[];
		try {
			dirents = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const dirent of dirents) {
			if (scanned >= maxScanned) return;
			const name = dirent.name;
			if (ALWAYS_SKIP_DIRS.has(name)) continue;
			if (!includeHidden && (name.startsWith(".") || DEFAULT_IGNORE_NAMES.has(name))) continue;
			if (dirent.isSymbolicLink()) continue;
			scanned += 1;
			const full = join(dir, name);
			const isDir = dirent.isDirectory();
			const rel = relative(rootReal, full).split(sep).join("/");
			const lowerName = name.toLowerCase();
			const lowerRel = rel.toLowerCase();
			if (lowerRel.includes(term)) {
				let size = 0;
				if (!isDir) {
					try {
						size = statSync(full).size;
					} catch {
						continue;
					}
				}
				const score = lowerName === term ? 0 : lowerName.startsWith(term) ? 1 : lowerName.includes(term) ? 2 : 3;
				matches.push({ entry: { name, path: rel, kind: isDir ? "dir" : "file", size }, score });
			}
			if (isDir) walk(full, depth + 1);
		}
	};

	walk(rootReal, 0);
	matches.sort((a, b) => {
		if (a.score !== b.score) return a.score - b.score;
		if (a.entry.kind !== b.entry.kind) return a.entry.kind === "file" ? -1 : 1;
		return a.entry.path.localeCompare(b.entry.path, undefined, { sensitivity: "base" });
	});
	return matches.slice(0, maxResults).map((m) => m.entry);
}

export function readSafeRepoFile(rootDir: string, relPath: string, maxBytes = 65_536): RepoFilePreview {
	const rootReal = realpathSync(resolve(rootDir));
	const targetFile = resolveSafeRepoPath(rootReal, relPath);
	const rel = relative(rootReal, targetFile).split(sep).join("/");
	const st = statSync(targetFile);
	if (!st.isFile()) throw new Error("Target is not a regular file");

	if (isSecretFileName(targetFile)) {
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
