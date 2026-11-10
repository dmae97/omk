import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditTool, type EditToolInput } from "../src/core/tools/edit.ts";
import * as feedback from "../src/core/tools/edit-failure-feedback.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "omk-edit-feedback-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(dir, { recursive: true, force: true });
});

async function failEdit(file: string, edits: EditToolInput["edits"]): Promise<Error> {
	const path = join(dir, "target.txt");
	writeFileSync(path, file);
	let failure: unknown;
	try {
		await createEditTool(dir).execute("failure", { path: "target.txt", edits });
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(Error);
	expect(readFileSync(path, "utf8")).toBe(file);
	if (!(failure instanceof Error)) throw new Error("Expected edit to fail without writing");
	return failure;
}

describe("edit failure recovery feedback", () => {
	it("points to indentation-only candidates without applying them", async () => {
		const error = await failEdit("header\ndef f():\n    return 1\n", [
			{ oldText: "def f():\nreturn 1", newText: "def f():\n    return 2" },
		]);
		expect(error.message).toContain("Could not find the exact text");
		expect(error.message).toContain("Indentation-only");
		expect(error.message).toContain("offset=2, limit=2");
		expect(error.message).toContain("exact indentation");
		expect(error.message).toContain("No changes were written");
		expect(error.cause).toBeInstanceOf(Error);
	});

	it("reports BOM/CRLF line numbers and identifies the failing batch entry", async () => {
		const error = await failEdit("\uFEFFheader\r\ndef f():\r\n\treturn 1\r\n", [
			{ oldText: "header", newText: "HEADER" },
			{ oldText: "def f():\r\nreturn 1", newText: "def f():\r\n\treturn 2" },
		]);
		expect(error.message).toContain("Edit recovery for edits[1]");
		expect(error.message).toContain("offset=2, limit=2");
	});

	it("reports all shown indentation candidates, not a chosen replacement", async () => {
		const error = await failEdit("def f():\n    return 1\n\ndef f():\n\treturn 1\n", [
			{ oldText: "def f():\nreturn 1", newText: "new function" },
		]);
		expect(error.message).toContain("offset=1, limit=2");
		expect(error.message).toContain("offset=4, limit=2");
	});

	it("keeps overlapping matches ambiguous and reports both positions", async () => {
		const error = await failEdit("aaaa", [{ oldText: "aaa", newText: "Z" }]);
		expect(error.message).toContain("Found 2 occurrences");
		expect(error.message).toContain("Candidate positions (line:column): 1:1, 1:2");
		expect(error.message).toContain("surrounding context");
	});

	it("maps fuzzy-normalized candidate positions back to the original columns", async () => {
		const error = await failEdit("ﬃＡＡ\nﬃＡＡ\n", [{ oldText: "AA", newText: "Z" }]);
		expect(error.message).toContain("Candidate positions (line:column): 1:2, 2:2");
	});

	it("bounds duplicate hints to five candidates without exposing file text", async () => {
		const error = await failEdit(`${"secret-do-not-echo\n".repeat(20)}`, [
			{ oldText: "secret-do-not-echo", newText: "replacement" },
		]);
		expect(error.message).toContain("1:1, 2:1, 3:1, 4:1, 5:1");
		expect(error.message).toContain("showing first 5");
		expect(error.message).not.toContain("6:1");
		expect(error.message).not.toContain("secret-do-not-echo");
	});

	it("notes an existing replacement without treating it as success", async () => {
		const error = await failEdit("header\nready\nnow\n", [{ oldText: "obsolete", newText: "ready\r\nnow" }]);
		expect(error.message).toContain("newText is already present at line 2");
		expect(error.message).toContain("does not prove");
		expect(error.message).not.toContain("Successfully");
	});

	it.each(["", " \t\n"])("does not report an empty or whitespace replacement as applied (%j)", async (newText) => {
		const error = await failEdit("alpha\n", [{ oldText: "missing", newText }]);
		expect(error.message).not.toContain("already present");
		expect(error.message).toContain("Re-read");
	});

	it("does not suggest indentation for a partial-line mismatch", async () => {
		const error = await failEdit("  x = 1\n  value = 2\n", [{ oldText: "x = 1\nvalue", newText: "new" }]);
		expect(error.message).not.toContain("Indentation-only");
		expect(error.message).toContain("Re-read");
	});

	it("keeps no-op and cross-edit overlap errors unchanged", async () => {
		const noOp = await failEdit("same\n", [{ oldText: "same", newText: "same" }]);
		expect(noOp.message).not.toContain("Edit recovery");
		const overlap = await failEdit("abcdef\n", [
			{ oldText: "abcd", newText: "1" },
			{ oldText: "cdef", newText: "2" },
		]);
		expect(overlap.message).toBe(
			"edits[0] and edits[1] overlap in target.txt. Merge them into one edit or target disjoint regions.",
		);
	});

	it("skips detailed recovery beyond the file and edit-text budgets", async () => {
		const largeFile = await failEdit("x".repeat(256_001), [{ oldText: "missing", newText: "new" }]);
		expect(largeFile.message).not.toContain("Edit recovery");
		const largeEdit = await failEdit("small", [{ oldText: "z".repeat(32_001), newText: "new" }]);
		expect(largeEdit.message).not.toContain("Edit recovery");
	});

	it("bounds indentation candidates and suggested read lengths", async () => {
		const repeated = await failEdit("    a\n    b\n".repeat(6), [{ oldText: "a\nb", newText: "new" }]);
		expect(repeated.message).toContain("offset=9, limit=2");
		expect(repeated.message).not.toContain("offset=11");
		expect(repeated.message).toContain("showing first 5");
		const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
		const longBlock = await failEdit(lines.map((line) => `    ${line}`).join("\n"), [
			{ oldText: lines.join("\n"), newText: "new" },
		]);
		expect(longBlock.message).toContain("offset=1, limit=20");
	});

	it("skips detailed hints for oversized replacements or batches", async () => {
		const replacement = await failEdit("small", [{ oldText: "missing", newText: "z".repeat(32_001) }]);
		expect(replacement.message).not.toContain("Edit recovery");
		const batch = await failEdit(
			"small",
			Array.from({ length: 65 }, () => ({ oldText: "missing", newText: "new" })),
		);
		expect(batch.message).not.toContain("Edit recovery");
	});

	it("never computes recovery feedback on a successful edit", async () => {
		const spy = vi.spyOn(feedback, "addEditFailureFeedback");
		writeFileSync(join(dir, "target.txt"), "before\n");
		await createEditTool(dir).execute("success", {
			path: "target.txt",
			edits: [{ oldText: "before", newText: "after" }],
		});
		expect(spy).not.toHaveBeenCalled();
	});

	it("preserves an original exception if recovery diagnostics fail", () => {
		const error = new Error("original failure");
		const edits = [{ oldText: "missing", newText: "new" }];
		Object.defineProperty(edits[0], "oldText", {
			get: () => {
				throw new Error("diagnostic failure");
			},
		});
		expect(feedback.addEditFailureFeedback(error, "file", edits)).toBe(error);
	});

	it("rethrows a non-Error matching failure unchanged", async () => {
		const failure = { code: "original" };
		const edits = [{ oldText: "missing", newText: "new" }];
		Object.defineProperty(edits[0], "oldText", {
			get: () => {
				throw failure;
			},
		});
		writeFileSync(join(dir, "target.txt"), "original file");
		await expect(createEditTool(dir).execute("failure", { path: "target.txt", edits })).rejects.toBe(failure);
		expect(readFileSync(join(dir, "target.txt"), "utf8")).toBe("original file");
	});

	it("uses only the content read by custom operations and never writes on failure", async () => {
		const readFile = vi.fn(async () => Buffer.from("header\ndef f():\n    return 1\n"));
		const writeFile = vi.fn(async () => {});
		const tool = createEditTool(dir, { operations: { access: async () => {}, readFile, writeFile } });
		await expect(
			tool.execute("remote", {
				path: "remote.py",
				edits: [{ oldText: "def f():\nreturn 1", newText: "new" }],
			}),
		).rejects.toThrow("offset=2, limit=2");
		expect(readFile).toHaveBeenCalledTimes(1);
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("allows the next edit to recover after re-reading the indicated range", async () => {
		await failEdit("header\ndef f():\n    return 1\n", [{ oldText: "def f():\nreturn 1", newText: "new" }]);
		const oldText = readFileSync(join(dir, "target.txt"), "utf8").split("\n").slice(1, 3).join("\n");
		const result = await createEditTool(dir).execute("retry", {
			path: "target.txt",
			edits: [{ oldText, newText: "def f():\n    return 2" }],
		});
		expect(result.content).toEqual([{ type: "text", text: "Successfully replaced 1 block(s) in target.txt." }]);
		expect(readFileSync(join(dir, "target.txt"), "utf8")).toBe("header\ndef f():\n    return 2\n");
	});
});
