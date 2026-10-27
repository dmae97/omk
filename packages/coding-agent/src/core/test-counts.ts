/**
 * Spec 100: test counts read from a check's own output text.
 *
 * Only the summary formats of node:test (TAP and spec reporters), vitest and
 * jest are understood. Nothing is installed or run here; a summary this module
 * cannot read gives `undefined`, never a guessed number.
 */
import { stripAnsi } from "../utils/ansi.ts";

/** What kind of check an approved command is, from the command text alone. */
export type CheckKind = "test_runner" | "typecheck" | "shell";

/** Counts a runner printed. `executed` ran (passed or failed); `skipped` includes todo; `matched` is the runner's total. */
export interface TestCounts {
	readonly executed: number;
	readonly matched: number;
	readonly skipped: number;
}

const TEST_RUNNER =
	/(?:^|[\s;&|(])(?:npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+)?(?:vitest|jest)\b|\bnode\b[^;&|]*(?:--test\b|--test-[a-z-]+|\.test\.[cm]?[jt]s\b)|\bnpm\s+(?:run\s+)?test\b/;
const TYPECHECK = /(?:^|[\s;&|(])(?:npx\s+)?(?:tsc|tsgo)\b/;

export function classifyCheckKind(command: string): CheckKind {
	if (TEST_RUNNER.test(command)) return "test_runner";
	if (TYPECHECK.test(command)) return "typecheck";
	return "shell";
}

function lastMatch(text: string, pattern: RegExp): RegExpMatchArray | undefined {
	let found: RegExpMatchArray | undefined;
	for (const match of text.matchAll(pattern)) found = match;
	return found;
}

/** Non-flag arguments of each `node --test …` invocation in the command: the files node:test was given. */
export function nodeTestFileArgs(command: string): Set<string> {
	const files = new Set<string>();
	for (const segment of command.split(/&&|\|\||[;|\n]/)) {
		const tokens = segment
			.trim()
			.split(/\s+/)
			.map((token) => token.replace(/^['"]|['"]$/g, ""));
		const node = tokens.findIndex((token) => token === "node" || token.endsWith("/node"));
		if (node < 0 || !tokens.slice(node + 1).includes("--test")) continue;
		for (const token of tokens.slice(node + 1)) if (token.length > 0 && !token.startsWith("-")) files.add(token);
	}
	return files;
}

/**
 * node:test reports a file whose tests were all filtered out as one top-level passing test named
 * exactly after the file. Only such a line counts as a stand-in: its name equals a file argument
 * and it has no subtests (TAP: the file's own `1..0` plan, then the `# Subtest:` header; spec: no
 * indented child line right above it). A real test that merely looks like a file name stays counted.
 */
function fileStandIns(text: string, files: ReadonlySet<string>): number {
	if (files.size === 0) return 0;
	const lines = text.split("\n");
	let count = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;
		const tap = /^ok \d+ - (.+)$/.exec(line);
		if (tap && files.has(tap[1] as string)) {
			if (lines[i - 1] === `# Subtest: ${tap[1]}` && lines[i - 2] === "1..0") count++;
			continue;
		}
		const spec = /^\u2714 (.+) \([\d.]+m?s\)$/.exec(line);
		if (spec && files.has(spec[1] as string) && (i === 0 || !/^\s/.test(lines[i - 1] as string))) count++;
	}
	return count;
}

/** node:test: `# tests N` (TAP) or `ℹ tests N` (spec), with pass/fail/cancelled/skipped/todo lines. */
function nodeTestCounts(text: string, files: ReadonlySet<string>): TestCounts | undefined {
	const field = (name: string): number | undefined => {
		const match = lastMatch(text, new RegExp(`^(?:#|\\u2139)\\s+${name}\\s+(\\d+)\\s*$`, "gm"));
		return match ? Number(match[1]) : undefined;
	};
	const tests = field("tests");
	const pass = field("pass");
	const fail = field("fail");
	const cancelled = field("cancelled");
	const skipped = field("skipped");
	const todo = field("todo");
	if ([tests, pass, fail, cancelled, skipped, todo].some((value) => value === undefined)) return undefined;
	const skippedAll = (skipped as number) + (todo as number);
	const executed = (pass as number) + (fail as number) + (cancelled as number);
	if (executed + skippedAll !== tests) return undefined;
	// A file whose own tests were all filtered out is reported as one passing test named after the file.
	const standIns = fileStandIns(text, files);
	if (standIns > (pass as number)) return undefined;
	return { executed: executed - standIns, matched: (tests as number) - standIns, skipped: skippedAll };
}

function partsOf(list: string): Map<string, number> | undefined {
	const parts = new Map<string, number>();
	for (const part of list.split(/\s*[|,]\s*/)) {
		const match = /^(\d+)\s+(passed|failed|skipped|todo|pending)$/.exec(part.trim());
		if (!match) return undefined;
		parts.set(match[2] as string, Number(match[1]));
	}
	return parts;
}

function fromParts(parts: Map<string, number>, total: number): TestCounts | undefined {
	const skipped = (parts.get("skipped") ?? 0) + (parts.get("todo") ?? 0) + (parts.get("pending") ?? 0);
	const executed = (parts.get("passed") ?? 0) + (parts.get("failed") ?? 0);
	if (executed + skipped !== total) return undefined;
	return { executed, matched: total, skipped };
}

/** vitest: `      Tests  2 passed | 1 skipped (3)`. */
function vitestCounts(text: string): TestCounts | undefined {
	const match = lastMatch(text, /^\s*Tests\s{2,}(.+?)\s+\((\d+)\)\s*$/gm);
	if (!match) return undefined;
	const parts = partsOf(match[1] as string);
	return parts ? fromParts(parts, Number(match[2])) : undefined;
}

/** jest: `Tests:       1 skipped, 2 passed, 3 total`. */
function jestCounts(text: string): TestCounts | undefined {
	const match = lastMatch(text, /^Tests:\s+(?:(.+?),\s+)?(\d+)\s+total\s*$/gm);
	if (!match) return undefined;
	const total = Number(match[2]);
	if (match[1] === undefined) return total === 0 ? { executed: 0, matched: 0, skipped: 0 } : undefined;
	const parts = partsOf(match[1]);
	return parts ? fromParts(parts, total) : undefined;
}

/**
 * Counts from the runner's own summary, or undefined when no known summary is readable.
 * `command` is the executed check; only its node:test file arguments can mark a file stand-in.
 */
export function parseTestCounts(output: string, command = ""): TestCounts | undefined {
	const text = stripAnsi(output).replace(/\r/g, "");
	return nodeTestCounts(text, nodeTestFileArgs(command)) ?? vitestCounts(text) ?? jestCounts(text);
}
