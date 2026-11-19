import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeWriter, waitUntil } from "./helpers/native-reconnect.ts";

const binary = process.env.EXECUTION_HOST_TEST_BINARY;
beforeEach(() => {
	if (binary) vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary);
	vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!binary)("Rust writer reconnect through original durable authority", () => {
	it("continues the live execution with the same grant, execution ID, generation and budget", async () => {
		const run = await nativeWriter(binary ?? "");
		try {
			await waitUntil(() => run.record()?.detached === true || run.record()?.terminal != null, 2_000);
			expect(run.record()?.detached).toBe(true);
			expect(run.record()?.terminal).toBeNull();
			const pending = run.coordinator.reconnect(run.command, run.approval);
			run.release();
			const result = await pending;
			expect(result).toMatchObject({
				generation: run.before.state.generation,
				verification: "verified",
				settlement: "settled",
			});
			expect(result.budget).toEqual(run.before.state.budget);
			expect(run.attempts()).toBe("x");
			expect(existsSync(join(run.runPath, "writer-2"))).toBe(false);
			expect(existsSync(join(run.workspace, "output"))).toBe(false);
			const dispatches = run.coordinator.events("reconnect").filter(({ event }) => event.kind === "dispatch");
			expect(dispatches).toHaveLength(2);
			expect(dispatches[0]?.event).toMatchObject({ executionId: run.command.executionId });
			const original = run.authorityBefore.records.find(({ event }) => event.kind === "grant-reserved")?.event;
			if (original?.kind !== "grant-reserved") throw new Error("missing original grant");
			const reservations = run.coordinator
				.inspectAuthority()
				.records.filter(({ event }) => event.kind === "grant-reserved");
			expect(reservations).toHaveLength(2);
			expect(reservations[0]?.event).toEqual(original);
			const journal = readFileSync(join(run.runPath, "journal.v2.jsonl"));
			expect(await run.coordinator.reconnect(run.command, run.approval)).toEqual(result);
			expect(readFileSync(join(run.runPath, "journal.v2.jsonl"))).toEqual(journal);
			const attestation = join(run.runPath, "attestations", `${result.receiptDigest}.json`);
			writeFileSync(attestation, "{}");
			await expect(run.coordinator.reconnect(run.command, run.approval)).rejects.toThrow(/integrity/);
		} finally {
			await run.cleanup();
		}
	}, 30_000);
});
