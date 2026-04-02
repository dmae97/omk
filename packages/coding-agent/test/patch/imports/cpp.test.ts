import { describe, expect, it } from "bun:test";
import { cppImportHandler } from "../../../src/patch/imports/cpp";
import type { ImportSpec } from "../../../src/patch/types";

function apply(content: string, imports: ImportSpec[]) {
	return cppImportHandler.apply(content, imports);
}

describe("c and c++ import handler", () => {
	it("inserts includes after #pragma once and keeps system includes before local includes", () => {
		const source = ["#pragma once", "", "class Widget {};", ""].join("\n");

		const result = apply(source, [
			{ from: "vector", system: true },
			{ from: "widget/detail.h", system: false },
		]);

		expect(result.content).toBe(
			["#pragma once", "", "#include <vector>", "", '#include "widget/detail.h"', "", "class Widget {};", ""].join(
				"\n",
			),
		);
		expect(result.added).toEqual(["#include <vector>", '#include "widget/detail.h"']);
		expect(result.warnings).toEqual([]);
	});

	it("inserts includes after a header guard", () => {
		const source = ["#ifndef WIDGET_H", "#define WIDGET_H", "", "struct Widget {};", ""].join("\n");

		const result = apply(source, [{ from: "widget/detail.h", system: false }]);

		expect(result.content).toBe(
			["#ifndef WIDGET_H", "#define WIDGET_H", "", '#include "widget/detail.h"', "", "struct Widget {};", ""].join(
				"\n",
			),
		);
		expect(result.added).toEqual(['#include "widget/detail.h"']);
		expect(result.warnings).toEqual([]);
	});

	it("deduplicates requested includes while preserving grouped ordering", () => {
		const source = ["#include <string>", "", '#include "app/foo.h"', "", "int main();", ""].join("\n");

		const result = apply(source, [
			{ from: "string", system: true },
			{ from: "vector", system: true },
			{ from: "app/foo.h", system: false },
			{ from: "app/foo.h", system: false },
			{ from: "app/bar.h", system: false },
		]);

		expect(result.content).toBe(
			[
				"#include <string>",
				"#include <vector>",
				"",
				'#include "app/bar.h"',
				'#include "app/foo.h"',
				"",
				"int main();",
				"",
			].join("\n"),
		);
		expect(result.added).toEqual(["#include <vector>", '#include "app/bar.h"']);
		expect(result.warnings).toEqual([]);
	});
});
