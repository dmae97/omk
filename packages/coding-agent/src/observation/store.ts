/**
 * Bounded raw-observation store — U1.
 *
 * Session-scoped, in-memory, deterministic. Stores exact bytes with their
 * execution identity, and serves byte-range reads that snap to UTF-8 code-point
 * boundaries rather than emitting silently-corrupted text. Over-capacity puts
 * fail closed with `archive-unavailable` instead of silently evicting evidence.
 */

import { ensure, integer, text } from "../metacognition/validation.ts";
import { observationId as makeObservationId, sha256Hex } from "./identity.ts";
import type {
	ObservationKind,
	ObservationPrivacy,
	ObservationRead,
	ObservationReadResult,
	ObservationStatus,
	RawObservation,
} from "./types.ts";

export interface ObservationStoreOptions {
	readonly maxObservations?: number;
	readonly maxTotalBytes?: number;
	readonly maxObservationBytes?: number;
}

const DEFAULT_MAX_OBSERVATIONS = 512;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_OBSERVATION_BYTES = 8 * 1024 * 1024;

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: false });

/** Snap a byte offset down to the nearest UTF-8 code-point boundary. */
function snapUtf8Boundary(bytes: Uint8Array, offset: number): { offset: number; normalized: boolean } {
	if (offset <= 0 || offset >= bytes.length)
		return { offset: Math.max(0, Math.min(offset, bytes.length)), normalized: false };
	// A continuation byte is 0b10xxxxxx; walk back to a lead byte or ASCII.
	let i = offset;
	while (i > 0 && (bytes[i]! & 0xc0) === 0x80) i -= 1;
	return { offset: i, normalized: i !== offset };
}

export class ObservationStore {
	private readonly maxObservations: number;
	private readonly maxTotalBytes: number;
	private readonly maxObservationBytes: number;
	private readonly byId = new Map<string, RawObservation>();
	private totalBytes = 0;

	constructor(options: ObservationStoreOptions = {}) {
		this.maxObservations = options.maxObservations ?? DEFAULT_MAX_OBSERVATIONS;
		this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
		this.maxObservationBytes = options.maxObservationBytes ?? DEFAULT_MAX_OBSERVATION_BYTES;
	}

	/** Store one raw observation. Throws (fails closed) on malformed input or capacity. */
	put(input: {
		readonly sessionId: string;
		readonly runId: string;
		readonly operationId: string;
		readonly sequence: number;
		readonly bytes: Uint8Array;
		readonly status: ObservationStatus;
		readonly kind?: ObservationKind;
		readonly privacy?: ObservationPrivacy;
		readonly sourceComplete?: boolean;
		readonly toolCallId?: string;
	}): RawObservation {
		text(input.sessionId, "sessionId", 256);
		text(input.runId, "runId", 256);
		text(input.operationId, "operationId", 256);
		integer(input.sequence, "sequence");
		ensure(input.bytes instanceof Uint8Array, "bytes must be a Uint8Array");
		ensure(input.bytes.length <= this.maxObservationBytes, "observation exceeds per-item cap");
		if (this.byId.size >= this.maxObservations || this.totalBytes + input.bytes.length > this.maxTotalBytes) {
			throw new Error("archive-unavailable: observation store capacity exceeded");
		}
		const rawDigest = sha256Hex(input.bytes);
		const id = makeObservationId({
			runId: input.runId,
			operationId: input.operationId,
			sequence: input.sequence,
			rawDigest,
		});
		const observation: RawObservation = Object.freeze({
			observationId: id,
			sessionId: input.sessionId,
			runId: input.runId,
			operationId: input.operationId,
			sequence: input.sequence,
			rawDigest,
			byteLength: input.bytes.length,
			bytes: input.bytes,
			status: input.status,
			kind: input.kind ?? "generic",
			privacy: input.privacy ?? "raw-private",
			sourceComplete: input.sourceComplete ?? true,
			...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
		});
		this.byId.set(id, observation);
		this.totalBytes += input.bytes.length;
		return observation;
	}

	get(observationId: string): RawObservation | undefined {
		return this.byId.get(observationId);
	}

	has(observationId: string): boolean {
		return this.byId.has(observationId);
	}

	/**
	 * Scoped byte-range read. `scopeSessionId` must equal the observation's own
	 * session — a handle never crosses a session boundary. Byte offsets snap to
	 * UTF-8 boundaries; a `strict` range that lands mid-codepoint returns
	 * `utf8-boundary` instead of emitting corrupted text.
	 */
	read(input: {
		readonly observationId: string;
		readonly scopeSessionId: string;
		readonly byteOffset: number;
		readonly maxBytes: number;
		readonly strict?: boolean;
	}): ObservationReadResult {
		text(input.observationId, "observationId", 128);
		text(input.scopeSessionId, "scopeSessionId", 256);
		integer(input.byteOffset, "byteOffset");
		integer(input.maxBytes, "maxBytes");
		ensure(input.maxBytes > 0, "maxBytes must be positive");
		const observation = this.byId.get(input.observationId);
		if (!observation) return { ok: false, error: "observation-not-found" };
		if (observation.sessionId !== input.scopeSessionId) {
			return { ok: false, error: "scope-mismatch" };
		}
		if (input.byteOffset > observation.byteLength) {
			return { ok: false, error: "invalid-range" };
		}
		const snapped = snapUtf8Boundary(observation.bytes, input.byteOffset);
		if (input.strict && snapped.normalized) return { ok: false, error: "utf8-boundary" };
		const start = snapped.offset;
		const end = Math.min(observation.byteLength, start + input.maxBytes);
		const chunk = observation.bytes.slice(start, end);
		const read: ObservationRead = {
			observationId: observation.observationId,
			text: UTF8_DECODER.decode(chunk),
			byteOffset: start,
			byteLength: chunk.length,
			nextOffset: end,
			eof: end >= observation.byteLength,
			truncated: end < observation.byteLength,
			sourceComplete: observation.sourceComplete,
			normalized: snapped.normalized,
		};
		return { ok: true, read };
	}

	get size(): number {
		return this.byId.size;
	}

	get bytes(): number {
		return this.totalBytes;
	}
}
