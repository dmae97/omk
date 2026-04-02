import type { ImportSpec } from "../types";
import {
	defaultImportStyle,
	type ImportHandler,
	type ImportRegion,
	type ImportStyle,
	type ParsedImport,
} from "./types";

type ImportGroup = "side-effect" | "external" | "local";
type QuoteStyle = "single" | "double";
type TypeImportStyle = "separate" | "inline";

interface ImportedBinding {
	imported: string;
	local?: string;
	typeOnly: boolean;
	order: number;
}

interface TypeScriptImportStyle extends ImportStyle {
	typeImportStyle: TypeImportStyle;
	quoteStyle: QuoteStyle;
	semicolons: boolean;
}

interface ParsedTypeScriptImport extends ParsedImport {
	kind: "side-effect" | "binding";
	typeOnly: boolean;
	order: number;
	startLine: number;
	endLine: number;
	group: ImportGroup;
	quoteStyle: QuoteStyle;
	hasSemicolon: boolean;
	namedBindings: ImportedBinding[];
	assertion?: string;
}

interface ParsedTypeScriptRegion extends ImportRegion {
	imports: ParsedTypeScriptImport[];
	style: TypeScriptImportStyle;
}

interface ParsedImportStatement {
	kind: "side-effect" | "binding";
	typeOnly: boolean;
	source: string;
	quoteStyle: QuoteStyle;
	assertion?: string;
	defaultImport?: string;
	namespaceImport?: string;
	namedBindings: ImportedBinding[];
}

interface ParsedSpecifierName {
	imported: string;
	local?: string;
}

interface ParsedSpecRequest {
	source: string;
	defaultImport?: string;
	namespaceImport?: string;
	valueBindings: ImportedBinding[];
	typeBindings: ImportedBinding[];
	assertion?: string;
}

const DEFAULT_GROUP_ORDER: ImportGroup[] = ["side-effect", "external", "local"];
const ASSET_IMPORT_TYPES: Record<string, string> = {
	".adoc": "text",
	".css": "css",
	".json": "json",
	".md": "text",
	".txt": "text",
};

function getTypeScriptStyle(style: ImportStyle): TypeScriptImportStyle {
	const maybeStyle = style as Partial<TypeScriptImportStyle>;
	return {
		...style,
		typeImportStyle: maybeStyle.typeImportStyle ?? "inline",
		quoteStyle: maybeStyle.quoteStyle ?? "double",
		semicolons: maybeStyle.semicolons ?? true,
	};
}

function detectEol(content: string): string {
	return content.includes("\r\n") ? "\r\n" : "\n";
}

function isBlankLine(line: string): boolean {
	return line.trim().length === 0;
}

function isLineComment(line: string): boolean {
	return line.trimStart().startsWith("//");
}

function startsBlockComment(line: string): boolean {
	return line.trimStart().startsWith("/*");
}

function lineStartsImport(line: string): boolean {
	return line.trimStart().startsWith("import ");
}

function isImportGroup(value: string): value is ImportGroup {
	return value === "side-effect" || value === "external" || value === "local";
}

function classifyGroup(record: Pick<ParsedTypeScriptImport, "kind" | "source">): ImportGroup {
	if (record.kind === "side-effect") return "side-effect";
	if (record.source.startsWith(".") || record.source.startsWith("/")) return "local";
	return "external";
}

function findPrefixEnd(lines: string[]): number {
	let index = 0;
	if (lines[0]?.startsWith("#!")) index += 1;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (isBlankLine(line) || isLineComment(line)) {
			index += 1;
			continue;
		}
		if (startsBlockComment(line)) {
			index += 1;
			while (index < lines.length && !(lines[index - 1] ?? "").includes("*/")) index += 1;
			continue;
		}
		break;
	}
	return index;
}

function stripComments(text: string): string {
	let result = "";
	let index = 0;
	let inSingle = false;
	let inDouble = false;
	let inTemplate = false;
	let inBlockComment = false;
	let escaped = false;
	while (index < text.length) {
		const char = text[index] ?? "";
		const next = text[index + 1] ?? "";
		if (inBlockComment) {
			if (char === "*" && next === "/") {
				inBlockComment = false;
				index += 2;
				continue;
			}
			if (char === "\n" || char === "\r") result += char;
			index += 1;
			continue;
		}
		if (inSingle) {
			result += char;
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === "'") {
				inSingle = false;
			}
			index += 1;
			continue;
		}
		if (inDouble) {
			result += char;
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inDouble = false;
			}
			index += 1;
			continue;
		}
		if (inTemplate) {
			result += char;
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === "`") {
				inTemplate = false;
			}
			index += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			index += 2;
			while (index < text.length) {
				const commentChar = text[index] ?? "";
				if (commentChar === "\n" || commentChar === "\r") break;
				index += 1;
			}
			continue;
		}
		if (char === "/" && next === "*") {
			inBlockComment = true;
			index += 2;
			continue;
		}
		result += char;
		if (char === "'") inSingle = true;
		else if (char === '"') inDouble = true;
		else if (char === "`") inTemplate = true;
		index += 1;
	}
	return result;
}

function parseStringLiteral(text: string): { value: string; quoteStyle: QuoteStyle; nextIndex: number } | null {
	const quote = text[0];
	if (quote !== '"' && quote !== "'") return null;
	let value = "";
	let index = 1;
	let escaped = false;
	while (index < text.length) {
		const char = text[index] ?? "";
		if (escaped) {
			value += char;
			escaped = false;
			index += 1;
			continue;
		}
		if (char === "\\") {
			value += char;
			escaped = true;
			index += 1;
			continue;
		}
		if (char === quote) {
			return {
				value,
				quoteStyle: quote === "'" ? "single" : "double",
				nextIndex: index + 1,
			};
		}
		value += char;
		index += 1;
	}
	return null;
}

function scanBalancedState(text: string): { balanced: boolean } {
	let braceDepth = 0;
	let bracketDepth = 0;
	let parenDepth = 0;
	let inSingle = false;
	let inDouble = false;
	let inTemplate = false;
	let inBlockComment = false;
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] ?? "";
		const next = text[index + 1] ?? "";
		if (inBlockComment) {
			if (char === "*" && next === "/") {
				inBlockComment = false;
				index += 1;
			}
			continue;
		}
		if (inSingle) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "'") inSingle = false;
			continue;
		}
		if (inDouble) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inDouble = false;
			continue;
		}
		if (inTemplate) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "`") inTemplate = false;
			continue;
		}
		if (char === "/" && next === "*") {
			inBlockComment = true;
			index += 1;
			continue;
		}
		if (char === "/" && next === "/") break;
		if (char === "'") {
			inSingle = true;
			continue;
		}
		if (char === '"') {
			inDouble = true;
			continue;
		}
		if (char === "`") {
			inTemplate = true;
			continue;
		}
		if (char === "{") braceDepth += 1;
		else if (char === "}") braceDepth -= 1;
		else if (char === "[") bracketDepth += 1;
		else if (char === "]") bracketDepth -= 1;
		else if (char === "(") parenDepth += 1;
		else if (char === ")") parenDepth -= 1;
	}
	return {
		balanced:
			!inSingle &&
			!inDouble &&
			!inTemplate &&
			!inBlockComment &&
			braceDepth === 0 &&
			bracketDepth === 0 &&
			parenDepth === 0,
	};
}

function findKeywordOutside(text: string, keyword: string): number {
	let braceDepth = 0;
	let bracketDepth = 0;
	let parenDepth = 0;
	let inSingle = false;
	let inDouble = false;
	let inTemplate = false;
	let escaped = false;
	for (let index = 0; index <= text.length - keyword.length; index += 1) {
		const char = text[index] ?? "";
		if (inSingle) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "'") inSingle = false;
			continue;
		}
		if (inDouble) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inDouble = false;
			continue;
		}
		if (inTemplate) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "`") inTemplate = false;
			continue;
		}
		if (char === "'") {
			inSingle = true;
			continue;
		}
		if (char === '"') {
			inDouble = true;
			continue;
		}
		if (char === "`") {
			inTemplate = true;
			continue;
		}
		if (char === "{") {
			braceDepth += 1;
			continue;
		}
		if (char === "}") {
			braceDepth -= 1;
			continue;
		}
		if (char === "[") {
			bracketDepth += 1;
			continue;
		}
		if (char === "]") {
			bracketDepth -= 1;
			continue;
		}
		if (char === "(") {
			parenDepth += 1;
			continue;
		}
		if (char === ")") {
			parenDepth -= 1;
			continue;
		}
		if (braceDepth !== 0 || bracketDepth !== 0 || parenDepth !== 0) continue;
		if (text.slice(index, index + keyword.length) !== keyword) continue;
		const before = index === 0 ? "" : (text[index - 1] ?? "");
		const after = text[index + keyword.length] ?? "";
		const beforeOk = before.length === 0 || /\s|,|\{|\}/.test(before);
		const afterOk = after.length === 0 || /\s|['"]/.test(after);
		if (beforeOk && afterOk) return index;
	}
	return -1;
}

function splitTopLevel(text: string, delimiter: string): string[] {
	const parts: string[] = [];
	let current = "";
	let braceDepth = 0;
	let bracketDepth = 0;
	let parenDepth = 0;
	let inSingle = false;
	let inDouble = false;
	let inTemplate = false;
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] ?? "";
		if (inSingle) {
			current += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "'") inSingle = false;
			continue;
		}
		if (inDouble) {
			current += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inDouble = false;
			continue;
		}
		if (inTemplate) {
			current += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "`") inTemplate = false;
			continue;
		}
		if (char === "'") {
			inSingle = true;
			current += char;
			continue;
		}
		if (char === '"') {
			inDouble = true;
			current += char;
			continue;
		}
		if (char === "`") {
			inTemplate = true;
			current += char;
			continue;
		}
		if (char === "{") braceDepth += 1;
		else if (char === "}") braceDepth -= 1;
		else if (char === "[") bracketDepth += 1;
		else if (char === "]") bracketDepth -= 1;
		else if (char === "(") parenDepth += 1;
		else if (char === ")") parenDepth -= 1;
		if (char === delimiter && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts;
}

function parseNamedBinding(token: string, order: number, impliedTypeOnly: boolean): ImportedBinding | null {
	const trimmed = token.trim();
	if (trimmed.length === 0) return null;
	const hasInlineType = trimmed.startsWith("type ");
	const typeOnly = impliedTypeOnly || hasInlineType;
	const body = hasInlineType ? trimmed.slice(5).trim() : trimmed;
	const match = /^(?<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/.exec(body);
	if (!match?.groups?.imported) return null;
	return {
		imported: match.groups.imported,
		local: match.groups.local,
		typeOnly,
		order,
	};
}

function parseSpecifierName(token: string): ParsedSpecifierName | null {
	const trimmed = token.trim();
	if (trimmed.length === 0) return null;
	const match = /^(?<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/.exec(trimmed);
	if (!match?.groups?.imported) return null;
	return {
		imported: match.groups.imported,
		local: match.groups.local,
	};
}

function parseClause(clauseText: string): Omit<ParsedImportStatement, "kind" | "source" | "quoteStyle" | "assertion"> {
	let clause = clauseText.trim();
	let typeOnly = false;
	if (clause.startsWith("type ")) {
		typeOnly = true;
		clause = clause.slice(5).trim();
	}
	let defaultImport: string | undefined;
	let namespaceImport: string | undefined;
	const namedBindings: ImportedBinding[] = [];
	const parts = splitTopLevel(clause, ",")
		.map(part => part.trim())
		.filter(part => part.length > 0);
	let bindingOrder = 0;
	if (parts.length === 1) {
		const only = parts[0] ?? "";
		if (only.startsWith("{")) {
			const inner = only.slice(1, only.endsWith("}") ? -1 : undefined);
			for (const token of splitTopLevel(inner, ",")) {
				const parsed = parseNamedBinding(token, bindingOrder, typeOnly);
				if (!parsed) continue;
				namedBindings.push(parsed);
				bindingOrder += 1;
			}
		} else if (only.startsWith("* as ")) {
			namespaceImport = only.slice(5).trim();
		} else {
			defaultImport = only;
		}
	} else if (parts.length >= 2) {
		defaultImport = parts[0] ?? undefined;
		const second = parts[1] ?? "";
		if (second.startsWith("* as ")) {
			namespaceImport = second.slice(5).trim();
		} else if (second.startsWith("{")) {
			const inner = second.slice(1, second.endsWith("}") ? -1 : undefined);
			for (const token of splitTopLevel(inner, ",")) {
				const parsed = parseNamedBinding(token, bindingOrder, typeOnly);
				if (!parsed) continue;
				namedBindings.push(parsed);
				bindingOrder += 1;
			}
		}
	}
	return {
		typeOnly,
		defaultImport,
		namespaceImport,
		namedBindings,
	};
}

function parseImportStatementText(statement: string): ParsedImportStatement | null {
	const withoutComments = stripComments(statement).trim();
	if (!withoutComments.startsWith("import ")) return null;
	const normalized = withoutComments.endsWith(";") ? withoutComments.slice(0, -1).trimEnd() : withoutComments;
	const remainder = normalized.slice(6).trimStart();
	const sideEffectLiteral = parseStringLiteral(remainder);
	if (sideEffectLiteral) {
		const assertionText = remainder.slice(sideEffectLiteral.nextIndex).trim();
		return {
			kind: "side-effect",
			typeOnly: false,
			source: sideEffectLiteral.value,
			quoteStyle: sideEffectLiteral.quoteStyle,
			assertion: assertionText.startsWith("with") ? assertionText : undefined,
			namedBindings: [],
		};
	}
	const fromIndex = findKeywordOutside(remainder, "from");
	if (fromIndex === -1) return null;
	const clause = remainder.slice(0, fromIndex).trim();
	const sourceSection = remainder.slice(fromIndex + 4).trimStart();
	const sourceLiteral = parseStringLiteral(sourceSection);
	if (!sourceLiteral) return null;
	const assertionText = sourceSection.slice(sourceLiteral.nextIndex).trim();
	const parsedClause = parseClause(clause);
	return {
		kind: "binding",
		typeOnly: parsedClause.typeOnly,
		source: sourceLiteral.value,
		quoteStyle: sourceLiteral.quoteStyle,
		assertion: assertionText.startsWith("with") ? assertionText : undefined,
		defaultImport: parsedClause.defaultImport,
		namespaceImport: parsedClause.namespaceImport,
		namedBindings: parsedClause.namedBindings,
	};
}

function collectImportStatement(
	lines: string[],
	startIndex: number,
): { statement: string; nextIndex: number; endLine: number; hasSemicolon: boolean } | null {
	const collected: string[] = [];
	for (let index = startIndex; index < lines.length; index += 1) {
		collected.push(lines[index] ?? "");
		const joined = collected.join("\n");
		const { balanced } = scanBalancedState(joined);
		if (!balanced) continue;
		const parsed = parseImportStatementText(joined);
		if (!parsed) continue;
		const trimmed = stripComments(joined).trimEnd();
		return {
			statement: joined,
			nextIndex: index + 1,
			endLine: index + 1,
			hasSemicolon: trimmed.endsWith(";"),
		};
	}
	return null;
}

function hasBlankLineBetween(lines: string[], startIndex: number, endIndex: number): boolean {
	for (let index = startIndex; index < endIndex; index += 1) {
		if (isBlankLine(lines[index] ?? "")) return true;
	}
	return false;
}

function inferStyle(records: ParsedTypeScriptImport[], lines: string[]): TypeScriptImportStyle {
	const singleQuotes = records.filter(record => record.quoteStyle === "single").length;
	const semicolons = records.filter(record => record.hasSemicolon).length;
	const separateTypeStatements = records.filter(record => record.kind === "binding" && record.typeOnly).length;
	const inlineTypeBindings = records.reduce((count, record) => {
		if (record.kind !== "binding" || record.typeOnly) return count;
		return count + record.namedBindings.filter(binding => binding.typeOnly).length;
	}, 0);
	const groupOrder = records.reduce<ImportGroup[]>((order, record) => {
		if (!order.includes(record.group)) order.push(record.group);
		return order;
	}, []);
	let groupSeparator = false;
	for (let index = 1; index < records.length; index += 1) {
		if (hasBlankLineBetween(lines, records[index - 1]!.endLine, records[index]!.startLine - 1)) {
			groupSeparator = true;
			break;
		}
	}
	return {
		...defaultImportStyle,
		groupSeparator,
		groupOrder: groupOrder.length > 0 ? groupOrder : [...DEFAULT_GROUP_ORDER],
		sorted: true,
		typeImportStyle: separateTypeStatements > inlineTypeBindings ? "separate" : "inline",
		quoteStyle: singleQuotes > records.length - singleQuotes ? "single" : "double",
		semicolons: semicolons >= Math.ceil(records.length / 2),
	};
}

function normalizeAssertion(assertion: string | undefined): string | undefined {
	return assertion?.trim() || undefined;
}

function cloneBinding(binding: ImportedBinding, order: number): ImportedBinding {
	return {
		imported: binding.imported,
		local: binding.local,
		typeOnly: binding.typeOnly,
		order,
	};
}

function cloneRecord(record: ParsedTypeScriptImport, order: number): ParsedTypeScriptImport {
	return {
		...record,
		order,
		startLine: 0,
		endLine: 0,
		namedBindings: record.namedBindings.map((binding, index) => cloneBinding(binding, index)),
	};
}

function compareBindings(left: ImportedBinding, right: ImportedBinding): number {
	const leftName = `${left.typeOnly ? "1" : "0"}:${left.imported}:${left.local ?? left.imported}`;
	const rightName = `${right.typeOnly ? "1" : "0"}:${right.imported}:${right.local ?? right.imported}`;
	return leftName.localeCompare(rightName);
}

function compareRecords(left: ParsedTypeScriptImport, right: ParsedTypeScriptImport): number {
	if (left.group !== right.group) return left.group.localeCompare(right.group);
	if (left.source !== right.source) return left.source.localeCompare(right.source);
	if (left.kind !== right.kind) return left.kind === "side-effect" ? -1 : 1;
	if (left.kind === "binding" && right.kind === "binding" && left.typeOnly !== right.typeOnly)
		return left.typeOnly ? 1 : -1;
	return left.order - right.order;
}

function formatBinding(binding: ImportedBinding, statementTypeOnly = false): string {
	const prefix = !statementTypeOnly && binding.typeOnly ? "type " : "";
	const localPart = binding.local ? ` as ${binding.local}` : "";
	return `${prefix}${binding.imported}${localPart}`;
}

function formatSource(source: string, quoteStyle: QuoteStyle): string {
	const quote = quoteStyle === "single" ? "'" : '"';
	return `${quote}${source}${quote}`;
}

function renderAssertion(assertion: string | undefined): string {
	return assertion ? ` ${assertion}` : "";
}

function renderRecord(record: ParsedTypeScriptImport, style: TypeScriptImportStyle): string {
	const semicolon = style.semicolons ? ";" : "";
	if (record.kind === "side-effect") {
		return `import ${formatSource(record.source, style.quoteStyle)}${renderAssertion(record.assertion)}${semicolon}`;
	}
	const namedBindings = [...record.namedBindings];
	if (style.sorted) namedBindings.sort(compareBindings);
	const namedPart =
		namedBindings.length > 0
			? `{ ${namedBindings.map(binding => formatBinding(binding, record.typeOnly)).join(", ")} }`
			: "";
	const defaultPart = record.defaultImport ?? "";
	const namespacePart = record.namespaceImport ? `* as ${record.namespaceImport}` : "";
	const bindingParts = [defaultPart, namespacePart, namedPart].filter(part => part.length > 0);
	const typePrefix = record.typeOnly ? "type " : "";
	return `import ${typePrefix}${bindingParts.join(", ")} from ${formatSource(record.source, style.quoteStyle)}${renderAssertion(record.assertion)}${semicolon}`;
}

function renderImportBlock(records: ParsedTypeScriptImport[], style: TypeScriptImportStyle): string[] {
	const groups = new Map<ImportGroup, ParsedTypeScriptImport[]>();
	for (const record of records) {
		const list = groups.get(record.group) ?? [];
		list.push(record);
		groups.set(record.group, list);
	}
	const orderedGroups = [...style.groupOrder.filter(isImportGroup), ...DEFAULT_GROUP_ORDER].filter(
		(group, index, values) => values.indexOf(group) === index,
	);
	const lines: string[] = [];
	for (const group of orderedGroups) {
		const recordsInGroup = groups.get(group);
		if (!recordsInGroup || recordsInGroup.length === 0) continue;
		const ordered = [...recordsInGroup];
		if (style.sorted) ordered.sort(compareRecords);
		else ordered.sort((left, right) => left.order - right.order);
		for (const record of ordered) lines.push(renderRecord(record, style));
		if (style.groupSeparator) lines.push("");
	}
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function deriveAssertion(source: string): string | undefined {
	for (const [extension, type] of Object.entries(ASSET_IMPORT_TYPES)) {
		if (!source.toLowerCase().endsWith(extension)) continue;
		return `with { type: ${JSON.stringify(type)} }`;
	}
	return undefined;
}

function parseImportSpecName(token: string, order: number, typeOnly: boolean): ImportedBinding | null {
	const parsed = parseSpecifierName(token);
	if (!parsed) return null;
	return {
		imported: parsed.imported,
		local: parsed.local,
		typeOnly,
		order,
	};
}

function specToRequest(spec: ImportSpec): ParsedSpecRequest {
	const valueBindings: ImportedBinding[] = [];
	const typeBindings: ImportedBinding[] = [];
	let order = 0;
	for (const imported of spec.imports ?? []) {
		const trimmed = imported.trim();
		if (trimmed.length === 0) continue;
		const isTypeOnly = trimmed.startsWith("type ");
		const parsed = parseImportSpecName(isTypeOnly ? trimmed.slice(5).trim() : trimmed, order, isTypeOnly);
		if (!parsed) continue;
		if (parsed.typeOnly) typeBindings.push(parsed);
		else valueBindings.push(parsed);
		order += 1;
	}
	return {
		source: spec.from,
		defaultImport: spec.default,
		namespaceImport: spec.namespace,
		valueBindings,
		typeBindings,
		assertion: deriveAssertion(spec.from),
	};
}

function requestToRecords(
	request: ParsedSpecRequest,
	style: TypeScriptImportStyle,
	startOrder: number,
): ParsedTypeScriptImport[] {
	const records: ParsedTypeScriptImport[] = [];
	let order = startOrder;
	const group = classifyGroup({
		kind:
			request.defaultImport ||
			request.namespaceImport ||
			request.valueBindings.length > 0 ||
			request.typeBindings.length > 0
				? "binding"
				: "side-effect",
		source: request.source,
	});
	if (
		!request.defaultImport &&
		!request.namespaceImport &&
		request.valueBindings.length === 0 &&
		request.typeBindings.length === 0
	) {
		records.push({
			raw: "",
			source: request.source,
			names: [],
			kind: "side-effect",
			typeOnly: false,
			order,
			startLine: 0,
			endLine: 0,
			group,
			quoteStyle: style.quoteStyle,
			hasSemicolon: style.semicolons,
			namedBindings: [],
			assertion: request.assertion,
		});
		return records;
	}
	if (request.defaultImport || request.namespaceImport || request.valueBindings.length > 0) {
		const bindings = request.valueBindings.map((binding, index) => cloneBinding(binding, index));
		if (style.typeImportStyle === "inline") {
			for (const typeBinding of request.typeBindings) bindings.push(cloneBinding(typeBinding, bindings.length));
		}
		records.push({
			raw: "",
			source: request.source,
			names: bindings.map(binding => formatBinding(binding, false)),
			defaultImport: request.defaultImport,
			namespaceImport: request.namespaceImport,
			kind: "binding",
			typeOnly: false,
			order,
			startLine: 0,
			endLine: 0,
			group,
			quoteStyle: style.quoteStyle,
			hasSemicolon: style.semicolons,
			namedBindings: bindings,
			assertion: request.assertion,
		});
		order += 1;
	}
	if (
		request.typeBindings.length > 0 &&
		(style.typeImportStyle === "separate" ||
			(!request.defaultImport && !request.namespaceImport && request.valueBindings.length === 0))
	) {
		const bindings = request.typeBindings.map((binding, index) =>
			cloneBinding({ ...binding, typeOnly: false }, index),
		);
		records.push({
			raw: "",
			source: request.source,
			names: bindings.map(binding => formatBinding(binding, true)),
			kind: "binding",
			typeOnly: true,
			order,
			startLine: 0,
			endLine: 0,
			group,
			quoteStyle: style.quoteStyle,
			hasSemicolon: style.semicolons,
			namedBindings: bindings,
			assertion: request.assertion,
		});
	}
	return records;
}

function bindingKey(binding: ImportedBinding, statementTypeOnly = false): string {
	const typeKey = statementTypeOnly || binding.typeOnly ? "type" : "value";
	return `${typeKey}:${binding.imported}:${binding.local ?? binding.imported}`;
}

function hasBinding(
	records: ParsedTypeScriptImport[],
	source: string,
	binding: ImportedBinding,
	statementTypeOnly = false,
): boolean {
	return records.some(
		record =>
			record.kind === "binding" &&
			record.source === source &&
			record.namedBindings.some(
				existing => bindingKey(existing, record.typeOnly) === bindingKey(binding, statementTypeOnly),
			),
	);
}

function getSourceRecords(records: ParsedTypeScriptImport[], source: string): ParsedTypeScriptImport[] {
	return records.filter(record => record.source === source);
}

function getBindingRecord(
	records: ParsedTypeScriptImport[],
	source: string,
	typeOnly: boolean,
): ParsedTypeScriptImport | undefined {
	return records.find(record => record.kind === "binding" && record.source === source && record.typeOnly === typeOnly);
}

function syncNames(record: ParsedTypeScriptImport): void {
	record.names = record.namedBindings.map(binding => formatBinding(binding, record.typeOnly));
}

function mergeNamedBindings(
	target: ParsedTypeScriptImport,
	bindings: ImportedBinding[],
	typeOnly: boolean,
	style: TypeScriptImportStyle,
): ImportedBinding[] {
	const added: ImportedBinding[] = [];
	for (const binding of bindings) {
		const candidate = typeOnly
			? { ...binding, typeOnly: style.typeImportStyle === "inline" && !target.typeOnly }
			: binding;
		const existing = target.namedBindings.some(
			current => bindingKey(current, target.typeOnly) === bindingKey(candidate, target.typeOnly),
		);
		if (existing) continue;
		target.namedBindings.push(cloneBinding(candidate, target.namedBindings.length));
		added.push(candidate);
	}
	if (style.sorted) target.namedBindings.sort(compareBindings);
	syncNames(target);
	return added;
}

function buildPreviewRecord(
	base: ParsedTypeScriptImport,
	parts: { defaultImport?: string; namespaceImport?: string; namedBindings?: ImportedBinding[]; typeOnly?: boolean },
): ParsedTypeScriptImport {
	const namedBindings = parts.namedBindings?.map((binding, index) => cloneBinding(binding, index)) ?? [];
	return {
		...base,
		defaultImport: parts.defaultImport,
		namespaceImport: parts.namespaceImport,
		namedBindings,
		names: namedBindings.map(binding => formatBinding(binding, parts.typeOnly ?? base.typeOnly)),
		typeOnly: parts.typeOnly ?? base.typeOnly,
	};
}

function mergeRecords(
	existing: ParsedTypeScriptImport[],
	requested: ParsedTypeScriptImport[],
	style: TypeScriptImportStyle,
): { records: ParsedTypeScriptImport[]; added: string[] } {
	const records = existing.map((record, index) => cloneRecord(record, index));
	const added: string[] = [];
	let nextOrder = records.reduce((max, record) => Math.max(max, record.order), -1) + 1;
	for (const record of requested) {
		if (record.kind === "side-effect") {
			const exists = records.some(
				existingRecord => existingRecord.kind === "side-effect" && existingRecord.source === record.source,
			);
			if (exists) continue;
			const inserted = cloneRecord(record, nextOrder);
			records.push(inserted);
			added.push(renderRecord(inserted, style));
			nextOrder += 1;
			continue;
		}
		if (record.typeOnly && style.typeImportStyle !== "separate") {
			const inlineTarget = getBindingRecord(records, record.source, false);
			if (inlineTarget) {
				const normalizedBindings = record.namedBindings.map(binding => ({ ...binding, typeOnly: true }));
				const missingBindings = normalizedBindings.filter(binding => !hasBinding(records, record.source, binding));
				if (missingBindings.length === 0) continue;
				mergeNamedBindings(inlineTarget, normalizedBindings, true, style);
				added.push(
					renderRecord(
						buildPreviewRecord(inlineTarget, { namedBindings: missingBindings, typeOnly: false }),
						style,
					),
				);
				continue;
			}
		}
		const target = getBindingRecord(records, record.source, record.typeOnly);
		if (!target) {
			const inserted = cloneRecord(record, nextOrder);
			records.push(inserted);
			added.push(renderRecord(inserted, style));
			nextOrder += 1;
			continue;
		}
		const addedDefault =
			record.defaultImport &&
			!getSourceRecords(records, record.source).some(
				sourceRecord => sourceRecord.defaultImport === record.defaultImport,
			)
				? record.defaultImport
				: undefined;
		if (addedDefault) target.defaultImport = addedDefault;
		const addedNamespace =
			record.namespaceImport &&
			!getSourceRecords(records, record.source).some(
				sourceRecord => sourceRecord.namespaceImport === record.namespaceImport,
			)
				? record.namespaceImport
				: undefined;
		if (addedNamespace) target.namespaceImport = addedNamespace;
		const missingBindings = record.namedBindings.filter(
			binding => !hasBinding(records, record.source, binding, record.typeOnly),
		);
		if (missingBindings.length > 0) mergeNamedBindings(target, missingBindings, record.typeOnly, style);
		if (!addedDefault && !addedNamespace && missingBindings.length === 0) continue;
		added.push(
			renderRecord(
				buildPreviewRecord(target, {
					defaultImport: addedDefault,
					namespaceImport: addedNamespace,
					namedBindings: missingBindings,
					typeOnly: record.typeOnly,
				}),
				style,
			),
		);
	}
	return { records, added };
}

function parseTypeScriptRegion(content: string): ParsedTypeScriptRegion | null {
	const lines = content.split(/\r?\n/);
	const prefixEnd = findPrefixEnd(lines);
	let index = prefixEnd;
	while (index < lines.length && isBlankLine(lines[index] ?? "")) index += 1;
	if (!lineStartsImport(lines[index] ?? "")) return null;
	const records: ParsedTypeScriptImport[] = [];
	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (isBlankLine(line) || isLineComment(line)) {
			index += 1;
			continue;
		}
		if (startsBlockComment(line)) {
			index += 1;
			while (index < lines.length && !(lines[index - 1] ?? "").includes("*/")) index += 1;
			continue;
		}
		if (!lineStartsImport(line)) break;
		const collected = collectImportStatement(lines, index);
		if (!collected) break;
		const parsed = parseImportStatementText(collected.statement);
		if (!parsed) break;
		records.push({
			raw: collected.statement,
			source: parsed.source,
			names: parsed.namedBindings.map(binding => formatBinding(binding, parsed.typeOnly)),
			defaultImport: parsed.defaultImport,
			namespaceImport: parsed.namespaceImport,
			typeOnly: parsed.typeOnly,
			assertion: normalizeAssertion(parsed.assertion),
			kind: parsed.kind,
			order: records.length,
			startLine: index + 1,
			endLine: collected.endLine,
			group: classifyGroup({ kind: parsed.kind, source: parsed.source }),
			quoteStyle: parsed.quoteStyle,
			hasSemicolon: collected.hasSemicolon,
			namedBindings: parsed.namedBindings.map((binding, bindingIndex) => cloneBinding(binding, bindingIndex)),
		});
		index = collected.nextIndex;
	}
	if (records.length === 0) return null;
	return {
		startLine: records[0]!.startLine,
		endLine: Math.max(...records.map(record => record.endLine)),
		imports: records,
		style: inferStyle(records, lines),
	};
}

function parseExisting(content: string): ImportRegion | null {
	return parseTypeScriptRegion(content);
}

function specToLine(spec: ImportSpec, style: ImportStyle): string {
	const tsStyle = getTypeScriptStyle(style);
	const request = specToRequest(spec);
	const records = requestToRecords(request, tsStyle, 0);
	return records.map(record => renderRecord(record, tsStyle)).join("\n");
}

function insertWithoutRegion(content: string, lines: string[], blockLines: string[], eol: string): string {
	if (content.length === 0) return blockLines.join(eol);
	const insertAt = findPrefixEnd(lines);
	const before = lines.slice(0, insertAt);
	const after = lines.slice(insertAt);
	const needsTrailingBlank =
		after.length > 0 && after.some(line => line.trim().length > 0) && !isBlankLine(after[0] ?? "");
	const nextLines = [...before, ...blockLines, ...(needsTrailingBlank ? [""] : []), ...after];
	const nextContent = nextLines.join(eol);
	if (content.endsWith(eol) && !nextContent.endsWith(eol)) return `${nextContent}${eol}`;
	return nextContent;
}

function replaceRegion(
	content: string,
	lines: string[],
	region: ParsedTypeScriptRegion,
	blockLines: string[],
	eol: string,
): string {
	const nextLines = [...lines.slice(0, region.startLine - 1), ...blockLines, ...lines.slice(region.endLine)];
	const nextContent = nextLines.join(eol);
	if (content.endsWith(eol) && !nextContent.endsWith(eol)) return `${nextContent}${eol}`;
	return nextContent;
}

export const typescriptImportHandler: ImportHandler = {
	parseExisting,
	specToLine,
	apply(content, specs) {
		const region = parseTypeScriptRegion(content);
		const style = getTypeScriptStyle(
			region?.style ?? {
				...defaultImportStyle,
				groupSeparator: true,
				groupOrder: [...DEFAULT_GROUP_ORDER],
				sorted: true,
				typeImportStyle: "inline",
				quoteStyle: "double",
				semicolons: true,
			},
		);
		const requested: ParsedTypeScriptImport[] = [];
		let order = 0;
		for (const spec of specs) {
			const request = specToRequest(spec);
			const records = requestToRecords(request, style, order);
			requested.push(...records);
			order += Math.max(records.length, 1);
		}
		if (requested.length === 0) return { content, added: [], warnings: [] };
		const { records, added } = mergeRecords(region?.imports ?? [], requested, style);
		if (added.length === 0) return { content, added: [], warnings: [] };
		const eol = detectEol(content);
		const lines = content.split(/\r?\n/);
		const blockLines = renderImportBlock(records, style);
		const nextContent = region
			? replaceRegion(content, lines, region, blockLines, eol)
			: insertWithoutRegion(content, lines, blockLines, eol);
		return { content: nextContent, added, warnings: [] };
	},
};

export { defaultImportStyle };
