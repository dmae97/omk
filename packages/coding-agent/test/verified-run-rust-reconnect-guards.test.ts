import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireSessionOwnerLeaseSync } from "../src/core/session-owner-lease.ts";
import * as authorityClock from "../src/core/verified-run/authority-clock.ts";
import { openRunAuthority } from "../src/core/verified-run/authority-runtime.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import { nativeReconnectBinding } from "../src/core/verified-run/native-reconnect-binding.ts";
import { nativeWriter, waitUntil } from "./helpers/native-reconnect.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
beforeEach(() => {
	if (binary) vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary);
	vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe.skipIf(!binary)("native reconnect binding failures", () => {
	it("rejects wrong approval, revision, generation and execution without journal mutation or redispatch", async () => {
		const run = await nativeWriter(binary ?? "");
		try {
			const bytes = readFileSync(journalPath(run.runPath));
			await expect(
				run.coordinator.reconnect(run.command, { approvedContractDigest: "f".repeat(64) }),
			).rejects.toThrow(/approval/);
			for (const patch of [
				{ expectedRevision: 1 },
				{ expectedGeneration: 2 },
				{ executionId: "00000000-0000-4000-8000-000000000000" },
			]) {
				await expect(run.coordinator.reconnect({ ...run.command, ...patch }, run.approval)).rejects.toThrow(
					/stale|unavailable/,
				);
			}
			expect(readFileSync(journalPath(run.runPath))).toEqual(bytes);
			expect(run.attempts()).toBe("x");
		} finally {
			await run.cleanup();
		}
	}, 25_000);

	it.each(["bindingDigest", "hostBootId", "identity", "uncommitted"])(
		"refuses altered %s before recording reconnect or sending control",
		async (field) => {
			const run = await nativeWriter(binary ?? "");
			let original = "";
			let originalHead = "";
			const headPath = run.recordPath.replace(/\.jsonl$/, ".head");
			try {
				await waitUntil(() => run.record()?.detached === true);
				original = readFileSync(run.recordPath, "utf8");
				originalHead = readFileSync(headPath, "utf8");
				const rows = original
					.trimEnd()
					.split("\n")
					.map((s) => JSON.parse(s));
				if (field === "identity") rows[1].identity.startTicks = "1";
				else if (field === "uncommitted") rows.splice(2);
				else rows[0][field] = field === "bindingDigest" ? "f".repeat(64) : "00000000-0000-4000-8000-000000000000";
				const altered = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
				writeFileSync(run.recordPath, altered);
				writeFileSync(headPath, `${Buffer.byteLength(altered)}\n`);
				await expect(run.coordinator.reconnect(run.command, run.approval)).rejects.toThrow(/native_binding/);
				expect(run.coordinator.events("reconnect").some(({ event }) => event.kind === "reconnected")).toBe(false);
				expect(existsSync(run.recordPath.replace(/\.jsonl$/, ".cancel"))).toBe(false);
				expect(run.attempts()).toBe("x");
			} finally {
				if (original) writeFileSync(run.recordPath, original);
				if (originalHead) writeFileSync(headPath, originalHead);
				await run.cleanup();
			}
		},
		25_000,
	);

	it("fences a released observer and a superseded session incarnation", async () => {
		const run = await nativeWriter(binary ?? "");
		const authority = openRunAuthority(run.runPath);
		const owner = acquireSessionOwnerLeaseSync(journalPath(run.runPath));
		try {
			const binding = nativeReconnectBinding(run.runPath, run.before, run.command.executionId, owner, authority);
			const record = run.record();
			if (!record) throw new Error("record missing");
			expect(binding.assertRecord(record)).toBeUndefined();
			authority.store.register(authority.sessionId);
			expect(() => binding.assertRecord(record)).toThrow(/stale_owner/);
			authority.store.release();
			expect(() => binding.assertRecord(record)).toThrow(/stale_owner/);
			expect(run.attempts()).toBe("x");
		} finally {
			owner.release();
			authority.store.release();
			await run.cleanup();
		}
	}, 25_000);

	it("drains an operator cancellation and preserves the original generation and budget", async () => {
		const run = await nativeWriter(binary ?? "");
		try {
			const controller = new AbortController();
			controller.abort();
			const result = await run.coordinator.reconnect(run.command, { ...run.approval, signal: controller.signal });
			expect(result).toMatchObject({
				execution: "paused",
				settlement: "settled",
				generation: 1,
				activeExecutionIds: [],
			});
			expect(result.budget).toEqual(run.before.state.budget);
			expect(run.record()?.terminal).toMatchObject({ failure: "cancelled" });
			expect(existsSync(join(run.runPath, "writer", "output"))).toBe(false);
			expect(run.attempts()).toBe("x");
		} finally {
			await run.cleanup();
		}
	}, 25_000);

	it("never revives a revoked grant: reconnect only cancels and drains its existing effect", async () => {
		const run = await nativeWriter(binary ?? "");
		try {
			const authority = openRunAuthority(run.runPath);
			try {
				const grant = [...authority.store.state.grants.values()].find(
					(g) => g.commandId === run.command.executionId,
				);
				if (!grant) throw new Error("grant missing");
				expect(authority.store.cancel(grant.token)).toBe(true);
			} finally {
				authority.store.release();
			}
			const result = await run.coordinator.reconnect(run.command, run.approval);
			expect(result).toMatchObject({
				failure: "authorization_revoked",
				settlement: "settled",
				generation: 1,
				activeExecutionIds: [],
			});
			expect(run.record()?.terminal).toMatchObject({ failure: "cancelled" });
			expect(
				run.coordinator.inspectAuthority().records.filter(({ event }) => event.kind === "grant-reserved"),
			).toHaveLength(1);
		} finally {
			await run.cleanup();
		}
	}, 25_000);

	it("expires the original authorization instead of extending it for the new owner", async () => {
		const run = await nativeWriter(binary ?? "");
		try {
			const original = run.authorityBefore.records.find(({ event }) => event.kind === "grant-reserved")?.event;
			if (original?.kind !== "grant-reserved") throw new Error("grant missing");
			vi.spyOn(authorityClock, "createAuthorityClock").mockReturnValue(
				() => original.grant.token.authorizationDeadline + 1,
			);
			const result = await run.coordinator.reconnect(run.command, run.approval);
			expect(result).toMatchObject({ failure: "authorization_expired", settlement: "settled", generation: 1 });
			expect(run.record()?.terminal).toMatchObject({ failure: "cancelled" });
			expect(
				run.coordinator.inspectAuthority().records.filter(({ event }) => event.kind === "grant-reserved"),
			).toHaveLength(1);
		} finally {
			await run.cleanup();
		}
	}, 25_000);

	it("does not replenish an expired work budget", async () => {
		const run = await nativeWriter(binary ?? "", 4_000);
		try {
			await waitUntil(() => run.record()?.terminal != null, 8_000);
			const result = await run.coordinator.reconnect(run.command, run.approval);
			expect(result).toMatchObject({
				failure: "deadline",
				settlement: "settled",
				generation: 1,
				activeExecutionIds: [],
			});
			expect(result.budget).toEqual(run.before.state.budget);
			expect(run.attempts()).toBe("x");
		} finally {
			await run.cleanup();
		}
	}, 25_000);

	it("quarantines a lost host without inventing an outcome or dispatching a replacement", async () => {
		const run = await nativeWriter(binary ?? "");
		try {
			const record = run.record();
			if (!record) throw new Error("record missing");
			process.kill(record.host.pid, "SIGKILL");
			const result = await run.coordinator.reconnect(run.command, run.approval);
			expect(result).toMatchObject({ failure: "unsettled", settlement: "quarantined", generation: 1 });
			expect(result.activeExecutionIds).toEqual([run.command.executionId]);
			expect(result.verification).not.toBe("verified");
			expect(
				run.coordinator.inspectAuthority().records.filter(({ event }) => event.kind === "grant-reserved"),
			).toHaveLength(1);
		} finally {
			await run.cleanup();
		}
	}, 25_000);
});
