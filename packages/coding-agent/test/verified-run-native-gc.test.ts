import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectVerifiedRuns } from "../src/core/verified-run/run-gc.ts";
import { readRustExecutionRecord } from "../src/core/verified-run/rust-host-record.ts";
import { ageNativeGcArtifacts } from "./helpers/native-gc.ts";
import { waitUntil } from "./helpers/native-reconnect.ts";
import { nativeVerifier } from "./helpers/native-verifier.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
beforeEach(() => {
	if (binary) vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary);
	vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

async function hostsGone(run: Awaited<ReturnType<typeof nativeVerifier>>) {
	for (const name of readdirSync(run.recordDir).filter((name) => name.endsWith(".jsonl"))) {
		const record = readRustExecutionRecord(run.recordDir, name.slice(0, -6), 1024)!;
		await waitUntil(() => {
			try {
				const stat = readFileSync(`/proc/${record.host.pid}/stat`, "utf8");
				const fields = stat
					.slice(stat.lastIndexOf(")") + 2)
					.trim()
					.split(/\s+/);
				return fields[19] !== record.host.ticks || fields[0] === "Z" || fields[0] === "X";
			} catch {
				return true;
			}
		});
	}
}

function cliGc(run: Awaited<ReturnType<typeof nativeVerifier>>, execute: boolean) {
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			"tsx",
			"packages/coding-agent/src/cli.ts",
			"run",
			"gc",
			"--state-dir",
			run.stateRoot,
			"--older-than",
			"0ms",
			...(execute ? ["--execute"] : []),
		],
		{ cwd: run.repo, env: run.env, encoding: "utf8", timeout: 15_000 },
	);
	expect(result.status, result.stderr).toBe(0);
	return JSON.parse(result.stdout);
}

describe.skipIf(!binary)("native execution record retention and GC", () => {
	it("source CLI previews and prunes only terminal records, preserving evidence and completed reconnect replay", async () => {
		const run = await nativeVerifier(binary!, { mode: "receipt-written" });
		try {
			await run.kill();
			const command = run.command();
			const result = await run.coordinator.reconnect(command, { approvedContractDigest: run.digest });
			expect(result.verification).toBe("verified");
			await hostsGone(run);
			ageNativeGcArtifacts(run);
			const before = readdirSync(run.recordDir).sort();
			const authority = run.coordinator.inspectAuthority().records;
			const preview = cliGc(run, false);
			expect(preview, JSON.stringify({ now: Date.now(), preview })).toMatchObject({
				nativeRecords: [
					expect.objectContaining({ action: "prunable" }),
					expect.objectContaining({ action: "prunable" }),
				],
			});
			expect(readdirSync(run.recordDir).sort()).toEqual(before);
			const done = cliGc(run, true);
			expect(done.nativeRecords).toHaveLength(2);
			expect(done.nativeRecords.every((entry: { action: string }) => entry.action === "pruned")).toBe(true);
			expect(readdirSync(run.recordDir)).toEqual([]);
			expect(existsSync(join(run.runPath, "candidate"))).toBe(false);
			expect(run.coordinator.evidence("verifier").verified).toBe(true);
			expect(run.coordinator.artifact("verifier", result.candidateDigest!, "output.txt").toString()).toBe(
				"candidate",
			);
			expect(await run.coordinator.reconnect(command, { approvedContractDigest: run.digest })).toEqual(result);
			expect(run.coordinator.inspectAuthority().records).toEqual(authority);
			expect(cliGc(run, true).nativeRecords).toEqual([]);
		} finally {
			await run.cleanup();
		}
	}, 40_000);

	it("retains terminal output in the pre-attestation crash window and reconnects after actual CLI GC", async () => {
		const run = await nativeVerifier(binary!, { mode: "receipt-written" });
		try {
			await run.kill();
			await hostsGone(run);
			const before = readdirSync(run.recordDir).sort();
			const report = cliGc(run, true);
			expect(report).toMatchObject({
				nativeRecords: [
					expect.objectContaining({ action: "kept", reason: "recoverable" }),
					expect.objectContaining({ action: "kept", reason: "recoverable" }),
				],
			});
			expect(readdirSync(run.recordDir).sort()).toEqual(before);
			expect(
				(await run.coordinator.reconnect(run.command(), { approvedContractDigest: run.digest })).verification,
			).toBe("verified");
			expect(collectVerifiedRuns(run.stateRoot, { olderThanMs: 86_400_000, execute: true })).toMatchObject({
				nativeRecords: [
					expect.objectContaining({ action: "kept", reason: "recent" }),
					expect.objectContaining({ action: "kept", reason: "recent" }),
				],
			});
		} finally {
			await run.cleanup();
		}
	}, 40_000);
});
