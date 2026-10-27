/**
 * Spec 107: new-only diagnostics after edit/write (`OMK_EDIT_DIAGNOSTICS`, default on; `0`/`false`/`off` opts out).
 *
 * Idea credited to SWE-agent's `windowed_edit_linting` (MIT) and Aider's auto-lint
 * (Apache-2.0). No code is copied. Unlike SWE-agent this variant is report-only: the
 * edit is never rejected or reverted, and a diagnostics failure never fails the edit.
 *
 * Flow: baseline check inside the file mutation queue (before the write), snapshot
 * (mtime + hash) after the write, release the lock, post-check, re-snapshot, and
 * report only errors that are new vs the baseline. Timeouts, skips and stale files
 * append nothing to the tool text; they go to `details` and the run log only.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { isEnvFlagOptOut } from "../env-flag.ts";
import { appendRunLog } from "../run-log.ts";
import {
	type CollectFileDiagnostics,
	collectFileDiagnostics,
	type DiagnosticLine,
	type FileDiagnosticsResult,
	languageForFile,
} from "./diagnostics-checkers.ts";
import { recordCheck, sessionState } from "./edit-diagnostics-session.ts";

/** Start the per-session record at tool creation when on/shadow (no-op when off). */
export function ensureEditDiagnosticsSession(env: NodeJS.ProcessEnv = process.env): void {
	const mode = editDiagnosticsMode(env);
	if (mode !== "off") sessionState(mode);
}

export {
	EDIT_DIAG_CHECKERS_LOG,
	EDIT_DIAG_SESSION_LOG,
	flushEditDiagnosticsSession,
	setCheckerVersionProbeForTest,
} from "./edit-diagnostics-session.ts";

export const EDIT_DIAGNOSTICS_ENV = "OMK_EDIT_DIAGNOSTICS";
export const EDIT_DIAGNOSTICS_TIMEOUT_ENV = "OMK_EDIT_DIAGNOSTICS_TIMEOUT_MS";
export const EDIT_DIAG_TIMEOUT_LOG = "edit-diag-timeout";
/** One line per checked edit: mechanism metrics (spec 107 §4), never evidence for resolve rate. */
export const EDIT_DIAG_LOG = "edit-diag";

const PER_CHECK_TIMEOUT_MS = 10_000;
const PER_EDIT_TIMEOUT_MS = 20_000;
const MAX_FILES = 5;
const MAX_ENTRIES = 20;

import type { EditDiagnosticsMode } from "./edit-diagnostics-session.ts";
export type { EditDiagnosticsMode };

/**
 * Default on (incl. unset). `shadow` = checker runs, results only to the run log (model output
 * byte-identical to off); `0`/`false`/`off` = off.
 */
export function editDiagnosticsMode(env: NodeJS.ProcessEnv = process.env): EditDiagnosticsMode {
	const raw = env[EDIT_DIAGNOSTICS_ENV];
	if (raw === "shadow") return "shadow";
	return isEnvFlagOptOut(raw) ? "off" : "on";
}

/** True when the checker runs at all (on or shadow). */
export function isEditDiagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return editDiagnosticsMode(env) !== "off";
}

/** True only when results go to the model (`OMK_EDIT_DIAGNOSTICS=1`). */
export function isEditDiagnosticsReported(env: NodeJS.ProcessEnv = process.env): boolean {
	return editDiagnosticsMode(env) === "on";
}

let collector: CollectFileDiagnostics = collectFileDiagnostics;

/** Test seam: replace the checker. Returns a restore function. */
export function setEditDiagnosticsCollectorForTest(next: CollectFileDiagnostics): () => void {
	const previous = collector;
	collector = next;
	return () => {
		collector = previous;
	};
}

export interface NewDiagnosticsDetails {
	readonly outcome: "reported" | "none" | "skipped" | "stale" | "timeout";
	readonly diagnostics: readonly DiagnosticLine[];
	readonly total: number;
	readonly skipped?: string;
}

/**
 * Strip line/column numbers and position notations from a checker message so an
 * existing error that only moved (lines inserted above it) keeps the same key.
 * Covers `(12,5)`, `:12:5`, `:12`, `line 12`, `col 5`, `column 5`, `L12`, `[12:5]`.
 */
export function normalizeDiagnosticMessage(message: string): string {
	return message
		.replace(/\(\s*\d+\s*,\s*\d+\s*\)/g, "(#)")
		.replace(/\[\s*\d+\s*[:,]\s*\d+\s*\]/g, "[#]")
		.replace(/:\d+(?::\d+)?\b/g, ":#")
		.replace(/\b(lines?|ln|columns?|cols?)\s*[:.]?\s*\d+/gi, "$1 #")
		.replace(/\bL\d+(?:C\d+)?\b/g, "L#")
		.replace(/\s+/g, " ")
		.trim();
}

function keyOf(d: DiagnosticLine): string {
	return `${d.path}\0${d.severity}\0${normalizeDiagnosticMessage(d.message)}`;
}

/**
 * Errors in `after` that are not in `before`, keyed by (path, severity, normalized
 * message) with multiset counts. Line/column fields are excluded and position
 * notations are stripped from the message, so shifted errors are not "new". Warnings
 * and info are dropped. Order: edited file first, then other files by first appearance.
 */
export function diffNewDiagnostics(
	before: readonly DiagnosticLine[],
	after: readonly DiagnosticLine[],
	editedPath: string,
): DiagnosticLine[] {
	const remaining = new Map<string, number>();
	for (const d of before) {
		if (d.severity !== "error") continue;
		remaining.set(keyOf(d), (remaining.get(keyOf(d)) ?? 0) + 1);
	}
	const fresh: DiagnosticLine[] = [];
	for (const d of after) {
		if (d.severity !== "error") continue;
		const count = remaining.get(keyOf(d)) ?? 0;
		if (count > 0) remaining.set(keyOf(d), count - 1);
		else fresh.push(d);
	}
	const edited = fresh.filter((d) => d.path === editedPath);
	const others = fresh.filter((d) => d.path !== editedPath);
	return [...edited, ...others];
}

/** Cap at 5 files and 20 entries total; `undefined` when there is nothing new. */
export function formatNewDiagnostics(cwd: string, fresh: readonly DiagnosticLine[]): string | undefined {
	if (fresh.length === 0) return undefined;
	const files: string[] = [];
	const shown: DiagnosticLine[] = [];
	for (const d of fresh) {
		if (shown.length >= MAX_ENTRIES) break;
		if (!files.includes(d.path)) {
			if (files.length >= MAX_FILES) continue;
			files.push(d.path);
		}
		shown.push(d);
	}
	const lines = shown.map((d) => `ERROR ${relative(cwd, d.path) || d.path}:${d.line}:${d.column} ${d.message}`);
	if (fresh.length > shown.length) lines.push(`... ${fresh.length - shown.length} more`);
	return [`New diagnostics after this edit (${fresh.length}, vs pre-edit baseline):`, ...lines].join("\n");
}

function perCheckTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = Number(env[EDIT_DIAGNOSTICS_TIMEOUT_ENV]);
	return Number.isFinite(raw) && raw > 0 ? raw : PER_CHECK_TIMEOUT_MS;
}

interface Snapshot {
	readonly mtimeMs: number;
	readonly hash: string;
}

async function snapshotFile(absolutePath: string): Promise<Snapshot | undefined> {
	try {
		const [st, bytes] = await Promise.all([stat(absolutePath), readFile(absolutePath)]);
		return { mtimeMs: st.mtimeMs, hash: createHash("sha256").update(bytes).digest("hex") };
	} catch {
		return undefined;
	}
}

function hashMessage(message: string): string {
	return createHash("sha256").update(normalizeDiagnosticMessage(message)).digest("hex").slice(0, 16);
}

/**
 * One edit's diagnostics session. Call `baseline()` inside the mutation queue before
 * the write, `afterWrite()` inside the queue after it, then `report()` outside it.
 */
export class EditDiagnosticsRun {
	private readonly started = performance.now();
	private readonly perCheck = perCheckTimeoutMs();
	private base: FileDiagnosticsResult | undefined;
	private baseMs = 0;
	private postMs = 0;
	private newFile = false;
	private readonly mode: EditDiagnosticsMode = editDiagnosticsMode();
	private snap: Snapshot | undefined;
	private ran = false;

	private readonly tool: "edit" | "write";
	private readonly cwd: string;
	private readonly path: string;
	private readonly absolutePath: string;
	private readonly signal: AbortSignal | undefined;

	constructor(
		tool: "edit" | "write",
		cwd: string,
		path: string,
		absolutePath: string,
		signal: AbortSignal | undefined,
	) {
		this.tool = tool;
		this.cwd = cwd;
		this.path = path;
		this.absolutePath = absolutePath;
		this.signal = signal;
	}

	/** False for files no checker handles: skip everything at zero cost. */
	static applies(path: string): boolean {
		return languageForFile(path) !== undefined;
	}

	private budget(): number {
		return Math.min(this.perCheck, PER_EDIT_TIMEOUT_MS - (performance.now() - this.started));
	}

	private async check(): Promise<FileDiagnosticsResult> {
		const timeoutMs = this.budget();
		if (timeoutMs <= 0) return { lines: [], skipped: "edit deadline exhausted", timedOut: true };
		let result: FileDiagnosticsResult;
		try {
			result = await collector(this.cwd, this.path, { timeoutMs, signal: this.signal, bypassCache: true });
		} catch {
			result = { lines: [], skipped: "checker failed" };
		}
		if (recordCheck(this.mode, result, this.cwd, collector === collectFileDiagnostics)) this.ran = true;
		return result;
	}

	/**
	 * `fileExisted === false` (write to a new file) ⇒ empty baseline, no checker run, and
	 * only errors inside the new file are counted (spec 107 decision: other files have no
	 * baseline, so their existing errors would all look new).
	 */
	async baseline(fileExisted = true): Promise<void> {
		this.newFile = !fileExisted;
		const t = performance.now();
		this.base = fileExisted ? await this.check() : { lines: [] };
		this.baseMs = performance.now() - t;
	}

	async afterWrite(): Promise<void> {
		this.snap = await snapshotFile(this.absolutePath);
	}

	private log(
		outcome: NewDiagnosticsDetails["outcome"],
		extra: Record<string, number | string | boolean | readonly { file: string; key: string }[]>,
	): void {
		appendRunLog(EDIT_DIAG_LOG, {
			tool: this.tool,
			path: this.path,
			language: languageForFile(this.path) ?? null,
			outcome,
			mode: this.mode === "shadow" ? "shadow" : "on",
			baselineMs: this.baseMs,
			postMs: this.postMs,
			// Checker time only (baseline + post), so the wall-time guardrail can subtract it.
			diagMs: this.baseMs + this.postMs,
			totalMs: performance.now() - this.started,
			checkerRan: this.ran,
			...extra,
		});
	}

	private timeout(phase: "baseline" | "post"): { text: undefined; details: NewDiagnosticsDetails } {
		appendRunLog(EDIT_DIAG_TIMEOUT_LOG, {
			tool: this.tool,
			path: this.path,
			phase,
			perCheckMs: this.perCheck,
			elapsedMs: performance.now() - this.started,
		});
		this.log("timeout", { phase });
		return {
			text: undefined,
			details: { outcome: "timeout", diagnostics: [], total: 0, skipped: `${phase} timeout` },
		};
	}

	private skip(reason: string): { text: undefined; details: NewDiagnosticsDetails } {
		this.log("skipped", { reason });
		return { text: undefined, details: { outcome: "skipped", diagnostics: [], total: 0, skipped: reason } };
	}

	/** Text to append (or undefined) plus details. Never throws. */
	async report(): Promise<{ text: string | undefined; details: NewDiagnosticsDetails }> {
		const base = this.base;
		if (!base) return this.skip("baseline unavailable");
		if (base.timedOut) return this.timeout("baseline");
		if (base.skipped) return this.skip(`baseline unavailable: ${base.skipped}`);
		const tPost = performance.now();
		const post = await this.check();
		this.postMs = performance.now() - tPost;
		if (post.timedOut) return this.timeout("post");
		if (post.skipped) return this.skip(post.skipped);
		const now = await snapshotFile(this.absolutePath);
		if (!this.snap || !now || now.mtimeMs !== this.snap.mtimeMs || now.hash !== this.snap.hash) {
			this.log("stale", {});
			return { text: undefined, details: { outcome: "stale", diagnostics: [], total: 0, skipped: "stale" } };
		}
		const edited = resolve(this.absolutePath);
		const diffed = diffNewDiagnostics(base.lines, post.lines, edited);
		const fresh = this.newFile ? diffed.filter((d) => d.path === edited) : diffed;
		const text = formatNewDiagnostics(this.cwd, fresh);
		const files = new Set(fresh.map((d) => d.path)).size;
		this.log(fresh.length > 0 ? "reported" : "none", {
			newErrors: fresh.length,
			editedFileErrors: fresh.filter((d) => d.path === resolve(this.absolutePath)).length,
			files,
			// file + message hash so a verdict can compute the next-edit fix rate without message text.
			keys: fresh.map((d) => ({ file: d.path, key: hashMessage(d.message) })),
		});
		return {
			text,
			details: { outcome: fresh.length > 0 ? "reported" : "none", diagnostics: fresh, total: fresh.length },
		};
	}
}
