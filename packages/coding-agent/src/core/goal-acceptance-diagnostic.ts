/**
 * Spec 094 (P0-A) + spec 095 (two windows): a bounded, framed excerpt of a failed acceptance check's
 * output for the repair follow-up. Default off behind OMK_GOAL_DIAGNOSTICS;
 * unset or "0" keeps today's follow-up byte for byte. The diagnostic is text in
 * the follow-up only: it never feeds the gate, completion or approvals.
 */
import { buildDiagnosticExcerpt } from "./goal-acceptance-diagnostic-excerpt.ts";
import { AnchorScanner } from "./goal-acceptance-diagnostic-scanner.ts";
import {
	GOAL_DIAGNOSTIC_TAG,
	GOAL_DIAGNOSTIC_TRUST,
	sanitizeDiagnosticText,
	utf8Bytes,
} from "./goal-acceptance-diagnostic-text.ts";
import type { DiagnosticAnchor, DiagnosticOutput } from "./goal-acceptance-diagnostic-types.ts";

export { buildDiagnosticExcerpt } from "./goal-acceptance-diagnostic-excerpt.ts";
export {
	GOAL_DIAGNOSTIC_ERROR_PATTERNS,
	GOAL_DIAGNOSTIC_INJECTION_RULES,
	GOAL_DIAGNOSTIC_SUCCESS_EXCLUSIONS,
	GOAL_DIAGNOSTIC_SUMMARY_PATTERNS,
	injectionRuleFor,
	matchErrorLine,
	matchSummaryLine,
	repeatKey,
} from "./goal-acceptance-diagnostic-patterns.ts";
export { AnchorScanner } from "./goal-acceptance-diagnostic-scanner.ts";
export {
	GOAL_DIAGNOSTIC_ANCHOR_CONTEXT_LINES,
	GOAL_DIAGNOSTIC_HEAD_BYTES,
	GOAL_DIAGNOSTIC_HEAD_LINES,
	GOAL_DIAGNOSTIC_MAX_BYTES,
	GOAL_DIAGNOSTIC_MAX_LINES,
	GOAL_DIAGNOSTIC_MIDDLE_MARKER_LINES,
	GOAL_DIAGNOSTIC_REPEAT_CAP,
	GOAL_DIAGNOSTIC_TAG,
	GOAL_DIAGNOSTIC_TRUST,
	GOAL_DIAGNOSTIC_WINDOW1_BYTES,
	GOAL_DIAGNOSTIC_WINDOW1_LINES,
	GOAL_DIAGNOSTIC_WINDOW2_BYTES,
	GOAL_DIAGNOSTIC_WINDOW2_LINES,
	goalDiagnosticsEnabled,
	sanitizeDiagnosticText,
	utf8Bytes,
} from "./goal-acceptance-diagnostic-text.ts";
export type {
	DiagnosticAnchor,
	DiagnosticExcerpt,
	DiagnosticOutput,
	DiagnosticWindow,
} from "./goal-acceptance-diagnostic-types.ts";
export {
	classifyV3Line,
	d4Skips,
	GOAL_DIAGNOSTIC_V3_FAILURE_MARKERS,
	GOAL_DIAGNOSTIC_V3_SHAPE,
	GOAL_DIAGNOSTIC_V3_SUCCESS_MARKERS,
	goalDiagnosticsV3Enabled,
	knownFormatLevel,
	type V3LineClass,
	type V3LineKind,
} from "./goal-acceptance-diagnostic-v3.ts";

export interface AcceptanceDiagnosticInput {
	readonly receiptId: string;
	readonly goalId: string;
	readonly goalRevision: number;
	readonly round: number;
	readonly workspaceSha256: string;
	readonly workspaceCompleteness: string;
	readonly status: string;
	readonly exitCode: number | null;
	readonly gateReason: string;
	readonly output: DiagnosticOutput;
}

export interface AcceptanceDiagnostic {
	readonly kind: "validation_diagnostic";
	readonly checkRef: string;
	readonly attemptRef: string;
	readonly workspaceRef: string;
	readonly outcome: string;
	readonly exitCode: number | null;
	readonly gateReason: string;
	readonly excerpt: string;
	readonly truncated: boolean;
	readonly trust: typeof GOAL_DIAGNOSTIC_TRUST;
}

/** Pure: the §7.6 subset for one failed check. */
export function buildAcceptanceDiagnostic(input: AcceptanceDiagnosticInput): AcceptanceDiagnostic {
	const excerpt = buildDiagnosticExcerpt(input.output);
	return {
		kind: "validation_diagnostic",
		checkRef: input.receiptId,
		attemptRef: `${input.goalId}@r${input.goalRevision}#${input.round}`,
		workspaceRef: `${input.workspaceSha256}:${input.workspaceCompleteness}`,
		outcome: input.status,
		exitCode: input.exitCode,
		gateReason: input.gateReason,
		excerpt: excerpt.text,
		truncated: excerpt.truncated,
		trust: GOAL_DIAGNOSTIC_TRUST,
	};
}

/** Neutralize any tag of the fence inside untrusted content. */
export function escapeFence(text: string): string {
	return text.replace(/<(\/?)(acceptance-diagnostic)/gi, "<\\$1$2");
}

function attribute(value: string): string {
	return value.replace(/[^A-Za-z0-9@#:._-]/g, "_");
}

/** The fenced block appended to the repair follow-up. */
export function renderAcceptanceDiagnostic(diagnostic: AcceptanceDiagnostic): string {
	const open =
		`<${GOAL_DIAGNOSTIC_TAG} check="${attribute(diagnostic.checkRef)}" attempt="${attribute(diagnostic.attemptRef)}"` +
		` workspace="${attribute(diagnostic.workspaceRef)}" exit="${diagnostic.exitCode ?? "none"}" truncated="${diagnostic.truncated}"` +
		` trust="${diagnostic.trust}">`;
	return `${open}\n${escapeFence(diagnostic.excerpt)}\n</${GOAL_DIAGNOSTIC_TAG}>`;
}

/** Head/tail window kept by the verifier while streaming, in characters. */
export const GOAL_DIAGNOSTIC_WINDOW_CHARS = 2_000;

/** The `DiagnosticOutput` the verifier would capture for a whole output. */
export function diagnosticOutputFromText(raw: string): DiagnosticOutput {
	const text = sanitizeDiagnosticText(raw);
	const complete = text.length <= GOAL_DIAGNOSTIC_WINDOW_CHARS;
	return {
		head: complete ? text : text.slice(0, GOAL_DIAGNOSTIC_WINDOW_CHARS),
		tail: complete ? text : text.slice(-GOAL_DIAGNOSTIC_WINDOW_CHARS),
		totalBytes: utf8Bytes(text),
		complete,
		...anchorOf(text),
	};
}

function anchorOf(sanitized: string): { anchor?: DiagnosticAnchor } {
	const scanner = new AnchorScanner();
	scanner.push(sanitized);
	const anchor = scanner.finish();
	return anchor ? { anchor } : {};
}
