/**
 * Per-run memo for DAG schedules. A plan is a pure function of the keyed
 * inputs, so replaying it is safe — but only while every input the key cannot
 * fingerprint stays stable. A custom `resourceKeyResolver` or any tool whose
 * `resourceClaims` is a function closure can answer differently on identical
 * call shapes, so those batches bypass the memo entirely (audit §9).
 */

import { type DagSchedulePlan, type ScheduleDagLevelsOptions, scheduleDagLevels } from "./tool-dag-scheduler.ts";
import { awaitWithAbort } from "./tool-execution-boundary.ts";
import type { ClaimableToolCall } from "./tool-resource-claims.ts";

/** Bounded per-run memo for DAG schedules. */
export type DagScheduleCache = Map<string, DagSchedulePlan>;

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
 * `null` when the underlying schedule was aborted. Cached levels are handed
 * out as copies because callers append to and reorder them.
 */
export async function scheduleDagLevelsMemo(
	toolCalls: readonly ClaimableToolCall[],
	options: ScheduleDagLevelsOptions,
	signal: AbortSignal | undefined,
	cache: DagScheduleCache,
): Promise<DagSchedulePlan | null> {
	// Skip the memo whenever resolution can depend on state the key cannot
	// fingerprint: a custom resourceKeyResolver, or any tool whose resourceClaims
	// is a function closure — its return value may change between identical
	// calls, and a stale cached plan would silently reuse its old claims.
	if (
		options.resourceKeyResolver ||
		options.registeredTools?.some((tool) => typeof tool.resourceClaims === "function")
	) {
		const scheduled = await awaitWithAbort(() => scheduleDagLevels(toolCalls, options), signal);
		return scheduled.kind === "aborted" ? null : scheduled.value;
	}
	const key = dagScheduleCacheKey(toolCalls, options);
	const cached = cache.get(key);
	if (cached) {
		cache.delete(key);
		cache.set(key, cached);
		return { levels: cached.levels.map((level) => level.slice()), planKey: cached.planKey, entries: cached.entries };
	}
	const scheduled = await awaitWithAbort(() => scheduleDagLevels(toolCalls, options), signal);
	if (scheduled.kind === "aborted") {
		return null;
	}
	if (cache.size >= DAG_SCHEDULE_CACHE_LIMIT) {
		const oldest = cache.keys().next();
		if (!oldest.done) {
			cache.delete(oldest.value);
		}
	}
	cache.set(key, {
		levels: scheduled.value.levels.map((level) => level.slice()),
		planKey: scheduled.value.planKey,
		entries: scheduled.value.entries,
	});
	return scheduled.value;
}
