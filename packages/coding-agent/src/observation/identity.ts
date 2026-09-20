/**
 * Observation identity and digests — U1.
 *
 * `observationId` binds an execution event (run, operation, sequence) to its
 * content digest. It is intentionally not a bare content hash: identical bytes
 * from two different executions are different events and must not collapse into
 * one record. Digests here are integrity checks, not provenance authentication.
 */
import { createHash } from "node:crypto";
import { integer, text } from "../metacognition/validation.ts";

export function sha256Hex(data: Uint8Array | string): string {
	return createHash("sha256")
		.update(data as Uint8Array)
		.digest("hex");
}

export function observationId(input: {
	readonly runId: string;
	readonly operationId: string;
	readonly sequence: number;
	readonly rawDigest: string;
}): string {
	text(input.runId, "runId", 256);
	text(input.operationId, "operationId", 256);
	integer(input.sequence, "sequence");
	text(input.rawDigest, "rawDigest", 128);
	return sha256Hex(`${input.runId}${input.operationId}${input.sequence}${input.rawDigest}`);
}

/** Deterministic digest of a derived view's transform + source + params. */
export function viewDigestOf(input: {
	readonly observationId: string;
	readonly viewKind: string;
	readonly params: string;
}): string {
	text(input.observationId, "observationId", 128);
	text(input.viewKind, "viewKind", 32);
	return sha256Hex(`${input.observationId}${input.viewKind}${input.params}`);
}
