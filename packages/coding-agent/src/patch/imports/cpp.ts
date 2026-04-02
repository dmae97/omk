import type { ImportSpec } from "../types";
import {
	defaultImportStyle,
	type ImportHandler,
	type ImportRegion,
	type ImportStyle,
	type ParsedImport,
} from "./types";

type IncludeGroup = "system" | "local";
type LineKind = "blank" | "comment" | "include" | "other";

interface ParsedIncludeEntry extends ParsedImport {
	lineIndex: number;
	group: IncludeGroup;
}

interface LineClassification {
	kind: LineKind;
	inBlockComment: boolean;
	parsedImport?: ParsedImport;
}

interface IncludeRegionAnalysis extends ImportRegion {
	entries: ParsedIncludeEntry[];
	groupOrder: IncludeGroup[];
}

const INCLUDE_PATTERN = /^#\s*include\s*([<"])([^>"]+)[>"](?:\s*(?:\/\/.*|\/\*.*\*\/\s*)?)?$/;
const PRAGMA_ONCE_PATTERN = /^#\s*pragma\s+once\b/;
const IFNDEF_PATTERN = /^#\s*ifndef\s+([A-Za-z_]\w*)\b/;

function isBlankLine(line: string): boolean {
	return line.trim().length === 0;
}

function lastItem<T>(items: T[]): T | undefined {
	return items[items.length - 1];
}

function parseIncludeLine(text: string): ParsedImport | null {
	const match = INCLUDE_PATTERN.exec(text.trim());
	if (!match) {
		return null;
	}

	const delimiter = match[1];
	const source = match[2]?.trim();
	if (!source) {
		return null;
	}

	return {
		raw: text,
		source,
		names: [],
		system: delimiter === "<",
	};
}

function classifyLine(line: string, inBlockComment: boolean): LineClassification {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return { kind: "blank", inBlockComment };
	}

	if (inBlockComment) {
		const blockEnd = trimmed.indexOf("*/");
		if (blockEnd === -1) {
			return { kind: "comment", inBlockComment: true };
		}

		const remainder = trimmed.slice(blockEnd + 2).trim();
		if (remainder.length === 0) {
			return { kind: "comment", inBlockComment: false };
		}

		return classifyLine(remainder, false);
	}

	const parsedImport = parseIncludeLine(trimmed);
	if (parsedImport) {
		return { kind: "include", inBlockComment: false, parsedImport };
	}

	if (trimmed.startsWith("//")) {
		return { kind: "comment", inBlockComment: false };
	}

	if (trimmed.startsWith("/*")) {
		const blockEnd = trimmed.indexOf("*/", 2);
		if (blockEnd === -1) {
			return { kind: "comment", inBlockComment: true };
		}

		const remainder = trimmed.slice(blockEnd + 2).trim();
		if (remainder.length === 0) {
			return { kind: "comment", inBlockComment: false };
		}

		return classifyLine(remainder, false);
	}

	return { kind: "other", inBlockComment: false };
}

function findNextSubstantiveLine(lines: string[], startIndex: number): number | null {
	let inBlockComment = false;
	for (let index = startIndex; index < lines.length; index += 1) {
		const classification = classifyLine(lines[index] ?? "", inBlockComment);
		inBlockComment = classification.inBlockComment;
		if (classification.kind === "blank" || classification.kind === "comment") {
			continue;
		}
		return index;
	}
	return null;
}

function findInsertionPoint(lines: string[]): number {
	let index = 0;
	if ((lines[0] ?? "").startsWith("#!")) {
		index = 1;
	}

	let inBlockComment = false;
	while (index < lines.length) {
		const classification = classifyLine(lines[index] ?? "", inBlockComment);
		inBlockComment = classification.inBlockComment;
		if (classification.kind === "blank" || classification.kind === "comment") {
			index += 1;
			continue;
		}
		break;
	}

	const firstSubstantive = lines[index]?.trim() ?? "";
	if (PRAGMA_ONCE_PATTERN.test(firstSubstantive)) {
		return index + 1;
	}

	const guardMatch = IFNDEF_PATTERN.exec(firstSubstantive);
	if (!guardMatch) {
		return index;
	}

	const macroName = guardMatch[1];
	const defineIndex = findNextSubstantiveLine(lines, index + 1);
	if (defineIndex === null) {
		return index;
	}

	const definePattern = new RegExp(`^#\\s*define\\s+${macroName}\\b`);
	return definePattern.test(lines[defineIndex]?.trim() ?? "") ? defineIndex + 1 : index;
}

function detectGroupOrder(entries: ParsedIncludeEntry[]): IncludeGroup[] {
	const firstSystem = entries.find(entry => entry.group === "system");
	const firstLocal = entries.find(entry => entry.group === "local");
	if (firstSystem && firstLocal) {
		return firstSystem.lineIndex < firstLocal.lineIndex ? ["system", "local"] : ["local", "system"];
	}
	return ["system", "local"];
}

function hasBlankBetweenGroups(lines: string[], entries: ParsedIncludeEntry[]): boolean {
	const firstSystem = entries.find(entry => entry.group === "system");
	const firstLocal = entries.find(entry => entry.group === "local");
	if (!firstSystem || !firstLocal) {
		return defaultImportStyle.groupSeparator;
	}

	const start = Math.min(firstSystem.lineIndex, firstLocal.lineIndex);
	const end = Math.max(firstSystem.lineIndex, firstLocal.lineIndex);
	for (let index = start + 1; index < end; index += 1) {
		if (isBlankLine(lines[index] ?? "")) {
			return true;
		}
	}
	return false;
}

function isGroupSorted(entries: ParsedIncludeEntry[]): boolean {
	for (let index = 1; index < entries.length; index += 1) {
		if ((entries[index - 1]?.source ?? "").localeCompare(entries[index]?.source ?? "") > 0) {
			return false;
		}
	}
	return true;
}

function analyzeIncludeRegion(content: string): IncludeRegionAnalysis | null {
	const lines = content.split("\n");
	const insertionPoint = findInsertionPoint(lines);

	let index = insertionPoint;
	let inBlockComment = false;
	while (index < lines.length) {
		const classification = classifyLine(lines[index] ?? "", inBlockComment);
		inBlockComment = classification.inBlockComment;
		if (classification.kind === "blank" || classification.kind === "comment") {
			index += 1;
			continue;
		}
		if (classification.kind !== "include") {
			return null;
		}
		break;
	}

	if (index >= lines.length) {
		return null;
	}

	const entries: ParsedIncludeEntry[] = [];
	let endIndex = index;
	inBlockComment = false;

	for (let lineIndex = index; lineIndex < lines.length; lineIndex += 1) {
		const classification = classifyLine(lines[lineIndex] ?? "", inBlockComment);
		inBlockComment = classification.inBlockComment;
		if (classification.kind === "other") {
			break;
		}

		endIndex = lineIndex;
		if (classification.kind !== "include" || !classification.parsedImport) {
			continue;
		}

		entries.push({
			...classification.parsedImport,
			group: classification.parsedImport.system ? "system" : "local",
			lineIndex,
		});
	}

	if (entries.length === 0) {
		return null;
	}

	const groupOrder = detectGroupOrder(entries);
	const imports = entries.map(({ lineIndex, group, ...parsedImport }) => parsedImport);
	const systemEntries = entries.filter(entry => entry.group === "system");
	const localEntries = entries.filter(entry => entry.group === "local");

	return {
		startLine: index + 1,
		endLine: endIndex + 1,
		imports,
		entries,
		groupOrder,
		style: {
			...defaultImportStyle,
			groupSeparator: hasBlankBetweenGroups(lines, entries),
			groupOrder,
			sorted: isGroupSorted(systemEntries) && isGroupSorted(localEntries),
		},
	};
}

function parseExisting(content: string): ImportRegion | null {
	const region = analyzeIncludeRegion(content);
	if (!region) {
		return null;
	}

	return {
		startLine: region.startLine,
		endLine: region.endLine,
		imports: region.imports,
		style: region.style,
	};
}

function specToLine(spec: ImportSpec, _style: ImportStyle): string {
	return spec.system ? `#include <${spec.from}>` : `#include "${spec.from}"`;
}

function makeSpecKey(spec: Pick<ImportSpec, "from" | "system">): string {
	return `${spec.system ? "system" : "local"}:${spec.from}`;
}

function dedupeSpecs(specs: ImportSpec[], existing: Iterable<Pick<ImportSpec, "from" | "system">>): ImportSpec[] {
	const seen = new Set<string>();
	for (const spec of existing) {
		seen.add(makeSpecKey(spec));
	}

	const uniqueSpecs: ImportSpec[] = [];
	for (const spec of specs) {
		const key = makeSpecKey(spec);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		uniqueSpecs.push(spec);
	}
	return uniqueSpecs;
}

function addInsertion(insertions: Map<number, string[]>, index: number, addedLines: string[]): void {
	if (addedLines.length === 0) {
		return;
	}

	const existing = insertions.get(index);
	if (existing) {
		existing.push(...addedLines);
		return;
	}

	insertions.set(index, [...addedLines]);
}

function insertChunk(
	insertions: Map<number, string[]>,
	lines: string[],
	index: number,
	chunk: string[],
	options: { blankBefore?: boolean; blankAfter?: boolean } = {},
): void {
	if (chunk.length === 0) {
		return;
	}

	const nextChunk = [...chunk];
	if (options.blankBefore && !isBlankLine(lines[index - 1] ?? "")) {
		nextChunk.unshift("");
	}
	if (options.blankAfter && !isBlankLine(lines[index] ?? "")) {
		nextChunk.push("");
	}

	addInsertion(insertions, index, nextChunk);
}

function sortSpecs(specs: ImportSpec[]): ImportSpec[] {
	return [...specs].sort((left, right) => left.from.localeCompare(right.from));
}

function buildSectionLines(specs: ImportSpec[], style: ImportStyle): { sectionLines: string[]; addedLines: string[] } {
	const systemLines = sortSpecs(specs.filter(spec => spec.system)).map(spec => specToLine(spec, style));
	const localLines = sortSpecs(specs.filter(spec => !spec.system)).map(spec => specToLine(spec, style));
	const sectionLines = [
		...systemLines,
		...(systemLines.length > 0 && localLines.length > 0 && style.groupSeparator ? [""] : []),
		...localLines,
	];
	return {
		sectionLines,
		addedLines: [...systemLines, ...localLines],
	};
}

function applyInsertions(lines: string[], insertions: Map<number, string[]>): string[] {
	const indexes = [...insertions.keys()].sort((left, right) => right - left);
	for (const index of indexes) {
		const chunk = insertions.get(index);
		if (!chunk || chunk.length === 0) {
			continue;
		}
		lines.splice(index, 0, ...chunk);
	}
	return lines;
}

function applyExistingRegion(
	content: string,
	specs: ImportSpec[],
	region: IncludeRegionAnalysis,
): { content: string; added: string[] } {
	const lines = content.split("\n");
	const insertions = new Map<number, string[]>();
	const groupedSpecs: Record<IncludeGroup, ImportSpec[]> = {
		system: sortSpecs(specs.filter(spec => spec.system)),
		local: sortSpecs(specs.filter(spec => !spec.system)),
	};
	const groupedEntries: Record<IncludeGroup, ParsedIncludeEntry[]> = {
		system: region.entries.filter(entry => entry.group === "system"),
		local: region.entries.filter(entry => entry.group === "local"),
	};
	const addedLines: string[] = [];

	for (const group of region.groupOrder) {
		const specsForGroup = groupedSpecs[group];
		if (specsForGroup.length === 0) {
			continue;
		}

		const entriesForGroup = groupedEntries[group];
		const otherGroup: IncludeGroup = group === "system" ? "local" : "system";
		const otherEntries = groupedEntries[otherGroup];
		const linesForGroup = specsForGroup.map(spec => specToLine(spec, region.style));
		addedLines.push(...linesForGroup);

		if (entriesForGroup.length === 0) {
			const placeBeforeOther = region.groupOrder[0] === group;
			if (placeBeforeOther) {
				insertChunk(insertions, lines, otherEntries[0]?.lineIndex ?? region.startLine - 1, linesForGroup, {
					blankAfter: otherEntries.length > 0 && region.style.groupSeparator,
				});
			} else {
				insertChunk(
					insertions,
					lines,
					(lastItem(otherEntries)?.lineIndex ?? region.endLine - 1) + 1,
					linesForGroup,
					{
						blankBefore: otherEntries.length > 0 && region.style.groupSeparator,
					},
				);
			}
			continue;
		}

		if (!isGroupSorted(entriesForGroup)) {
			addInsertion(insertions, (lastItem(entriesForGroup)?.lineIndex ?? region.endLine - 1) + 1, linesForGroup);
			continue;
		}

		const pendingByIndex = new Map<number, string[]>();
		for (const spec of specsForGroup) {
			const targetIndex =
				entriesForGroup.find(entry => spec.from.localeCompare(entry.source) < 0)?.lineIndex ??
				(lastItem(entriesForGroup)?.lineIndex ?? region.endLine - 1) + 1;
			addInsertion(pendingByIndex, targetIndex, [specToLine(spec, region.style)]);
		}

		for (const [targetIndex, chunk] of pendingByIndex.entries()) {
			addInsertion(insertions, targetIndex, chunk);
		}
	}

	const updatedLines = applyInsertions(lines, insertions);
	return { content: updatedLines.join("\n"), added: addedLines };
}

export const cppImportHandler: ImportHandler = {
	parseExisting,
	specToLine,
	apply(content, specs) {
		const region = analyzeIncludeRegion(content);
		const uniqueSpecs = dedupeSpecs(
			specs,
			region?.entries.map(entry => ({ from: entry.source, system: entry.system })) ?? [],
		);
		if (uniqueSpecs.length === 0) {
			return { content, added: [], warnings: [] };
		}

		if (!region) {
			const lines = content.split("\n");
			const insertionPoint = findInsertionPoint(lines);
			const { sectionLines, addedLines } = buildSectionLines(uniqueSpecs, defaultImportStyle);
			const insertions = new Map<number, string[]>();
			insertChunk(insertions, lines, insertionPoint, sectionLines, {
				blankBefore: insertionPoint > 0,
				blankAfter: insertionPoint < lines.length && !isBlankLine(lines[insertionPoint] ?? ""),
			});
			const updatedLines = applyInsertions(lines, insertions);
			return { content: updatedLines.join("\n"), added: addedLines, warnings: [] };
		}

		const result = applyExistingRegion(content, uniqueSpecs, region);
		return { content: result.content, added: result.added, warnings: [] };
	},
};

export { defaultImportStyle };
