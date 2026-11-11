import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeRequestId, readRustExecutionRecord } from "../src/core/verified-run/rust-host-record.ts";
import { waitUntil } from "./helpers/native-reconnect.ts";
import { nativeVerifier } from "./helpers/native-verifier.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
beforeEach(() => {
	if (binary) vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary);
	vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!binary)("source CLI verifier continuation", () => {
	it("reuses partial receipts and dispatches only never-started checks", async () => {
		const run = await nativeVerifier(binary!, {
			targetClaim: "second",
			checks: [
				{ claimId: "first", argv: ["/bin/cat", "output.txt"], stdout: "candidate" },
				{ claimId: "second", argv: ["/bin/sh", "-c", "sleep 3; cat output.txt"], stdout: "candidate" },
				{ claimId: "third", argv: ["/bin/cat", "output.txt"], stdout: "candidate" },
			],
		});
		try {
			await run.kill();
			const before = readdirSync(join(run.runPath, "receipts"));
			expect(before).toHaveLength(1);
			const reservations = run.coordinator
				.inspectAuthority()
				.records.filter((r) => r.event.kind === "grant-reserved");
			const result = await run.coordinator.reconnect(run.command(), { approvedContractDigest: run.digest });
			expect(result.verification).toBe("verified");
			expect(readdirSync(join(run.runPath, "receipts"))).toEqual(expect.arrayContaining(before));
			expect(readdirSync(join(run.runPath, "receipts"))).toHaveLength(3);
			const after = run.coordinator.inspectAuthority().records.filter((r) => r.event.kind === "grant-reserved");
			expect(after).toHaveLength(4);
			expect(after.slice(0, reservations.length)).toEqual(reservations);
			expect(run.snapshot()!.records.filter((r) => r.event.kind === "dispatch")).toHaveLength(4);
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("survives another source CLI parent crash during the next check, with exclusive ownership and idempotent replay", async () => {
		const run = await nativeVerifier(binary!, {
			verifyMs: 30_000,
			checks: [
				{ claimId: "first", argv: ["/bin/sh", "-c", "sleep 5; cat output.txt"], stdout: "candidate" },
				{ claimId: "second", argv: ["/bin/sh", "-c", "sleep 8; cat output.txt"], stdout: "candidate" },
			],
		});
		await run.kill();
		const command = run.command();
		const args = [
			"--import",
			"tsx",
			"packages/coding-agent/src/cli.ts",
			"run",
			"reconnect",
			"verifier",
			"--execute",
			"--approve",
			run.digest,
			"--execution",
			command.executionId,
			"--revision",
			String(command.expectedRevision),
			"--generation",
			String(command.expectedGeneration),
			"--command-id",
			command.commandId,
			"--state-dir",
			run.stateRoot,
		];
		const launch = () => {
			const child = spawn(process.execPath, args, {
				cwd: run.repo,
				env: run.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			const closed = once(child, "close");
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (bytes) => {
				stdout += String(bytes);
			});
			child.stderr.on("data", (bytes) => {
				stderr += String(bytes);
			});
			return { child, closed, output: () => ({ stdout, stderr }) };
		};
		const children: ReturnType<typeof launch>[] = [];
		try {
			const first = launch();
			children.push(first);
			await waitUntil(() => run.snapshot()!.records.some((r) => r.event.kind === "reconnected"));
			const blocked = launch();
			children.push(blocked);
			expect((await blocked.closed)[0], blocked.output().stderr).toBe(1);
			let secondId = "";
			await waitUntil(() => {
				const dispatch = run
					.snapshot()!
					.records.find((r) => r.event.kind === "dispatch" && r.event.claimId === "second")?.event;
				if (dispatch?.kind !== "dispatch") return false;
				secondId = dispatch.executionId;
				try {
					return !!readRustExecutionRecord(run.recordDir, nativeRequestId(secondId), 1024)?.committed;
				} catch {
					return false;
				}
			});
			first.child.kill("SIGKILL");
			await first.closed;
			expect(readdirSync(join(run.runPath, "receipts"))).toHaveLength(1);
			const second = launch();
			children.push(second);
			expect((await second.closed)[0], second.output().stderr).toBe(0);
			expect(JSON.parse(second.output().stdout)).toMatchObject({ verification: "verified", generation: 1 });
			expect(run.snapshot()!.records.filter((r) => r.event.kind === "reconnected")).toHaveLength(1);
			expect(run.snapshot()!.records.filter((r) => r.event.kind === "dispatch")).toHaveLength(3);
			expect(
				run.coordinator.inspectAuthority().records.filter((r) => r.event.kind === "grant-reserved"),
			).toHaveLength(3);
			expect(existsSync(join(run.runPath, "candidate-2"))).toBe(false);
			const replay = launch();
			children.push(replay);
			expect((await replay.closed)[0], replay.output().stderr).toBe(0);
			expect(JSON.parse(replay.output().stdout)).toEqual(JSON.parse(second.output().stdout));
		} finally {
			for (const entry of children) {
				if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill("SIGKILL");
				await entry.closed;
			}
			await run.cleanup();
		}
	}, 45_000);
});
