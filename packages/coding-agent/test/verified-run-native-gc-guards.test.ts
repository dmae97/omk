import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRunAuthority } from "../src/core/verified-run/authority-runtime.ts";
import { workspaceClaim } from "../src/core/verified-run/owned-execution.ts";
import * as recoveryClock from "../src/core/verified-run/recovery-clock.ts";
import { collectVerifiedRuns } from "../src/core/verified-run/run-gc.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";
import { ageNativeGcArtifacts, nativeGcCli, settledNativeVerifier } from "./helpers/native-gc.ts";
import { nativeWriter, waitUntil } from "./helpers/native-reconnect.ts";
import { nativeVerifier } from "./helpers/native-verifier.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
beforeEach(() => {
	if (binary) vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary);
	vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	syncBuiltinESMExports();
});

describe.skipIf(!binary)("native GC conservative boundaries", () => {
	it("retains a detached running writer and reconnects after actual source CLI GC", async () => {
		const run = await nativeWriter(binary!);
		try {
			const before = fs.readFileSync(run.recordPath);
			const authority = run.coordinator.inspectAuthority().records;
			const cli = nativeGcCli(run, true);
			expect(cli.status, cli.stderr).toBe(0);
			expect(JSON.parse(cli.stdout).nativeRecords).toEqual([
				expect.objectContaining({ action: "kept", reason: "unsettled" }),
			]);
			expect(fs.readFileSync(run.recordPath).subarray(0, before.length)).toEqual(before);
			expect(run.coordinator.inspectAuthority().records).toEqual(authority);
			run.release();
			expect((await run.coordinator.reconnect(run.command, run.approval)).verification).toBe("verified");
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("leaves a live authority owner and verifier completely untouched", async () => {
		const run = await nativeVerifier(binary!, {
			checks: [{ claimId: "check", argv: ["/bin/sh", "-c", "sleep 10; cat output.txt"], stdout: "candidate" }],
		});
		try {
			const before = run.coordinator.inspectAuthority().records;
			const cli = nativeGcCli(run, true);
			expect(cli.status, cli.stderr).toBe(0);
			expect(
				JSON.parse(cli.stdout).nativeRecords.every(
					(entry: { action: string; reason: string }) =>
						entry.action === "kept" && entry.reason === "authority_live",
				),
			).toBe(true);
			expect(run.coordinator.inspectAuthority().records).toEqual(before);
			expect(fs.existsSync(join(run.runPath, "candidate"))).toBe(true);
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("retains a paused run inside its budget and prunes only after the anchored cap expires", async () => {
		const run = await nativeVerifier(binary!);
		try {
			await run.kill();
			const controller = new AbortController();
			controller.abort();
			const state = await run.coordinator.reconnect(run.command(), {
				approvedContractDigest: run.digest,
				signal: controller.signal,
			});
			expect(state).toMatchObject({ execution: "paused", settlement: "settled" });
			ageNativeGcArtifacts(run);
			const before = collectVerifiedRuns(run.stateRoot, { olderThanMs: 0, execute: true });
			expect(before.nativeRecords.every((entry) => entry.action === "kept" && entry.reason === "recoverable")).toBe(
				true,
			);
			vi.spyOn(recoveryClock, "readRunClock").mockReturnValue({
				bootId: state.budget!.bootId,
				nowMs: state.budget!.verifyCapMs + 1,
			});
			const expired = collectVerifiedRuns(run.stateRoot, { olderThanMs: 0, execute: true });
			expect(expired.nativeRecords.every((entry) => entry.action === "pruned")).toBe(true);
			expect(fs.readdirSync(run.recordDir)).toEqual([]);
		} finally {
			vi.restoreAllMocks();
			await run.cleanup();
		}
	}, 30_000);

	it("does not prune a terminal journal whose authority still has an unresolved reservation", async () => {
		const run = await settledNativeVerifier(binary!);
		try {
			const authority = openRunAuthority(run.runPath);
			try {
				expect(
					authority.store.acquire({
						sessionId: authority.sessionId,
						incarnation: authority.incarnation,
						commandId: randomUUID(),
						intentDigest: digestObject({ pending: true }),
						claims: workspaceClaim(join(run.runPath, "candidate"), "read", 1),
						now: Date.now(),
						ttl: 30_000,
					}).status,
				).toBe("granted");
			} finally {
				authority.store.release();
			}
			const report = collectVerifiedRuns(run.stateRoot, { olderThanMs: 0, execute: true });
			expect(report.nativeRecords.every((entry) => entry.action === "kept")).toBe(true);
			expect(fs.existsSync(join(run.runPath, "candidate"))).toBe(true);
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("resumes GC after the actual source CLI is SIGKILLed with a durably retired payload", async () => {
		const run = await settledNativeVerifier(binary!);
		const id = fs
			.readdirSync(run.recordDir)
			.find((name) => name.endsWith(".jsonl"))!
			.slice(0, -6);
		const checkpoint = join(run.root, "gc-retired");
		const before = run.coordinator.inspectAuthority().records;
		const child = spawn(
			process.execPath,
			[
				"--import",
				"tsx",
				"--import",
				"./packages/coding-agent/test/fixtures/native-gc-stop.ts",
				"packages/coding-agent/src/cli.ts",
				"run",
				"gc",
				"--state-dir",
				run.stateRoot,
				"--older-than",
				"0ms",
				"--execute",
			],
			{
				cwd: run.repo,
				env: {
					...run.env,
					OMK_TEST_GC_HEAD: join(run.recordDir, `${id}.head`),
					OMK_TEST_GC_CHECKPOINT: checkpoint,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		const closed = once(child, "close");
		let diagnostic = "";
		child.stdout.on("data", (bytes) => {
			diagnostic += String(bytes);
		});
		child.stderr.on("data", (bytes) => {
			diagnostic += String(bytes);
		});
		try {
			await waitUntil(() => {
				if (child.exitCode !== null) throw new Error(`GC child exited before retirement: ${diagnostic}`);
				return fs.existsSync(checkpoint);
			});
			expect(fs.existsSync(join(run.recordDir, `${id}.gc.jsonl`))).toBe(true);
			child.kill("SIGKILL");
			await closed;
			const retry = nativeGcCli(run, true);
			expect(retry.status, retry.stderr).toBe(0);
			expect(fs.readdirSync(run.recordDir)).toEqual([]);
			expect(run.coordinator.inspectAuthority().records).toEqual(before);
			expect(run.coordinator.evidence("verifier").verified).toBe(true);
		} finally {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await closed;
			await run.cleanup();
		}
	}, 35_000);

	it("retries a partially removed bundle after durable retirement, even when its head was already removed", async () => {
		const run = await settledNativeVerifier(binary!);
		try {
			const path = fs.readdirSync(run.recordDir).find((name) => name.endsWith(".jsonl"))!;
			const id = path.slice(0, -6);
			const unlink = fs.unlinkSync;
			vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
				unlink(target);
				if (String(target) === join(run.recordDir, `${id}.head`))
					throw new Error("injected crash after head unlink");
			});
			syncBuiltinESMExports();
			const interrupted = collectVerifiedRuns(run.stateRoot, { olderThanMs: 0, execute: true });
			expect(interrupted.nativeRecords).toContainEqual(
				expect.objectContaining({ requestId: id, action: "kept", reason: "remove_failed" }),
			);
			expect(fs.existsSync(join(run.recordDir, `${id}.gc.jsonl`))).toBe(true);
			expect(fs.existsSync(join(run.recordDir, `${id}.head`))).toBe(false);
			vi.restoreAllMocks();
			syncBuiltinESMExports();
			const retry = nativeGcCli(run, true);
			expect(retry.status, retry.stderr).toBe(0);
			expect(JSON.parse(retry.stdout).nativeRecords).toContainEqual(
				expect.objectContaining({ requestId: id, action: "pruned" }),
			);
			expect(fs.readdirSync(run.recordDir)).toEqual([]);
			expect(run.coordinator.evidence("verifier").verified).toBe(true);
		} finally {
			vi.restoreAllMocks();
			syncBuiltinESMExports();
			await run.cleanup();
		}
	}, 30_000);
});
