/**
 * Spec 095/097 measurement core: which window holds each fixture's real first and
 * last error line. Test/measurement use only; never imported by runtime code.
 *
 * Rules (selected explicitly; default "095" so the 095 record is unchanged):
 * - "095": first line in window 1 and, when the last line differs, last line in window 2.
 * - "097": both ground-truth lines are inside the emitted excerpt text (any window,
 *   merged windows count), never inside an elision marker.
 * Both rules hard-stop on fixtures that fit the cap whole.
 */
import {
	buildDiagnosticExcerpt,
	type DiagnosticExcerpt,
	diagnosticOutputFromText,
	GOAL_DIAGNOSTIC_MAX_BYTES,
	GOAL_DIAGNOSTIC_MAX_LINES,
	sanitizeDiagnosticText,
	utf8Bytes,
} from "./goal-acceptance-diagnostic.ts";

export interface MeasureFixture {
	readonly file: string;
	readonly raw: string;
	readonly truth: unknown;
}

export type WindowHit = 1 | 2 | "none";

export type MeasureRule = "095" | "097";

export interface MeasureOptions {
	readonly rule?: MeasureRule;
}

const ELISION_MARKER = /^\[… \d+ bytes elided …\]$/;

export interface MeasureRow {
	readonly file: string;
	readonly first: WindowHit;
	readonly last: WindowHit;
	readonly pattern: string;
	readonly fallback: boolean;
	readonly passthrough: boolean;
	readonly pass: boolean;
	readonly rule: MeasureRule;
	/** 097 rule: GT line present in emitted (non-marker) excerpt text. */
	readonly firstShown: boolean;
	readonly lastShown: boolean;
	readonly excerpt: DiagnosticExcerpt;
}

export function exceedsCap(sanitized: string): boolean {
	const text = sanitized.replace(/\s+$/, "");
	return utf8Bytes(text) > GOAL_DIAGNOSTIC_MAX_BYTES || text.split("\n").length > GOAL_DIAGNOSTIC_MAX_LINES;
}

function lineField(truth: unknown, key: string, file: string): number {
	const value = (truth as Record<string, unknown> | null)?.[key];
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${file}: missing or invalid ${key}`);
	}
	return value;
}

/** Line ranges of the 094 head/tail fallback: head = window 1, tail = window 2. */
function fallbackWindows(excerpt: DiagnosticExcerpt, text: string): (readonly [number, number])[] {
	const total = text.replace(/\s+$/, "").split("\n").length;
	const parts = excerpt.text.split(/\n\[… \d+ bytes elided …\]\n/);
	if (parts.length !== 2) return [];
	const head = parts[0].split("\n").length;
	const tail = parts[1].split("\n").length;
	return [
		[1, head],
		[total - tail + 1, total],
	];
}

export function windowOf(excerpt: DiagnosticExcerpt, line: number, text = ""): WindowHit {
	const windows =
		excerpt.windows ?? (excerpt.mode === "fallback" && excerpt.truncated ? fallbackWindows(excerpt, text) : []);
	const index = windows.findIndex(([start, end]) => line >= start && line <= end) ?? -1;
	return index === 0 ? 1 : index === 1 ? 2 : "none";
}

function windowRanges(excerpt: DiagnosticExcerpt, text: string): readonly (readonly [number, number])[] {
	return excerpt.windows ?? (excerpt.mode === "fallback" && excerpt.truncated ? fallbackWindows(excerpt, text) : []);
}

/** Emitted text split at elision markers into contiguous non-marker segments, in order. */
function emittedSegments(excerpt: DiagnosticExcerpt): string[][] {
	const segments: string[][] = [];
	let current: string[] | undefined;
	for (const emitted of excerpt.text.split("\n")) {
		if (ELISION_MARKER.test(emitted)) {
			current = undefined;
			continue;
		}
		if (!current) {
			current = [];
			segments.push(current);
		}
		current.push(emitted);
	}
	return segments;
}

/**
 * 097 rule for one line: the line lies in shown window k AND the emitted line at
 * the same position of the k-th non-marker segment is that line's sanitized text
 * (whole, or a non-empty prefix cut at the cap). Lines covered only by an elision
 * marker, or ranges that do not line up with emitted text, are not shown.
 */
export function lineShown(excerpt: DiagnosticExcerpt, line: number, text: string): boolean {
	const source = text.replace(/\s+$/, "").split("\n")[line - 1];
	if (source === undefined || source.trim() === "") return false;
	// Adjacent windows are emitted without a marker between them: they form one segment.
	const ranges: [number, number][] = [];
	for (const [start, end] of windowRanges(excerpt, text)) {
		const prev = ranges[ranges.length - 1];
		if (prev && start === prev[1] + 1) prev[1] = end;
		else ranges.push([start, end]);
	}
	const segments = emittedSegments(excerpt);
	if (segments.length !== ranges.length) return false;
	const k = ranges.findIndex(([start, end]) => line >= start && line <= end);
	if (k < 0) return false;
	const [start, end] = ranges[k];
	const segment = segments[k];
	if (segment.length !== end - start + 1) return false;
	const emitted = segment[line - start];
	return emitted === source || (emitted.trim() !== "" && line === end && source.startsWith(emitted));
}

/** Pure verdict for one fixture under the chosen rule. */
export function scoreFixture(
	excerpt: DiagnosticExcerpt,
	text: string,
	first: number,
	last: number,
	rule: MeasureRule,
): { first: WindowHit; last: WindowHit; firstShown: boolean; lastShown: boolean; pass: boolean } {
	const firstHit = windowOf(excerpt, first, text);
	const lastHit = windowOf(excerpt, last, text);
	const firstShown = lineShown(excerpt, first, text);
	const lastShown = lineShown(excerpt, last, text);
	const pass = rule === "097" ? firstShown && lastShown : firstHit === 1 && (last === first || lastHit === 2);
	return { first: firstHit, last: lastHit, firstShown, lastShown, pass };
}

/** Throws (hard stop) on missing ground truth or any fixture that does not exceed the cap. */
export function measureTwoWindowFixtures(
	fixtures: readonly MeasureFixture[],
	options: MeasureOptions = {},
): MeasureRow[] {
	const rule = options.rule ?? "095";
	const prepared = fixtures.map((fixture) => {
		const first = lineField(fixture.truth, "groundTruthLine", fixture.file);
		const last = lineField(fixture.truth, "groundTruthLastLine", fixture.file);
		const text = sanitizeDiagnosticText(fixture.raw);
		if (!exceedsCap(text)) {
			throw new Error(
				`${fixture.file}: fits the cap whole (<= ${GOAL_DIAGNOSTIC_MAX_BYTES} B and <= ${GOAL_DIAGNOSTIC_MAX_LINES} lines after sanitize)`,
			);
		}
		return { ...fixture, first, last, text };
	});
	return prepared.map(({ file, first, last, text }) => {
		const excerpt = buildDiagnosticExcerpt(diagnosticOutputFromText(text));
		const score = scoreFixture(excerpt, text, first, last, rule);
		return {
			file,
			...score,
			rule,
			pattern: excerpt.mode,
			fallback: excerpt.mode === "fallback",
			passthrough: !excerpt.truncated,
			excerpt,
		};
	});
}

/** Top-level manifest key that holds the author's blindness statement, not a fixture (spec 097 holdout4). */
export const MANIFEST_AUTHOR_DECLARATION = "authorDeclaration";

/**
 * Manifest entries as fixtures: skips the top-level `authorDeclaration` string and reads each
 * listed file. Ground-truth lines are 1-based on `content.split("\n")`; caps apply after trimming trailing whitespace.
 */
export function manifestFixtures(manifest: Record<string, unknown>, read: (file: string) => string): MeasureFixture[] {
	return Object.entries(manifest)
		.filter(([key, value]) => !(key === MANIFEST_AUTHOR_DECLARATION && typeof value === "string"))
		.map(([file, truth]) => ({ file, raw: read(file), truth }));
}
