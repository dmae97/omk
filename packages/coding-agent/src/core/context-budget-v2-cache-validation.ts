import type { ContextRepresentationCandidateV2 } from "./context-budget-headroom.ts";
import {
	computeContextBudgetOutputTextHashV2,
	computeContextBudgetRepresentationFingerprintV2,
	computeContextBudgetTargetTokenBucketV2,
} from "./context-budget-v2-cache-keys.ts";
import type { PlannedItemV2 } from "./context-budget-v2-scoring.ts";
import type {
	ContextBudgetPlanCacheEntryV2,
	ContextBudgetRepresentationCacheReadV2,
	ContextBudgetRepresentationCacheRejectReasonV2,
} from "./context-budget-v2-types.ts";

interface ContextBudgetCacheValidationRuntimeV2 {
	readonly keyBase: {
		readonly modelId: string;
		readonly policyVersion: string;
		readonly tokenizerId: string;
		readonly compressorPolicyHash?: string;
		readonly qualityPolicyHash?: string;
	};
	readonly nowEpochMs: number;
	readonly ttlMs: number;
}

export function validateContextBudgetPlanCacheEntryV2(input: {
	readonly entry: ContextBudgetPlanCacheEntryV2;
	readonly planned: readonly PlannedItemV2[];
	readonly availableTokens: number;
	readonly cache: ContextBudgetCacheValidationRuntimeV2;
}): string | undefined {
	if (isContextBudgetCacheEntryStaleV2(input.entry.createdAtEpochMs, input.cache.nowEpochMs, input.cache.ttlMs)) {
		return "stale";
	}
	if (input.entry.plan.selectedRepresentations.some((representation) => representation.cache?.hit === true)) {
		return "cache_dependency_unsafe";
	}
	if (input.entry.plan.usedTokens > input.availableTokens) return "budget_mismatch";
	const currentSourceHashes = sourceHashesByContextBudgetItemIdV2(input.planned);
	for (const [itemId, sourceHash] of Object.entries(currentSourceHashes)) {
		if (input.entry.sourceHashes[itemId] !== sourceHash) return "source_hash_mismatch";
	}
	return undefined;
}

export function validateContextBudgetRepresentationCacheEntryV2(input: {
	readonly cached: ContextBudgetRepresentationCacheReadV2;
	readonly candidate: ContextRepresentationCandidateV2;
	readonly cache: ContextBudgetCacheValidationRuntimeV2;
	readonly sourceHash: string;
}): ContextBudgetRepresentationCacheRejectReasonV2 | undefined {
	const entry = input.cached.entry;
	if (entry.kind !== input.candidate.kind) return "kind_mismatch";
	if (entry.sourceHash !== input.sourceHash) return "source_hash_mismatch";
	if (entry.keyKind === "materialized") {
		return validateContextBudgetMaterializedRepresentationCacheEntryV2(input);
	}
	if (entry.representationFingerprint !== computeContextBudgetRepresentationFingerprintV2(input.candidate)) {
		return "fingerprint_mismatch";
	}
	return validateSharedRepresentationCacheEntryV2(input);
}

export function validateContextBudgetMaterializedRepresentationCacheEntryV2(input: {
	readonly cached: ContextBudgetRepresentationCacheReadV2;
	readonly candidate: ContextRepresentationCandidateV2;
	readonly cache: ContextBudgetCacheValidationRuntimeV2;
	readonly sourceHash: string;
}): ContextBudgetRepresentationCacheRejectReasonV2 | undefined {
	const entry = input.cached.entry;
	if (entry.kind !== input.candidate.kind) return "kind_mismatch";
	if (entry.sourceHash !== input.sourceHash) return "source_hash_mismatch";
	const sharedRejection = validateSharedRepresentationCacheEntryV2(input);
	if (sharedRejection) return sharedRejection;
	if (
		entry.compressorPolicyHash !== undefined &&
		entry.compressorPolicyHash !== input.cache.keyBase.compressorPolicyHash
	) {
		return "policy_mismatch";
	}
	if (entry.qualityPolicyHash !== undefined && entry.qualityPolicyHash !== input.cache.keyBase.qualityPolicyHash) {
		return "policy_mismatch";
	}
	if (
		entry.targetTokenBucket !== undefined &&
		entry.targetTokenBucket !== computeContextBudgetTargetTokenBucketV2(input.candidate.estimatedTokens)
	) {
		return "token_invalid";
	}
	if (entry.outputTextHash !== computeContextBudgetOutputTextHashV2(entry.text)) return "poisoned";
	const verification = entry.verification;
	if (!verification) return "poisoned";
	if ((verification.queryCoverage ?? 0) < materializedCoverageFloor(input.candidate)) return "poisoned";
	if ((verification.sourceCoverage ?? 0) < materializedCoverageFloor(input.candidate)) return "poisoned";
	if ((verification.secretLeakScore ?? 1) > 0) return "poisoned";
	if ((verification.poisonScore ?? 1) > 0) return "poisoned";
	return undefined;
}

function validateSharedRepresentationCacheEntryV2(input: {
	readonly cached: ContextBudgetRepresentationCacheReadV2;
	readonly cache: ContextBudgetCacheValidationRuntimeV2;
}): ContextBudgetRepresentationCacheRejectReasonV2 | undefined {
	const entry = input.cached.entry;
	if (entry.policyVersion !== input.cache.keyBase.policyVersion) return "policy_mismatch";
	if (entry.modelId !== input.cache.keyBase.modelId) return "model_mismatch";
	if (entry.tokenizerId !== input.cache.keyBase.tokenizerId) return "tokenizer_mismatch";
	if (!Number.isFinite(entry.estimatedTokens) || entry.estimatedTokens < 0) return "token_invalid";
	if (isContextBudgetCacheEntryStaleV2(entry.createdAtEpochMs, input.cache.nowEpochMs, input.cache.ttlMs))
		return "stale";
	return undefined;
}

function materializedCoverageFloor(candidate: ContextRepresentationCandidateV2): number {
	if (candidate.kind === "headroom-compressed") return 0.5;
	return 0.75;
}

export function sourceHashesByContextBudgetItemIdV2(planned: readonly PlannedItemV2[]): Record<string, string> {
	const hashes: Record<string, string> = {};
	for (const item of planned) {
		hashes[item.item.id] = item.contentHash;
	}
	return hashes;
}

export function isContextBudgetCacheEntryStaleV2(
	createdAtEpochMs: number | undefined,
	nowEpochMs: number,
	ttlMs: number,
): boolean {
	if (createdAtEpochMs === undefined) return false;
	return nowEpochMs - createdAtEpochMs > ttlMs;
}
