import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DELIVERABLE_MAX_COUNT,
	extractDeliverables,
	resolveDeliverableGuardMode,
} from "../src/core/deliverable-guard.ts";

// spec 034 requirement 1, run on the real Terminal-Bench 2 instruction.md text.
const fixture = (task: string) => readFileSync(join(__dirname, "fixtures", "deliverables", `${task}.md`), "utf8");
const CWD = "/app";
const MiB = 1024 * 1024;

const TARGETS: Record<string, string> = {
	"write-compressor": "/app/data.comp",
	"gpt2-codegolf": "/app/gpt2.c",
	"path-tracing-reverse": "/app/mystery.c",
	"break-filter-js-from-html": "/app/out.html",
	"extract-moves-from-video": "/app/solution.txt",
	"train-fasttext": "/app/model.bin",
	"tune-mjcf": "/app/model.xml",
};
const INPUTS = ["/app/decomp.c", "/app/filter.py", "/app/model_ref.xml", "/app/a.out", "/app/data.txt", "/app/mystery"];

describe("extractDeliverables: target prompts", () => {
	for (const [task, path] of Object.entries(TARGETS)) {
		it(`${task} gives exactly ${path}`, () => {
			const found = extractDeliverables(fixture(task), CWD).map((d) => d.path);
			expect(found).toEqual([path]);
			for (const input of INPUTS) expect(found).not.toContain(input);
		});
	}

	it("reads size limits: 2500 inclusive, 5000 strict, 150 MiB strict, none for gzip size", () => {
		const limit = (task: string) => extractDeliverables(fixture(task), CWD)[0]?.sizeLimit;
		expect(limit("write-compressor")).toEqual({ bytes: 2500, inclusive: true });
		expect(limit("gpt2-codegolf")).toEqual({ bytes: 5000, inclusive: false });
		expect(limit("train-fasttext")).toEqual({ bytes: 150 * MiB, inclusive: false });
		expect(limit("path-tracing-reverse")).toBeUndefined();
		expect(limit("tune-mjcf")).toBeUndefined();
	});
});

describe("extractDeliverables: rules", () => {
	it("applies an unnamed size sentence to neither of two deliverables", () => {
		const prompt = "Write /app/a.c first. Save the table as /app/b.json. The file must be at most 100 bytes.";
		const found = extractDeliverables(prompt, CWD);
		expect(found.map((d) => d.path)).toEqual(["/app/a.c", "/app/b.json"]);
		expect(found.every((d) => d.sizeLimit === undefined)).toBe(true);
	});

	it("applies a size sentence that names one of two deliverables by basename to that one only", () => {
		const prompt = "Write /app/a.c first. Save the table as /app/b.json. Keep a.c under 3 KB.";
		const found = extractDeliverables(prompt, CWD);
		expect(found[0].sizeLimit).toEqual({ bytes: 3072, inclusive: false });
		expect(found[1].sizeLimit).toBeUndefined();
	});

	it("ignores paths in fenced code and indented lines", () => {
		const prompt = [
			"Read the notes.",
			"```",
			"write /app/fenced.txt",
			"```",
			"    save it to /app/indented.txt",
			"Then create /app/real.txt.",
		].join("\n");
		expect(extractDeliverables(prompt, CWD).map((d) => d.path)).toEqual(["/app/real.txt"]);
	});

	it("skips directories and keeps at most four deliverables in prompt order", () => {
		const prompt =
			"Write output into /app/out/ please. Create /app/1.txt, /app/2.txt.\nSave /app/3.txt.\nStore /app/4.txt.\nWrite /app/5.txt.\nPlace /app/6.txt.";
		const found = extractDeliverables(prompt, CWD).map((d) => d.path);
		expect(found).toEqual(["/app/1.txt", "/app/3.txt", "/app/4.txt", "/app/5.txt"]);
		expect(found).toHaveLength(DELIVERABLE_MAX_COUNT);
	});

	it("resolves relative names against cwd and accepts call/name as produce words", () => {
		expect(extractDeliverables("Name the result out/result.json.", "/work").map((d) => d.path)).toEqual([
			"/work/out/result.json",
		]);
	});

	it("finds nothing in a prompt without a produce word", () => {
		expect(extractDeliverables("Fix the failing test in /app/src/main.py.", CWD)).toEqual([]);
	});
});

describe("resolveDeliverableGuardMode", () => {
	it("is off unless set; on/1/true/enable/enabled = headless; always = every session", () => {
		for (const value of [undefined, "", "0", "off", "false", "nonsense"])
			expect(resolveDeliverableGuardMode(value)).toBe("off");
		for (const value of ["on", "1", "true", "enable", "enabled", " ON "])
			expect(resolveDeliverableGuardMode(value)).toBe("headless");
		expect(resolveDeliverableGuardMode("always")).toBe("always");
	});
});
