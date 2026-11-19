import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectVerifiedRuns } from "../src/core/verified-run/run-gc.ts";
import { nativeExecutionDir, readRustExecutionRecord } from "../src/core/verified-run/rust-host-record.ts";
import { privateStateRoot } from "./helpers/native-storage.ts";

const obsolete = { olderThanMs: 0, execute: true, obsolete: true } as const;

describe("obsolete native execution records", () => {
	it("deletes an obsolete legacy record and its companions while preserving invalid and live records", () => {
		const root = privateStateRoot();
		const dir = nativeExecutionDir(root);
		const record = readRustExecutionRecord(dir, "a".repeat(32), 1024)!;
		expect(record.terminal).not.toBeNull();
		expect(record.bindingDigest).toBeNull();
		const before = collectVerifiedRuns(root, { olderThanMs: 0, execute: false, obsolete: false });
		expect(before.nativeRecords.every((entry) => entry.action === "kept" && entry.reason === "unreferenced")).toBe(
			true,
		);
		const report = collectVerifiedRuns(root, obsolete);
		expect(report.nativeRecords).toEqual([
			expect.objectContaining({
				action: "pruned",
				reason: null,
				paths: expect.arrayContaining([
					`native-exec/${"a".repeat(32)}.jsonl`,
					`native-exec/${"a".repeat(32)}.head`,
				]),
			}),
			expect.objectContaining({
				action: "kept",
				reason: "integrity",
				paths: expect.arrayContaining([
					`native-exec/${"b".repeat(32)}.jsonl`,
					`native-exec/${"b".repeat(32)}.head`,
				]),
			}),
			expect.objectContaining({
				action: "kept",
				reason: "native_live",
				paths: expect.arrayContaining([
					`native-exec/${"c".repeat(32)}.jsonl`,
					`native-exec/${"c".repeat(32)}.head`,
				]),
			}),
		]);
	});

	it("supports explicit --prune-obsolete on the real source CLI without deleting recoverable state", () => {
		const root = privateStateRoot();
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				"tsx",
				"packages/coding-agent/src/cli.ts",
				"run",
				"gc",
				"--state-dir",
				root,
				"--older-than",
				"0ms",
				"--prune-obsolete",
				"--execute",
			],
			{ cwd: resolve("..", ".."), encoding: "utf8", timeout: 15_000 },
		);
		expect(result.status, result.stderr).toBe(0);
		const report = JSON.parse(result.stdout);
		expect(report.nativeRecords.some((entry: { action: string }) => entry.action === "pruned")).toBe(true);
		expect(result.stdout).toContain("nativeRecords");
		const nativeDir = nativeExecutionDir(root);
		expect(existsSync(join(nativeDir, `${"a".repeat(32)}.jsonl`))).toBe(false);
	});
});
