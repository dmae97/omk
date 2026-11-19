import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { materializeRecord, recordLine } from "../src/core/verified-run/authority-journal.ts";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";
import { compactNativeAuthority as compact } from "./helpers/native-compaction.ts";
import { nativeWriter } from "./helpers/native-reconnect.ts";
import { nativeVerifier } from "./helpers/native-verifier.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
beforeEach(() => {
	if (binary) vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary);
	vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!binary || process.platform !== "linux")("native reconnect across authority compaction", () => {
	it("reconnects through the actual source CLI after two compactions without replacing the writer", async () => {
		const run = await nativeWriter(binary!);
		try {
			const original = compact(run.runPath, run.command.executionId);
			compact(run.runPath, run.command.executionId);
			expect(run.coordinator.inspectAuthority().records).toHaveLength(1);
			run.release();
			const cli = spawnSync(
				process.execPath,
				[
					...run.prefix,
					"reconnect",
					"reconnect",
					"--execute",
					"--approve",
					run.command.contractDigest,
					"--execution",
					run.command.executionId,
					"--revision",
					String(run.command.expectedRevision),
					"--generation",
					"1",
					"--command-id",
					run.command.commandId,
					"--state-dir",
					run.stateRoot,
				],
				{ cwd: run.repo, env: run.env, encoding: "utf8", timeout: 20_000 },
			);
			expect(cli.status, cli.stderr).toBe(0);
			expect(JSON.parse(cli.stdout)).toMatchObject({
				verification: "verified",
				generation: 1,
				budget: run.before.state.budget,
			});
			expect(
				AuthorityStore.inspect(authorityStorePath(run.stateRoot)).grants.get(original.token.grantSequence)?.token,
			).toEqual(original.token);
			expect(run.attempts()).toBe("x");
			expect(run.coordinator.events("reconnect").filter(({ event }) => event.kind === "dispatch")).toHaveLength(2);
		} finally {
			await run.cleanup();
		}
	}, 35_000);

	it("preserves cancellation across compaction and only drains the original writer", async () => {
		const run = await nativeWriter(binary!);
		try {
			const original = compact(run.runPath, run.command.executionId, true);
			compact(run.runPath, run.command.executionId);
			const result = await run.coordinator.reconnect(run.command, run.approval);
			expect(result).toMatchObject({
				failure: "authorization_revoked",
				settlement: "settled",
				generation: 1,
				activeExecutionIds: [],
			});
			expect(result.verification).not.toBe("verified");
			expect(run.record()?.terminal).toMatchObject({ failure: "cancelled" });
			expect(
				AuthorityStore.inspect(authorityStorePath(run.stateRoot)).grants.get(original.token.grantSequence)?.token,
			).toEqual(original.token);
			expect(run.attempts()).toBe("x");
			expect(run.coordinator.events("reconnect").filter(({ event }) => event.kind === "dispatch")).toHaveLength(1);
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("continues the original verifier and receipt after compacting its terminated grant", async () => {
		const run = await nativeVerifier(binary!, { mode: "receipt-written" });
		try {
			await run.kill();
			const before = run.snapshot()!;
			const original = compact(run.runPath, run.executionId);
			const result = await run.coordinator.reconnect(run.command(), { approvedContractDigest: run.digest });
			expect(result).toMatchObject({
				verification: "verified",
				generation: 1,
				candidateDigest: before.state.candidateDigest,
				verificationDeadlineMs: before.state.verificationDeadlineMs,
			});
			expect(
				AuthorityStore.inspect(authorityStorePath(run.stateRoot)).grants.get(original.token.grantSequence)?.token,
			).toEqual(original.token);
			expect(run.snapshot()!.records.filter(({ event }) => event.kind === "dispatch")).toHaveLength(2);
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("refuses legacy snapshots missing start provenance instead of inferring a fresh authorization", async () => {
		const run = await nativeWriter(binary!);
		try {
			compact(run.runPath, run.command.executionId);
			const path = authorityStorePath(run.stateRoot);
			const view = AuthorityStore.inspectJournal(path);
			const event = JSON.parse(JSON.stringify(view.records[0]!.event));
			for (const grant of event.state.grants) delete grant.startProvenance;
			const record = materializeRecord(view.records[0]!.seq, view.records[0]!.previous, event);
			const line = recordLine(record);
			writeFileSync(path, line);
			writeFileSync(
				`${path}.head`,
				`${JSON.stringify({ ...view.head, size: Buffer.byteLength(line), lastHash: record.hash })}\n`,
			);
			await expect(run.coordinator.reconnect(run.command, run.approval)).rejects.toThrow(
				/authority_history_missing/,
			);
			expect(run.coordinator.events("reconnect").some(({ event }) => event.kind === "reconnected")).toBe(false);
			expect(existsSync(run.recordPath.replace(/\.jsonl$/, ".cancel"))).toBe(false);
			expect(readFileSync(join(run.runPath, "writer", "attempts"), "utf8")).toBe("x");
		} finally {
			await run.cleanup();
		}
	}, 30_000);
});
