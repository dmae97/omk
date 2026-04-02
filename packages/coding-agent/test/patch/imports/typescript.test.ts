import { describe, expect, test } from "bun:test";
import { typescriptImportHandler } from "../../../src/patch/imports/typescript";

describe("typescriptImportHandler.apply", () => {
	test("adds an import block to a file with no imports", () => {
		const result = typescriptImportHandler.apply("const answer = 42;\n", [{ from: "react", imports: ["useMemo"] }]);

		expect(result).toEqual({
			content: 'import { useMemo } from "react";\n\nconst answer = 42;\n',
			added: ['import { useMemo } from "react";'],
			warnings: [],
		});
	});

	test("merges named imports into an existing module import", () => {
		const content = 'import { useState } from "react";\n\nconst answer = 42;\n';

		const result = typescriptImportHandler.apply(content, [{ from: "react", imports: ["useMemo"] }]);

		expect(result.content).toBe('import { useMemo, useState } from "react";\n\nconst answer = 42;\n');
		expect(result.added).toEqual(['import { useMemo } from "react";']);
		expect(result.warnings).toEqual([]);
	});

	test("dedupes an already present import", () => {
		const content = 'import { useMemo } from "react";\n';

		const result = typescriptImportHandler.apply(content, [{ from: "react", imports: ["useMemo"] }]);

		expect(result).toEqual({
			content,
			added: [],
			warnings: [],
		});
	});

	test("derives an import assertion for known asset types", () => {
		const result = typescriptImportHandler.apply("const answer = 42;\n", [
			{ from: "./guide.adoc", default: "guide" },
		]);

		expect(result).toEqual({
			content: 'import guide from "./guide.adoc" with { type: "text" };\n\nconst answer = 42;\n',
			added: ['import guide from "./guide.adoc" with { type: "text" };'],
			warnings: [],
		});
	});
});
