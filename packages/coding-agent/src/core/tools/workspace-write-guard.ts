import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { resolvePath } from "../../utils/paths.ts";

/**
 * Keeps the write and edit tools inside the workspace.
 *
 * A model-chosen path is trusted only after it is resolved the same way the
 * filesystem will resolve it: `..` segments are collapsed and every symlink in
 * the longest existing prefix is followed. A symlink inside the workspace that
 * points outside it therefore counts as outside.
 */
export type WorkspaceWriteDecision = { allowed: true } | { allowed: false; reason: string };

export type WorkspaceWriteGuard = (absolutePath: string) => WorkspaceWriteDecision;

/**
 * Resolve the longest existing prefix through realpath, then re-append the missing tail.
 * A dangling symlink is followed to where a write would actually land.
 */
export function canonicalizeForWrite(path: string, depth = 0): string {
	const absolute = resolve(path);
	try {
		return realpathSync.native(absolute);
	} catch {
		// realpath fails on a dangling symlink, and existsSync follows links, so
		// check the link itself: writing to it creates the file at its target.
		const link = readSymlink(absolute);
		if (link !== undefined) {
			if (depth >= 40) return absolute; // symlink loop: the write will fail anyway
			return canonicalizeForWrite(resolve(dirname(absolute), link), depth + 1);
		}
		const parent = dirname(absolute);
		if (parent === absolute) return absolute;
		return resolve(canonicalizeForWrite(parent, depth), basename(absolute));
	}
}

function readSymlink(path: string): string | undefined {
	try {
		return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined;
	} catch {
		return undefined;
	}
}

function isInside(root: string, candidate: string): boolean {
	if (candidate === root) return true;
	const rel = relative(root, candidate);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function createWorkspaceWriteGuard(roots: readonly string[]): WorkspaceWriteGuard {
	const canonicalRoots = [...new Set(roots.filter((root) => root.trim() !== "").map(canonicalizeForWrite))];
	if (canonicalRoots.length === 0) {
		throw new Error("createWorkspaceWriteGuard needs at least one workspace root");
	}
	return (absolutePath: string) => {
		const candidate = canonicalizeForWrite(absolutePath);
		if (canonicalRoots.some((root) => isInside(root, candidate))) return { allowed: true };
		const where = canonicalRoots.length === 1 ? canonicalRoots[0] : canonicalRoots.join(", ");
		return {
			allowed: false,
			reason: `resolves to ${candidate}, outside the workspace (${where}). To allow it, add the directory to fileTools.writeRoots in your global settings.`,
		};
	};
}

/** Throw the tool-facing error when a write lands outside the workspace roots (no-op without roots). */
export function assertWorkspaceWrite(
	roots: readonly string[] | undefined,
	verb: "Write" | "Edit",
	displayPath: string,
	absolutePath: string,
): void {
	if (!roots) return;
	const decision = createWorkspaceWriteGuard(roots)(absolutePath);
	if (!decision.allowed) throw new Error(`${verb} blocked: ${displayPath} ${decision.reason}`);
}

/**
 * Where the write and edit tools may write. Global-only: a cloned repo's project
 * settings must not be able to widen its own write reach.
 */
export interface FileToolsSettings {
	/** Extra directories (absolute or ~) the write/edit tools may write into, besides the session cwd. */
	writeRoots?: string[];
	/** default: false. true turns the workspace boundary off entirely (old behaviour). */
	allowWriteOutsideWorkspace?: boolean;
}

/**
 * Roots for an agent session, or undefined when the user turned the boundary off.
 * Pass global settings only, never merged project settings.
 */
export function resolveWorkspaceWriteRoots(
	globalFileTools: FileToolsSettings | undefined,
	cwd: string,
): string[] | undefined {
	if (globalFileTools?.allowWriteOutsideWorkspace === true) return undefined;
	const extra = Array.isArray(globalFileTools?.writeRoots) ? globalFileTools.writeRoots : [];
	return [
		cwd,
		...extra
			.filter((root): root is string => typeof root === "string" && root.trim() !== "")
			.map((root) => resolvePath(root, cwd, { trim: true })),
	];
}
