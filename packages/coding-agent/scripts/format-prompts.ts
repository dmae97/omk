#!/usr/bin/env bun
/**
 * Format prompt files (mixed XML + Markdown + Handlebars).
 *
 * Rules:
 * 1. No blank line before list items
 * 2. No blank line after opening XML tag or Handlebars block
 * 3. No blank line before closing XML tag or Handlebars block
 * 4. Strip leading whitespace from closing XML tags and Handlebars (lines starting with {{)
 * 5. Compact markdown tables (remove padding)
 * 6. Collapse 2+ blank lines to single blank line
 * 7. Trim trailing whitespace (preserve indentation)
 * 8. No trailing newline at EOF
 */
import { Glob } from "bun";

const PROMPTS_DIR = new URL("../src/prompts/", import.meta.url).pathname;
const COMMIT_PROMPTS_DIR = new URL("../src/commit/prompts/", import.meta.url).pathname;
const AGENTIC_PROMPTS_DIR = new URL("../src/commit/agentic/prompts/", import.meta.url).pathname;

const PROMPT_DIRS = [PROMPTS_DIR, COMMIT_PROMPTS_DIR, AGENTIC_PROMPTS_DIR];

// Opening XML tag (not self-closing, not closing)
const OPENING_XML = /^<([a-z_-]+)(?:\s+[^>]*)?>$/;
// Closing XML tag
const CLOSING_XML = /^<\/([a-z_-]+)>$/;
// Handlebars block start: {{#if}}, {{#has}}, {{#list}}, etc.
const OPENING_HBS = /^\{\{#/;
// Handlebars block end: {{/if}}, {{/has}}, {{/list}}, etc.
const CLOSING_HBS = /^\{\{\//;
// List item (- or * or 1.)
const LIST_ITEM = /^[-*]|\d+\.\s/;
// Code fence
const CODE_FENCE = /^```/;
// Table row
const TABLE_ROW = /^\|.*\|$/;
// Table separator (|---|---|)
const TABLE_SEP = /^\|[-:\s|]+\|$/;

/** Compact a table row by trimming cell padding */
function compactTableRow(line: string): string {
	// Split by |, trim each cell, rejoin
	const cells = line.split("|");
	return cells.map((c) => c.trim()).join("|");
}

/** Compact a table separator row */
function compactTableSep(line: string): string {
	// Normalize to minimal |---|---|
	const cells = line.split("|").filter((c) => c.trim());
	const normalized = cells.map((c) => {
		const trimmed = c.trim();
		// Preserve alignment markers
		const left = trimmed.startsWith(":");
		const right = trimmed.endsWith(":");
		if (left && right) return ":---:";
		if (left) return ":---";
		if (right) return "---:";
		return "---";
	});
	return "|" + normalized.join("|") + "|";
}

function formatPrompt(content: string): string {
	const lines = content.split("\n");
	const result: string[] = [];
	let inCodeBlock = false;

	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];

		const trimmed = line.trim();

		// Track code blocks - don't modify inside them
		if (CODE_FENCE.test(trimmed)) {
			inCodeBlock = !inCodeBlock;
			result.push(line);
			continue;
		}

		if (inCodeBlock) {
			result.push(line);
			continue;
		}

		// Strip leading whitespace from closing XML tags and Handlebars
		if (CLOSING_XML.test(trimmed) || trimmed.startsWith("{{")) {
			line = trimmed;
		} else if (TABLE_SEP.test(trimmed)) {
			// Compact table separator
			line = compactTableSep(trimmed);
		} else if (TABLE_ROW.test(trimmed)) {
			// Compact table row
			line = compactTableRow(trimmed);
		} else {
			// Trim trailing whitespace (preserve leading for non-closing-tags)
			line = line.trimEnd();
		}

		const isBlank = trimmed === "";

		// Skip blank lines that violate our rules
		if (isBlank) {
			const prevLine = result[result.length - 1]?.trim() ?? "";
			const nextLine = lines[i + 1]?.trim() ?? "";

			// Rule 1: No blank line before list items
			if (LIST_ITEM.test(nextLine)) {
				continue;
			}

			// Rule 2: No blank after opening XML tag or Handlebars block
			if (OPENING_XML.test(prevLine) || OPENING_HBS.test(prevLine)) {
				continue;
			}

			// Rule 3: No blank before closing XML tag or Handlebars block
			if (CLOSING_XML.test(nextLine) || CLOSING_HBS.test(nextLine)) {
				continue;
			}

			// Rule 4: Collapse multiple blank lines
			const prevIsBlank = prevLine === "";
			if (prevIsBlank) {
				continue;
			}
		}

		// Rule 3 (cleanup): Remove trailing blanks before closing tag
		if (CLOSING_XML.test(trimmed) || CLOSING_HBS.test(trimmed)) {
			while (result.length > 0 && result[result.length - 1].trim() === "") {
				result.pop();
			}
		}

		result.push(line);
	}

	// Rule 8: No trailing newline at EOF
	while (result.length > 0 && result[result.length - 1].trim() === "") {
		result.pop();
	}

	return result.join("\n");
}

async function main() {
	const glob = new Glob("**/*.md");
	const files: string[] = [];
	let changed = 0;
	const check = process.argv.includes("--check");

	for (const dir of PROMPT_DIRS) {
		for await (const path of glob.scan(dir)) {
			files.push(`${dir}${path}`);
		}
	}

	for (const fullPath of files) {
		const original = await Bun.file(fullPath).text();
		const formatted = formatPrompt(original);

		if (original !== formatted) {
			if (check) {
				console.log(`Would format: ${fullPath}`);
			} else {
				await Bun.write(fullPath, formatted);
				console.log(`Formatted: ${fullPath}`);
			}
			changed++;
		}
	}

	if (check && changed > 0) {
		console.log(`\n${changed} file(s) need formatting. Run 'bun run format-prompts' to fix.`);
		process.exit(1);
	} else if (changed === 0) {
		console.log("All prompt files are formatted.");
	} else {
		console.log(`\nFormatted ${changed} file(s).`);
	}
}

main();
