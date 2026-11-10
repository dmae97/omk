import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { nativeWriter, waitUntil } from "./helpers/native-reconnect.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
beforeEach(() => {
	if (binary) vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary);
	vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!binary)("source CLI native reconnect", () => {
	it("survives a second owner crash, excludes a concurrent owner, and replays one command without a new generation", async () => {
		const run = await nativeWriter(binary ?? "");
		const args = [
			...run.prefix,
			"reconnect",
			"reconnect",
			"--approve",
			run.command.contractDigest,
			"--execution",
			run.command.executionId,
			"--revision",
			String(run.command.expectedRevision),
			"--generation",
			String(run.command.expectedGeneration),
			"--command-id",
			run.command.commandId,
			"--state-dir",
			run.stateRoot,
		];
		const launch = () => {
			const child = spawn(process.execPath, [...args, "--execute"], {
				cwd: run.repo,
				env: run.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			const closed = once(child, "close");
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (b: Buffer) => {
				stdout += b.toString();
			});
			child.stderr.on("data", (b: Buffer) => {
				stderr = (stderr + b.toString()).slice(-4096);
			});
			return { child, closed, output: () => ({ stdout, stderr }) };
		};
		let first: ReturnType<typeof launch> | undefined;
		let second: ReturnType<typeof launch> | undefined;
		try {
			const denied = spawnSync(process.execPath, args, {
				cwd: run.repo,
				env: run.env,
				encoding: "utf8",
				timeout: 15_000,
			});
			expect(denied.status, denied.stderr).toBe(2);
			first = launch();
			await waitUntil(() => run.coordinator.events("reconnect").some(({ event }) => event.kind === "reconnected"));
			const bytes = readFileSync(journalPath(run.runPath));
			const blocked = spawnSync(process.execPath, [...args, "--execute"], {
				cwd: run.repo,
				env: run.env,
				encoding: "utf8",
				timeout: 15_000,
			});
			expect(blocked.status, blocked.stderr).toBe(1);
			expect(readFileSync(journalPath(run.runPath))).toEqual(bytes);
			first.child.kill("SIGKILL");
			await first.closed;
			expect(run.record()?.terminal).toBeNull();
			const epochs = () =>
				run.coordinator.inspectAuthority().records.filter(({ event }) => event.kind === "authority-epoch-advanced")
					.length;
			const previousEpochs = epochs();
			second = launch();
			await waitUntil(() => epochs() > previousEpochs);
			run.release();
			const [exit] = await second.closed;
			expect(exit, second.output().stderr).toBe(0);
			expect(JSON.parse(second.output().stdout)).toMatchObject({
				verification: "verified",
				generation: 1,
				budget: run.before.state.budget,
			});
			expect(run.attempts()).toBe("x");
			expect(run.coordinator.events("reconnect").filter(({ event }) => event.kind === "reconnected")).toHaveLength(
				1,
			);
			expect(run.coordinator.events("reconnect").filter(({ event }) => event.kind === "dispatch")).toHaveLength(2);
		} finally {
			for (const entry of [first, second]) {
				if (!entry) continue;
				if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill("SIGKILL");
				await entry.closed;
			}
			await run.cleanup();
		}
	}, 40_000);
});
