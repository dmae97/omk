import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorityStore, authorityStorePath } from "../src/core/verified-run/authority-store.ts";
import { journalPath } from "../src/core/verified-run/journal.ts";
import * as recoveryClock from "../src/core/verified-run/recovery-clock.ts";
import { digestObject, VerifiedRunError } from "../src/core/verified-run/storage.ts";
import { compactNativeAuthority } from "./helpers/native-compaction.ts";
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
});

it("keeps an expired tombstone's disposition while its settled grant is retained, then drops the pair", () => {
	const root = mkdtempSync(join(tmpdir(), "grant-retention-"));
	let retain = true;
	const store = AuthorityStore.open(authorityStorePath(root), {
		capacity: 1,
		clock: () => 100,
		retainGrant: () => retain,
	});
	try {
		store.reconcile();
		const incarnation = store.register("session");
		const input = {
			sessionId: "session",
			incarnation,
			commandId: "execution",
			intentDigest: digestObject("intent"),
			claims: [
				{
					namespace: "filesystem",
					instanceId: "test",
					canonicalKey: "workspace",
					access: "write" as const,
					generation: "1",
				},
			],
			now: 100,
			ttl: 100,
		};
		const result = store.acquire(input);
		if (result.status !== "granted") throw new Error("grant missing");
		expect(store.effectStarted(result.token, input.claims)).toBe(true);
		expect(store.confirmTerminated(result.token)).toBe(true);
		store.retainResult(input.commandId, digestObject("result"), 100, 10);
		expect(store.compact(200).dropped).toBe(0);
		expect(store.lookup(input.commandId, 200).status).toBe("result-expired");
		expect(store.acquire({ ...input, now: 200 }).status).toBe("result-expired");
		expect(store.state.grants.get(result.token.grantSequence)?.token).toEqual(result.token);
		expect(store.effectStarted(result.token, input.claims)).toBe(false);
		retain = false;
		expect(store.compact(200).dropped).toBe(2);
		expect(store.lookup(input.commandId, 200).status).toBe("unknown");
		expect(store.state.grantCounter).toBe(result.token.grantSequence);
	} finally {
		store.release();
		rmSync(root, { recursive: true, force: true });
	}
});

describe.skipIf(!binary || process.platform !== "linux")("recoverable run grant retention", () => {
	it("preserves a terminal writer grant in the pre-candidate crash window", async () => {
		const run = await nativeWriter(binary!);
		try {
			run.release();
			await waitUntil(() => run.record()?.terminal != null);
			const original = compactNativeAuthority(run.runPath, run.command.executionId);
			expect(
				AuthorityStore.inspect(authorityStorePath(run.stateRoot)).grants.get(original.token.grantSequence)?.token,
			).toEqual(original.token);
			expect((await run.coordinator.reconnect(run.command, run.approval)).verification).toBe("verified");
			expect(run.attempts()).toBe("x");
		} finally {
			await run.cleanup();
		}
	}, 30_000);
	it.each(["exit-written", "receipt-written"] as const)(
		"recovers at %s after compaction without synthetic result retention",
		async (mode) => {
			const run = await nativeVerifier(binary!, { mode });
			try {
				await run.kill();
				const command = run.command();
				const before = run.snapshot()!.state;
				const grant = compactNativeAuthority(run.runPath, run.executionId);
				expect(
					AuthorityStore.inspect(authorityStorePath(run.stateRoot)).grants.get(grant.token.grantSequence),
				).toEqual(grant);
				const result = await run.coordinator.reconnect(command, { approvedContractDigest: run.digest });
				expect(result).toMatchObject({
					verification: "verified",
					generation: before.generation,
					candidateDigest: before.candidateDigest,
					verificationDeadlineMs: before.verificationDeadlineMs,
				});
				expect(run.snapshot()!.records.filter(({ event }) => event.kind === "dispatch")).toHaveLength(2);
			} finally {
				await run.cleanup();
			}
		},
		30_000,
	);

	it("heals a compaction rewrite crash with the original verifier grant intact", async () => {
		const run = await nativeVerifier(binary!, { mode: "exit-written" });
		try {
			await run.kill();
			const command = run.command();
			expect(() =>
				compactNativeAuthority(run.runPath, run.executionId, false, {
					afterAtomicRewrite() {
						throw new Error("after rewrite");
					},
				}),
			).toThrow(/after rewrite/);
			const result = await run.coordinator.reconnect(command, { approvedContractDigest: run.digest });
			expect(result.verification).toBe("verified");
			expect(run.snapshot()!.records.filter(({ event }) => event.kind === "dispatch")).toHaveLength(2);
		} finally {
			await run.cleanup();
		}
	}, 30_000);

	it.each(["clock", "journal"] as const)(
		"keeps grants when %s recovery evidence cannot be decided",
		async (kind) => {
			const run = await nativeVerifier(binary!, { mode: "exit-written" });
			let original: Buffer | undefined;
			try {
				await run.kill();
				original = readFileSync(journalPath(run.runPath));
				if (kind === "clock")
					vi.spyOn(recoveryClock, "readRunClock").mockImplementation(() => {
						throw new VerifiedRunError("clock_unavailable");
					});
				else appendFileSync(journalPath(run.runPath), "damaged\n");
				const grant = compactNativeAuthority(run.runPath, run.executionId);
				expect(
					AuthorityStore.inspect(authorityStorePath(run.stateRoot)).grants.get(grant.token.grantSequence),
				).toEqual(grant);
			} finally {
				vi.restoreAllMocks();
				if (original) writeFileSync(journalPath(run.runPath), original);
				await run.cleanup();
			}
		},
		30_000,
	);

	it("releases settled grants only after the original recovery cap, without moving that cap", async () => {
		const run = await nativeVerifier(binary!, { mode: "exit-written" });
		try {
			await run.kill();
			const before = run.snapshot()!.state;
			const budget = before.budget!;
			vi.spyOn(recoveryClock, "readRunClock").mockReturnValue({
				bootId: budget.bootId,
				nowMs: budget.verifyCapMs + 1,
			});
			const grant = compactNativeAuthority(run.runPath, run.executionId);
			expect(AuthorityStore.inspect(authorityStorePath(run.stateRoot)).grants.has(grant.token.grantSequence)).toBe(
				false,
			);
			expect(run.snapshot()!.state.budget).toEqual(budget);
		} finally {
			vi.restoreAllMocks();
			await run.cleanup();
		}
	}, 30_000);
});
