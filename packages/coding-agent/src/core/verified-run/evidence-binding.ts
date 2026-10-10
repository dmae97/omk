import {
	CLAIM_GRAPH_SCHEMA_VERSION,
	evaluateProofClosure,
	type ProofClosureResult,
	type RunContract,
	type WorkspaceCompleteness,
} from "omk-protocol";
import { digestBytes, VerifiedRunError } from "./storage.ts";

export interface CheckObservation {
	readonly claimId: string;
	readonly executionId: string;
	readonly stdoutDigest: string;
	readonly stderrDigest: string;
	readonly exitCode: number | null;
	readonly failure: string | null;
	readonly receiptCoreDigest?: string;
}

export function parseCheckObservations(value: unknown, nativeRequired: boolean): readonly CheckObservation[] {
	if (!Array.isArray(value) || value.length > 32) throw new VerifiedRunError("integrity");
	const rawChecks: readonly unknown[] = value;
	const claims = new Set<string>();
	const executions = new Set<string>();
	return Object.freeze(
		rawChecks.map((raw): CheckObservation => {
			if (
				typeof raw !== "object" ||
				raw === null ||
				!("claimId" in raw) ||
				typeof raw.claimId !== "string" ||
				!raw.claimId.trim() ||
				claims.has(raw.claimId) ||
				!("executionId" in raw) ||
				typeof raw.executionId !== "string" ||
				!raw.executionId.trim() ||
				executions.has(raw.executionId) ||
				!("stdoutDigest" in raw) ||
				typeof raw.stdoutDigest !== "string" ||
				!/^[a-f0-9]{64}$/.test(raw.stdoutDigest) ||
				!("stderrDigest" in raw) ||
				typeof raw.stderrDigest !== "string" ||
				!/^[a-f0-9]{64}$/.test(raw.stderrDigest) ||
				!("exitCode" in raw) ||
				(raw.exitCode !== null && (typeof raw.exitCode !== "number" || !Number.isSafeInteger(raw.exitCode))) ||
				!("failure" in raw) ||
				(raw.failure !== null && typeof raw.failure !== "string")
			)
				throw new VerifiedRunError("integrity");
			const native = "receiptCoreDigest" in raw ? raw.receiptCoreDigest : undefined;
			if (nativeRequired && (typeof native !== "string" || !/^[a-f0-9]{64}$/.test(native)))
				throw new VerifiedRunError("integrity");
			if (!nativeRequired && native !== undefined) throw new VerifiedRunError("integrity");
			claims.add(raw.claimId);
			executions.add(raw.executionId);
			return Object.freeze({
				claimId: raw.claimId,
				executionId: raw.executionId,
				stdoutDigest: raw.stdoutDigest,
				stderrDigest: raw.stderrDigest,
				exitCode: raw.exitCode,
				failure: raw.failure,
				...(typeof native === "string" ? { receiptCoreDigest: native } : {}),
			});
		}),
	);
}

interface RunClaimContext {
	readonly candidate: string;
	readonly environment: string;
	readonly checks: readonly CheckObservation[];
	readonly unresolvedEffectIds?: readonly string[];
	readonly workspaceCompleteness?: WorkspaceCompleteness;
}

/** Only the authenticated adapter supplies these observations; the reducer itself grants no trust. */
export function closesRunClaims(contract: RunContract, context: RunClaimContext): boolean {
	try {
		return evaluateRunClaims(contract, context).verdict === "verified";
	} catch (error) {
		if (error instanceof VerifiedRunError && error.code === "integrity") return false;
		throw error;
	}
}

/** Read-only closure explanation; missing checks and live effects remain unresolved. */
export function evaluateRunClaims(contract: RunContract, context: RunClaimContext): ProofClosureResult {
	const claims = new Set<string>();
	const executions = new Set<string>();
	for (const check of context.checks) {
		if (
			!check.claimId.trim() ||
			!check.executionId.trim() ||
			claims.has(check.claimId) ||
			executions.has(check.executionId) ||
			!contract.checks.some((expected) => expected.claimId === check.claimId)
		)
			throw new VerifiedRunError("integrity");
		claims.add(check.claimId);
		executions.add(check.executionId);
	}
	const graph = {
		schemaVersion: CLAIM_GRAPH_SCHEMA_VERSION,
		claims: contract.checks.map((check) => ({
			claimId: check.claimId,
			kind: "requirement" as const,
			statement: `Exact stdout for ${check.claimId}`,
			severity: "required" as const,
			satisfaction: { rule: "all" as const, inputs: [] },
			trustFloor: "trusted_attestation" as const,
			invalidationKeys: [],
			scopeSensitive: true,
		})),
	};
	const observations = context.checks.map((check) => ({
		observationId: check.executionId,
		claimIds: [check.claimId],
		source: "trusted_attestation" as const,
		polarity:
			check.exitCode === 0 &&
			check.failure === null &&
			contract.checks.some(
				(expected) => expected.claimId === check.claimId && digestBytes(expected.stdout) === check.stdoutDigest,
			)
				? ("supports" as const)
				: ("violates" as const),
		sourceRoot: context.candidate,
		environmentDigest: context.environment,
		independenceGroup: check.executionId,
	}));
	return evaluateProofClosure({
		graph,
		observations,
		witnessIndependence: "explicit-groups",
		waivers: [],
		sourceRoot: context.candidate,
		environmentDigest: context.environment,
		workspaceCompleteness: context.workspaceCompleteness ?? "complete",
		unresolvedEffectIds: context.unresolvedEffectIds ?? [],
		now: "1970-01-01T00:00:00.000Z",
	});
}
