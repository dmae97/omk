/**
 * Verification digest for receipts — patch + evidence fingerprints without secret material.
 */

import { createHash } from "node:crypto";

export interface VerificationDigestInput {
	/** Unified diff or patch text (hashed, not echoed). */
	patchText?: string;
	/** Opaque evidence blobs (e.g. run artifact excerpts); only digests are retained. */
	evidenceChunks?: string[];
	/** Correctness wall policy batch id (included in composite hash when set). */
	wallVersion?: string;
}

export interface VerificationDigest {
	algorithm: "sha256-hex";
	patchHash: string | null;
	evidenceHashes: string[];
	compositeHash: string;
	/** Wall receipt batch id when supplied at digest build time. */
	wallVersion?: string;
}

/** Wall-scoped receipt metadata paired with digest fingerprints. */
export interface WallReceiptMeta {
	wallVersion: string;
	compositeHash: string;
}

function sha256Hex(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Build a stable verification digest from patch and evidence. No secrets or raw payloads in output.
 */
export function buildVerificationDigest(input: VerificationDigestInput): VerificationDigest {
	const patchHash = input.patchText !== undefined && input.patchText.length > 0 ? sha256Hex(input.patchText) : null;
	const evidenceHashes = (input.evidenceChunks ?? []).filter((c) => c.length > 0).map((c) => sha256Hex(c));
	const wallVersion = input.wallVersion !== undefined && input.wallVersion.length > 0 ? input.wallVersion : undefined;
	const compositeMaterial = [wallVersion ?? "", patchHash ?? "", ...evidenceHashes].join("|");
	const compositeHash = sha256Hex(compositeMaterial || "empty");

	return {
		algorithm: "sha256-hex",
		patchHash,
		evidenceHashes,
		compositeHash,
		...(wallVersion !== undefined ? { wallVersion } : {}),
	};
}
