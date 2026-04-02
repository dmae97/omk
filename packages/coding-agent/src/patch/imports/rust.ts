import type { ImportSpec } from "../types";
import {
	defaultImportStyle,
	type ImportHandler,
	type ImportRegion,
	type ImportStyle,
	type ParsedImport,
} from "./types";

type RustImportGroup = "std" | "external" | "local";
type RustImportKind = "simple" | "group";

interface RustImportEntry extends ParsedImport {
	group: RustImportGroup;
	kind: RustImportKind;
	path: string;
	prefix?: string;
	members: string[];
	order: number;
}

interface ParsedRustRegion extends ImportRegion {
	imports: RustImportEntry[];
	entries: RustImportEntry[];
	newline: string;
}

const DEFAULT_GROUP_ORDER: RustImportGroup[] = ["std", "external", "local"];

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

function isLineComment(line: string): boolean {
	const trimmed = line.trimStart();
	return trimmed.startsWith("//");
}

function isBlockCommentStart(line: string): boolean {
	return line.trimStart().startsWith("/*");
}

function isOuterAttribute(line: string): boolean {
	const trimmed = line.trimStart();
	return trimmed.startsWith("#![") || trimmed.startsWith("#[");
}

function consumeBlockComment(lines: string[], startIndex: number): number {
	let index = startIndex;
	while (index < lines.length) {
		if ((lines[index] ?? "").includes("*/")) {
			return index + 1;
		}
		index += 1;
	}
	return lines.length;
}

function stripLineComment(line: string): string {
	const markerIndex = line.indexOf("//");
	return markerIndex === -1 ? line : line.slice(0, markerIndex);
}

function normalizeWhitespace(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

function normalizeMemberName(member: string): string {
	return normalizeWhitespace(member).replace(/\s+as\s+/g, " as ");
}

function classifyGroup(path: string): RustImportGroup {
	const root = path.split("::")[0] ?? path;
	if (root === "std" || root === "core") {
		return "std";
	}
	if (root === "crate" || root === "self" || root === "super") {
		return "local";
	}
	return "external";
}

function detectGroupOrder(entries: RustImportEntry[]): string[] {
	const seen = new Set<RustImportGroup>();
	const order: string[] = [];
	for (const entry of entries) {
		if (seen.has(entry.group)) {
			continue;
		}
		seen.add(entry.group);
		order.push(entry.group);
	}
	return order.length > 0 ? order : [...DEFAULT_GROUP_ORDER];
}

function findPrefixEnd(lines: string[]): number {
	let index = 0;
	while (index < lines.length && isBlank(lines[index] ?? "")) {
		index += 1;
	}

	if ((lines[index] ?? "").startsWith("#!") && !(lines[index] ?? "").trimStart().startsWith("#![")) {
		index += 1;
	}

	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (isBlank(line) || isLineComment(line) || isOuterAttribute(line)) {
			index += 1;
			continue;
		}
		if (isBlockCommentStart(line)) {
			index = consumeBlockComment(lines, index);
			continue;
		}
		break;
	}

	return index;
}

function parseSimpleExpression(expression: string): { path: string; alias?: string } | null {
	const match = /^(?<path>.+?)(?:\s+as\s+(?<alias>[A-Za-z_][A-Za-z0-9_]*))?$/.exec(expression.trim());
	if (!match?.groups?.path) {
		return null;
	}

	const path = normalizeWhitespace(match.groups.path);
	if (path.length === 0 || path.includes("{") || path.includes("}")) {
		return null;
	}

	return {
		path,
		alias: match.groups.alias,
	};
}

function parseMembers(rawMembers: string): string[] | null {
	const members: string[] = [];
	for (const token of rawMembers.split(",")) {
		const normalized = normalizeMemberName(token);
		if (normalized.length === 0) {
			continue;
		}
		if (normalized.includes("{") || normalized.includes("}")) {
			return null;
		}
		members.push(normalized);
	}
	return members.length > 0 ? members : null;
}

function parseUseStatement(line: string, order: number): RustImportEntry | null {
	const withoutComment = stripLineComment(line).trim();
	const match = /^use\s+(.+);$/.exec(withoutComment);
	if (!match) {
		return null;
	}

	const expression = normalizeWhitespace(match[1]);
	const groupMatch = /^(?<prefix>.+?)::\{(?<members>[^{}]+)\}$/.exec(expression);
	if (groupMatch?.groups?.prefix && groupMatch.groups.members) {
		const prefix = normalizeWhitespace(groupMatch.groups.prefix);
		const members = parseMembers(groupMatch.groups.members);
		if (!members) {
			return null;
		}
		return {
			raw: line,
			source: prefix,
			names: [...members],
			path: prefix,
			prefix,
			members,
			kind: "group",
			group: classifyGroup(prefix),
			order,
		};
	}

	const simple = parseSimpleExpression(expression);
	if (!simple) {
		return null;
	}

	return {
		raw: line,
		source: simple.path,
		names: [],
		alias: simple.alias,
		path: simple.path,
		members: [],
		kind: "simple",
		group: classifyGroup(simple.path),
		order,
	};
}

function parseExistingRegion(content: string): ParsedRustRegion | null {
	const lines = splitLines(content);
	const prefixEnd = findPrefixEnd(lines);
	let cursor = prefixEnd;
	while (cursor < lines.length && isBlank(lines[cursor] ?? "")) {
		cursor += 1;
	}
	const startLine = cursor + 1;
	if (!(lines[cursor] ?? "").trimStart().startsWith("use ")) {
		return null;
	}

	const entries: RustImportEntry[] = [];
	let endLine = cursor + 1;
	let order = 0;
	let sawBlankGroupSeparator = false;
	let seenImport = false;

	while (cursor < lines.length) {
		const line = lines[cursor] ?? "";
		if (isBlank(line)) {
			if (seenImport) {
				sawBlankGroupSeparator = true;
				endLine = cursor + 1;
			}
			cursor += 1;
			continue;
		}
		if (isLineComment(line)) {
			if (seenImport) {
				endLine = cursor + 1;
			}
			cursor += 1;
			continue;
		}
		if (isBlockCommentStart(line)) {
			if (!seenImport) {
				break;
			}
			const nextCursor = consumeBlockComment(lines, cursor);
			endLine = nextCursor;
			cursor = nextCursor;
			continue;
		}
		const parsed = parseUseStatement(line, order);
		if (!parsed) {
			break;
		}
		entries.push(parsed);
		seenImport = true;
		endLine = cursor + 1;
		cursor += 1;
		order += 1;
	}

	if (entries.length === 0) {
		return null;
	}

	return {
		startLine,
		endLine,
		imports: entries,
		entries,
		style: {
			...defaultImportStyle,
			groupSeparator: sawBlankGroupSeparator,
			groupOrder: detectGroupOrder(entries),
			sorted: true,
		},
		newline: detectNewline(content),
	};
}

function parseExisting(content: string): ImportRegion | null {
	return parseExistingRegion(content);
}

function renderSimpleExpression(path: string, alias?: string): string {
	return alias ? `${path} as ${alias}` : path;
}

function renderUseLine(entry: RustImportEntry): string {
	if (entry.kind === "group") {
		const prefix = entry.prefix ?? entry.path;
		return `use ${prefix}::{${entry.members.join(", ")}};`;
	}
	return `use ${renderSimpleExpression(entry.path, entry.alias)};`;
}

function specToLine(spec: ImportSpec, _style: ImportStyle): string {
	if (spec.imports && spec.imports.length > 0) {
		const members = spec.imports.map(item => normalizeMemberName(item)).filter(item => item.length > 0);
		return `use ${spec.from}::{${members.join(", ")}};`;
	}
	return `use ${renderSimpleExpression(spec.from, spec.alias)};`;
}

function trimLeadingBlankLines(lines: string[]): string[] {
	let index = 0;
	while (index < lines.length && isBlank(lines[index] ?? "")) {
		index += 1;
	}
	return lines.slice(index);
}

function createSimpleEntry(path: string, alias: string | undefined, order: number): RustImportEntry {
	return {
		raw: `use ${renderSimpleExpression(path, alias)};`,
		source: path,
		names: [],
		alias,
		path,
		members: [],
		kind: "simple",
		group: classifyGroup(path),
		order,
	};
}

function createGroupEntry(prefix: string, members: string[], order: number): RustImportEntry {
	const normalizedMembers = [
		...new Set(members.map(member => normalizeMemberName(member)).filter(member => member.length > 0)),
	];
	return {
		raw: `use ${prefix}::{${normalizedMembers.join(", ")}};`,
		source: prefix,
		names: [...normalizedMembers],
		path: prefix,
		prefix,
		members: normalizedMembers,
		kind: "group",
		group: classifyGroup(prefix),
		order,
	};
}

function normalizeRequestedImports(specs: ImportSpec[]): { entries: RustImportEntry[]; warnings: string[] } {
	const warnings: string[] = [];
	const entries: RustImportEntry[] = [];
	let order = 0;

	for (const spec of specs) {
		if (spec.default) {
			warnings.push(`Rust imports do not support default imports from ${spec.from}; ignoring default binding.`);
		}
		if (spec.namespace) {
			warnings.push(`Rust imports do not support namespace imports from ${spec.from}; ignoring namespace binding.`);
		}
		if (spec.system) {
			warnings.push(`Rust imports do not use system import mode for ${spec.from}; ignoring system flag.`);
		}

		const normalizedFrom = normalizeWhitespace(spec.from);
		if (normalizedFrom.length === 0) {
			continue;
		}

		if (spec.imports && spec.imports.length > 0) {
			const members = spec.imports.map(item => normalizeMemberName(item)).filter(item => item.length > 0);
			if (members.length === 0) {
				continue;
			}
			entries.push(createGroupEntry(normalizedFrom, members, order));
			order += 1;
			continue;
		}

		entries.push(createSimpleEntry(normalizedFrom, spec.alias, order));
		order += 1;
	}

	return { entries, warnings };
}

function simpleKey(path: string, alias: string | undefined): string {
	return alias ? `${path} as ${alias}` : path;
}

function splitSimplePath(path: string): { prefix: string; member: string } | null {
	const separatorIndex = path.lastIndexOf("::");
	if (separatorIndex <= 0 || separatorIndex === path.length - 2) {
		return null;
	}
	return {
		prefix: path.slice(0, separatorIndex),
		member: path.slice(separatorIndex + 2),
	};
}

function sortMembers(members: Iterable<string>): string[] {
	return [...new Set(members)].sort((left, right) => left.localeCompare(right));
}

function compareEntries(left: RustImportEntry, right: RustImportEntry): number {
	const leftKey = left.kind === "group" ? `${left.path}::{` : renderSimpleExpression(left.path, left.alias);
	const rightKey = right.kind === "group" ? `${right.path}::{` : renderSimpleExpression(right.path, right.alias);
	return leftKey.localeCompare(rightKey);
}

function mergeImports(
	existing: RustImportEntry[],
	requested: RustImportEntry[],
): { merged: RustImportEntry[]; added: RustImportEntry[] } {
	const simpleEntries = new Map<string, RustImportEntry>();
	const aliaslessSimplePaths = new Set<string>();
	const groupEntries = new Map<string, RustImportEntry>();
	let nextOrder = existing.length;

	for (const entry of existing) {
		if (entry.kind === "simple") {
			simpleEntries.set(simpleKey(entry.path, entry.alias), createSimpleEntry(entry.path, entry.alias, entry.order));
			if (!entry.alias) {
				aliaslessSimplePaths.add(entry.path);
			}
			continue;
		}

		const prior = groupEntries.get(entry.path);
		if (!prior) {
			groupEntries.set(entry.path, createGroupEntry(entry.path, entry.members, entry.order));
			continue;
		}
		prior.members = sortMembers([...prior.members, ...entry.members]);
		prior.names = [...prior.members];
	}

	const addedSimple = new Map<string, RustImportEntry>();
	const addedGroupMembers = new Map<string, Set<string>>();

	for (const entry of requested) {
		if (entry.kind === "simple") {
			const key = simpleKey(entry.path, entry.alias);
			if (simpleEntries.has(key)) {
				continue;
			}
			if (!entry.alias) {
				const pathParts = splitSimplePath(entry.path);
				if (pathParts) {
					const grouped = groupEntries.get(pathParts.prefix);
					if (grouped?.members.includes(pathParts.member)) {
						continue;
					}
				}
			}
			const normalizedEntry = createSimpleEntry(entry.path, entry.alias, nextOrder);
			nextOrder += 1;
			simpleEntries.set(key, normalizedEntry);
			addedSimple.set(key, normalizedEntry);
			if (!entry.alias) {
				aliaslessSimplePaths.add(entry.path);
			}
			continue;
		}

		let mergedGroup = groupEntries.get(entry.path);
		if (!mergedGroup) {
			mergedGroup = createGroupEntry(entry.path, [], nextOrder);
			nextOrder += 1;
			groupEntries.set(entry.path, mergedGroup);
		}

		const groupAdditions = addedGroupMembers.get(entry.path) ?? new Set<string>();
		for (const member of entry.members) {
			const simplePath = `${entry.path}::${member}`;
			if (aliaslessSimplePaths.has(simplePath) || mergedGroup.members.includes(member)) {
				continue;
			}
			mergedGroup.members = sortMembers([...mergedGroup.members, member]);
			mergedGroup.names = [...mergedGroup.members];
			groupAdditions.add(member);
		}
		if (groupAdditions.size > 0) {
			addedGroupMembers.set(entry.path, groupAdditions);
		}
	}

	const merged = [...simpleEntries.values(), ...groupEntries.values()].sort(compareEntries);
	const added = [
		...addedSimple.values(),
		...Array.from(addedGroupMembers.entries(), ([prefix, members]) => {
			const entry = createGroupEntry(prefix, sortMembers(members), nextOrder);
			nextOrder += 1;
			return entry;
		}),
	].sort(compareEntries);
	return { merged, added };
}

function buildImportSection(entries: RustImportEntry[], style: ImportStyle): string[] {
	const requestedOrder = style.groupOrder.filter(
		(group): group is RustImportGroup => group === "std" || group === "external" || group === "local",
	);
	const groupOrder = [...requestedOrder];
	for (const fallbackGroup of DEFAULT_GROUP_ORDER) {
		if (!groupOrder.includes(fallbackGroup)) {
			groupOrder.push(fallbackGroup);
		}
	}

	const lines: string[] = [];
	let emittedGroups = 0;
	for (const group of groupOrder) {
		const groupEntries = entries.filter(entry => entry.group === group).sort(compareEntries);
		if (groupEntries.length === 0) {
			continue;
		}
		if (style.groupSeparator && emittedGroups > 0) {
			lines.push("");
		}
		for (const entry of groupEntries) {
			lines.push(renderUseLine(entry));
		}
		emittedGroups += 1;
	}
	return lines;
}

function apply(content: string, specs: ImportSpec[]): { content: string; added: string[]; warnings: string[] } {
	const requested = normalizeRequestedImports(specs);
	const parsedRegion = parseExistingRegion(content);
	const style: ImportStyle = parsedRegion?.style ?? {
		...defaultImportStyle,
		groupSeparator: true,
		groupOrder: [...DEFAULT_GROUP_ORDER],
		sorted: true,
	};
	const mergeResult = mergeImports(parsedRegion?.entries ?? [], requested.entries);
	if (mergeResult.added.length === 0) {
		return { content, added: [], warnings: requested.warnings };
	}

	const lines = splitLines(content);
	const newline = parsedRegion?.newline ?? detectNewline(content);
	const trailingNewline = hasTrailingNewline(content);
	const importSection = buildImportSection(mergeResult.merged, style);
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
		const insertionLine = findPrefixEnd(lines);
		const before = lines.slice(0, insertionLine);
		const after = trimLeadingBlankLines(lines.slice(insertionLine));
		nextLines = [...before];
		if (nextLines.length > 0 && !isBlank(nextLines[nextLines.length - 1] ?? "")) {
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
		added: mergeResult.added.map(entry => renderUseLine(entry)),
		warnings: requested.warnings,
	};
}

export const rustImportHandler: ImportHandler = {
	parseExisting,
	specToLine,
	apply,
};

export { defaultImportStyle };
