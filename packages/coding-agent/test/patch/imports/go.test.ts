import { describe, expect, it } from "bun:test";
import { goImportHandler } from "../../../src/patch/imports/go";
import type { ImportSpec } from "../../../src/patch/types";

function apply(content: string, imports: ImportSpec[]) {
	return goImportHandler.apply(content, imports);
}

describe("go import handler", () => {
	it("converts a single import into a block when adding another import", () => {
		const source = ["package main", "", 'import "fmt"', "", "func main() {}", ""].join("\n");

		const result = apply(source, [{ from: "os" }]);

		expect(result.content).toBe(
			["package main", "", "import (", '\t"fmt"', '\t"os"', ")", "", "func main() {}", ""].join("\n"),
		);
		expect(result.added).toEqual(['"os"']);
		expect(result.warnings).toEqual([]);
	});

	it("groups stdlib imports before third-party imports in a new block", () => {
		const source = ["package main", "", "func main() {}", ""].join("\n");

		const result = apply(source, [{ from: "github.com/acme/project" }, { from: "fmt" }]);

		expect(result.content).toBe(
			[
				"package main",
				"",
				"import (",
				'\t"fmt"',
				"",
				'\t"github.com/acme/project"',
				")",
				"",
				"func main() {}",
				"",
			].join("\n"),
		);
		expect(result.warnings).toEqual([]);
	});

	it("deduplicates repeated requested imports", () => {
		const source = ["package main", "", "func main() {}", ""].join("\n");

		const result = apply(source, [
			{ from: "fmt" },
			{ from: "fmt" },
			{ from: "github.com/acme/project" },
			{ from: "github.com/acme/project" },
		]);

		expect(result.content).toBe(
			[
				"package main",
				"",
				"import (",
				'\t"fmt"',
				"",
				'\t"github.com/acme/project"',
				")",
				"",
				"func main() {}",
				"",
			].join("\n"),
		);
		expect(result.added).toEqual(['"fmt"', '"github.com/acme/project"']);
		expect(result.warnings).toEqual([]);
	});
});
