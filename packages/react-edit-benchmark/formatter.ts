/**
 * Prettier formatting utilities for edit benchmarks.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as prettier from "prettier";

export const PRETTIER_OPTIONS: prettier.Options = {
	printWidth: 100,
	tabWidth: 2,
	useTabs: false,
	semi: true,
	singleQuote: true,
	quoteProps: "as-needed",
	trailingComma: "all",
	bracketSpacing: true,
	arrowParens: "always",
	endOfLine: "lf",
	proseWrap: "preserve",
};

const parsersByExtension: Record<string, prettier.BuiltInParserName[]> = {
	".js": ["flow", "babel", "babel-ts"],
	".jsx": ["flow", "babel", "babel-ts"],
	".ts": ["typescript"],
	".tsx": ["typescript"],
	".json": ["json"],
	".jsonc": ["json"],
	".md": ["markdown"],
	".mdx": ["mdx"],
	".yml": ["yaml"],
	".yaml": ["yaml"],
	".css": ["css"],
	".scss": ["scss"],
	".html": ["html"],
};

async function listFiles(rootDir: string, subPath = ""): Promise<string[]> {
	const entries = await fs.readdir(path.join(rootDir, subPath), { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const relativePath = path.join(subPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(rootDir, relativePath)));
		} else if (entry.isFile()) {
			files.push(relativePath);
		}
	}

	return files.sort();
}

export interface FormatResult {
	formatted: string;
	didFormat: boolean;
}

export async function formatContent(filePath: string, content: string): Promise<FormatResult> {
	const parsers = parsersByExtension[path.extname(filePath).toLowerCase()];
	if (!parsers) {
		return { formatted: content, didFormat: false };
	}

	for (const parser of parsers) {
		try {
			const formatted = await prettier.format(content, { ...PRETTIER_OPTIONS, parser });
			return { formatted, didFormat: true };
		} catch {
			// Try the next parser.
		}
	}

	return { formatted: content, didFormat: false };
}

export async function formatDirectory(rootDir: string): Promise<void> {
	const files = await listFiles(rootDir);

	for (const file of files) {
		const fullPath = path.join(rootDir, file);
		const content = await Bun.file(fullPath).text();
		const result = await formatContent(fullPath, content);
		if (result.didFormat && result.formatted !== content) {
			await Bun.write(fullPath, result.formatted);
		}
	}
}
