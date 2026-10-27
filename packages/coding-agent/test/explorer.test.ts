import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exploreCodebase } from "../src/core/explorer/explorer.ts";

const roots: string[] = [];

function fixture(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "omk-explorer-")));
	roots.push(root);
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "docs"), { recursive: true });
	mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
	writeFileSync(
		join(root, "src", "auth.ts"),
		[
			"// auth entry",
			"export function authenticateUser(token: string) {",
			"\treturn token.length > 0;",
			"}",
			"",
			"export function unrelated() {",
			"\treturn 1;",
			"}",
		].join("\n"),
	);
	writeFileSync(
		join(root, "src", "auth.test.ts"),
		'import { authenticateUser } from "./auth.ts";\nauthenticateUser("x");\n',
	);
	writeFileSync(join(root, "src", "other.ts"), "export const answer = 42;\n");
	writeFileSync(join(root, "docs", "auth.md"), "# authenticateUser\n\nHow to authenticateUser safely.\n");
	writeFileSync(join(root, "node_modules", "pkg", "skip.ts"), "export function authenticateUser() { return 0; }\n");
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("read-only codebase explorer", () => {
	it("returns matching files with line ranges, reasons and negative terms", async () => {
		const root = fixture();
		const result = await exploreCodebase({ cwd: root, question: "authenticateUser zzzz" });
		expect(result.files[0]?.path).toBe("src/auth.ts");
		expect(result.files[0]?.ranges[0]?.start).toBeLessThanOrEqual(2);
		expect(result.files[0]?.ranges[0]?.end).toBeGreaterThanOrEqual(2);
		expect(result.files[0]?.ranges[0]?.reason).toContain("authenticateuser");
		expect(result.negative).toEqual(["zzzz"]);
		expect(result.coverage.searched).toEqual(["authenticateuser", "zzzz"]);
		expect(result.coverage.visited).toContain("src/auth.ts");
		expect(result.coverage.visited).not.toContain("node_modules/pkg/skip.ts");
	});

	it("caps returned ranges and reports the truncation instead of hiding it", async () => {
		const root = fixture();
		const result = await exploreCodebase({ cwd: root, question: "authenticateUser", budget: { maxRangesTotal: 1 } });
		expect(result.files.flatMap((file) => file.ranges)).toHaveLength(1);
		expect(result.budget.truncated).toBe(true);
		expect(result.coverage.notVisited.length).toBeGreaterThan(0);
	});

	it("caps returned files and names the files it left out", async () => {
		const root = fixture();
		const result = await exploreCodebase({
			cwd: root,
			question: "authenticateUser",
			budget: { maxFilesReturned: 1 },
		});
		expect(result.files).toHaveLength(1);
		expect(result.coverage.notVisited.length).toBeGreaterThan(0);
		expect(result.budget.truncated).toBe(true);
	});

	it("returns no files and marks every term negative when nothing matches", async () => {
		const root = fixture();
		const result = await exploreCodebase({ cwd: root, question: "zzzz" });
		expect(result.files).toEqual([]);
		expect(result.negative).toEqual(["zzzz"]);
		expect(result.budget.truncated).toBe(false);
	});

	it("is deterministic for the same question and budget", async () => {
		const root = fixture();
		const first = await exploreCodebase({ cwd: root, question: "authenticateUser" });
		const second = await exploreCodebase({ cwd: root, question: "authenticateUser" });
		expect(first).toEqual(second);
	});
});
