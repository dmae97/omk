import { describe, expect, it } from "vitest";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";
import { signWallReceipt, verifyWallReceipt } from "../src/receipt-signature.ts";
import { buildVerificationDigest } from "../src/signed-receipt.ts";

describe("signWallReceipt", () => {
	it("round-trips verify with same secret", () => {
		const digest = buildVerificationDigest({ patchText: "a", wallVersion: "v1" });
		const signed = signWallReceipt({
			digest,
			wallVersion: "v1",
			secret: "test-secret",
			signedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(verifyWallReceipt({ signed, secret: "test-secret" })).toBe(true);
		expect(verifyWallReceipt({ signed, secret: "wrong" })).toBe(false);
	});
});

describe("evaluateCorrectnessWall signedReceipt", () => {
	it("attaches signedReceipt when receiptSigningSecret set", async () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/src/x.ts",
			"+++ b/packages/adaptorch-wpl/src/x.ts",
			"@@ -1 +1 @@",
			"+//",
		].join("\n");
		const { receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			diffText: diff,
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			previewOnly: true,
			receiptSigningSecret: "signing-key",
		});
		expect(receipt.signedReceipt?.algorithm).toBe("hmac-sha256-hex");
		expect(receipt.signedReceipt?.signature.length).toBeGreaterThan(16);
	});
});
