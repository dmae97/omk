import type { ImportSpec } from "../types";
import {
	defaultImportStyle,
	type ImportHandler,
	type ImportRegion,
	type ImportStyle,
	type ParsedImport,
} from "./types";

type GoImportGroup = "stdlib" | "thirdParty";

interface GoImportEntry extends ParsedImport {
	group: GoImportGroup;
}

interface ParsedGoImportRegion extends ImportRegion {
	entries: GoImportEntry[];
	hasBlock: boolean;
	packageLine: number;
	newline: string;
}

const GROUP_ORDER: GoImportGroup[] = ["stdlib", "thirdParty"];
const SINGLE_IMPORT_RE = /^\s*import\s+(?:(?<alias>[._]|[A-Za-z_]\w*)\s+)?"(?<source>[^"]+)"(?:\s*\/\/.*)?\s*$/;
const BLOCK_IMPORT_START_RE = /^\s*import\s*\(\s*(?:\/\/.*)?\s*$/;
const BLOCK_IMPORT_END_RE = /^\s*\)\s*(?:\/\/.*)?\s*$/;
const BLOCK_IMPORT_LINE_RE = /^\s*(?:(?<alias>[._]|[A-Za-z_]\w*)\s+)?"(?<source>[^"]+)"(?:\s*\/\/.*)?\s*$/;
const PACKAGE_RE = /^\s*package\s+[A-Za-z_]\w*\s*(?:\/\/.*)?\s*$/;

function detectNewline(content: string): string {
	return content.includes("\r\n") ? "\r\n" : "\n";
}

function hasTrailingNewline(content: string): boolean {
	return content.endsWith("\n");
}

function splitLines(content: string): string[] {
	return content.split(/\r?\n/);
}

function joinLines(lines: string[], newline: string, trailingNewline: boolean): string {
	let result = lines.join(newline);
	if (trailingNewline && (lines.length === 0 || lines[lines.length - 1] !== "")) {
		result += newline;
	}
	return result;
}

function isBlank(line: string): boolean {
	return line.trim().length === 0;
}

function isCommentLine(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/");
}

function isIgnorableTopLevelLine(line: string): boolean {
	return isBlank(line) || isCommentLine(line);
}

function classifyGroup(source: string): GoImportGroup {
	const firstSegment = source.split("/")[0] ?? source;
	return firstSegment.includes(".") ? "thirdParty" : "stdlib";
}

function parseImportSpec(line: string, expression: RegExp): GoImportEntry | null {
	const match = expression.exec(line);
	if (!match?.groups?.source) {
		return null;
	}

	const alias = match.groups.alias;
	const source = match.groups.source;
	return {
		raw: line,
		source,
		names: [],
		alias,
		group: classifyGroup(source),
	};
}

function findPackageLine(lines: string[]): number {
	for (let index = 0; index < lines.length; index += 1) {
		if (PACKAGE_RE.test(lines[index] ?? "")) {
			return index + 1;
		}
	}
	return -1;
}

function detectGroupOrder(entries: GoImportEntry[]): string[] {
	const seen = new Set<GoImportGroup>();
	const order: string[] = [];

	for (const entry of entries) {
		if (seen.has(entry.group)) {
			continue;
		}
		seen.add(entry.group);
		order.push(entry.group);
	}

	return order.length > 0 ? order : [...GROUP_ORDER];
}

function parseExistingRegion(content: string): ParsedGoImportRegion | null {
	const lines = splitLines(content);
	const packageLine = findPackageLine(lines);
	if (packageLine < 0) {
		return null;
	}

	let cursor = packageLine;
	while (cursor < lines.length && isIgnorableTopLevelLine(lines[cursor] ?? "")) {
		cursor += 1;
	}

	if (cursor >= lines.length || !(lines[cursor]?.trimStart().startsWith("import") ?? false)) {
		return null;
	}

	const newline = detectNewline(content);
	const entries: GoImportEntry[] = [];
	const startLine = cursor + 1;
	let endLine = cursor + 1;
	let hasBlock = false;
	let sawBlankGroupSeparator = false;
	let previousEntryLine = -1;

	while (cursor < lines.length) {
		const line = lines[cursor] ?? "";
		if (isIgnorableTopLevelLine(line)) {
			cursor += 1;
			continue;
		}

		if (BLOCK_IMPORT_START_RE.test(line)) {
			hasBlock = true;
			cursor += 1;
			while (cursor < lines.length) {
				const innerLine = lines[cursor] ?? "";
				if (BLOCK_IMPORT_END_RE.test(innerLine)) {
					endLine = cursor + 1;
					cursor += 1;
					break;
				}

				if (isBlank(innerLine)) {
					if (previousEntryLine > 0) {
						sawBlankGroupSeparator = true;
					}
					cursor += 1;
					continue;
				}

				if (isCommentLine(innerLine)) {
					cursor += 1;
					continue;
				}

				const parsed = parseImportSpec(innerLine, BLOCK_IMPORT_LINE_RE);
				if (parsed) {
					entries.push(parsed);
					previousEntryLine = cursor + 1;
				}
				cursor += 1;
			}
			continue;
		}

		const parsed = parseImportSpec(line, SINGLE_IMPORT_RE);
		if (!parsed) {
			break;
		}

		entries.push(parsed);
		endLine = cursor + 1;
		cursor += 1;

		let lookahead = cursor;
		while (lookahead < lines.length && isIgnorableTopLevelLine(lines[lookahead] ?? "")) {
			if (isBlank(lines[lookahead] ?? "")) {
				sawBlankGroupSeparator = true;
			}
			lookahead += 1;
		}
		if (lookahead >= lines.length || !(lines[lookahead]?.trimStart().startsWith("import") ?? false)) {
			break;
		}
		cursor = lookahead;
	}

	const style: ImportStyle = {
		...defaultImportStyle,
		groupSeparator: sawBlankGroupSeparator,
		groupOrder: detectGroupOrder(entries),
	};

	return {
		startLine,
		endLine,
		imports: entries,
		style,
		entries,
		hasBlock,
		packageLine,
		newline,
	};
}

function parseExisting(content: string): ImportRegion | null {
	return parseExistingRegion(content);
}

function specToLine(spec: ImportSpec, _style: ImportStyle): string {
	const aliasPrefix = spec.alias ? `${spec.alias} ` : "";
	return `${aliasPrefix}"${spec.from}"`;
}

function normalizeRequestedImports(specs: ImportSpec[]): { imports: GoImportEntry[]; warnings: string[] } {
	const warnings: string[] = [];
	const bySource = new Map<string, GoImportEntry>();

	for (const spec of specs) {
		if (spec.imports?.length) {
			warnings.push(`Go imports do not support named imports from ${spec.from}; ignoring named bindings.`);
		}
		if (spec.default) {
			warnings.push(`Go imports do not support default imports from ${spec.from}; ignoring default binding.`);
		}
		if (spec.namespace) {
			warnings.push(`Go imports do not support namespace imports from ${spec.from}; ignoring namespace binding.`);
		}
		if (spec.system) {
			warnings.push(`Go imports do not use system import mode for ${spec.from}; ignoring system flag.`);
		}

		const normalized: GoImportEntry = {
			raw: specToLine(spec, defaultImportStyle),
			source: spec.from,
			names: [],
			alias: spec.alias,
			group: classifyGroup(spec.from),
		};

		const existing = bySource.get(normalized.source);
		if (!existing) {
			bySource.set(normalized.source, normalized);
			continue;
		}

		if (existing.alias === normalized.alias) {
			continue;
		}

		warnings.push(
			`Conflicting Go import aliases requested for ${normalized.source}; keeping ${formatAlias(existing.alias)}.`,
		);
	}

	return { imports: [...bySource.values()], warnings };
}

function formatAlias(alias: string | undefined): string {
	return alias ? `alias ${alias}` : "the existing unaliased import";
}

function trimLeadingBlankLines(lines: string[]): string[] {
	let start = 0;
	while (start < lines.length && isBlank(lines[start] ?? "")) {
		start += 1;
	}
	return lines.slice(start);
}

function pushGroupLines(lines: string[], imports: GoImportEntry[], style: ImportStyle): void {
	const orderedGroups = style.groupOrder.filter(
		(group): group is GoImportGroup => group === "stdlib" || group === "thirdParty",
	);
	const groupOrder = orderedGroups.length > 0 ? orderedGroups : GROUP_ORDER;
	let emittedGroups = 0;

	for (const group of groupOrder) {
		const groupImports = imports.filter(entry => entry.group === group);
		if (groupImports.length === 0) {
			continue;
		}
		if (style.groupSeparator && emittedGroups > 0) {
			lines.push("");
		}
		for (const entry of groupImports) {
			lines.push(`\t${specToLine({ from: entry.source, alias: entry.alias }, style)}`);
		}
		emittedGroups += 1;
	}
}

function buildImportSection(imports: GoImportEntry[], preferBlock: boolean, style: ImportStyle): string[] {
	if (imports.length === 1 && !preferBlock) {
		const [entry] = imports;
		return [`import ${specToLine({ from: entry.source, alias: entry.alias }, style)}`];
	}

	const lines = ["import ("];
	pushGroupLines(lines, imports, style);
	lines.push(")");
	return lines;
}

function mergeImports(
	existing: GoImportEntry[],
	requested: GoImportEntry[],
): { merged: GoImportEntry[]; added: GoImportEntry[]; warnings: string[] } {
	const warnings: string[] = [];
	const added: GoImportEntry[] = [];
	const mergedBySource = new Map<string, GoImportEntry>();

	for (const entry of existing) {
		if (mergedBySource.has(entry.source)) {
			const prior = mergedBySource.get(entry.source);
			if (prior?.alias !== entry.alias) {
				warnings.push(
					`Conflicting existing Go import aliases for ${entry.source}; keeping ${formatAlias(prior?.alias)}.`,
				);
			}
			continue;
		}
		mergedBySource.set(entry.source, entry);
	}

	for (const entry of requested) {
		const prior = mergedBySource.get(entry.source);
		if (!prior) {
			mergedBySource.set(entry.source, entry);
			added.push(entry);
			continue;
		}
		if (prior.alias === entry.alias) {
			continue;
		}
		warnings.push(
			`Go import ${entry.source} already exists with ${formatAlias(prior.alias)}; skipping conflicting alias.`,
		);
	}

	const groupBuckets = new Map<GoImportGroup, GoImportEntry[]>();
	for (const group of GROUP_ORDER) {
		groupBuckets.set(group, []);
	}
	for (const entry of mergedBySource.values()) {
		groupBuckets.get(entry.group)?.push(entry);
	}
	for (const bucket of groupBuckets.values()) {
		bucket.sort((left, right) => {
			if (left.source === right.source) {
				return (left.alias ?? "").localeCompare(right.alias ?? "");
			}
			return left.source.localeCompare(right.source);
		});
	}

	return {
		merged: [...(groupBuckets.get("stdlib") ?? []), ...(groupBuckets.get("thirdParty") ?? [])],
		added,
		warnings,
	};
}

function apply(content: string, specs: ImportSpec[]): { content: string; added: string[]; warnings: string[] } {
	const requested = normalizeRequestedImports(specs);
	const parsedRegion = parseExistingRegion(content);
	const newline = parsedRegion?.newline ?? detectNewline(content);
	const trailingNewline = hasTrailingNewline(content);
	const warnings = [...requested.warnings];
	const lines = splitLines(content);
	const packageLine = parsedRegion?.packageLine ?? findPackageLine(lines);
	if (packageLine < 0) {
		warnings.push("Go import management requires a package declaration.");
		return { content, added: [], warnings };
	}

	const mergeResult = mergeImports(parsedRegion?.entries ?? [], requested.imports);
	warnings.push(...mergeResult.warnings);
	if (mergeResult.added.length === 0) {
		return { content, added: [], warnings };
	}

	const style: ImportStyle = parsedRegion?.style ?? {
		...defaultImportStyle,
		groupSeparator: true,
		groupOrder: [...GROUP_ORDER],
	};
	const preferBlock = Boolean(parsedRegion) || mergeResult.merged.length > 1;
	const importSection = buildImportSection(mergeResult.merged, preferBlock, style);

	let nextLines: string[];
	if (parsedRegion) {
		const before = lines.slice(0, parsedRegion.startLine - 1);
		const after = trimLeadingBlankLines(lines.slice(parsedRegion.endLine));
		nextLines = [...before, ...importSection];
		if (after.length > 0 && !isBlank(nextLines[nextLines.length - 1] ?? "")) {
			nextLines.push("");
		}
		nextLines.push(...after);
	} else {
		const before = lines.slice(0, packageLine);
		const after = trimLeadingBlankLines(lines.slice(packageLine));
		nextLines = [...before];
		if (!isBlank(nextLines[nextLines.length - 1] ?? "")) {
			nextLines.push("");
		}
		nextLines.push(...importSection);
		if (after.length > 0) {
			nextLines.push("");
			nextLines.push(...after);
		}
	}

	return {
		content: joinLines(nextLines, newline, trailingNewline),
		added: mergeResult.added.map(entry => specToLine({ from: entry.source, alias: entry.alias }, style)),
		warnings,
	};
}

export const goImportHandler: ImportHandler = {
	parseExisting,
	specToLine,
	apply,
};

export { defaultImportStyle };
