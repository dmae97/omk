import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireSessionOwnerLeaseSync } from "../src/core/session-owner-lease.ts";
import * as authorityClock from "../src/core/verified-run/authority-clock.ts";
import { openRunAuthority } from "../src/core/verified-run/authority-runtime.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { nativeReconnectBinding } from "../src/core/verified-run/native-reconnect-binding.ts";
import { readRunClock } from "../src/core/verified-run/recovery-clock.ts";
import { nativeRequestId, readRustExecutionRecord } from "../src/core/verified-run/rust-host-record.ts";
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
const record = (run: Awaited<ReturnType<typeof nativeVerifier>>) =>
	readRustExecutionRecord(run.recordDir, nativeRequestId(run.executionId), 1024);

describe.skipIf(!binary)("verifier reconnect boundaries", () => {
	it("rejects stale bindings and changed environment without dispatch or journal mutation", async () => {
		const run = await nativeVerifier(binary!);
		try {
			await run.kill();
			const bytes = readFileSync(journalPath(run.runPath));
			const command = run.command();
			const approval = { approvedContractDigest: run.digest };
			for (const patch of [
				{ expectedRevision: 1 },
				{ expectedGeneration: 2 },
				{ executionId: "00000000-0000-4000-8000-000000000000" },
			])
				await expect(run.coordinator.reconnect({ ...command, ...patch }, approval)).rejects.toThrow(
					/stale|unavailable/,
				);
			await expect(run.coordinator.reconnect(command, { approvedContractDigest: "f".repeat(64) })).rejects.toThrow(
				/approval/,
			);
			vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "0");
			await expect(run.coordinator.reconnect(command, approval)).rejects.toThrow(/unsupported_boundary/);
			vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
			expect(readFileSync(journalPath(run.runPath))).toEqual(bytes);
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it.each(["bindingDigest", "legacy", "missing"])(
		"refuses %s native evidence before reconnect publication",
		async (field) => {
			const run = await nativeVerifier(binary!);
			const path = join(run.recordDir, `${nativeRequestId(run.executionId)}.jsonl`);
			const head = path.replace(/\.jsonl$/, ".head");
			let bytes: Buffer | undefined;
			let prefix: Buffer | undefined;
			try {
				await run.kill();
				await waitUntil(() => record(run)?.detached === true || record(run)?.terminal != null);
				bytes = readFileSync(path);
				prefix = readFileSync(head);
				const journal = readFileSync(journalPath(run.runPath));
				if (field === "missing") renameSync(path, `${path}.saved`);
				else if (field === "legacy") rmSync(head);
				else {
					const rows = bytes
						.toString()
						.trimEnd()
						.split("\n")
						.map((line) => JSON.parse(line));
					rows[0].bindingDigest = "f".repeat(64);
					const modified = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
					writeFileSync(path, modified);
					writeFileSync(head, `${Buffer.byteLength(modified)}\n`);
				}
				await expect(
					run.coordinator.reconnect(run.command(), { approvedContractDigest: run.digest }),
				).rejects.toThrow(/binding|missing|legacy/);
				expect(readFileSync(journalPath(run.runPath))).toEqual(journal);
				expect(existsSync(path.replace(/\.jsonl$/, ".cancel"))).toBe(false);
			} finally {
				if (field === "missing" && existsSync(`${path}.saved`)) renameSync(`${path}.saved`, path);
				else {
					if (bytes) writeFileSync(path, bytes, { mode: 0o600 });
					if (prefix) writeFileSync(head, prefix, { mode: 0o600 });
				}
				await run.cleanup();
			}
		},
		30_000,
	);

	it.each(["cancelled", "authorization_revoked", "authorization_expired"])(
		"drains %s without signing a check verdict",
		async (cause) => {
			const run = await nativeVerifier(binary!);
			try {
				await run.kill();
				const controller = new AbortController();
				if (cause === "cancelled") controller.abort();
				else {
					const authority = openRunAuthority(run.runPath);
					try {
						const grant = [...authority.store.state.grants.values()].find(
							(g) => g.commandId === run.executionId,
						)!;
						if (cause === "authorization_revoked") expect(authority.store.cancel(grant.token)).toBe(true);
						else
							vi.spyOn(authorityClock, "createAuthorityClock").mockReturnValue(
								() => grant.token.authorizationDeadline + 1,
							);
					} finally {
						authority.store.release();
					}
				}
				const before = run.snapshot()!.state;
				const result = await run.coordinator.reconnect(run.command(), {
					approvedContractDigest: run.digest,
					signal: controller.signal,
				});
				expect(result).toMatchObject({
					failure: cause,
					settlement: "settled",
					activeExecutionIds: [],
					generation: before.generation,
					candidateDigest: before.candidateDigest,
					verificationDeadlineMs: before.verificationDeadlineMs,
					receiptDigest: null,
				});
				expect(record(run)?.terminal?.kind).toBe("finished");
				expect(
					run.coordinator.inspectAuthority().records.filter((r) => r.event.kind === "grant-reserved"),
				).toHaveLength(2);
			} finally {
				await run.cleanup();
			}
		},
		30_000,
	);

	it("uses verification time remaining after the original work deadline", async () => {
		const run = await nativeVerifier(binary!, { workMs: 1500 });
		try {
			await run.kill();
			const budget = run.snapshot()!.state.budget!;
			await waitUntil(() => readRunClock().nowMs > budget.workDeadlineMs);
			const result = await run.coordinator.reconnect(run.command(), { approvedContractDigest: run.digest });
			expect(result.verification).toBe("verified");
			expect(result.budget).toEqual(budget);
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("does not replenish the original verification deadline", async () => {
		const run = await nativeVerifier(binary!, { verifyMs: 1500 });
		try {
			await run.kill();
			await waitUntil(() => record(run)?.terminal != null);
			const before = run.snapshot()!.state;
			const result = await run.coordinator.reconnect(run.command(), { approvedContractDigest: run.digest });
			expect(result).toMatchObject({
				failure: "deadline",
				settlement: "settled",
				generation: 1,
				receiptDigest: null,
				verificationDeadlineMs: before.verificationDeadlineMs,
			});
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it("fences a superseded observer and preserves the original verifier token", async () => {
		const run = await nativeVerifier(binary!);
		await run.kill();
		const authority = openRunAuthority(run.runPath);
		const owner = acquireSessionOwnerLeaseSync(journalPath(run.runPath));
		try {
			const binding = nativeReconnectBinding(run.runPath, run.snapshot()!, run.executionId, owner, authority);
			expect(binding.assertRecord(record(run)!)).toBeUndefined();
			authority.store.register(authority.sessionId);
			expect(() => binding.assertRecord(record(run)!)).toThrow(/stale_owner/);
		} finally {
			owner.release();
			authority.store.release();
			await run.cleanup();
		}
	}, 30_000);

	it("binds candidate, check identity and original timeout even when the argv is identical", async () => {
		const run = await nativeVerifier(binary!, {
			checks: [
				{ claimId: "first", argv: ["/bin/sh", "-c", "sleep 3; cat output.txt"], stdout: "candidate" },
				{ claimId: "other", argv: ["/bin/sh", "-c", "sleep 3; cat output.txt"], stdout: "candidate" },
			],
		});
		await run.kill();
		const authority = openRunAuthority(run.runPath);
		const owner = acquireSessionOwnerLeaseSync(journalPath(run.runPath));
		try {
			const original = run.snapshot()!;
			for (const field of ["candidate", "claim", "timeout"]) {
				const snapshot = {
					...original,
					state: {
						...original.state,
						...(field === "candidate" ? { candidateDigest: original.state.inputDigest } : {}),
					},
					records: original.records.map((row) =>
						row.event.kind === "dispatch" && row.event.executionId === run.executionId
							? {
									...row,
									event: {
										...row.event,
										...(field === "claim" ? { claimId: "other" } : {}),
										...(field === "timeout" ? { timeoutMs: row.event.timeoutMs! - 1 } : {}),
									},
								}
							: row,
					),
				};
				expect(() => nativeReconnectBinding(run.runPath, snapshot, run.executionId, owner, authority)).toThrow(
					/authority_binding/,
				);
			}
		} finally {
			owner.release();
			authority.store.release();
			await run.cleanup();
		}
	}, 30_000);

	it("keeps lost host outcomes quarantined instead of redispatching", async () => {
		const run = await nativeVerifier(binary!);
		try {
			await run.kill();
			process.kill(record(run)!.host.pid, "SIGKILL");
			const result = await run.coordinator.reconnect(run.command(), { approvedContractDigest: run.digest });
			expect(result).toMatchObject({
				failure: "unsettled",
				settlement: "quarantined",
				activeExecutionIds: [run.executionId],
				receiptDigest: null,
			});
			expect(run.snapshot()!.records.filter((r) => r.event.kind === "dispatch")).toHaveLength(2);
		} finally {
			await run.cleanup();
		}
	}, 30_000);
});
