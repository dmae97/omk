/**
 * Per-run memo for DAG schedules. A plan is a pure function of the keyed
 * inputs, so replaying it is safe — but only while every input the key cannot
 * fingerprint stays stable. A custom `resourceKeyResolver` or any tool whose
 * `resourceClaims` is a function closure can answer differently on identical
 * call shapes, so those batches bypass the memo entirely (audit §9).
 */

import { copyDagClaimEntries, copyDagSchedulePlan } from "./tool-dag-plan-copy.ts";
import {
	type DagSchedulePlan,
	type ResolvedClaimEntry,
	resolveBatchClaims,
	type ScheduleDagLevelsOptions,
	scheduleDagLevels,
} from "./tool-dag-scheduler.ts";
import { awaitWithAbort } from "./tool-execution-boundary.ts";
import type { ClaimableToolCall } from "./tool-resource-claims.ts";

/** Bounded per-run memo for DAG schedules. */
export type DagScheduleCache = Map<string, DagSchedulePlan>;
/** This cache never contains compatibility barrier levels. Do not share it with DagScheduleCache. */
export type DagFrontierScheduleCache = Map<string, readonly ResolvedClaimEntry[]>;

export const DAG_SCHEDULE_CACHE_LIMIT = 64;

/**
 * Canonical key covering every input claim resolution depends on. A custom
 * `resourceKeyResolver` function cannot be fingerprinted, so callers skip the
 * memo entirely when one is configured. Within a run, tool definitions (and
 * their `resourceClaims` closures) are stable, so name/mode/claims-presence
 * fingerprints are sufficient.
 */
function dagScheduleCacheKey(toolCalls: readonly ClaimableToolCall[], options: ScheduleDagLevelsOptions): string {
	const policies = [...(options.toolPolicies?.entries() ?? [])].sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	const registered = (options.registeredTools ?? []).map((tool) => [
		tool.name,
		tool.executionMode ?? "",
		typeof tool.resourceClaims === "function" ? "1" : "0",
	]);
	return JSON.stringify([
		toolCalls.map((call) => [call.name, call.arguments ?? null]),
		options.cwd,
		options.strictExtensionClaims === true,
		options.maxConcurrency ?? null,
		policies,
		registered,
	]);
}

/**
 * Schedule with a per-run memo. Identical batches (provider retries, stubborn
 * re-emissions) re-resolve path identities and custom claims; the plan is a
 * pure function of the canonical inputs, so replaying it is safe. Returns
 * `null` on cancellation, including cache hits before key serialization. Cached levels are handed
 * out as copies because callers append to and reorder them.
 */
export function scheduleDagLevelsMemo(
	toolCalls: readonly ClaimableToolCall[],
	options: ScheduleDagLevelsOptions,
	signal: AbortSignal | undefined,
	cache: DagScheduleCache,
): Promise<DagSchedulePlan | null> {
	return memoizeDagSchedule(
		toolCalls,
		options,
		signal,
		cache,
		() => scheduleDagLevels(toolCalls, options),
		copyDagSchedulePlan,
	);
}

/** Live ready-frontier intake needs resolved claims, not barrier levels. */
export function resolveDagFrontierMemo(
	toolCalls: readonly ClaimableToolCall[],
	options: ScheduleDagLevelsOptions,
	signal: AbortSignal | undefined,
	cache: DagFrontierScheduleCache,
): Promise<readonly ResolvedClaimEntry[] | null> {
	return memoizeDagSchedule(
		toolCalls,
		options,
		signal,
		cache,
		() => resolveBatchClaims(toolCalls, options),
		copyDagClaimEntries,
	);
}

async function memoizeDagSchedule<T>(
	toolCalls: readonly ClaimableToolCall[],
	options: ScheduleDagLevelsOptions,
	signal: AbortSignal | undefined,
	cache: Map<string, T>,
	compute: () => Promise<T>,
	copy: (value: T) => T,
): Promise<T | null> {
	if (signal?.aborted) return null;
	// Closures and custom resolvers can change their claims without changing a key.
	if (
		options.resourceKeyResolver ||
		options.registeredTools?.some((tool) => typeof tool.resourceClaims === "function")
	) {
		const scheduled = await awaitWithAbort(compute, signal);
		return scheduled.kind === "aborted" ? null : scheduled.value;
	}
	const key = dagScheduleCacheKey(toolCalls, options);
	const cached = cache.get(key);
	if (cached !== undefined) {
		cache.delete(key);
		cache.set(key, cached);
		return copy(cached);
	}
	const scheduled = await awaitWithAbort(compute, signal);
	if (scheduled.kind === "aborted") return null;
	if (cache.size >= DAG_SCHEDULE_CACHE_LIMIT) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	cache.set(key, copy(scheduled.value));
	return scheduled.value;
}
