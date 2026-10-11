import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fastCheckFile, findOnPath } from "../src/core/fast-check.ts";

// spec 034 requirement 2: existence, size and a quick syntax check, never longer than the timeout.
let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "omk-fast-check-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const file = (name: string, content: string) => {
	const path = join(dir, name);
	writeFileSync(path, content);
	return path;
};

describe("fastCheckFile: existence and size", () => {
	it("gives distinct reasons for missing, empty, directory and over-limit files", async () => {
		expect(await fastCheckFile(join(dir, "nope.txt"))).toMatchObject({ ok: false, reason: "missing" });
		expect(await fastCheckFile(file("empty.txt", ""))).toMatchObject({ ok: false, reason: "empty" });
		mkdirSync(join(dir, "sub.txt"));
		expect(await fastCheckFile(join(dir, "sub.txt"))).toMatchObject({ ok: false, reason: "not_file" });
		const big = file("big.c", "x".repeat(5069));
		expect(await fastCheckFile(big, { sizeLimit: { bytes: 5000, inclusive: false } })).toMatchObject({
			ok: false,
			reason: "size",
			size: 5069,
		});
	});

	it("applies strict and inclusive limits at the boundary", async () => {
		const path = file("data.comp", "x".repeat(2500));
		expect((await fastCheckFile(path, { sizeLimit: { bytes: 2500, inclusive: true } })).ok).toBe(true);
		expect((await fastCheckFile(path, { sizeLimit: { bytes: 2500, inclusive: false } })).ok).toBe(false);
	});

	it("checks only existence and size for other extensions, .xml included", async () => {
		const result = await fastCheckFile(file("model.xml", "<mujoco><worldbody>"));
		expect(result).toMatchObject({ ok: true, reason: undefined });
		expect(result.ms).toBeGreaterThanOrEqual(0);
	});
});

describe("fastCheckFile: content checks", () => {
	it("rejects broken JSON and accepts valid JSON", async () => {
		expect(await fastCheckFile(file("a.json", '{"a": 1,'))).toMatchObject({ ok: false, reason: "syntax:json" });
		expect((await fastCheckFile(file("b.json", '{"a": 1}'))).ok).toBe(true);
	});

	it.skipIf(!findOnPath("cc"))("rejects a .c file with a syntax error when cc exists", async () => {
		expect(await fastCheckFile(file("bad.c", "int main(void) { return 0 \n"))).toMatchObject({
			ok: false,
			reason: "syntax:cc",
		});
		expect((await fastCheckFile(file("good.c", "int main(void) { return 0; }\n"))).ok).toBe(true);
	});

	// Review of b0998ee: a header cc cannot find is not a syntax error, or a better newer file gets reverted.
	it.skipIf(!findOnPath("cc"))("counts a missing #include as unknown (ok), not syntax:cc", async () => {
		for (const include of ['"missing_dep.h"', "<omk_missing_dep_034.h>"]) {
			const path = file("needs.c", `#include ${include}\nint main(void) { return 0; }\n`);
			expect(await fastCheckFile(path)).toMatchObject({ ok: true, reason: "unknown:missing-header" });
		}
	});

	it.skipIf(!findOnPath("cc"))("finds an angle-bracket header next to the file (-I its directory)", async () => {
		mkdirSync(join(dir, "src"));
		writeFileSync(join(dir, "src", "local_dep.h"), "int dep(void);\n");
		const path = join(dir, "src", "main.c");
		writeFileSync(path, "#include <local_dep.h>\nint main(void) { return dep(); }\n");
		expect(await fastCheckFile(path)).toMatchObject({ ok: true, reason: undefined });
	});

	it.skipIf(!findOnPath("cc"))("still rejects a syntax error in a file whose headers are found", async () => {
		writeFileSync(join(dir, "ok_dep.h"), "int dep(void);\n");
		const path = file("broken.c", '#include "ok_dep.h"\nint main(void) { return dep() }\n');
		expect(await fastCheckFile(path)).toMatchObject({ ok: false, reason: "syntax:cc" });
	});

	it.skipIf(!findOnPath("python3"))("rejects a .py file with a syntax error and leaves no bytecode", async () => {
		expect(await fastCheckFile(file("bad.py", "def f(:\n  pass\n"))).toMatchObject({
			ok: false,
			reason: "syntax:python3",
		});
		expect((await fastCheckFile(file("good.py", "def f():\n  return 1\n"))).ok).toBe(true);
		expect(() => rmSync(join(dir, "__pycache__"))).toThrow();
	});

	it.skipIf(!findOnPath("bash"))("rejects a .sh file with a syntax error", async () => {
		expect(await fastCheckFile(file("bad.sh", "if then fi\n"))).toMatchObject({ ok: false, reason: "syntax:bash" });
		expect((await fastCheckFile(file("good.sh", "echo ok\n"))).ok).toBe(true);
	});

	it("counts a missing checker as unknown, which is ok", async () => {
		const result = await fastCheckFile(file("x.c", "int main(void) { return 0 \n"), {
			checkers: { ".c": { command: "omk-no-such-checker-034", args: (path) => [path] } },
		});
		expect(result).toMatchObject({ ok: true, reason: "unknown:no-checker" });
	});

	it("kills a hanging checker at the timeout and counts it as ok with unknown:timeout", async () => {
		const started = Date.now();
		const result = await fastCheckFile(file("slow.c", "int x;\n"), {
			timeoutMs: 300,
			checkers: { ".c": { command: "sh", args: () => ["-c", "sleep 30 & sleep 30"] } },
		});
		expect(result).toMatchObject({ ok: true, reason: "unknown:timeout" });
		expect(Date.now() - started).toBeLessThan(5000);
	});
});
