/**
 * Fast validity check for one output file (spec 034 requirement 2).
 *
 * Existence, regular file, non-empty and size limit, then a syntax check for a few
 * extensions whose checker is quick and on `PATH`. A checker that is missing, hangs
 * or crashes gives "unknown", which counts as ok: a failed checker never makes a
 * file look broken. Shared with the per-edit diagnostics spec (040).
 */
import { spawn } from "node:child_process";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, extname, join } from "node:path";

export interface SizeLimit {
	readonly bytes: number;
	/** `at most N` is inclusive; `< N` and `less than N` are strict. */
	readonly inclusive: boolean;
}

export interface FastCheckResult {
	readonly ok: boolean;
	/** Why the file is not ok (`missing`, `not_file`, `empty`, `size`, `syntax:<checker>`), or `unknown:<why>` when ok. */
	readonly reason?: string;
	readonly size?: number;
	readonly ms: number;
}

export interface FastChecker {
	readonly command: string;
	readonly args: (path: string) => string[];
}

export interface FastCheckOptions {
	readonly sizeLimit?: SizeLimit;
	readonly timeoutMs?: number;
	/** Replaces the built-in checker per extension (tests). */
	readonly checkers?: Readonly<Record<string, FastChecker>>;
}

export const FAST_CHECK_TIMEOUT_MS = 5000;
/** JSON files above this are not parsed in-process; they get existence and size only. */
const MAX_JSON_BYTES = 32 * 1024 * 1024;

const BUILTIN_CHECKERS: Readonly<Record<string, FastChecker>> = {
	".c": { command: "cc", args: (path) => ["-fsyntax-only", path] },
	".h": { command: "cc", args: (path) => ["-fsyntax-only", path] },
	".py": { command: "python3", args: (path) => ["-m", "py_compile", path] },
	".sh": { command: "bash", args: (path) => ["-n", path] },
};

/** The first executable named `command` on `PATH`, or undefined. */
export function findOnPath(command: string, path = process.env.PATH ?? ""): string | undefined {
	for (const dir of path.split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, command);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// not here
		}
	}
	return undefined;
}

function withinLimit(size: number, limit: SizeLimit | undefined): boolean {
	if (!limit) return true;
	return limit.inclusive ? size <= limit.bytes : size < limit.bytes;
}

type RunOutcome = "pass" | "fail" | "timeout" | "crash";

function runChecker(
	executable: string,
	args: string[],
	timeoutMs: number,
	env: NodeJS.ProcessEnv,
): Promise<RunOutcome> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (outcome: RunOutcome) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(outcome);
		};
		const child = spawn(executable, args, { stdio: "ignore", detached: true, env });
		const timer = setTimeout(() => {
			// Kill the whole process group so a checker's children do not outlive it.
			try {
				if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
			done("timeout");
		}, timeoutMs);
		child.once("error", () => done("crash"));
		child.once("exit", (code, signal) => {
			if (signal !== null) done("crash");
			else done(code === 0 ? "pass" : "fail");
		});
	});
}

async function contentCheck(
	path: string,
	size: number,
	timeoutMs: number,
	overrides: FastCheckOptions["checkers"],
): Promise<string | undefined> {
	const ext = extname(path).toLowerCase();
	if (ext === ".json" && !overrides?.[ext]) {
		if (size > MAX_JSON_BYTES) return "unknown:too-large";
		try {
			JSON.parse(await readFile(path, "utf8"));
			return undefined;
		} catch {
			return "syntax:json";
		}
	}
	const checker = overrides?.[ext] ?? BUILTIN_CHECKERS[ext];
	if (!checker) return undefined;
	const executable = findOnPath(checker.command);
	if (!executable) return "unknown:no-checker";
	// py_compile writes bytecode; keep it out of the workspace.
	const cacheDir = ext === ".py" ? mkdtempSync(join(tmpdir(), "omk-fast-check-")) : undefined;
	const env = cacheDir ? { ...process.env, PYTHONPYCACHEPREFIX: cacheDir } : process.env;
	try {
		const outcome = await runChecker(executable, checker.args(path), timeoutMs, env);
		if (outcome === "pass") return undefined;
		if (outcome === "fail") return `syntax:${checker.command}`;
		return `unknown:${outcome}`;
	} finally {
		if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
	}
}

/** Checks that `path` is a usable output file. Never throws. */
export async function fastCheckFile(path: string, options: FastCheckOptions = {}): Promise<FastCheckResult> {
	const started = performance.now();
	const result = (ok: boolean, reason?: string, size?: number): FastCheckResult => ({
		ok,
		reason,
		size,
		ms: Math.round(performance.now() - started),
	});
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(path);
	} catch {
		return result(false, "missing");
	}
	if (!info.isFile()) return result(false, "not_file");
	const size = Number(info.size);
	if (size === 0) return result(false, "empty", 0);
	if (!withinLimit(size, options.sizeLimit)) return result(false, "size", size);
	const reason = await contentCheck(path, size, options.timeoutMs ?? FAST_CHECK_TIMEOUT_MS, options.checkers);
	return result(!reason?.startsWith("syntax:"), reason, size);
}
