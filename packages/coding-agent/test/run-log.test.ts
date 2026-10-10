import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindActiveRemainingBudget, RemainingBudget } from "../src/core/remaining-budget.ts";
import { appendRunLog, RUN_LOG_DIR_ENV, RUN_LOG_ROLE_ENV, runLogRole } from "../src/core/run-log.ts";

// spec 042: one opt-in directory; every feature appends its own <name>.jsonl.
const roots: string[] = [];
function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "omk-run-log-"));
	roots.push(root);
	return root;
}
const lines = (file: string) =>
	readFileSync(file, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);

afterEach(() => {
	bindActiveRemainingBudget(undefined);
	while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe("appendRunLog (spec 042)", () => {
	it("writes nothing and creates nothing when OMK_RUN_LOG_DIR is unset or blank", () => {
		const root = tempRoot();
		expect(appendRunLog("finish-check", { round: 1 }, { env: {} })).toBe(false);
		expect(appendRunLog("finish-check", { round: 1 }, { env: { [RUN_LOG_DIR_ENV]: "  " } })).toBe(false);
		expect(readdirSync(root)).toEqual([]);
	});

	it("appends one line per call to <dir>/<name>.jsonl, creating the directory", () => {
		const dir = join(tempRoot(), "nested", "logs");
		const env = { [RUN_LOG_DIR_ENV]: dir };
		expect(appendRunLog("finish-check", { round: 1, ids: [1, 2] }, { env, now: () => 1_700_000_000_000 })).toBe(true);
		expect(appendRunLog("finish-check", { round: 2 }, { env, now: () => 1_700_000_000_500 })).toBe(true);
		expect(lines(join(dir, "finish-check.jsonl"))).toEqual([
			{ round: 1, ids: [1, 2], t: 1_700_000_000_000, elapsedFraction: null, pid: process.pid, role: "lead" },
			{ round: 2, t: 1_700_000_000_500, elapsedFraction: null, pid: process.pid, role: "lead" },
		]);
	});

	it("stamps elapsedFraction from the shared run clock (spec 036)", () => {
		const dir = tempRoot();
		bindActiveRemainingBudget(new RemainingBudget({ budgetMs: 100_000, now: () => 40_000, startedAt: 0 }));
		appendRunLog("cache", { hit: 3 }, { env: { [RUN_LOG_DIR_ENV]: dir } });
		expect(lines(join(dir, "cache.jsonl"))[0].elapsedFraction).toBeCloseTo(0.4, 6);
	});

	it("marks worker lines and never lets a record overwrite the stamped fields", () => {
		const dir = tempRoot();
		const env = { [RUN_LOG_DIR_ENV]: dir, [RUN_LOG_ROLE_ENV]: "worker" };
		expect(runLogRole(env)).toBe("worker");
		expect(runLogRole({})).toBe("lead");
		appendRunLog("deliverable-guard", { t: 1, elapsedFraction: 9, pid: -1, role: "lead", kind: "restore" }, { env });
		expect(lines(join(dir, "deliverable-guard.jsonl"))[0]).toMatchObject({
			kind: "restore",
			elapsedFraction: null,
			pid: process.pid,
			role: "worker",
		});
		expect(lines(join(dir, "deliverable-guard.jsonl"))[0].t).toBeGreaterThan(Date.parse("2020-01-01"));
	});

	it("refuses names that could leave the directory or break the convention", () => {
		const root = tempRoot();
		const dir = join(root, "logs");
		for (const name of ["../escape", "x/y", "Finish", "", "-lead", "a".repeat(65)]) {
			expect(appendRunLog(name, { n: 1 }, { env: { [RUN_LOG_DIR_ENV]: dir } })).toBe(false);
		}
		expect(readdirSync(root)).toEqual([]);
	});

	it("returns false instead of throwing when the write fails", () => {
		const root = tempRoot();
		const notADir = join(root, "file");
		writeFileSync(notADir, "");
		expect(() => appendRunLog("finish-check", { n: 1 }, { env: { [RUN_LOG_DIR_ENV]: notADir } })).not.toThrow();
		expect(appendRunLog("finish-check", { n: 1 }, { env: { [RUN_LOG_DIR_ENV]: notADir } })).toBe(false);
		expect(existsSync(join(notADir, "finish-check.jsonl"))).toBe(false);
	});

	it("adds no env value to a line: records hold hashes, paths and numbers only", () => {
		const dir = tempRoot();
		const env = { [RUN_LOG_DIR_ENV]: dir, XAI_API_KEY: "xai-sentinel-value", HOME: "/home/sentinel" };
		appendRunLog("adaptorch-calls", { sha256: "ab12", tokens: 512 }, { env });
		const raw = readFileSync(join(dir, "adaptorch-calls.jsonl"), "utf8");
		expect(raw).not.toContain("xai-sentinel-value");
		expect(raw).not.toContain("/home/sentinel");
		expect(raw).not.toContain(dir);
		expect(Object.keys(JSON.parse(raw)).sort()).toEqual(
			["sha256", "tokens", "t", "elapsedFraction", "pid", "role"].sort(),
		);
	});
});
