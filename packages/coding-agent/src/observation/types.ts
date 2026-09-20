/**
 * Observation kernel types — U1/U2 of the upgraded SoL-Pi design.
 *
 * Raw observations are host-owned execution artifacts. Model-facing views are
 * derived projections and never replace the raw authority: `taskVerdict` is
 * always `not-assessed` here because a view cannot prove completion.
 */

export type ObservationStatus = "exit" | "signal" | "partial" | "unavailable";
export type ObservationPrivacy = "raw-private" | "approved-sanitized";
export type ObservationKind = "log" | "test" | "command" | "file" | "dom" | "network" | "generic";

/**
 * A stored execution artifact. `observationId` binds the run, operation and
 * sequence to the content digest, so two identical byte outputs from different
 * executions remain distinct events (never content-hash deduped into one).
 */
export interface RawObservation {
	readonly observationId: string;
	readonly sessionId: string;
	readonly runId: string;
	readonly operationId: string;
	readonly sequence: number;
	readonly rawDigest: string;
	readonly byteLength: number;
	readonly bytes: Uint8Array;
	readonly status: ObservationStatus;
	readonly kind: ObservationKind;
	readonly privacy: ObservationPrivacy;
	/** False when the capture itself was truncated upstream — never claim "full raw". */
	readonly sourceComplete: boolean;
	readonly toolCallId?: string;
}

export type ObservationViewKind = "full" | "excerpt" | "evidence" | "pointer";
export type ObservationCoverageStatus = "complete" | "partial" | "unknown";

/**
 * A model-facing projection of a stored observation. `transformationDigest`
 * binds the view to the deterministic transform that produced it, and
 * `coverageStatus` records whether the view preserves the required fact atoms.
 */
export interface ObservationView {
	readonly viewKind: ObservationViewKind;
	readonly observationId: string;
	readonly parentDigest: string;
	readonly transformationDigest: string;
	readonly text: string;
	readonly estimatedTokens: number;
	readonly coveredFactIds: readonly string[];
	readonly missingRequiredFactIds: readonly string[];
	readonly coverageStatus: ObservationCoverageStatus;
	readonly taskVerdict: "not-assessed";
}

/** Result of a scoped, byte-bounded read against a stored observation. */
export interface ObservationRead {
	readonly observationId: string;
	readonly text: string;
	readonly byteOffset: number;
	readonly byteLength: number;
	readonly nextOffset: number;
	readonly eof: boolean;
	readonly truncated: boolean;
	readonly sourceComplete: boolean;
	/** True when the requested byte range was snapped to UTF-8 boundaries. */
	readonly normalized: boolean;
}

export type ObservationReadError =
	| "observation-not-found"
	| "scope-mismatch"
	| "invalid-range"
	| "utf8-boundary"
	| "archive-unavailable";

export type ObservationReadResult =
	| { readonly ok: true; readonly read: ObservationRead }
	| { readonly ok: false; readonly error: ObservationReadError };
