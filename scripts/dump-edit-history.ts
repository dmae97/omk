#!/usr/bin/env bun
/**
 * Dump and analyze edit tool attempts from session JSONL files.
 *
 * Usage:
 *   bun scripts/dump-edit-history.ts <session-file.jsonl> [options]
 *
 * Options:
 *   --failures     Show only failed attempts
 *   --successes    Show only successful attempts
 *   --json         Output as JSON
 *   --stats        Show statistics only
 *   --context      Include thinking context before each attempt
 *   --compact      Compact output (no diff content)
 */

import { Glob } from "bun";

import { basename } from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface Message {
	type: string;
	id?: string;
	message?: {
		role?: string;
		content?: Array<{
			type: string;
			name?: string;
			id?: string;
			arguments?: Record<string, unknown>;
			text?: string;
			thinking?: string;
		}>;
		toolCallId?: string;
		isError?: boolean;
	};
}

interface EditAttempt {
	id: string;
	path: string;
	op: string;
	diff: string;
	isError: boolean;
	resultText: string;
	errorType?: string;
	thinkingContext?: string;
}

interface SessionResult {
	file: string;
	attempts: EditAttempt[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Parsing
// ═══════════════════════════════════════════════════════════════════════════

function classifyError(resultText: string): string {
	if (resultText.includes("Failed to find context")) return "context-not-found";
	if (resultText.includes("matches for context")) return "ambiguous-context";
	if (resultText.includes("Unexpected line in hunk")) return "parse-error";
	if (resultText.includes("Failed to find expected lines")) return "lines-not-found";
	if (resultText.includes("File not found")) return "file-not-found";
	if (resultText.includes("occurrences")) return "ambiguous-match";
	return "unknown";
}

async function extractEditAttempts(sessionPath: string): Promise<EditAttempt[]> {
	const content = await Bun.file(sessionPath).bytes();
	const messages = Bun.JSONL.parse(content) as Message[];

	const editAttempts: EditAttempt[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.type !== "message") continue;

		const msgContent = msg.message?.content;
		if (!Array.isArray(msgContent)) continue;

		// Extract thinking from this message
		const thinking = msgContent.find((c) => c.type === "thinking")?.thinking;

		for (const item of msgContent) {
			if (item.type === "toolCall" && item.name === "edit") {
				const toolId = item.id!;
				const args = item.arguments as { path?: string; op?: string; diff?: string };

				// Find result
				let result: Message["message"] | null = null;
				for (let j = i + 1; j < messages.length; j++) {
					const resultMsg = messages[j];
					if (resultMsg.type === "message" && resultMsg.message?.role === "toolResult") {
						if (resultMsg.message.toolCallId === toolId) {
							result = resultMsg.message;
							break;
						}
					}
				}

				const resultContent = result?.content;
				const resultText =
					Array.isArray(resultContent) && resultContent[0]?.type === "text"
						? (resultContent[0].text ?? "")
						: "";

				const isError = result?.isError ?? false;

				editAttempts.push({
					id: toolId,
					path: args.path ?? "",
					op: args.op ?? "update",
					diff: args.diff ?? "",
					isError,
					resultText,
					errorType: isError ? classifyError(resultText) : undefined,
					thinkingContext: thinking,
				});
			}
		}
	}

	return editAttempts;
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════

const colors = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
};

function colorize(text: string, color: keyof typeof colors): string {
	return `${colors[color]}${text}${colors.reset}`;
}

function formatDiff(diff: string): string {
	return diff
		.split("\n")
		.map((line) => {
			if (line.startsWith("+")) return colorize(line, "green");
			if (line.startsWith("-")) return colorize(line, "red");
			if (line.startsWith("@@")) return colorize(line, "cyan");
			return colorize(line, "dim");
		})
		.join("\n");
}

function formatAttempt(attempt: EditAttempt, index: number, options: Options): string {
	const status = attempt.isError
		? `${colorize("✗ FAILED", "red")} ${colorize(`[${attempt.errorType}]`, "yellow")}`
		: colorize("✓ SUCCESS", "green");

	const lines: string[] = [
		``,
		`${colorize(`### Attempt ${index}`, "bold")}: ${status}`,
		`${colorize("Path:", "dim")} ${attempt.path}`,
		`${colorize("Operation:", "dim")} ${attempt.op}`,
	];

	if (options.context && attempt.thinkingContext) {
		const truncated =
			attempt.thinkingContext.length > 300
				? `${attempt.thinkingContext.slice(0, 300)}...`
				: attempt.thinkingContext;
		lines.push(`${colorize("Thinking:", "dim")} ${truncated}`);
	}

	if (!options.compact) {
		lines.push(`${colorize("Diff:", "dim")}`);
		lines.push(formatDiff(attempt.diff));
	}

	lines.push(``);
	const resultPreview = attempt.resultText.slice(0, 200);
	const truncatedResult = attempt.resultText.length > 200 ? `${resultPreview}...` : resultPreview;
	lines.push(`${colorize("Result:", "dim")} ${truncatedResult}`);
	lines.push(colorize("-".repeat(80), "dim"));

	return lines.join("\n");
}

function formatStats(results: SessionResult[]): string {
	const allAttempts = results.flatMap((r) => r.attempts);
	const failed = allAttempts.filter((a) => a.isError);
	const succeeded = allAttempts.filter((a) => !a.isError);

	// Group failures by error type
	const errorGroups: Record<string, EditAttempt[]> = {};
	for (const attempt of failed) {
		const type = attempt.errorType ?? "unknown";
		if (!errorGroups[type]) errorGroups[type] = [];
		errorGroups[type].push(attempt);
	}

	const lines: string[] = [
		``,
		colorize("═".repeat(60), "dim"),
		colorize(" Statistics", "bold"),
		colorize("═".repeat(60), "dim"),
		``,
		`Total attempts: ${colorize(String(allAttempts.length), "bold")}`,
		`  ${colorize("✓", "green")} Succeeded: ${succeeded.length}`,
		`  ${colorize("✗", "red")} Failed: ${failed.length}`,
		``,
	];

	if (Object.keys(errorGroups).length > 0) {
		lines.push(colorize("Failures by type:", "bold"));
		for (const [type, attempts] of Object.entries(errorGroups).sort((a, b) => b[1].length - a[1].length)) {
			lines.push(`  ${colorize(type, "yellow")}: ${attempts.length}`);
			// Show example paths
			const uniquePaths = [...new Set(attempts.map((a) => a.path))].slice(0, 3);
			for (const p of uniquePaths) {
				lines.push(`    ${colorize("→", "dim")} ${p}`);
			}
		}
	}

	// Show unique @@ contexts that failed
	const failedContexts = failed
		.map((a) => {
			const match = a.diff.match(/^@@\s*(.+)$/m);
			return match?.[1]?.trim();
		})
		.filter(Boolean);

	if (failedContexts.length > 0) {
		lines.push(``);
		lines.push(colorize("Failed @@ contexts:", "bold"));
		const uniqueContexts = [...new Set(failedContexts)].slice(0, 10);
		for (const ctx of uniqueContexts) {
			lines.push(`  ${colorize("@@", "cyan")} ${ctx}`);
		}
	}

	return lines.join("\n");
}

function formatJson(results: SessionResult[]): string {
	return JSON.stringify(
		results.map((r) => ({
			file: r.file,
			attempts: r.attempts.map((a) => ({
				path: a.path,
				op: a.op,
				diff: a.diff,
				isError: a.isError,
				errorType: a.errorType,
				result: a.resultText,
			})),
		})),
		null,
		2,
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

interface Options {
	failures: boolean;
	successes: boolean;
	json: boolean;
	stats: boolean;
	context: boolean;
	compact: boolean;
}

function parseArgs(): { paths: string[]; options: Options } {
	const args = process.argv.slice(2);
	const options: Options = {
		failures: false,
		successes: false,
		json: false,
		stats: false,
		context: false,
		compact: false,
	};
	const paths: string[] = [];

	for (const arg of args) {
		if (arg === "--failures") options.failures = true;
		else if (arg === "--successes") options.successes = true;
		else if (arg === "--json") options.json = true;
		else if (arg === "--stats") options.stats = true;
		else if (arg === "--context") options.context = true;
		else if (arg === "--compact") options.compact = true;
		else if (!arg.startsWith("-")) paths.push(arg);
	}

	return { paths, options };
}

async function expandGlobs(patterns: string[]): Promise<string[]> {
	const files: string[] = [];
	for (const pattern of patterns) {
		if (pattern.includes("*")) {
			const glob = new Glob(pattern);
			for await (const file of glob.scan({ absolute: true })) {
				files.push(file);
			}
		} else {
			try {
				await Bun.file(pattern).text();
				files.push(pattern);
			} catch (err) {
				if (isEnoent(err)) continue;
				const error = err as NodeJS.ErrnoException;
				if (error.code === "EISDIR" || error.code === "EACCES" || error.code === "EPERM") continue;
				throw err;
			}
		}
	}
	return files;
}

async function main() {
	const { paths, options } = parseArgs();

	if (paths.length === 0) {
		console.error(`Usage: bun scripts/dump-edit-history.ts <session-file.jsonl> [options]

Options:
  --failures     Show only failed attempts
  --successes    Show only successful attempts
  --json         Output as JSON
  --stats        Show statistics only
  --context      Include thinking context before each attempt
  --compact      Compact output (no diff content)

Examples:
  bun scripts/dump-edit-history.ts session.jsonl
  bun scripts/dump-edit-history.ts ~/.omp/agent/sessions/**/*.jsonl --stats
  bun scripts/dump-edit-history.ts session.jsonl --failures --compact`);
		process.exit(1);
	}

	const files = await expandGlobs(paths);
	if (files.length === 0) {
		console.error("No matching files found");
		process.exit(1);
	}

	const results: SessionResult[] = [];

	for (const file of files) {
		try {
			let attempts = await extractEditAttempts(file);

			// Filter
			if (options.failures) attempts = attempts.filter((a) => a.isError);
			if (options.successes) attempts = attempts.filter((a) => !a.isError);

			if (attempts.length > 0) {
				results.push({ file, attempts });
			}
		} catch (e) {
			console.error(`Error processing ${file}: ${e}`);
		}
	}

	// Output
	if (options.json) {
		console.log(formatJson(results));
		return;
	}

	if (options.stats) {
		console.log(formatStats(results));
		return;
	}

	for (const result of results) {
		if (results.length > 1) {
			console.log(`\n${colorize("═".repeat(80), "cyan")}`);
			console.log(colorize(` ${basename(result.file)}`, "bold"));
			console.log(colorize("═".repeat(80), "cyan"));
		}

		console.log(`Found ${result.attempts.length} edit attempt(s)`);

		for (let i = 0; i < result.attempts.length; i++) {
			console.log(formatAttempt(result.attempts[i], i + 1, options));
		}
	}

	// Always show summary
	const total = results.reduce((sum, r) => sum + r.attempts.length, 0);
	const failed = results.reduce((sum, r) => sum + r.attempts.filter((a) => a.isError).length, 0);
	console.log(`\n${colorize("Summary:", "bold")} ${total - failed} succeeded, ${failed} failed`);
}

main();
