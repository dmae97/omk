import type { ImportSpec } from "../types";
import {
	defaultImportStyle,
	type ImportHandler,
	type ImportRegion,
	type ImportStyle,
	type ParsedImport,
} from "./types";

type ImportGroup = "stdlib" | "thirdparty" | "local";

interface PythonImportStyle extends ImportStyle {
	parenthesized: boolean;
}

interface ImportedName {
	name: string;
	alias?: string;
	order: number;
}

interface ParsedPythonImport extends ParsedImport {
	kind: "module" | "from";
	group: ImportGroup;
	order: number;
	multiline: boolean;
	startLine: number;
	endLine: number;
	names: string[];
	parsedNames: ImportedName[];
}

interface ParsedPythonRegion extends ImportRegion {
	imports: ParsedPythonImport[];
	style: PythonImportStyle;
}

const DEFAULT_GROUP_ORDER: ImportGroup[] = ["stdlib", "thirdparty", "local"];

const STDLIB_MODULES = new Set<string>([
	"__future__",
	"abc",
	"argparse",
	"array",
	"ast",
	"asyncio",
	"base64",
	"collections",
	"contextlib",
	"copy",
	"csv",
	"dataclasses",
	"datetime",
	"decimal",
	"enum",
	"functools",
	"glob",
	"gzip",
	"hashlib",
	"heapq",
	"hmac",
	"html",
	"http",
	"importlib",
	"inspect",
	"io",
	"itertools",
	"json",
	"logging",
	"math",
	"mimetypes",
	"os",
	"pathlib",
	"pickle",
	"platform",
	"queue",
	"random",
	"re",
	"secrets",
	"shlex",
	"shutil",
	"socket",
	"sqlite3",
	"statistics",
	"string",
	"subprocess",
	"sys",
	"tempfile",
	"threading",
	"time",
	"traceback",
	"types",
	"typing",
	"unittest",
	"urllib",
	"uuid",
	"warnings",
	"weakref",
	"xml",
	"zipfile",
	"zoneinfo",
]);

function getPythonStyle(style: ImportStyle): PythonImportStyle {
	return {
		...style,
		parenthesized: (style as Partial<PythonImportStyle>).parenthesized ?? false,
	};
}

function detectEol(content: string): string {
	return content.includes("\r\n") ? "\r\n" : "\n";
}

function isBlankLine(line: string): boolean {
	return line.trim().length === 0;
}

function isCommentLine(line: string): boolean {
	return line.trimStart().startsWith("#");
}

function isEncodingComment(line: string): boolean {
	return /^[ \t]*#.*coding[:=][ \t]*[-\w.]+/.test(line);
}

function isImportStart(line: string): boolean {
	const trimmed = line.trimStart();
	return trimmed.startsWith("import ") || trimmed.startsWith("from ");
}

function stripInlineComment(line: string): string {
	const hashIndex = line.indexOf("#");
	return hashIndex === -1 ? line : line.slice(0, hashIndex);
}

function parseModuleDocstring(lines: string[], startIndex: number): number | null {
	const firstLine = lines[startIndex];
	if (firstLine === undefined) return null;
	const trimmed = firstLine.trimStart();
	const match = /^[rRuUbBfF]*(["']{3})/.exec(trimmed);
	if (!match) return null;
	const delimiter = match[1];
	const remainder = trimmed.slice(match[0].length);
	if (remainder.includes(delimiter)) return startIndex + 1;
	for (let index = startIndex + 1; index < lines.length; index += 1) {
		if (lines[index]?.includes(delimiter)) return index + 1;
	}
	return lines.length;
}

function findPrefixEnd(lines: string[]): number {
	let index = 0;
	if (lines[0]?.startsWith("#!")) index += 1;
	if (isEncodingComment(lines[index] ?? "")) index += 1;
	while (index < lines.length && isBlankLine(lines[index] ?? "")) index += 1;
	const docstringEnd = parseModuleDocstring(lines, index);
	if (docstringEnd !== null) {
		index = docstringEnd;
		while (index < lines.length && isBlankLine(lines[index] ?? "")) index += 1;
	}
	return index;
}

function classifyGroup(source: string): ImportGroup {
	if (source.startsWith(".")) return "local";
	const root = source.split(".")[0] ?? source;
	return STDLIB_MODULES.has(root) ? "stdlib" : "thirdparty";
}

function formatImportedName(name: ImportedName): string {
	return name.alias ? `${name.name} as ${name.alias}` : name.name;
}

function parseImportedName(token: string, order: number): ImportedName | null {
	const cleaned = stripInlineComment(token).replace(/,$/, "").trim();
	if (cleaned.length === 0) return null;
	const match = /^(\*|[A-Za-z_][\w]*)(?:\s+as\s+([A-Za-z_][\w]*))?$/.exec(cleaned);
	if (!match) return null;
	return { name: match[1], alias: match[2], order };
}

function parseModuleImport(token: string, order: number): ParsedPythonImport | null {
	const cleaned = stripInlineComment(token).replace(/,$/, "").trim();
	if (cleaned.length === 0) return null;
	const match = /^([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_][\w]*))?$/.exec(cleaned);
	if (!match) return null;
	return {
		raw: `import ${cleaned}`,
		source: match[1],
		names: [],
		parsedNames: [],
		alias: match[2],
		kind: "module",
		group: classifyGroup(match[1]),
		order,
		multiline: false,
		startLine: 0,
		endLine: 0,
	};
}

function parseImportStatement(
	line: string,
	lineNumber: number,
	startOrder: number,
): { records: ParsedPythonImport[]; nextOrder: number } | null {
	const match = /^import\s+(.+)$/.exec(stripInlineComment(line.trim()));
	if (!match) return null;
	let nextOrder = startOrder;
	const records: ParsedPythonImport[] = [];
	for (const token of match[1].split(",")) {
		const parsed = parseModuleImport(token, nextOrder);
		if (!parsed) continue;
		parsed.startLine = lineNumber;
		parsed.endLine = lineNumber;
		parsed.raw = line;
		records.push(parsed);
		nextOrder += 1;
	}
	return records.length === 0 ? null : { records, nextOrder };
}

function countParentheses(text: string): number {
	let balance = 0;
	for (const char of text) {
		if (char === "(") balance += 1;
		if (char === ")") balance -= 1;
	}
	return balance;
}

function parseFromStatement(
	lines: string[],
	startIndex: number,
	eol: string,
	startOrder: number,
): { record: ParsedPythonImport; nextIndex: number; nextOrder: number } | null {
	const collected: string[] = [];
	let nextIndex = startIndex;
	let balance = 0;
	let sawParenthesis = false;
	while (nextIndex < lines.length) {
		const line = lines[nextIndex] ?? "";
		collected.push(line);
		const withoutComment = stripInlineComment(line);
		balance += countParentheses(withoutComment);
		sawParenthesis ||= withoutComment.includes("(");
		nextIndex += 1;
		if (sawParenthesis) {
			if (balance <= 0) break;
			continue;
		}
		break;
	}
	const normalized = collected
		.map(line => stripInlineComment(line).trim())
		.join(" ")
		.replace(/\s+/g, " ");
	const match = /^from\s+([.A-Za-z_][\w.]*)\s+import\s+(.+)$/.exec(normalized);
	if (!match) return null;
	let namesPart = match[2].trim();
	if (namesPart.startsWith("(") && namesPart.endsWith(")")) {
		namesPart = namesPart.slice(1, -1).trim();
	}
	const parsedNames: ImportedName[] = [];
	let nextOrder = startOrder;
	for (const token of namesPart.split(",")) {
		const parsedName = parseImportedName(token, nextOrder);
		if (!parsedName) continue;
		parsedNames.push(parsedName);
		nextOrder += 1;
	}
	if (parsedNames.length === 0) return null;
	const record: ParsedPythonImport = {
		raw: collected.join(eol),
		source: match[1],
		names: parsedNames.map(formatImportedName),
		parsedNames,
		kind: "from",
		group: classifyGroup(match[1]),
		order: startOrder,
		multiline: sawParenthesis || collected.length > 1,
		startLine: startIndex + 1,
		endLine: nextIndex,
	};
	return { record, nextIndex, nextOrder };
}

function compareImportedNames(left: ImportedName, right: ImportedName): number {
	const leftKey = `${left.name}|${left.alias ?? ""}`;
	const rightKey = `${right.name}|${right.alias ?? ""}`;
	return leftKey.localeCompare(rightKey);
}

function compareRecords(left: ParsedPythonImport, right: ParsedPythonImport): number {
	const leftKey = left.kind === "module" ? `import ${left.source} ${left.alias ?? ""}` : `from ${left.source}`;
	const rightKey = right.kind === "module" ? `import ${right.source} ${right.alias ?? ""}` : `from ${right.source}`;
	return leftKey.localeCompare(rightKey);
}

function hasBlankLineBetween(lines: string[], previousEndLine: number, nextStartLine: number): boolean {
	for (let index = previousEndLine; index < nextStartLine - 1; index += 1) {
		if (isBlankLine(lines[index] ?? "")) return true;
	}
	return false;
}

function inferSorted(records: ParsedPythonImport[]): boolean {
	const byGroup = new Map<ImportGroup, ParsedPythonImport[]>();
	for (const record of records) {
		const groupRecords = byGroup.get(record.group);
		if (groupRecords) groupRecords.push(record);
		else byGroup.set(record.group, [record]);
		if (record.kind === "from") {
			for (let index = 1; index < record.parsedNames.length; index += 1) {
				if (compareImportedNames(record.parsedNames[index - 1]!, record.parsedNames[index]!) > 0) return false;
			}
		}
	}
	for (const group of DEFAULT_GROUP_ORDER) {
		const groupRecords = byGroup.get(group) ?? [];
		for (let index = 1; index < groupRecords.length; index += 1) {
			if (compareRecords(groupRecords[index - 1]!, groupRecords[index]!) > 0) return false;
		}
	}
	return true;
}

function inferStyle(records: ParsedPythonImport[], lines: string[]): PythonImportStyle {
	const groupOrder: ImportGroup[] = [];
	let groupSeparator = false;
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index]!;
		if (!groupOrder.includes(record.group)) groupOrder.push(record.group);
		if (index > 0) {
			const previous = records[index - 1]!;
			if (hasBlankLineBetween(lines, previous.endLine, record.startLine)) groupSeparator = true;
		}
	}
	return {
		...defaultImportStyle,
		groupSeparator,
		groupOrder: groupOrder.length > 0 ? groupOrder : [...DEFAULT_GROUP_ORDER],
		sorted: inferSorted(records),
		parenthesized: records.some(record => record.kind === "from" && record.multiline),
	};
}

function normalizeRecords(records: ParsedPythonImport[]): ParsedPythonImport[] {
	const moduleRecords = new Map<string, ParsedPythonImport>();
	const fromRecords = new Map<string, ParsedPythonImport>();
	for (const record of [...records].sort((left, right) => left.order - right.order)) {
		if (record.kind === "module") {
			const key = `${record.source}|${record.alias ?? ""}`;
			if (!moduleRecords.has(key)) moduleRecords.set(key, { ...record, parsedNames: [], names: [] });
			continue;
		}
		const existing = fromRecords.get(record.source);
		if (!existing) {
			fromRecords.set(record.source, {
				...record,
				parsedNames: [...record.parsedNames],
				names: [...record.names],
			});
			continue;
		}
		for (const name of record.parsedNames) {
			const alreadyPresent = existing.parsedNames.some(
				existingName => existingName.name === name.name && (existingName.alias ?? "") === (name.alias ?? ""),
			);
			if (alreadyPresent) continue;
			existing.parsedNames.push({ ...name, order: existing.parsedNames.length });
		}
		existing.names = existing.parsedNames.map(formatImportedName);
		existing.multiline ||= record.multiline;
		if (record.order < existing.order) existing.order = record.order;
	}
	const combined = [...moduleRecords.values(), ...fromRecords.values()];
	return combined.sort((left, right) => left.order - right.order);
}

function renderRecord(record: ParsedPythonImport, style: PythonImportStyle): string {
	if (record.kind === "module") {
		return record.alias ? `import ${record.source} as ${record.alias}` : `import ${record.source}`;
	}
	const names = [...record.parsedNames];
	if (style.sorted) names.sort(compareImportedNames);
	const renderedNames = names.map(formatImportedName);
	const useParenthesized = record.multiline || (style.parenthesized && renderedNames.length > 1);
	if (!useParenthesized) {
		return `from ${record.source} import ${renderedNames.join(", ")}`;
	}
	return [`from ${record.source} import (`, ...renderedNames.map(name => `    ${name},`), `)`].join("\n");
}

function groupComparator(left: ImportGroup, right: ImportGroup, style: PythonImportStyle): number {
	const orderedGroups = [
		...style.groupOrder,
		...DEFAULT_GROUP_ORDER.filter(group => !style.groupOrder.includes(group)),
	];
	return orderedGroups.indexOf(left) - orderedGroups.indexOf(right);
}

function renderImportBlock(records: ParsedPythonImport[], style: PythonImportStyle): string[] {
	const normalized = normalizeRecords(records).map(record => ({
		...record,
		parsedNames: [...record.parsedNames],
		names: [...record.names],
	}));
	const grouped = new Map<ImportGroup, ParsedPythonImport[]>();
	for (const record of normalized) {
		const groupRecords = grouped.get(record.group);
		if (groupRecords) groupRecords.push(record);
		else grouped.set(record.group, [record]);
	}
	const orderedGroups = [...grouped.keys()].sort((left, right) => groupComparator(left, right, style));
	const renderedLines: string[] = [];
	for (const group of orderedGroups) {
		const groupRecords = grouped.get(group) ?? [];
		const orderedRecords = style.sorted
			? [...groupRecords].sort(compareRecords)
			: [...groupRecords].sort((left, right) => left.order - right.order);
		if (renderedLines.length > 0 && style.groupSeparator) renderedLines.push("");
		for (const record of orderedRecords) {
			renderedLines.push(...renderRecord(record, style).split("\n"));
		}
	}
	return renderedLines;
}

function specToRecords(spec: ImportSpec, order: number): { records: ParsedPythonImport[]; warnings: string[] } {
	const warnings: string[] = [];
	if (spec.default) warnings.push(`Python imports do not support default import syntax for ${spec.from}`);
	if (spec.namespace) warnings.push(`Python imports do not support namespace import syntax for ${spec.from}`);
	if (spec.imports && spec.imports.length > 0) {
		const parsedNames = spec.imports.flatMap((item, index) => {
			const parsed = parseImportedName(item, order + index);
			if (parsed) return [parsed];
			return [];
		});
		if (parsedNames.length === 1 && spec.alias) parsedNames[0] = { ...parsedNames[0]!, alias: spec.alias };
		if (parsedNames.length === 0) return { records: [], warnings };
		return {
			records: [
				{
					raw: "",
					source: spec.from,
					names: parsedNames.map(formatImportedName),
					parsedNames,
					kind: "from",
					group: classifyGroup(spec.from),
					order,
					multiline: false,
					startLine: 0,
					endLine: 0,
				},
			],
			warnings,
		};
	}
	return {
		records: [
			{
				raw: "",
				source: spec.from,
				names: [],
				parsedNames: [],
				alias: spec.alias,
				kind: "module",
				group: classifyGroup(spec.from),
				order,
				multiline: false,
				startLine: 0,
				endLine: 0,
			},
		],
		warnings,
	};
}

function parsePythonRegion(content: string): ParsedPythonRegion | null {
	const lines = content.split(/\r?\n/);
	const eol = detectEol(content);
	const prefixEnd = findPrefixEnd(lines);
	let index = prefixEnd;
	while (index < lines.length && (isBlankLine(lines[index] ?? "") || isCommentLine(lines[index] ?? ""))) index += 1;
	if (!isImportStart(lines[index] ?? "")) return null;
	const records: ParsedPythonImport[] = [];
	let nextOrder = 0;
	while (index < lines.length) {
		const currentLine = lines[index] ?? "";
		if (isBlankLine(currentLine) || isCommentLine(currentLine)) {
			index += 1;
			continue;
		}
		if (currentLine.trimStart().startsWith("import ")) {
			const parsed = parseImportStatement(currentLine, index + 1, nextOrder);
			if (!parsed) break;
			records.push(...parsed.records);
			nextOrder = parsed.nextOrder;
			index += 1;
			continue;
		}
		if (currentLine.trimStart().startsWith("from ")) {
			const parsed = parseFromStatement(lines, index, eol, nextOrder);
			if (!parsed) break;
			records.push(parsed.record);
			nextOrder = parsed.nextOrder;
			index = parsed.nextIndex;
			continue;
		}
		break;
	}
	if (records.length === 0) return null;
	const normalizedRecords = normalizeRecords(records);
	return {
		startLine: normalizedRecords[0]!.startLine,
		endLine: Math.max(...normalizedRecords.map(record => record.endLine)),
		imports: normalizedRecords,
		style: inferStyle(normalizedRecords, lines),
	};
}

function parseExisting(content: string): ImportRegion | null {
	return parsePythonRegion(content);
}

function specToLine(spec: ImportSpec, style: ImportStyle): string {
	const pythonStyle = getPythonStyle(style);
	const { records } = specToRecords(spec, 0);
	return records.length === 0 ? "" : renderRecord(records[0]!, pythonStyle);
}

function mergeRecords(
	existing: ParsedPythonImport[],
	requested: ParsedPythonImport[],
	style: PythonImportStyle,
): { records: ParsedPythonImport[]; added: string[] } {
	const records = normalizeRecords(existing).map(record => ({
		...record,
		parsedNames: [...record.parsedNames],
		names: [...record.names],
	}));
	let nextOrder = records.reduce((max, record) => Math.max(max, record.order), -1) + 1;
	const added: string[] = [];
	for (const record of requested) {
		if (record.kind === "module") {
			const exists = records.some(
				existingRecord =>
					existingRecord.kind === "module" &&
					existingRecord.source === record.source &&
					(existingRecord.alias ?? "") === (record.alias ?? ""),
			);
			if (exists) continue;
			records.push({ ...record, order: nextOrder, startLine: 0, endLine: 0 });
			added.push(renderRecord(record, style));
			nextOrder += 1;
			continue;
		}
		const existingRecord = records.find(candidate => candidate.kind === "from" && candidate.source === record.source);
		if (!existingRecord || existingRecord.kind !== "from") {
			records.push({ ...record, order: nextOrder, startLine: 0, endLine: 0 });
			added.push(renderRecord(record, style));
			nextOrder += 1;
			continue;
		}
		const missingNames = record.parsedNames.filter(
			name =>
				!existingRecord.parsedNames.some(
					existingName => existingName.name === name.name && (existingName.alias ?? "") === (name.alias ?? ""),
				),
		);
		if (missingNames.length === 0) continue;
		for (const name of missingNames) {
			existingRecord.parsedNames.push({ ...name, order: existingRecord.parsedNames.length });
		}
		if (style.sorted) existingRecord.parsedNames.sort(compareImportedNames);
		existingRecord.names = existingRecord.parsedNames.map(formatImportedName);
		existingRecord.multiline ||= record.multiline;
		added.push(
			renderRecord(
				{ ...existingRecord, parsedNames: missingNames, names: missingNames.map(formatImportedName) },
				style,
			),
		);
	}
	return { records, added };
}

function insertWithoutRegion(content: string, lines: string[], blockLines: string[], eol: string): string {
	if (content.length === 0) return blockLines.join(eol);
	const insertAt = findPrefixEnd(lines);
	const before = lines.slice(0, insertAt);
	const after = lines.slice(insertAt);
	const needsTrailingBlank =
		after.length > 0 && after.some(line => line.trim().length > 0) && !isBlankLine(after[0] ?? "");
	const inserted = [...before, ...blockLines, ...(needsTrailingBlank ? [""] : []), ...after];
	const nextContent = inserted.join(eol);
	if (content.endsWith(eol) && !nextContent.endsWith(eol)) return `${nextContent}${eol}`;
	return nextContent;
}

function replaceRegion(
	content: string,
	lines: string[],
	region: ParsedPythonRegion,
	blockLines: string[],
	eol: string,
): string {
	const nextLines = [...lines.slice(0, region.startLine - 1), ...blockLines, ...lines.slice(region.endLine)];
	const nextContent = nextLines.join(eol);
	if (content.endsWith(eol) && !nextContent.endsWith(eol)) return `${nextContent}${eol}`;
	return nextContent;
}

export const pythonImportHandler: ImportHandler = {
	parseExisting,
	specToLine,
	apply(content, specs) {
		const region = parsePythonRegion(content);
		const style = getPythonStyle(
			region?.style ?? {
				...defaultImportStyle,
				groupSeparator: true,
				groupOrder: [...DEFAULT_GROUP_ORDER],
				sorted: true,
				parenthesized: false,
			},
		);
		const warnings: string[] = [];
		const requested: ParsedPythonImport[] = [];
		let order = 0;
		for (const spec of specs) {
			const result = specToRecords(spec, order);
			warnings.push(...result.warnings);
			requested.push(...result.records);
			order += Math.max(result.records.length, 1);
		}
		if (requested.length === 0) return { content, added: [], warnings };
		const { records, added } = mergeRecords(region?.imports ?? [], requested, style);
		if (added.length === 0) return { content, added: [], warnings };
		const eol = detectEol(content);
		const lines = content.split(/\r?\n/);
		const blockLines = renderImportBlock(records, style);
		const nextContent = region
			? replaceRegion(content, lines, region, blockLines, eol)
			: insertWithoutRegion(content, lines, blockLines, eol);
		return { content: nextContent, added, warnings };
	},
};

export { defaultImportStyle };
