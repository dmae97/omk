#!/usr/bin/env bun
/**
 * Format prompt files (mixed XML + Markdown + Handlebars).
 *
 * Rules:
 * 1. No blank line between "text:" and following list/block
 * 2. No blank line after opening XML tag or Handlebars block
 * 3. No blank line before closing XML tag or Handlebars block
 * 4. Collapse 2+ blank lines to single blank line
 * 5. Trim trailing whitespace (preserve indentation)
 * 6. Ensure single newline at EOF
 */

import { Glob } from "bun";

const PROMPTS_DIR = new URL("../src/prompts/", import.meta.url).pathname;

// Opening XML tag (not self-closing, not closing)
const OPENING_XML = /^<([a-z_-]+)(?:\s+[^>]*)?>$/;
// Closing XML tag
const CLOSING_XML = /^<\/([a-z_-]+)>$/;
// Handlebars block start: {{#if}}, {{#has}}, {{#list}}, etc.
const OPENING_HBS = /^\{\{#/;
// Handlebars block end: {{/if}}, {{/has}}, {{/list}}, etc.
const CLOSING_HBS = /^\{\{\//;
// Line ending with colon (intro to a list) - handles **bold:** too
const ENDS_WITH_COLON = /:\**\s*$/;
// List item or Handlebars conditional that acts like list
const LIST_OR_BLOCK = /^(\s*)[-*]|\d+\.\s|^\{\{#/;
// Code fence
const CODE_FENCE = /^```/;

function formatPrompt(content: string): string {
	const lines = content.split("\n");
	const result: string[] = [];
	let inCodeBlock = false;

	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];

		// Trim trailing whitespace (preserve leading)
		line = line.trimEnd();

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

		const isBlank = trimmed === "";

		// Skip blank lines that violate our rules
		if (isBlank) {
			const prevLine = result[result.length - 1]?.trim() ?? "";
			const nextLine = lines[i + 1]?.trim() ?? "";

			// Rule 1: No blank between "text:" and list/block
			if (ENDS_WITH_COLON.test(prevLine) && LIST_OR_BLOCK.test(nextLine)) {
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

	// Rule 6: Single newline at EOF
	while (result.length > 0 && result[result.length - 1].trim() === "") {
		result.pop();
	}
	result.push("");

	return result.join("\n");
}

async function main() {
	const glob = new Glob("**/*.md");
	const files: string[] = [];
	let changed = 0;

	for await (const path of glob.scan(PROMPTS_DIR)) {
		files.push(path);
	}

	const check = process.argv.includes("--check");

	for (const relativePath of files) {
		const fullPath = `${PROMPTS_DIR}${relativePath}`;
		const original = await Bun.file(fullPath).text();
		const formatted = formatPrompt(original);

		if (original !== formatted) {
			if (check) {
				console.log(`Would format: ${relativePath}`);
			} else {
				await Bun.write(fullPath, formatted);
				console.log(`Formatted: ${relativePath}`);
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
