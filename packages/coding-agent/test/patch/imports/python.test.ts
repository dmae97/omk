import { describe, expect, test } from "bun:test";
import { pythonImportHandler } from "../../../src/patch/imports/python";

describe("pythonImportHandler.apply", () => {
	test("inserts after shebang, encoding, and module docstring", () => {
		const content = '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\n\n"""module docs"""\n\nvalue = 1\n';

		const result = pythonImportHandler.apply(content, [{ from: "os", imports: ["path"] }]);

		expect(result).toEqual({
			content:
				'#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\n\n"""module docs"""\n\nfrom os import path\n\nvalue = 1\n',
			added: ["from os import path"],
			warnings: [],
		});
	});

	test("merges names into an existing from-import", () => {
		const content = "from pathlib import Path\n\nvalue = 1\n";

		const result = pythonImportHandler.apply(content, [{ from: "pathlib", imports: ["PurePath"] }]);

		expect(result.content).toBe("from pathlib import Path, PurePath\n\nvalue = 1\n");
		expect(result.added).toEqual(["from pathlib import PurePath"]);
		expect(result.warnings).toEqual([]);
	});

	test("preserves existing import grouping when adding to an existing group", () => {
		const content = "import os\n\nimport requests\n\nfrom .local import thing\n\nvalue = 1\n";

		const result = pythonImportHandler.apply(content, [{ from: "sys" }]);

		expect(result.content).toBe(
			"import os\nimport sys\n\nimport requests\n\nfrom .local import thing\n\nvalue = 1\n",
		);
		expect(result.added).toEqual(["import sys"]);
		expect(result.warnings).toEqual([]);
	});

	test("dedupes an already present import", () => {
		const content = "from pathlib import Path\n";

		const result = pythonImportHandler.apply(content, [{ from: "pathlib", imports: ["Path"] }]);

		expect(result).toEqual({
			content,
			added: [],
			warnings: [],
		});
	});
});
