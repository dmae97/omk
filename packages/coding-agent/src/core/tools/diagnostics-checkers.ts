/**
 * Checker runners behind the `diagnostics` tool and spec 107 edit diagnostics.
 * Kept free of tool/extension imports so `edit`/`write` can use it without
 * joining an import cycle.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type { DiagnosticLine } from "./diagnostics-parsers.ts";

import {
	type DiagnosticLine,
	parseCargo,
	parseGoVet,
	parsePyright,
	parseRuff,
	parseTsc,
} from "./diagnostics-parsers.ts";
import { pathFilter } from "./diagnostics-paths.ts";

export interface LanguageResult {
	readonly lines: readonly DiagnosticLine[];
	readonly skippedReason?: string;
	/** The checker was killed by its deadline (skippedReason keeps its old text). */
	readonly timedOut?: boolean;
	/** Directory the checker ran in; reported paths are relative to it. */
	readonly dir?: string;
}

function commandExists(command: string): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = spawn("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
		probe.on("close", (code) => resolve(code === 0));
		probe.on("error", () => resolve(false));
	});
}

function run(
	command: string,
	args: readonly string[],
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{ code: number | null; out: string; timedOut: boolean }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		let out = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);
		const onAbort = (): void => {
			child.kill("SIGKILL");
		};
		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
		const done = (code: number | null): void => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve({ code, out, timedOut });
		};
		child.stdout.on("data", (d: Buffer) => {
			if (out.length < 4 * 1024 * 1024) out += d.toString("utf8");
		});
		child.stderr.on("data", (d: Buffer) => {
			if (out.length < 4 * 1024 * 1024) out += d.toString("utf8");
		});
		child.on("close", (code) => done(code));
		child.on("error", () => done(null));
	});
}

export function nearestMarker(cwd: string, names: readonly string[]): string | undefined {
	// ponytail: project markers live at the session root in this harness; walk up
	// at most 4 levels for nested worktrees.
	let dir = cwd;
	for (let level = 0; level <= 4; level++) {
		for (const name of names) {
			if (existsSync(join(dir, name))) return dir;
		}
		const parent = join(dir, "..");
		if (parent === dir) return undefined;
		dir = parent;
	}
	return undefined;
}

async function checkTypeScript(
	cwd: string,
	path: string | undefined,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<LanguageResult> {
	const root = nearestMarker(cwd, ["tsconfig.json", "tsconfig.build.json"]);
	if (!root) return { lines: [], skippedReason: "no tsconfig found" };
	const tsc = join(cwd, "node_modules", ".bin", "tsc");
	const localBin = existsSync(tsc) ? tsc : join(root, "node_modules", ".bin", "tsc");
	const bin = existsSync(localBin) ? localBin : "tsc";
	const config = existsSync(join(root, "tsconfig.json")) ? "tsconfig.json" : "tsconfig.build.json";
	const { code, out, timedOut } = await run(
		bin,
		["--noEmit", "-p", config, "--pretty", "false"],
		root,
		timeoutMs,
		signal,
	);
	if (code === null) return { lines: [], skippedReason: "tsc spawn failed", timedOut };
	return { lines: parseTsc(out, "typescript").filter(pathFilter(cwd, path, root)), dir: root };
}

async function checkPython(
	cwd: string,
	path: string | undefined,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<LanguageResult> {
	const target = path ?? ".";
	if (await commandExists("pyright")) {
		const { code, out, timedOut } = await run("pyright", ["--outputjson", target], cwd, timeoutMs, signal);
		if (code === null) return { lines: [], skippedReason: "pyright spawn failed", timedOut };
		const lines = parsePyright(out);
		// pyright가 사용 가능한 출력을 내지 못했으면(깨진 설치·실행 오류) 조용히 0건으로
		// 보고하지 말고 ruff로 폴�백한다. `--outputjson`은 정상 실행 시 항상
		// generalDiagnostics JSON을 낸다 — 마커가 없으면 실행 실패로 간주한다.
		if (lines.length > 0 || out.includes('"generalDiagnostics"')) return { lines, dir: cwd };
	}
	if (await commandExists("ruff")) {
		// ruff의 기본 full 출력은 parseRuff가 읽지 못하므로 concise(path:line:col: msg)를 강제한다.
		const { code, out, timedOut } = await run(
			"ruff",
			["check", "--no-cache", "--output-format", "concise", target],
			cwd,
			timeoutMs,
			signal,
		);
		if (code === null) return { lines: [], skippedReason: "ruff spawn failed", timedOut };
		return { lines: parseRuff(out), dir: cwd };
	}
	return { lines: [], skippedReason: "pyright/ruff not installed" };
}

async function checkGo(
	cwd: string,
	path: string | undefined,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<LanguageResult> {
	const root = nearestMarker(cwd, ["go.mod"]);
	if (!root) return { lines: [], skippedReason: "no go.mod found" };
	if (!(await commandExists("go"))) return { lines: [], skippedReason: "go not installed" };
	const { code, out, timedOut } = await run("go", ["vet", "./..."], root, timeoutMs, signal);
	if (code === null) return { lines: [], skippedReason: "go vet spawn failed", timedOut };
	return { lines: parseGoVet(out).filter(pathFilter(cwd, path, root)), dir: root };
}

async function checkRust(
	cwd: string,
	path: string | undefined,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<LanguageResult> {
	const root = nearestMarker(cwd, ["Cargo.toml"]);
	if (!root) return { lines: [], skippedReason: "no Cargo.toml found" };
	if (!(await commandExists("cargo"))) return { lines: [], skippedReason: "cargo not installed" };
	const { code, out, timedOut } = await run(
		"cargo",
		["check", "--quiet", "--message-format", "short"],
		root,
		timeoutMs,
		signal,
	);
	if (code === null) return { lines: [], skippedReason: "cargo spawn failed", timedOut };
	return { lines: parseCargo(out).filter(pathFilter(cwd, path, root)), dir: root };
}

export const CHECKERS = {
	typescript: checkTypeScript,
	python: checkPython,
	go: checkGo,
	rust: checkRust,
} as const;

export type Language = keyof typeof CHECKERS;

/** Language of a file by extension only; `undefined` means no checker applies. */
export function languageForFile(path: string): Language | undefined {
	if (/\.tsx?$/.test(path)) return "typescript";
	if (/\.py$/.test(path)) return "python";
	if (/\.go$/.test(path)) return "go";
	if (/\.rs$/.test(path)) return "rust";
	return undefined;
}

export interface FileDiagnosticsResult {
	/** Diagnostics with `path` resolved to an absolute path. */
	readonly lines: readonly DiagnosticLine[];
	readonly skipped?: string;
	readonly timedOut?: boolean;
}

export type CollectFileDiagnostics = (
	cwd: string,
	path: string,
	options: { timeoutMs: number; signal?: AbortSignal; bypassCache: true },
) => Promise<FileDiagnosticsResult>;

/**
 * Internal helper for edit diagnostics (spec 107). Runs the checker for the
 * file's language, never through the TTL cache, and returns every diagnostic
 * the checker reports (project-wide for tsc/go/cargo; the file for python) so
 * cross-file breakage is visible. Paths are absolute for exact comparison.
 */
export const collectFileDiagnostics: CollectFileDiagnostics = async (cwd, path, { timeoutMs, signal }) => {
	const language = languageForFile(path);
	if (!language) return { lines: [], skipped: "unsupported language" };
	const scope = language === "python" ? path : undefined;
	const result = await CHECKERS[language](cwd, scope, timeoutMs, signal);
	if (result.skippedReason) return { lines: [], skipped: result.skippedReason, timedOut: result.timedOut === true };
	const dir = result.dir ?? cwd;
	return { lines: result.lines.map((d) => ({ ...d, path: resolve(dir, d.path) })) };
};

export type CheckerName = "tsc" | "pyright" | "ruff";
/** `null` = not installed, failed or timed out. First output line only, capped at 80 chars. */
export type CheckerVersions = Readonly<Record<CheckerName, string | null>>;

/**
 * Spec 107 pre-registration: `--version` of each checker the bench image must pin.
 * Never throws; each probe is bounded by `timeoutMs`.
 */
export async function probeCheckerVersions(cwd: string, timeoutMs = 5_000): Promise<CheckerVersions> {
	const root = nearestMarker(cwd, ["tsconfig.json", "tsconfig.build.json", "package.json"]) ?? cwd;
	const local = [join(cwd, "node_modules", ".bin", "tsc"), join(root, "node_modules", ".bin", "tsc")].find((p) =>
		existsSync(p),
	);
	const one = async (bin: string): Promise<string | null> => {
		try {
			const { code, out, timedOut } = await run(bin, ["--version"], cwd, timeoutMs);
			if (code !== 0 || timedOut) return null;
			const line = out.trim().split("\n")[0]?.trim() ?? "";
			return line ? line.slice(0, 80) : null;
		} catch {
			return null;
		}
	};
	const [tsc, pyright, ruff] = await Promise.all([one(local ?? "tsc"), one("pyright"), one("ruff")]);
	return { tsc, pyright, ruff };
}
