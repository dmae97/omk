import { describe, expect, test } from "bun:test";
import { rustImportHandler } from "../../../src/patch/imports/rust";

describe("rustImportHandler.apply", () => {
	test("adds a use statement to a file with no imports", () => {
		const result = rustImportHandler.apply("fn main() {}\n", [{ from: "std::fmt::Debug" }]);

		expect(result).toEqual({
			content: "use std::fmt::Debug;\n\nfn main() {}\n",
			added: ["use std::fmt::Debug;"],
			warnings: [],
		});
	});

	test("merges a requested member into an existing brace-group import", () => {
		const content = "use std::fmt::{Debug};\n\nfn main() {}\n";

		const result = rustImportHandler.apply(content, [{ from: "std::fmt", imports: ["Display"] }]);

		expect(result.content).toBe("use std::fmt::{Debug, Display};\n\nfn main() {}\n");
		expect(result.added).toEqual(["use std::fmt::{Display};"]);
		expect(result.warnings).toEqual([]);
	});

	test("keeps distinct simple-path imports when they cannot be merged semantically", () => {
		const content = "use crate::config;\n\nfn main() {}\n";

		const result = rustImportHandler.apply(content, [{ from: "crate::config::load" }]);

		expect(result.content).toBe("use crate::config;\nuse crate::config::load;\n\nfn main() {}\n");
		expect(result.added).toEqual(["use crate::config::load;"]);
		expect(result.warnings).toEqual([]);
	});

	test("dedupes an already present use statement", () => {
		const content = "use std::fmt::Debug;\n";

		const result = rustImportHandler.apply(content, [{ from: "std::fmt::Debug" }]);

		expect(result).toEqual({
			content,
			added: [],
			warnings: [],
		});
	});
});
