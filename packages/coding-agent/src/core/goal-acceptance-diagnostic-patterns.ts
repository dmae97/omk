/** Spec 095 anchor patterns, success exclusions and injection rules R1–R3. */
import { ANCHOR_LINE_CHARS } from "./goal-acceptance-diagnostic-text.ts";

/**
 * Generic error markers, tested in order on each sanitized line (leading
 * whitespace trimmed). They only choose where the excerpt windows sit; they
 * never affect the verdict, the gate or completion.
 */
export const GOAL_DIAGNOSTIC_ERROR_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
	["fail-marker", /^(?:FAIL|FAILED|BUILD FAILED)\b/],
	["go-fail", /^--- FAIL:/],
	["error-word", /^(?:ERROR|Error)\b/],
	["error-code", /\berror\[[A-Z]?\d+\]/],
	["error-ts", /\berror TS\d+/],
	["error-colon", /\berror:/i],
	["eslint-error", /^\d+:\d+\s+error\s/],
	["named-error", /\b\w*(?:Error|Exception):/],
	["traceback", /^Traceback \(most recent call last\)/],
	["panic", /\bpanic(?:ked)?\b/],
	["npm-err", /^npm ERR!/],
	["cross-mark", /^[✗✖×❌]/],
	["pytest-e", /^E\s{2,}\S/],
	["rspec-failure", /Failure\/Error:/],
];

/**
 * Spec 095 summary-line patterns. They may anchor only window 2, and only when
 * no error pattern above produced a candidate anywhere in the output.
 */
export const GOAL_DIAGNOSTIC_SUMMARY_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
	["summary-failing", /^\s*\d+ failing\b/],
	["summary-failed", /\b[1-9]\d* (?:tests? )?failed\b/],
];

/** Lines that look like errors but report success; never an anchor. */
export const GOAL_DIAGNOSTIC_SUCCESS_EXCLUSIONS: readonly RegExp[] = [
	/\b(?:0|no|zero) (?:errors?|failures?|problems?)\b/i,
	/\bno errors? found\b/i,
	/[✓✔]/,
	/^(?:PASS|ok)\b/,
];

/** Spec 095 injection rules R1–R3 (R4 is stateful, see `AnchorScanner`). */
export const GOAL_DIAGNOSTIC_INJECTION_RULES: ReadonlyArray<readonly [string, (line: string) => boolean]> = [
	[
		"R1-log-level",
		(line) =>
			/^\S*\s*\[?(?:WARN|WARNING|INFO|DEBUG|TRACE|NOTE)\]?[:\s]/i.test(line) ||
			/level=(?:warn|info|debug|trace)\b/i.test(line),
	],
	["R2-quoted", (line) => /^(?:[>+-] |#|\/\/)/.test(line.trim())],
	["R3-retry", (line) => /retrying|\(ignored\)|will retry|attempt \d+\/\d+/i.test(line)],
];

/** The injection rule (R1–R3) rejecting `line`, or undefined. */
export function injectionRuleFor(line: string): string | undefined {
	for (const [name, rejects] of GOAL_DIAGNOSTIC_INJECTION_RULES) if (rejects(line)) return name;
	return undefined;
}

/** R4 key: the trimmed line with each run of digits normalized to `#`. */
export function repeatKey(line: string): string {
	return line.trim().replace(/\d+/g, "#");
}

function successExcluded(text: string): boolean {
	return GOAL_DIAGNOSTIC_SUCCESS_EXCLUSIONS.some((exclusion) => exclusion.test(text));
}

/** The error pattern name matching `line` (success exclusions first), or undefined. Ignores R1–R4. */
export function matchErrorLine(line: string): string | undefined {
	const text = line.trimStart().slice(0, ANCHOR_LINE_CHARS);
	if (successExcluded(text)) return undefined;
	for (const [name, pattern] of GOAL_DIAGNOSTIC_ERROR_PATTERNS) if (pattern.test(text)) return name;
	return undefined;
}

/** The summary pattern name matching `line` (success exclusions first), or undefined. */
export function matchSummaryLine(line: string): string | undefined {
	const text = line.slice(0, ANCHOR_LINE_CHARS);
	if (successExcluded(text.trimStart())) return undefined;
	for (const [name, pattern] of GOAL_DIAGNOSTIC_SUMMARY_PATTERNS) if (pattern.test(text)) return name;
	return undefined;
}
