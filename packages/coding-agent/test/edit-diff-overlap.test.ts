import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditTool } from "../src/core/tools/edit.ts";
import { classifyEditMatchFailure } from "../src/core/tools/edit-match-observe.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "omk-edit-overlap-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const runEdit = async (file: string, edits: Array<{ oldText: string; newText: string }>) => {
	const p = join(dir, "target.txt");
	writeFileSync(p, file);
	try {
		await createEditTool(dir).execute("id", { path: "target.txt", edits });
		return { ok: true as const, file: readFileSync(p, "utf-8") };
	} catch (e) {
		return { ok: false as const, error: (e as Error).message, file: readFileSync(p, "utf-8") };
	}
};

describe("edit tool rejects oldText that matches at overlapping positions", () => {
	it.each([
		["self-overlapping run", "aaaa", "aaa"],
		["repeated closing braces", "function a() {\n\t\t}\n\t}\n\t}\n}\n", "\t}\n\t}\n"],
		["CRLF file", "x\r\nx\r\nx\r\n", "x\nx"],
		["BOM file", "\uFEFFaaaa", "aaa"],
		["fuzzy trailing whitespace", "a  \na  \na  \n", "a\na"],
	])("%s keeps the file and reports 2 occurrences", async (_name, file, oldText) => {
		const result = await runEdit(file, [{ oldText, newText: "Z" }]);
		expect(result).toMatchObject({ ok: false, file });
		expect(result.ok === false && result.error).toMatch(/Found 2 occurrences of the text in .*must be unique/);
	});

	it("still applies a unique match next to a near-overlap", async () => {
		expect(await runEdit("aaab", [{ oldText: "aaa", newText: "Z" }])).toEqual({ ok: true, file: "Zb" });
	});

	it("names the overlapping edit in a multi-edit call and writes nothing", async () => {
		const file = "head\naaaa\n";
		const result = await runEdit(file, [
			{ oldText: "head", newText: "HEAD" },
			{ oldText: "aaa", newText: "Z" },
		]);
		expect(result).toMatchObject({ ok: false, file });
		expect(result.ok === false && result.error).toMatch(/Found 2 occurrences of edits\[1\]/);
	});

	it("classifies an overlapping match as multiple_matches", () => {
		expect(classifyEditMatchFailure("aaaa", [{ oldText: "aaa", newText: "Z" }])).toEqual({
			reason: "multiple_matches",
			editIndex: 0,
		});
	});
});
