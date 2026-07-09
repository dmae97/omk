/**
 * Optional HMAC receipt attestation (Wave 3 / Pro). No secret material in payload.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { VerificationDigest } from "./signed-receipt.ts";

export interface SignedWallReceipt {
	algorithm: "hmac-sha256-hex";
	digestCompositeHash: string;
	wallVersion: string;
	signature: string;
	signedAt: string;
}

export interface SignWallReceiptInput {
	digest: VerificationDigest;
	wallVersion: string;
	secret: string;
	signedAt?: string;
}

/**
 * Sign the composite hash of a verification digest. Caller must not log `secret`.
 */
export function signWallReceipt(input: SignWallReceiptInput): SignedWallReceipt {
	const signedAt = input.signedAt ?? new Date().toISOString();
	const material = [input.wallVersion, input.digest.compositeHash, signedAt].join("|");
	const signature = createHmac("sha256", input.secret).update(material, "utf8").digest("hex");
	return {
		algorithm: "hmac-sha256-hex",
		digestCompositeHash: input.digest.compositeHash,
		wallVersion: input.wallVersion,
		signature,
		signedAt,
	};
}

export interface VerifyWallReceiptInput {
	signed: SignedWallReceipt;
	secret: string;
}

/** Constant-time verify when lengths match. */
export function verifyWallReceipt(input: VerifyWallReceiptInput): boolean {
	const material = [input.signed.wallVersion, input.signed.digestCompositeHash, input.signed.signedAt].join("|");
	const expected = createHmac("sha256", input.secret).update(material, "utf8").digest("hex");
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(input.signed.signature, "utf8");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
