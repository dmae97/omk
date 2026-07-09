/**
 * Deep Correctness Wall — stub default, plus evidence-gated runner injection (Wave 4-C3b).
 *
 * `completed` is NEVER emitted unless a caller injects a `runner`, sets
 * `allowCompletion`, AND the runner returns structured evidence. Without all
 * three, the result is downgraded to `unavailable`. This is a candidate-patch-leak
 * guard: deep completion must be evidence-backed, never asserted.
 */

import { BATCH1_NO_DOCKER_RUNNER } from "./b2c-mapper.ts";

export type DeepWallStatus = "not_requested" | "unavailable" | "completed";

export type DeepWallPhase = "stub" | "docker";

export const DEEP_WALL_UNAVAILABLE = "DEEP_WALL_UNAVAILABLE" as const;

/** Policy flag when deep wall would report completed without a wired runner (Wave 4 gate). */
export const DEEP_RUNNER_NOT_WIRED = "DEEP_RUNNER_NOT_WIRED" as const;

/** Policy flag when an injected runner returned `completed` without valid evidence (downgraded). */
export const DEEP_RUNNER_EVIDENCE_MISSING = "DEEP_RUNNER_EVIDENCE_MISSING" as const;

/** Policy flag when an injected runner threw (caught, treated as unavailable). */
export const DEEP_RUNNER_ERROR = "DEEP_RUNNER_ERROR" as const;

/** Structured evidence a runner MUST attach to a `completed` result. */
export interface DeepWallRunnerEvidence {
	/** Content digest of what was checked (e.g. sha256 of replayed patch + base). */
	digest: string;
	/** The exact command/provenance the runner executed. */
	command: string;
	/** Runner exit code; `completed` requires `0` by runner contract. */
	exitCode: number;
}

export interface DeepWallRunnerResult {
	status: "completed" | "unavailable";
	evidence?: DeepWallRunnerEvidence;
	message: string;
}

export type DeepWallRunnerFn = (params: RunDeepWallStubParams) => Promise<DeepWallRunnerResult>;

export interface RunDeepWallStubParams {
	kind: string;
	runIds?: string[];
	packetId?: string;
	/** Wave 3: `docker` records intent; runner still unavailable until hermetic exec ships. */
	phase?: DeepWallPhase;
	/** Wave 4-C3b: injected hermetic runner. Completion is gated by `allowCompletion` + evidence. */
	runner?: DeepWallRunnerFn;
	/** Must be `true` for a runner to report `completed`; default `false` (stub path). */
	allowCompletion?: boolean;
}

export interface DeepWallStubResult {
	status: Extract<DeepWallStatus, "unavailable">;
	limits: readonly [typeof BATCH1_NO_DOCKER_RUNNER];
	message: string;
}

export interface DeepWallResult {
	status: DeepWallStatus;
	message: string;
	evidence?: DeepWallRunnerEvidence;
	limits?: readonly string[];
	/** Additional policy flags surfaced by the runner path (e.g. evidence-missing, runner-error). */
	runnerFlags?: readonly string[];
}

const DEFAULT_DEEP_WALL_MESSAGE =
	"Deep correctness check is not available in this environment (no docker runner). Use preview fast wall or run checks locally.";

const DOCKER_PHASE_MESSAGE =
	"Deep wall docker phase requested but hermetic runner is not wired yet; fast wall and local CI remain authoritative.";

function hasValidEvidence(e: unknown): e is DeepWallRunnerEvidence {
	if (typeof e !== "object" || e === null) return false;
	const v = e as DeepWallRunnerEvidence;
	return (
		typeof v.digest === "string" &&
		v.digest.length > 0 &&
		typeof v.command === "string" &&
		v.command.length > 0 &&
		typeof v.exitCode === "number" &&
		Number.isFinite(v.exitCode)
	);
}

/** Resolve deep-wall phase from env `OMK_WALL_DEEP_PHASE` (stub | docker). */
export function resolveDeepWallPhaseFromEnv(): DeepWallPhase {
	const raw = process.env.OMK_WALL_DEEP_PHASE?.trim().toLowerCase();
	if (raw === "docker") return "docker";
	return "stub";
}

/**
 * Hermetic deep runner is not shipped by default; `completed` is only reachable
 * via an injected runner through {@link runDeepWall}, and even then requires evidence.
 */
export function isDeepRunnerCompletionAllowed(): boolean {
	return false;
}

/**
 * Stub deep wall: always reports unavailable with batch-1 limit code (no docker exec).
 */
export function runDeepWallStub(params: RunDeepWallStubParams): DeepWallStubResult {
	const phase = params.phase ?? resolveDeepWallPhaseFromEnv();
	const message = phase === "docker" ? DOCKER_PHASE_MESSAGE : DEFAULT_DEEP_WALL_MESSAGE;
	return {
		status: "unavailable",
		limits: [BATCH1_NO_DOCKER_RUNNER],
		message,
	};
}

/**
 * Evidence-gated deep wall entry point.
 *
 * - No runner, or `allowCompletion !== true` → stub unavailable path.
 * - Runner present + `allowCompletion` → runner is called in a try/catch.
 *   - `completed` + valid evidence → `completed` (evidence attached).
 *   - `completed` without valid evidence → downgraded to `unavailable`
 *     with `DEEP_RUNNER_EVIDENCE_MISSING` (candidate-patch-leak guard).
 *   - runner throws → `unavailable` with `DEEP_RUNNER_ERROR`.
 */
export async function runDeepWall(params: RunDeepWallStubParams): Promise<DeepWallResult> {
	if (params.runner !== undefined && params.allowCompletion === true) {
		try {
			const result = await params.runner(params);
			if (result.status === "completed") {
				if (hasValidEvidence(result.evidence)) {
					return {
						status: "completed",
						evidence: result.evidence,
						message: result.message,
					};
				}
				return {
					status: "unavailable",
					message: "Deep runner reported completed without valid evidence; downgraded to unavailable.",
					runnerFlags: [DEEP_RUNNER_EVIDENCE_MISSING],
				};
			}
			return { status: "unavailable", message: result.message };
		} catch (err) {
			return {
				status: "unavailable",
				message: `Deep runner threw: ${err instanceof Error ? err.message : String(err)}`,
				runnerFlags: [DEEP_RUNNER_ERROR],
			};
		}
	}
	const stub = runDeepWallStub(params);
	return { status: stub.status, message: stub.message, limits: stub.limits };
}
