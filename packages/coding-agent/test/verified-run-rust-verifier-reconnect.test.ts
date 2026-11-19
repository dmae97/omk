import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
describe.skipIf(!binary || process.platform !== "linux")("native verifier reconnect", () => {
	it("recovers the source CLI verifier without another dispatch or grant", async () => {
		vi.stubEnv("OMK_RUST_EXECUTION_HOST", binary!);
		vi.stubEnv("OMK_RUST_EXECUTION_RECONNECT", "1");
		const fixture = await nativeVerifier(binary!);
		try {
			await fixture.kill();
			const before = fixture.snapshot()!;
			const command = fixture.command();
			const result = await fixture.coordinator.reconnect(command, { approvedContractDigest: fixture.digest });
			expect(result.verification).toBe("verified");
			expect(result.generation).toBe(before.state.generation);
			expect(result.candidateDigest).toBe(before.state.candidateDigest);
			expect(result.verificationDeadlineMs).toBe(before.state.verificationDeadlineMs);
			expect(fixture.snapshot()!.records.filter((r) => r.event.kind === "dispatch")).toHaveLength(2);
			expect(
				fixture.coordinator.inspectAuthority().records.filter((r) => r.event.kind === "grant-reserved"),
			).toHaveLength(2);
			expect(await fixture.coordinator.reconnect(command, { approvedContractDigest: fixture.digest })).toEqual(
				result,
			);
		} finally {
			await fixture.cleanup();
			vi.unstubAllEnvs();
		}
	}, 30_000);

	it("refuses an altered durable receipt instead of replacing it or redispatching", async () => {
		const fixture = await nativeVerifier(binary!, { mode: "receipt-written" });
		try {
			await fixture.kill();
			const receipts = join(fixture.runPath, "receipts");
			const name = readdirSync(receipts)[0]!;
			writeFileSync(join(receipts, name), "{}");
			const result = await fixture.coordinator.reconnect(fixture.command(), {
				approvedContractDigest: fixture.digest,
			});
			expect(result).toMatchObject({ failure: "integrity", receiptDigest: null, verification: "inconclusive" });
			expect(readFileSync(join(receipts, name), "utf8")).toBe("{}");
			expect(fixture.snapshot()!.records.filter((r) => r.event.kind === "dispatch")).toHaveLength(2);
		} finally {
			await fixture.cleanup();
		}
	}, 30_000);

	it("retains a failed check verdict without treating reconnection as a pass", async () => {
		const fixture = await nativeVerifier(binary!, {
			mode: "receipt-written",
			checks: [{ claimId: "failure", argv: ["/bin/sh", "-c", "printf wrong; exit 7"], stdout: "candidate" }],
		});
		try {
			await fixture.kill();
			const names = readdirSync(join(fixture.runPath, "receipts"));
			const result = await fixture.coordinator.reconnect(fixture.command(), {
				approvedContractDigest: fixture.digest,
			});
			expect(result.verification).toBe("violated");
			expect(readdirSync(join(fixture.runPath, "receipts"))).toEqual(names);
		} finally {
			await fixture.cleanup();
		}
	}, 30_000);

	it.each(["exit-written", "receipt-written"] as const)(
		"recovers at %s without duplicate receipt publication",
		async (mode) => {
			const fixture = await nativeVerifier(binary!, { mode });
			try {
				await fixture.kill();
				const receipts = join(fixture.runPath, "receipts");
				const before = existsSync(receipts) ? readdirSync(receipts).sort() : [];
				expect(before).toHaveLength(mode === "receipt-written" ? 1 : 0);
				const result = await fixture.coordinator.reconnect(fixture.command(), {
					approvedContractDigest: fixture.digest,
				});
				expect(result.verification).toBe("verified");
				expect(readdirSync(receipts)).toHaveLength(1);
				if (before.length) expect(readdirSync(receipts).sort()).toEqual(before);
				expect(fixture.snapshot()!.records.filter((r) => r.event.kind === "dispatch")).toHaveLength(2);
			} finally {
				await fixture.cleanup();
			}
		},
		30_000,
	);
});
