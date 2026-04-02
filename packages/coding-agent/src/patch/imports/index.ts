import { detectLanguageId } from "../../lsp/utils";
import type { ImportSpec } from "../types";
import { cppImportHandler } from "./cpp";
import { goImportHandler } from "./go";
import { pythonImportHandler } from "./python";
import { rustImportHandler } from "./rust";
import type { ImportApplyResult, ImportHandler } from "./types";
import { typescriptImportHandler } from "./typescript";

const handlers: Partial<Record<string, ImportHandler>> = {
	typescript: typescriptImportHandler,
	typescriptreact: typescriptImportHandler,
	javascript: typescriptImportHandler,
	javascriptreact: typescriptImportHandler,
	rust: rustImportHandler,
	python: pythonImportHandler,
	go: goImportHandler,
	c: cppImportHandler,
	cpp: cppImportHandler,
};

export interface ApplyImportsResult {
	content: string;
	warnings: string[];
	added: string[];
}

export function applyImports(filePath: string, content: string, specs: ImportSpec[]): ApplyImportsResult {
	if (specs.length === 0) {
		return { content, warnings: [], added: [] };
	}

	const languageId = detectLanguageId(filePath);
	const handler = handlers[languageId];
	if (!handler) {
		return {
			content,
			added: [],
			warnings: [`Import management not supported for language: ${languageId}`],
		};
	}

	try {
		const result: ImportApplyResult = handler.apply(content, specs);
		return {
			content: result.content,
			warnings: result.warnings,
			added: result.added,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content,
			added: [],
			warnings: [`Failed to manage imports for ${filePath}: ${message}`],
		};
	}
}

export * from "./types";
