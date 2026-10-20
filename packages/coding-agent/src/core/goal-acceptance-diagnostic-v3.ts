/**
 * Spec 097 (excerpt v3) line classes, behind OMK_GOAL_DIAGNOSTICS_V3 (default off).
 * Unset or "0" keeps the spec 095 scanner byte for byte. Classes only choose where
 * the excerpt windows sit; they never affect the verdict, the gate or completion.
 */
import { matchErrorLine } from "./goal-acceptance-diagnostic-patterns.ts";
import { ANCHOR_LINE_CHARS } from "./goal-acceptance-diagnostic-text.ts";

export function goalDiagnosticsV3Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const value = (env.OMK_GOAL_DIAGNOSTICS_V3 ?? "").trim().toLowerCase();
	return value === "1" || value === "on" || value === "true";
}

/**
 * - `error`: explicit 095 error pattern, D1 failure marker, or a known-format error/fatal log line.
 * - `shape`: D2 `file:line[:col]:` diagnostic, ranked below `error`.
 * - `warning`: D5, anchors only when no `error`/`shape` line exists at all.
 * - `skip`: D4 known-format info/debug/trace/warn log line; never window 1 of the fallback.
 * - `none`: anything else, including D3 success lines.
 */
export type V3LineKind = "error" | "shape" | "warning" | "skip" | "none";

export interface V3LineClass {
	readonly kind: V3LineKind;
	readonly pattern: string;
}

/** D1: tool-agnostic failure markers (whole words or status columns). */
export const GOAL_DIAGNOSTIC_V3_FAILURE_MARKERS: ReadonlyArray<readonly [string, RegExp]> = [
	["d1-failed", /\b(?:FAILED|FAIL|Failed)\b/],
	["d1-star-failed", /\*\*\*Failed/],
	["d1-failing", /\bfailing\b/],
	["d1-cross", /[✗✖]/],
];

/** D2: `file:line[:col]:` followed by whitespace, regardless of keyword. */
export const GOAL_DIAGNOSTIC_V3_SHAPE = /^\S+:\d+(?::\d+)?:\s/;

/** D3: a success marker on the line; such a line never anchors, even when it says "error". */
export const GOAL_DIAGNOSTIC_V3_SUCCESS_MARKERS: readonly RegExp[] = [/\bok\b/, /\bPASSED\b/, /\bpassed\b/, /[✓✔]/];

const WARNING = /\bwarn(?:ing)?s?\b/i;
const SKIPPED_LEVELS = new Set(["info", "debug", "trace", "warn", "warning"]);
const ERROR_LEVELS = new Set(["error", "fatal"]);
/** A whole line of logfmt `key=value` tokens (bare or double-quoted values). */
const LOGFMT_LINE = /^(?:[A-Za-z_][\w.-]*=(?:"(?:[^"\\]|\\.)*"|[^\s"]*)(?:\s+|$))+$/;
const LOGFMT_LEVEL = /(?:^|\s)level="?([A-Za-z]+)"?(?=\s|$)/;

/** D4: the level of a line in a listed known format (logfmt or JSON line), lowercased; else undefined. */
export function knownFormatLevel(line: string): string | undefined {
	const text = line.trim();
	if (text.startsWith("{")) {
		try {
			const value: unknown = JSON.parse(text);
			if (value !== null && typeof value === "object" && !Array.isArray(value)) {
				const level = (value as Record<string, unknown>).level;
				return typeof level === "string" ? level.toLowerCase() : undefined;
			}
		} catch {
			return undefined;
		}
		return undefined;
	}
	if (!LOGFMT_LINE.test(text)) return undefined;
	return LOGFMT_LEVEL.exec(text)?.[1]?.toLowerCase();
}

/** D4: true only for logfmt / JSON-line info, debug, trace, warn or warning lines; never error or fatal. */
export function d4Skips(line: string): boolean {
	const level = knownFormatLevel(line);
	return level !== undefined && SKIPPED_LEVELS.has(level);
}

export function v3SuccessLine(line: string): boolean {
	return GOAL_DIAGNOSTIC_V3_SUCCESS_MARKERS.some((marker) => marker.test(line));
}

/** Spec 097 class of one sanitized line (injection rules and R4 are applied by the scanner). */
export function classifyV3Line(line: string): V3LineClass {
	const text = line.trimStart().slice(0, ANCHOR_LINE_CHARS);
	const level = knownFormatLevel(text);
	if (level !== undefined && SKIPPED_LEVELS.has(level)) return { kind: "skip", pattern: "d4-skip" };
	if (v3SuccessLine(text)) return { kind: "none", pattern: "d3-success" };
	if (level !== undefined && ERROR_LEVELS.has(level)) return { kind: "error", pattern: "log-level-error" };
	const explicit = matchErrorLine(text);
	if (explicit !== undefined) return { kind: "error", pattern: explicit };
	for (const [name, pattern] of GOAL_DIAGNOSTIC_V3_FAILURE_MARKERS) {
		if (pattern.test(text)) return { kind: "error", pattern: name };
	}
	if (WARNING.test(text)) return { kind: "warning", pattern: "d5-warning" };
	if (GOAL_DIAGNOSTIC_V3_SHAPE.test(text)) return { kind: "shape", pattern: "d2-shape" };
	return { kind: "none", pattern: "none" };
}
