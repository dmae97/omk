import type { ImportSpec } from "../types";

export interface ImportStyle {
	groupSeparator: boolean;
	groupOrder: string[];
	sorted: boolean;
	typeImportStyle?: "separate" | "inline";
	quoteStyle?: "single" | "double";
	semicolons?: boolean;
}

export interface ParsedImport {
	raw: string;
	source: string;
	names: string[];
	defaultImport?: string;
	namespaceImport?: string;
	typeOnly?: boolean;
	assertion?: string;
	system?: boolean;
	alias?: string;
}

export interface ImportRegion {
	startLine: number;
	endLine: number;
	imports: ParsedImport[];
	style: ImportStyle;
}

export interface ImportApplyResult {
	content: string;
	added: string[];
	warnings: string[];
}

export interface ImportHandler {
	parseExisting(content: string): ImportRegion | null;
	specToLine(spec: ImportSpec, style: ImportStyle): string;
	apply(content: string, specs: ImportSpec[]): ImportApplyResult;
}

export const defaultImportStyle: ImportStyle = {
	groupSeparator: true,
	groupOrder: [],
	sorted: true,
};
